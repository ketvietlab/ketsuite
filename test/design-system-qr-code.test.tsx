import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { QrCode } from '@ketvietlab/design-system'
// The encoder stays internal to the package: the public contract is the drawn symbol.
import {
  alignmentCentres,
  byteCapacity,
  dataCodewords,
  encodeQr,
  reedSolomon,
} from '../packages/design-system/src/data-display/qr-code/encode.ts'
import type {
  QrErrorCorrection,
  QrMatrix,
} from '../packages/design-system/src/data-display/qr-code/encode.ts'

// The checks below read a symbol back the way a scanner does, from the standard's tables and
// placement rules, rather than repeating the encoder's own arithmetic.

const sheet = readFileSync('packages/design-system/src/data-display/qr-code/styles.css', 'utf8')
const rule = (selector: string) => {
  const at = sheet.indexOf(`${selector} {`)
  assert.notEqual(at, -1, `missing rule ${selector}`)
  return sheet.slice(at, sheet.indexOf('}', at))
}

// GF(256) over x^8 + x^4 + x^3 + x^2 + 1, by log and antilog tables.
const EXP = new Array<number>(512)
const LOG = new Array<number>(256)
{
  let value = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = value
    LOG[value] = i
    value <<= 1
    if (value & 0x100) value ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}
/** A block reads clean when its polynomial vanishes at α^0 … α^(ecc − 1). */
const syndromesZero = (block: readonly number[], ecc: number) => {
  for (let i = 0; i < ecc; i++) {
    let sum = 0
    for (const byte of block) sum = (sum === 0 ? 0 : EXP[LOG[sum] + i]) ^ byte
    if (sum !== 0) return false
  }
  return true
}

const LEVEL_OF = ['M', 'L', 'H', 'Q'] as const
const UNMASK: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]
// BCH(15,5) for the format and BCH(18,6) for the version, worked out by long division.
const bch = (data: number, shift: number, generator: number) => {
  let value = data << shift
  for (let bit = 14 + shift; bit >= shift; bit--) if (value & (1 << bit)) value ^= generator << (bit - shift)
  return (data << shift) | value
}

/** Both copies of the format, most significant bit first, as ISO/IEC 18004 places them. */
const readFormat = (m: boolean[][]) => {
  const size = m.length
  const first = [
    ...[0, 1, 2, 3, 4, 5, 7, 8].map((x) => m[8][x]),
    ...[7, 5, 4, 3, 2, 1, 0].map((y) => m[y][8]),
  ]
  const second = [
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => m[size - i][8]),
    ...[8, 7, 6, 5, 4, 3, 2, 1].map((i) => m[8][size - i]),
  ]
  const number = (bits: boolean[]) => bits.reduce((sum, dark) => (sum << 1) | (dark ? 1 : 0), 0)
  return { first: number(first), second: number(second) }
}

/**
 * The text a symbol carries: unmask, read the codewords in the zigzag order, take the blocks
 * apart, check each one's error correction and decode byte mode as UTF-8.
 */
