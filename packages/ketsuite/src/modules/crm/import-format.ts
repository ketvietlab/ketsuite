import { inflateRawSync } from 'node:zlib'
import { phoneKey } from '../../phone.ts'

import { IMPORT_LIMITS, ImportFormatError, guessImportMapping, tagNames } from './import-contract.ts'
import type { ImportMapping, ImportRules, ImportContact } from './import-contract.ts'
export * from './import-contract.ts'

/** Strict RFC-style quoting, including newlines in cells and doubled quotes. */
export function parseDelimited(source: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false
  const cell = () => {
    row.push(value)
    value = ''
    closed = false
    if (row.length > IMPORT_LIMITS.columns) throw new ImportFormatError('columns')
  }
  const line = () => {
    cell()
    rows.push(row)
    row = []
    if (rows.length > IMPORT_LIMITS.rows + 2) throw new ImportFormatError('rows')
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          value += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else value += c
    } else if (c === delimiter) cell()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++
      line()
    } else if (c === '"' && !value && !closed) quoted = true
    else if (closed || c === '"') throw new ImportFormatError('quotes')
    else value += c
    if (value.length > IMPORT_LIMITS.cell) throw new ImportFormatError('cell')
  }
  if (quoted) throw new ImportFormatError('quotes')
  if (value || row.length || closed) line()
  return rows
}

/** Validate actual inflated bytes and return the XLSX parts by lower-case name. No ZIP64/encryption/macros. */
function unzipWorkbook(bytes: Buffer) {
  const parts = new Map<string, Buffer>()
  let total = 0,
    files = 0,
    position = 0
  let endRecord = bytes.length - 22
  while (endRecord >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(endRecord) !== 0x06054b50)
    endRecord--
  if (
    endRecord < 0 ||
    endRecord + 22 > bytes.length ||
    bytes.readUInt32LE(endRecord) !== 0x06054b50 ||
    bytes.readUInt16LE(endRecord + 4) ||
    bytes.readUInt16LE(endRecord + 6)
  )
    throw new ImportFormatError('workbook')
  const entries = bytes.readUInt16LE(endRecord + 10),
    directory = bytes.readUInt32LE(endRecord + 16)
  if (
    !entries ||
    entries > 512 ||
    directory >= endRecord ||
    directory + bytes.readUInt32LE(endRecord + 12) !== endRecord
  )
    throw new ImportFormatError('workbook')
  const sizes = new Map<number, { size: number; declared: number; crc: number }>()
  let central = directory
  for (let index = 0; index < entries; index++) {
    if (central + 46 > endRecord || bytes.readUInt32LE(central) !== 0x02014b50)
      throw new ImportFormatError('workbook')
    const offset = bytes.readUInt32LE(central + 42)
    if (sizes.has(offset)) throw new ImportFormatError('workbook')
    sizes.set(offset, {
      size: bytes.readUInt32LE(central + 20),
      declared: bytes.readUInt32LE(central + 24),
      crc: bytes.readUInt32LE(central + 16),
    })
    central +=
      46 +
      bytes.readUInt16LE(central + 28) +
      bytes.readUInt16LE(central + 30) +
      bytes.readUInt16LE(central + 32)
  }
  if (central !== endRecord) throw new ImportFormatError('workbook')
  while (position + 30 <= directory && bytes.readUInt32LE(position) === 0x04034b50) {
    const flags = bytes.readUInt16LE(position + 6),
      method = bytes.readUInt16LE(position + 8)
    const entry = sizes.get(position)
    if (!entry) throw new ImportFormatError('workbook')
    const { size, declared } = entry
    if (
      !(flags & 8) &&
      (size !== bytes.readUInt32LE(position + 18) || declared !== bytes.readUInt32LE(position + 22))
    )
      throw new ImportFormatError('workbook')
    const nameSize = bytes.readUInt16LE(position + 26),
      extra = bytes.readUInt16LE(position + 28)
    const begin = position + 30 + nameSize + extra,
      end = begin + size
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      end > directory ||
      declared > 32 * 1024 * 1024 ||
      ++files > 512
    )
      throw new ImportFormatError('workbook')
    const name = bytes.subarray(position + 30, position + 30 + nameSize).toString('utf8')
    if (/vbaProject|\.bin$|\.\.\//iu.test(name)) throw new ImportFormatError('workbook')
    const data =
      method === 0
        ? bytes.subarray(begin, end)
        : inflateRawSync(bytes.subarray(begin, end), { maxOutputLength: 32 * 1024 * 1024 })
    total += data.length
    if (data.length !== declared || total > 64 * 1024 * 1024 || parts.has(name.toLowerCase()))
      throw new ImportFormatError('workbook')
    parts.set(name.toLowerCase(), data)
    // No spreadsheet application writes these; refusing them keeps the XML reader a plain tag scan.
    if (/\.(xml|rels)$/iu.test(name) && /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/iu.test(data.toString('utf8')))
      throw new ImportFormatError('workbook')
    position = end
    if (flags & 8) {
      if (position + 4 <= directory && bytes.readUInt32LE(position) === 0x08074b50) position += 4
      if (
        position + 12 > directory ||
        bytes.readUInt32LE(position) !== entry.crc ||
        bytes.readUInt32LE(position + 4) !== size ||
        bytes.readUInt32LE(position + 8) !== declared
      )
        throw new ImportFormatError('workbook')
      position += 12
    }
  }
  if (files !== entries || position !== directory) throw new ImportFormatError('workbook')
  return parts
}

