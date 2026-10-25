/**
 * A QR Code Model 2 encoder (ISO/IEC 18004) for `QrCode`: byte mode over UTF-8, versions 1 to 40,
 * the four error correction levels, Reed-Solomon codewords per block, the eight masks scored by
 * the standard's penalty rules, and the format and version information. It has no dependency and
 * draws nothing: it returns which modules are dark. Its construction follows the one laid out in
 * Project Nayuki's QR Code generator library (MIT).
 */

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'

export type QrEncodeOptions = {
  /** How much of the symbol may be damaged and still read: L 7%, M 15%, Q 25%, H 30%. */
  errorCorrection?: QrErrorCorrection
  /** The smallest version to use, 1 to 40. The encoder picks the smallest one the data fits. */
  minVersion?: number
  /** A fixed mask, 0 to 7. By default the mask with the lowest penalty is chosen. */
  mask?: number
}

export type QrMatrix = {
  version: number
  /** Modules per side: 17 + 4 × version, without the quiet zone. */
  size: number
  errorCorrection: QrErrorCorrection
  mask: number
  /** `modules[y][x]` is true for a dark module. */
  modules: boolean[][]
}

const LEVELS: readonly QrErrorCorrection[] = ['L', 'M', 'Q', 'H']
// The two format bits of each level, in the standard's order (M 00, L 01, H 10, Q 11).
const FORMAT_BITS: Record<QrErrorCorrection, number> = { L: 1, M: 0, Q: 3, H: 2 }

// Error correction codewords per block and number of blocks, by level and version (index 0 unused).
const CODEWORDS_PER_BLOCK: Record<QrErrorCorrection, readonly number[]> = {
  L: [
    0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
}
const BLOCKS: Record<QrErrorCorrection, readonly number[]> = {
  L: [
    0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16,
    17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28,
    29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35,
    38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42,
    45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
}

/** Modules left for data and error correction once the function patterns are drawn. */
export const rawDataModules = (version: number): number => {
  let modules = (16 * version + 128) * version + 64
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2
    modules -= (25 * aligns - 10) * aligns - 55
    if (version >= 7) modules -= 36
  }
  return modules
}

/** The data codewords a version holds at a level, error correction excluded. */
export const dataCodewords = (version: number, level: QrErrorCorrection): number =>
  Math.floor(rawDataModules(version) / 8) - CODEWORDS_PER_BLOCK[level][version] * BLOCKS[level][version]

/** The bytes byte mode can hold in a version at a level: its 4-bit mode and count come first. */
export const byteCapacity = (version: number, level: QrErrorCorrection): number =>
  Math.floor((dataCodewords(version, level) * 8 - 4 - (version < 10 ? 8 : 16)) / 8)

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const multiply = (x: number, y: number): number => {
  let product = 0
  for (let bit = 7; bit >= 0; bit--) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d)
    product ^= ((y >>> bit) & 1) * x
  }
  return product & 0xff
}

/** The Reed-Solomon generator of a degree, highest coefficient omitted, roots α^0 to α^(degree − 1). */
const generator = (degree: number): number[] => {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = multiply(root, 0x02)
  }
  return result
}

/** The error correction codewords of one block: the remainder of its data by the generator. */
export const reedSolomon = (data: readonly number[], degree: number): number[] => {
  const divisor = generator(degree)
  const result = new Array<number>(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number)
    result.push(0)
    for (let i = 0; i < degree; i++) result[i] ^= multiply(divisor[i], factor)
  }
  return result
}

/** The data codewords: mode, count, bytes, terminator, then the 0xEC 0x11 pad. */
const dataBits = (bytes: Uint8Array, version: number, level: QrErrorCorrection): number[] => {
  const bits: number[] = []
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)
  const capacity = dataCodewords(version, level) * 8
  push(0, Math.min(4, capacity - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8)
    codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0))
  for (let pad = 0xec; codewords.length < capacity / 8; pad ^= 0xec ^ 0x11) codewords.push(pad)
  return codewords
}

/** Data split into the version's blocks, each followed by its error correction, interleaved. */
const interleave = (data: readonly number[], version: number, level: QrErrorCorrection): number[] => {
  const blocks = BLOCKS[level][version]
  const degree = CODEWORDS_PER_BLOCK[level][version]
  const total = Math.floor(rawDataModules(version) / 8)
  const short = blocks - (total % blocks)
  const shortLength = Math.floor(total / blocks) - degree
  const parts: { data: number[]; ecc: number[] }[] = []
  for (let index = 0, offset = 0; index < blocks; index++) {
    const length = shortLength + (index < short ? 0 : 1)
    const block = data.slice(offset, offset + length)
    offset += length
    parts.push({ data: block, ecc: reedSolomon(block, degree) })
  }
  const result: number[] = []
  for (let i = 0; i <= shortLength; i++)
    for (const part of parts) if (i < part.data.length) result.push(part.data[i])
  for (let i = 0; i < degree; i++) for (const part of parts) result.push(part.ecc[i])
  return result
}

/** The centres of the alignment patterns along one axis. */
export const alignmentCentres = (version: number): number[] => {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const size = version * 4 + 17
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const result = [6]
  for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position)
  return result
}