const readSymbol = (matrix: QrMatrix, blocks: number, ecc: number) => {
  const { modules: m, size, version } = matrix
  const format = readFormat(m).first ^ 0x5412
  const mask = (format >>> 10) & 7
  const functional = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const mark = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) functional[y][x] = true
  }
  mark(0, 0, 9, 9)
  mark(size - 8, 0, 8, 9)
  mark(0, size - 8, 9, 8)
  mark(6, 0, 1, size)
  mark(0, 6, size, 1)
  const centres = alignmentCentres(version)
  // Every crossing of the centres has one, except the three under the finders.
  const [low, high] = [centres[0], centres[centres.length - 1]]
  for (const cx of centres)
    for (const cy of centres)
      if (!((cx === low || cy === low) && (cx === low || cx === high) && (cy === low || cy === high)))
        mark(cx - 2, cy - 2, 5, 5)
  if (version >= 7) {
    mark(size - 11, 0, 3, 6)
    mark(0, size - 11, 6, 3)
  }
  const bits: number[] = []
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    // Pairs counted from the right, the timing column skipped; even pairs run upward.
    const column = (size - 1 - (right < 6 ? right + 1 : right)) / 2
    for (let step = 0; step < size; step++) {
      const y = column % 2 === 0 ? size - 1 - step : step
      for (const x of [right, right - 1]) {
        if (functional[y][x]) continue
        bits.push(m[y][x] !== UNMASK[mask](x, y) ? 1 : 0)
      }
    }
  }
  const total = Math.floor(bits.length / 8)
  const codewords = Array.from({ length: total }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((sum, bit) => (sum << 1) | bit, 0),
  )
  // Short blocks first; the long ones hold one more data codeword, interleaved after the rest.
  const long = total % blocks
  const shortData = Math.floor(total / blocks) - ecc
  const parts = Array.from({ length: blocks }, (_, b) => ({
    data: [] as number[],
    length: shortData + (b >= blocks - long ? 1 : 0),
    ecc: [] as number[],
  }))
  let at = 0
  for (let i = 0; i <= shortData; i++)
    for (const part of parts) if (i < part.length) part.data.push(codewords[at++])
  for (let i = 0; i < ecc; i++) for (const part of parts) part.ecc.push(codewords[at++])
  assert.equal(at, total, 'every codeword belongs to a block')
  for (const part of parts)
    assert.ok(syndromesZero([...part.data, ...part.ecc], ecc), 'a block fails its error correction')
  const data = parts.flatMap((part) => part.data)
  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1))
  const take = (n: number) => stream.splice(0, n).reduce((sum, bit) => (sum << 1) | bit, 0)
  assert.equal(take(4), 0b0100, 'byte mode')
  const length = take(version < 10 ? 8 : 16)
  const bytes = Uint8Array.from({ length }, () => take(8))
  return {
    mask,
    level: LEVEL_OF[format >>> 13],
    text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  }
}

test('qr code: capacity follows the standard table for each level', () => {
  const table: [number, QrErrorCorrection, number][] = [
    [1, 'L', 19],
    [1, 'M', 16],
    [1, 'Q', 13],
    [1, 'H', 9],
    [5, 'Q', 62],
    [10, 'M', 216],
    [40, 'L', 2956],
    [40, 'M', 2334],
    [40, 'Q', 1666],
    [40, 'H', 1276],
  ]
  for (const [version, level, codewords] of table)
    assert.equal(dataCodewords(version, level), codewords, `${version}-${level}`)
  // Byte mode spends 4 bits on its mode and 8 (16 from version 10) on the count.
  assert.equal(byteCapacity(1, 'M'), 14)
  assert.equal(byteCapacity(10, 'M'), 213)
  assert.equal(byteCapacity(40, 'L'), 2953)
  assert.deepEqual(alignmentCentres(1), [])
  assert.deepEqual(alignmentCentres(2), [6, 18])
  assert.deepEqual(alignmentCentres(7), [6, 22, 38])
  assert.deepEqual(alignmentCentres(32), [6, 34, 60, 86, 112, 138])
  assert.deepEqual(alignmentCentres(40), [6, 30, 58, 86, 114, 142, 170])
})

test('qr code: the smallest version that holds the text is chosen, and too much text is refused', () => {
  assert.equal(encodeQr('x'.repeat(14)).version, 1)
  assert.equal(encodeQr('x'.repeat(15)).version, 2)
  assert.equal(encodeQr('x'.repeat(2953), { errorCorrection: 'L' }).version, 40)
  assert.throws(() => encodeQr('x'.repeat(2954), { errorCorrection: 'L' }), RangeError)
  assert.equal(encodeQr('x', { minVersion: 7 }).version, 7)
  assert.throws(() => encodeQr('x', { mask: 8 }), RangeError)
  // UTF-8: "đ" is two bytes, so seven of them fill version 1-M exactly.
  assert.equal(encodeQr('đ'.repeat(7)).version, 1)
  assert.equal(encodeQr('đ'.repeat(8)).version, 2)
})