// The parts are plain XML (no DOCTYPE, entities or CDATA, refused above), so one pass over the tags and
// the text between them reads them. Each match stops at the next `<` and attributes are capped, so no
// input can make the patterns backtrack into quadratic time.
const XML_TAG =
  /<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)(?=[\s/>])((?:[^<>"']|"[^"<]*"|'[^'<]*')*?)(\/?)>/gu
function* xmlTags(xml: string) {
  let text = 0
  for (const match of xml.matchAll(XML_TAG)) {
    if (match[3].length > 4096) throw new ImportFormatError('workbook')
    const from = text
    yield {
      name: match[2],
      open: match[1] !== '/',
      close: match[1] === '/' || match[4] === '/',
      attributes: match[3],
      // The text right before this tag: the content of an element that has no children.
      text: () => xmlText(xml.slice(from, match.index)),
    }
    text = match.index + match[0].length
  }
}
const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const xmlText = (raw: string) =>
  raw.replace(
    /&(?:#x([0-9a-fA-F]{1,6})|#(\d{1,7})|(lt|gt|amp|quot|apos));/gu,
    (entity, hex, decimal, name) => {
      if (name) return XML_ENTITIES[name]
      const code = hex ? Number.parseInt(hex, 16) : Number(decimal)
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity
    },
  )
const xmlAttribute = (attributes: string, name: string) => {
  for (const match of attributes.matchAll(/(?:^|\s)([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu))
    if (match[1] === name || match[1].endsWith(`:${name}`)) return xmlText(match[2] ?? match[3])
  return undefined
}

// Numbers stay as written (phone zeros survive as text cells); a number in a date format becomes an ISO
// timestamp. Built-in date formats, then a custom format whose every token is a date or time part.
const BUILT_IN_DATE_FORMATS = [
  [14, 22],
  [27, 36],
  [45, 47],
  [50, 58],
  [71, 81],
]
const DATE_TOKENS = new Set(
  's ss m mm mmm mmmm mmmmm h hh am pm a p d dd ddd dddd aaa aaaa aaaaa y yy yyyy e ee eeee'.split(' '),
)
const isDateFormat = (format: string) =>
  format
    .toLowerCase()
    .replace(/;@$/u, '')
    .replace(/\\./gu, ' ')
    .split(';')
    .some((part) => {
      const tokens = part
        .replace(/"[^"]*"/gu, ' ')
        .replace(/(\[?[smhd]{1,2}\]?)[.,]0{1,3}/gu, '$1')
        .replace(/\[([smhd]{1,2})\]/gu, '$1')
        .replace(/\[[^\]]*\]/gu, '')
        .split(/[^a-z0#?%]+/u)
        .filter(Boolean)
      return tokens.length > 0 && tokens.every((token) => DATE_TOKENS.has(token))
    })
const excelDate = (serial: number, epoch1904: boolean) => {
  const time = Math.floor((serial + (epoch1904 ? 1462 : 0) - 25569) * 86_400_000)
  return Number.isFinite(time) && Math.abs(time) <= 8.64e15 ? new Date(time).toISOString() : null
}

/** The workbook's sheet names, and a reader for one sheet as text cells from A1. */
function readWorkbook(parts: Map<string, Buffer>) {
  const part = (name: string) => parts.get(name.toLowerCase())?.toString('utf8')
  const workbook = part('xl/workbook.xml')
  if (!workbook) throw new ImportFormatError('workbook')
  const targets = new Map<string, string>()
  for (const tag of xmlTags(part('xl/_rels/workbook.xml.rels') ?? ''))
    if (tag.open && tag.name === 'Relationship') {
      const target = xmlAttribute(tag.attributes, 'Target') ?? ''
      targets.set(
        xmlAttribute(tag.attributes, 'Id') ?? '',
        target.startsWith('/') ? target.slice(1) : `xl/${target}`,
      )
    }
  const sheets: { name: string; path: string }[] = []
  let epoch1904 = false
  for (const tag of xmlTags(workbook)) {
    if (!tag.open) continue
    if (tag.name === 'workbookPr')
      epoch1904 = /^(1|true)$/u.test(xmlAttribute(tag.attributes, 'date1904') ?? '')
    if (tag.name === 'sheet')
      sheets.push({
        name: xmlAttribute(tag.attributes, 'name') ?? '',
        path: targets.get(xmlAttribute(tag.attributes, 'id') ?? '') ?? '',
      })
  }
  const strings: string[] = []
  let string: string | null = null,
    phonetic = 0
  for (const tag of xmlTags(part('xl/sharedStrings.xml') ?? '')) {
    if (tag.name === 'si') {
      if (tag.open) string = ''
      if (tag.close) {
        strings.push(string ?? '')
        string = null
      }
    } else if (tag.name === 'rPh' && tag.open !== tag.close) phonetic += tag.open ? 1 : -1
    else if (tag.name === 't' && !tag.open && string !== null && !phonetic) string += tag.text()
  }
  const formats = new Map<number, string>(),
    styles: number[] = []
  let cellFormats = false
  for (const tag of xmlTags(part('xl/styles.xml') ?? '')) {
    if (tag.name === 'cellXfs') cellFormats = tag.open && !tag.close
    else if (tag.open && tag.name === 'numFmt')
      formats.set(
        Number(xmlAttribute(tag.attributes, 'numFmtId')),
        xmlAttribute(tag.attributes, 'formatCode') ?? '',
      )
    else if (tag.open && tag.name === 'xf' && cellFormats)
      styles.push(Number(xmlAttribute(tag.attributes, 'numFmtId') ?? 0))
  }
  const dates = styles.map((id) => {
    const format = formats.get(id)
    return format === undefined
      ? BUILT_IN_DATE_FORMATS.some(([from, to]) => id >= from && id <= to)
      : isDateFormat(format)
  })

  const read = (name?: string) => {
    const sheet = name ? sheets.find((s) => s.name === name) : sheets[0]
    if (!sheet) throw new ImportFormatError('sheet')
    const xml = part(sheet.path)
    if (xml === undefined) throw new ImportFormatError('workbook')
    const rows: string[][] = []
    let row = 0,
      column = 0,
      width = 0,
      phonetic = 0,
      cell: { type: string; style: number; value: string; text: string } | null = null
    const commit = () => {
      if (!cell) return
      const { type, style, value } = cell
      let text: string
      if (type === 's') {
        const index = Number(value)
        if (!Number.isInteger(index) || index < 0 || index >= strings.length)
          throw new ImportFormatError('workbook')
        text = strings[index]
      } else if (type === 'inlineStr') text = cell.text
      else if (type === 'b') text = value === '1' ? 'true' : value === '0' ? 'false' : value
      else if (type === 'd')
        text = Number.isNaN(Date.parse(value)) ? value : new Date(Date.parse(value)).toISOString()
      else if (type === 'n' && dates[style] && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/iu.test(value))
        text = excelDate(Number(value), epoch1904) ?? value
      else text = value
      if (text.length > IMPORT_LIMITS.cell) throw new ImportFormatError('cell')
      if (text) {
        ;(rows[row - 1] ??= [])[column - 1] = text
        width = Math.max(width, column)
      }
      cell = null
    }
    for (const tag of xmlTags(xml)) {
      if (tag.name === 'row' && tag.open) {
        row = Number(xmlAttribute(tag.attributes, 'r')) || row + 1
        column = 0
        if (row > IMPORT_LIMITS.rows + 1) throw new ImportFormatError('rows')
      } else if (tag.name === 'c') {
        if (tag.open) {
          const ref = /^([A-Za-z]{1,3})\d*$/u.exec(xmlAttribute(tag.attributes, 'r') ?? '')?.[1]
          column = ref
            ? [...ref.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
            : column + 1
          if (column > IMPORT_LIMITS.columns) throw new ImportFormatError('columns')
          cell = {
            type: xmlAttribute(tag.attributes, 't') ?? 'n',
            style: Number(xmlAttribute(tag.attributes, 's') ?? 0),
            value: '',
            text: '',
          }
        }
        if (tag.close) commit()
      } else if (tag.name === 'v' && !tag.open && cell) cell.value = tag.text()
      else if (tag.name === 'rPh' && tag.open !== tag.close) phonetic += tag.open ? 1 : -1
      else if (tag.name === 't' && !tag.open && cell && !phonetic) cell.text += tag.text()
    }
    // Rows and cells the sheet leaves out are empty; trailing empty rows and columns are not there at all.
    return Array.from(rows, (cells: string[] | undefined) =>
      Array.from({ length: width }, (_, i) => cells?.[i] ?? ''),
    )
  }
  return { sheets: sheets.map((s) => s.name), read }
}

export async function parseImportFile(input: {
  filename: string
  content: string
  sheet?: string
  delimiter?: string
  header?: boolean
}) {
  if (
    input.content.length > Math.ceil(IMPORT_LIMITS.bytes / 3) * 4 + 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.content)
  )
    throw new ImportFormatError('size')
  const bytes = Buffer.from(input.content, 'base64')
  if (!bytes.length || bytes.length > IMPORT_LIMITS.bytes) throw new ImportFormatError('size')
  let matrix: string[][],
    encoding = 'UTF-8',
    sheets: string[] = []
  let delimiter = input.delimiter || (input.filename.toLowerCase().endsWith('.tsv') ? '\t' : '')
  if (/\.xlsx$/iu.test(input.filename)) {
    try {
      const workbook = readWorkbook(unzipWorkbook(bytes))
      sheets = workbook.sheets
      // Reading the chosen sheet only prevents silently importing the wrong sheet.
      matrix = workbook.read(input.sheet)
    } catch (error) {
      if (error instanceof ImportFormatError) throw error
      throw new ImportFormatError('workbook')
    }
  } else {
    if (!/\.(csv|tsv|txt)$/iu.test(input.filename)) throw new ImportFormatError('format')
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'UTF-16LE'
    if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'UTF-16BE'
    let source: string
    try {
      source = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '')
    } catch {
      throw new ImportFormatError('encoding')
    }
    if (!delimiter) {
      const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
      let quoted = false
      for (let i = 0; i < source.length; i++) {
        const c = source[i]
        if (c === '"') {
          if (quoted && source[i + 1] === '"') i++
          else quoted = !quoted
        } else if (!quoted && (c === '\r' || c === '\n')) break
        else if (!quoted && c in counts) counts[c]++
      }
      delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    }
    if (!['\t', ';', ','].includes(delimiter)) throw new ImportFormatError('delimiter')
    matrix = parseDelimited(source, delimiter)
  }
  while (matrix.at(-1)?.every((cell) => !cell.trim())) matrix.pop()
  const width = Math.max(0, ...matrix.map((row) => row.length))
  if (!width || width > IMPORT_LIMITS.columns) throw new ImportFormatError('columns')
  const headers =
    input.header === false
      ? Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
      : (matrix.shift()?.map((s, i) => s.trim() || `Column ${i + 1}`) ?? [])
  if (!matrix.length || matrix.length > IMPORT_LIMITS.rows) throw new ImportFormatError('rows')
  if (matrix.some((row) => row.some((cell) => cell.length > IMPORT_LIMITS.cell)))
    throw new ImportFormatError('cell')
  return {
    headers,
    rows: matrix,
    mapping: guessImportMapping(headers),
    encoding,
    delimiter,
    sheets,
    sheet: input.sheet || sheets[0] || null,
  }
}

export function mapImportRow(
  cells: string[],
  mapping: ImportMapping,
  rules: ImportRules,
): { value: ImportContact; issues: string[] } {
  const values = Object.fromEntries(mapping.map((field, i) => [field, String(cells[i] ?? '').trim()]))
  const rawPhone = values.phone || '',
    phone = rawPhone ? phoneKey(rawPhone) : ''
  const value: ImportContact = {
    name: values.name || '',
    contactName: values.contactName || values.name || '',
    phone: phone || rawPhone,
    email: (values.email || '').toLowerCase(),
    description: values.description || '',
    source: values.source || rules.source,
    medium: values.medium || rules.medium,
    campaign: values.campaign || rules.campaign,
    recordTags: tagNames(values.recordTags),
    customerLabels: tagNames(values.customerLabels),
  }
  const issues: string[] = []
  if (cells.length > mapping.length) issues.push('columns')
  if (!value.name) issues.push('name')
  if (!value.phone && !value.email) issues.push('contact')
  if (rawPhone && !phone) issues.push('phone')
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.email)) issues.push('email')
  if (value.recordTags.length > IMPORT_LIMITS.tags || value.customerLabels.length > IMPORT_LIMITS.tags)
    issues.push('tags')
  if (
    value.name.length > 240 ||
    value.contactName.length > 240 ||
    value.email.length > 254 ||
    [...value.recordTags, ...value.customerLabels].some((name) => name.length > 80)
  )
    issues.push('length')
  return { value, issues }
}

/** CSV files may be opened in spreadsheets: neutralise formula prefixes on export. */
export const exportImportCsv = (rows: unknown[][]) =>
  '\uFEFF' +
  rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? '')
          return '"' + (/^[\s]*[=+@-]/u.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'
        })
        .join(','),
    )
    .join('\r\n')