/** The 15 format bits of a level and mask: BCH(15,5) with the standard's XOR mask. */
export const formatBits = (level: QrErrorCorrection, mask: number): number => {
  const data = (FORMAT_BITS[level] << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  return ((data << 10) | remainder) ^ 0x5412
}

/** The 18 version bits of a version from 7 up: BCH(18,6). */
export const versionBits = (version: number): number => {
  let remainder = version
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25)
  return (version << 12) | remainder
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** The symbol before any mask: function patterns, then the codewords in the zigzag order. */
const layout = (version: number, codewords: readonly number[]) => {
  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark
    reserved[y][x] = true
  }
  // Timing patterns, then the finders with their separators over them.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx,
          y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const ring = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, ring !== 2 && ring !== 4)
      }
  const centres = alignmentCentres(version)
  const last = centres.length - 1
  for (let i = 0; i <= last; i++)
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(centres[i] + dx, centres[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  // Format areas are reserved now and written once the mask is chosen; the dark module is fixed.
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true
    reserved[i][8] = true
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true
    reserved[size - 1 - i][8] = true
  }
  set(8, size - 8, true)
  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3),
        b = Math.floor(i / 3)
      set(a, b, dark)
      set(b, a, dark)
    }
  }
  // Two columns at a time from the right, upward then downward, skipping the vertical timing column.
  let bit = 0
  const total = codewords.length * 8
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++)
      for (let column = 0; column < 2; column++) {
        const x = right - column
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (reserved[y][x]) continue
        if (bit < total) modules[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1
        bit++
      }
  }
  return { size, modules, reserved }
}

const drawFormat = (modules: boolean[][], level: QrErrorCorrection, mask: number) => {
  const size = modules.length
  const bits = formatBits(level, mask)
  const dark = (i: number) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) modules[i][8] = dark(i)
  modules[7][8] = dark(6)
  modules[8][8] = dark(7)
  modules[8][7] = dark(8)
  for (let i = 9; i < 15; i++) modules[8][14 - i] = dark(i)
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = dark(i)
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = dark(i)
  modules[size - 8][8] = true
}

/** The standard's four penalty rules: runs, 2 × 2 blocks, finder-like patterns and balance. */
export const penalty = (modules: readonly boolean[][]): number => {
  const size = modules.length
  let score = 0
  const lines: boolean[][] = []
  for (let i = 0; i < size; i++) {
    lines.push(modules[i])
    lines.push(modules.map((row) => row[i]))
  }
  const finder = [true, false, true, true, true, false, true]
  for (const line of lines) {
    for (let start = 0; start < size; ) {
      let end = start
      while (end < size && line[end] === line[start]) end++
      if (end - start >= 5) score += 3 + (end - start - 5)
      start = end
    }
    // A finder-like run with four light modules on one side; outside the symbol is light.
    const light = (i: number) => i < 0 || i >= size || !line[i]
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((dark, k) => line[i + k] === dark)) continue
      const before = [1, 2, 3, 4].every((k) => light(i - k))
      const after = [0, 1, 2, 3].every((k) => light(i + 7 + k))
      if (before) score += 40
      if (after) score += 40
    }
  }
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const colour = modules[y][x]
      if (colour === modules[y][x + 1] && colour === modules[y + 1][x] && colour === modules[y + 1][x + 1])
        score += 3
    }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
  const total = size * size
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

/**
 * The modules of the smallest symbol that holds `text` at the level asked for. Throws a RangeError
 * when it does not fit version 40.
 */
export const encodeQr = (text: string, options: QrEncodeOptions = {}): QrMatrix => {
  const level = options.errorCorrection ?? 'M'
  if (!LEVELS.includes(level)) throw new RangeError(`Unknown QR error correction level: ${level}`)
  const bytes = new TextEncoder().encode(text)
  let version = Math.max(1, Math.min(40, Math.trunc(options.minVersion ?? 1)))
  while (version <= 40 && bytes.length > byteCapacity(version, level)) version++
  if (version > 40) throw new RangeError('The text is too long for a QR code')
  const { size, modules, reserved } = layout(
    version,
    interleave(dataBits(bytes, version, level), version, level),
  )
  const masked = (mask: number) => {
    const result = modules.map((row, y) =>
      row.map((dark, x) => (reserved[y][x] ? dark : dark !== MASKS[mask](x, y))),
    )
    drawFormat(result, level, mask)
    return result
  }
  const fixed = options.mask
  if (fixed !== undefined && (!Number.isInteger(fixed) || fixed < 0 || fixed > 7))
    throw new RangeError(`Unknown QR mask: ${fixed}`)
  let best = { mask: fixed ?? 0, modules: masked(fixed ?? 0), score: Number.POSITIVE_INFINITY }
  if (fixed === undefined)
    for (let mask = 0; mask < 8; mask++) {
      const candidate = masked(mask)
      const score = penalty(candidate)
      if (score < best.score) best = { mask, modules: candidate, score }
    }
  return { version, size, errorCorrection: level, mask: best.mask, modules: best.modules }
}