test('qr code: format and version information are the standard BCH codes, drawn twice', () => {
  // Known values from the standard: L/M/Q/H with mask 0, and versions 7, 8 and 40.
  const known: [QrErrorCorrection, number][] = [
    ['L', 0b111011111000100],
    ['M', 0b101010000010010],
    ['Q', 0b011010101011111],
    ['H', 0b001011010001001],
  ]
  for (const [level, bits] of known) {
    const matrix = encodeQr('KET', { errorCorrection: level, mask: 0 })
    assert.deepEqual(readFormat(matrix.modules), { first: bits, second: bits }, level)
  }
  for (const level of ['L', 'M', 'Q', 'H'] as const)
    for (let mask = 0; mask < 8; mask++) {
      const matrix = encodeQr('KET', { errorCorrection: level, mask })
      const expected = bch(({ L: 1, M: 0, Q: 3, H: 2 }[level] << 3) | mask, 10, 0x537) ^ 0x5412
      assert.deepEqual(readFormat(matrix.modules), { first: expected, second: expected }, `${level}${mask}`)
      assert.equal(matrix.mask, mask)
    }
  for (const [version, bits] of [
    [7, 0x07c94],
    [8, 0x085bc],
    [40, 0x28c69],
  ]) {
    assert.equal(bch(version, 12, 0x1f25), bits)
    const m = encodeQr('x', { minVersion: version }).modules
    const size = m.length
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      assert.equal(m[b][a], dark, `version ${version} top-right bit ${i}`)
      assert.equal(m[a][b], dark, `version ${version} bottom-left bit ${i}`)
    }
  }
})

test('qr code: finders, timing and the dark module sit where scanners look for them', () => {
  for (const version of [1, 2, 7, 40]) {
    const { modules: m, size } = encodeQr('x', { minVersion: version })
    assert.equal(size, 17 + 4 * version)
    assert.equal(m.length, size)
    assert.ok(m.every((row) => row.length === size))
    for (const [ox, oy] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ])
      for (let dy = 0; dy < 7; dy++)
        for (let dx = 0; dx < 7; dx++) {
          const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
          assert.equal(m[oy + dy][ox + dx], ring !== 2, `finder at ${ox},${oy} module ${dx},${dy}`)
        }
    // The separators around the finders are light.
    for (let i = 0; i < 8; i++) {
      assert.equal(m[7][i], false)
      assert.equal(m[i][7], false)
      assert.equal(m[7][size - 1 - i], false)
      assert.equal(m[size - 8][i], false)
    }
    for (let i = 8; i < size - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0, `horizontal timing ${i}`)
      assert.equal(m[i][6], i % 2 === 0, `vertical timing ${i}`)
    }
    assert.equal(m[size - 8][8], true, 'dark module')
  }
})

test('qr code: Reed-Solomon matches the standard worked example and every block reads back', () => {
  // The widely published 1-M example: the data codewords of "HELLO WORLD" and their ten ECC.
  assert.deepEqual(
    reedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10),
    [196, 35, 39, 119, 235, 215, 231, 226, 93, 23],
  )
  // [text, level, blocks, error correction codewords per block, version expected]
  const cases: [string, QrErrorCorrection, number, number, number][] = [
    ['https://example.com/pay', 'M', 1, 16, 2],
    ['Thanh toán hóa đơn 0001 — 13.020.000 ₫', 'Q', 4, 18, 5],
    ['x'.repeat(200), 'M', 5, 26, 10],
    [`000201010212${'9'.repeat(120)}6304ABCD`, 'L', 2, 20, 7],
    ['y'.repeat(2953), 'L', 25, 30, 40],
  ]
  for (const [text, level, blocks, ecc, version] of cases) {
    const matrix = encodeQr(text, { errorCorrection: level, minVersion: version })
    assert.equal(matrix.version, version, text.slice(0, 20))
    const read = readSymbol(matrix, blocks, ecc)
    assert.equal(read.text, text)
    assert.equal(read.level, level)
    assert.equal(read.mask, matrix.mask)
  }
  // Every mask reads back, not only the one the penalty picks.
  for (let mask = 0; mask < 8; mask++) {
    const read = readSymbol(encodeQr('https://example.com/pay', { errorCorrection: 'M', mask }), 1, 16)
    assert.deepEqual([read.mask, read.text], [mask, 'https://example.com/pay'])
  }
})

test('qr code: a symbol is an SVG image with its quiet zone, named for what scanning it does', () => {
  const value = 'https://example.com/pay?invoice=0001'
  const html = renderToString(
    <QrCode
      value={value}
      label="Pay invoice 0001 by bank transfer"
      caption="Example Bank · 0001"
      size="small"
    />,
  ).replace(/<!--.*?-->/gs, '')
  const matrix = encodeQr(value, { errorCorrection: 'M' })
  const side = matrix.size + 8
  assert.match(html, /^<figure data-ui="qr-code" data-size="small">/)
  assert.match(
    html,
    new RegExp(
      `<svg data-ui="qr-code-symbol" viewBox="0 0 ${side} ${side}" role="img" aria-label="Pay invoice 0001 by bank transfer" focusable="false" shape-rendering="crispEdges" data-version="${matrix.version}">`,
    ),
  )
  assert.match(html, /<figcaption data-ui="qr-code-caption">Example Bank · 0001<\/figcaption><\/figure>$/)
  // The path draws exactly the dark modules, four modules in from the edge.
  const drawn = Array.from({ length: side }, () => new Array<boolean>(side).fill(false))
  const d = /<path d="([^"]+)"/.exec(html)?.[1] ?? ''
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g))
    for (let i = 0; i < Number(w); i++) {
      assert.equal(drawn[Number(y)][Number(x) + i], false, 'runs do not overlap')
      drawn[Number(y)][Number(x) + i] = true
    }
  assert.equal(d.replace(/M\d+ \d+h(\d+)v1h-\1z/g, ''), '')
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const inside = x >= 4 && y >= 4 && x < side - 4 && y < side - 4
      assert.equal(drawn[y][x], inside ? matrix.modules[y - 4][x - 4] : false, `module ${x},${y}`)
    }
  const bare = renderToString(<QrCode value="x" label="Open the record" />)
  assert.match(bare, /data-size="default"/)
  assert.doesNotMatch(bare, /figcaption/)
  // A stronger level makes a bigger symbol for the same text.
  const strong = renderToString(<QrCode value={value} label="Pay" errorCorrection="H" />)
  assert.match(strong, new RegExp(`data-version="${encodeQr(value, { errorCorrection: 'H' }).version}"`))
  assert.ok(encodeQr(value, { errorCorrection: 'H' }).version > matrix.version)
})

test('qr code: the symbol stays black on white in both themes and prints that way', () => {
  const symbol = rule('[data-ui="qr-code-symbol"]')
  assert.match(symbol, /background: var\(--kv-ref-white\)/)
  assert.match(symbol, /color: var\(--kv-ref-black\)/)
  assert.match(symbol, /aspect-ratio: 1/)
  assert.match(sheet, /@media print \{[^}]*\[data-ui="qr-code-symbol"\] \{\s*print-color-adjust: exact/)
  assert.match(rule('[data-ui="qr-code"][data-size="small"]'), /--kv-qr-code-size: 7\.5rem/)
  assert.match(rule('[data-ui="qr-code"][data-size="large"]'), /--kv-qr-code-size: 13rem/)
  // An account number in the caption is not split between digits while the figure has room.
  const caption = rule('[data-ui="qr-code-caption"]')
  assert.match(caption, /max-inline-size: 100%/)
  assert.match(caption, /overflow-wrap: break-word/)
})
