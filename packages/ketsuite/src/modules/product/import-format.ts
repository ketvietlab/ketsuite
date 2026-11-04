import { fold } from './text-fold.ts'

export const PRODUCT_IMPORT_LIMITS = { rows: 500, bytes: 256 * 1024 } as const
export const productImportColumns = [
  { key: 'templateCode', vi: 'Mã sản phẩm', en: 'Product code', aliases: ['ma mau', 'template code'] },
  { key: 'name', vi: 'Tên sản phẩm', en: 'Product name', aliases: ['ten', 'name'] },
  { key: 'kind', vi: 'Loại', en: 'Type', aliases: ['loai san pham', 'product type'] },
  { key: 'uom', vi: 'Đơn vị', en: 'Unit', aliases: ['dvt', 'don vi tinh', 'unit of measure', 'uom'] },
  { key: 'category', vi: 'Nhóm sản phẩm', en: 'Product group', aliases: ['nhom', 'category'] },
  { key: 'tax', vi: 'Thuế GTGT', en: 'VAT', aliases: ['thue', 'tax'] },
  { key: 'listPrice', vi: 'Giá bán', en: 'Sales price', aliases: ['gia', 'list price'] },
  {
    key: 'values',
    vi: 'Giá trị thuộc tính',
    en: 'Attribute values',
    aliases: ['thuoc tinh', 'attributes', 'variant values'],
  },
  { key: 'code', vi: 'Mã biến thể', en: 'Variant code', aliases: ['sku'] },
  { key: 'barcode', vi: 'Barcode', en: 'Barcode', aliases: ['ma vach', 'ean', 'gtin'] },
  { key: 'ownPrice', vi: 'Giá bán biến thể', en: 'Variant price', aliases: ['variant sales price'] },
  { key: 'cost', vi: 'Giá vốn', en: 'Cost', aliases: ['cost price', 'standard price'] },
] as const
export type ProductImportColumn = (typeof productImportColumns)[number]['key']
export type ProductImportRow = { row: number; cells: Partial<Record<ProductImportColumn, string>> }
export type ProductImportIssue = {
  field: 'data'
  row: number
  column: string
  code: string
  params: { row: number; column: string }
}
export class ProductImportRefused extends Error {
  readonly issues: ProductImportIssue[]
  constructor(issues: ProductImportIssue[]) {
    super('product import refused')
    this.issues = issues
  }
}
export const importIssue = (row: number, column: string, code: string): ProductImportIssue => ({
  field: 'data',
  row,
  column,
  code: `product.error.import.${code}`,
  params: { row, column },
})
const refuse = (row: number, column: string, code: string): never => {
  throw new ProductImportRefused([importIssue(row, column, code)])
}
export const importNameKey = (value: string) =>
  fold(value)
    .replace(/[\s_]+/gu, ' ')
    .trim()
const columnByName = new Map<string, ProductImportColumn>(
  productImportColumns.flatMap((column) =>
    [column.key, column.vi, column.en, ...column.aliases].map(
      (name) => [importNameKey(name), column.key] as const,
    ),
  ),
)

/** Spreadsheet formula escaping is reversible, including a literal leading apostrophe. */
export const importCell = (value: string) => (/^'(?:'|\s*[=+@-])/u.test(value) ? value.slice(1) : value)
export const exportProductImportCsv = (rows: readonly (readonly unknown[])[]) =>
  '\uFEFF' +
  rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? '')
          return '"' + (/^(?:'|\s*[=+@-])/u.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'
        })
        .join(','),
    )
    .join('\r\n')

function delimiterOf(source: string) {
  const counts = new Map([
    ['\t', 0],
    [',', 0],
    [';', 0],
  ])
  let quoted = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    if (char === '"') {
      if (quoted && source[index + 1] === '"') index++
      else quoted = !quoted
    } else if (!quoted) {
      if (char === '\r' || char === '\n') break
      if (counts.has(char)) counts.set(char, counts.get(char)! + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0]
}

/** Pasted CSV/TSV has its own 500-row/256-KiB boundary; no workbook or background job. */
export function parseProductImport(input: unknown): ProductImportRow[] {
  if (typeof input !== 'string' || !input.trim()) return refuse(1, 'data', 'empty')
  if (Buffer.byteLength(input, 'utf8') > PRODUCT_IMPORT_LIMITS.bytes) return refuse(1, 'data', 'bytes')
  const source = input.replace(/^\uFEFF/, ''),
    delimiter = delimiterOf(source)
  const records: string[][] = []
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false
  const cell = () => {
    row.push(importCell(value))
    value = ''
    closed = false
  }
  const line = () => {
    cell()
    records.push(row)
    row = []
  }
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          value += '"'
          index++
        } else {
          quoted = false
          closed = true
        }
      } else value += char
    } else if (char === delimiter) cell()
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++
      line()
    } else if (char === '"' && !value && !closed) quoted = true
    else if (char === '"' || closed) return refuse(records.length + 1, String(row.length + 1), 'quotes')
    else value += char
  }
  if (quoted) return refuse(records.length + 1, String(row.length + 1), 'quotes')
  if (value || row.length || closed) line()
  const headers = records.shift() ?? [],
    seen = new Set<string>()
  const columns = headers.map((name, index) => {
    const folded = importNameKey(name),
      key = columnByName.get(folded)
    const identity = key ?? folded
    if (identity && seen.has(identity)) return refuse(1, key ?? String(index + 1), 'duplicateColumn')
    if (identity) seen.add(identity)
    return key
  })
  if (!columns.includes('templateCode')) return refuse(1, 'templateCode', 'requiredColumn')
  const rows: ProductImportRow[] = []
  for (const [index, record] of records.entries()) {
    if (record.every((cell) => !cell.trim())) continue
    if (rows.length === PRODUCT_IMPORT_LIMITS.rows) return refuse(index + 2, 'data', 'rows')
    if (record.length > headers.length && record.slice(headers.length).some((cell) => cell.trim()))
      return refuse(index + 2, String(headers.length + 1), 'columns')
    const cells: ProductImportRow['cells'] = {}
    for (const [position, key] of columns.entries()) if (key) cells[key] = record[position] ?? ''
    if (!cells.templateCode?.trim()) return refuse(index + 2, 'templateCode', 'required')
    rows.push({ row: index + 2, cells })
  }
  if (!rows.length) return refuse(2, 'data', 'empty')
  return rows
}

/** Unambiguous groups of three are thousands; other single separators are decimal marks. */
export function importMoney(value: string, row: number, column: ProductImportColumn): string {
  let text = value.trim().replace(/[ \u00a0]/gu, '')
  if (/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/u.test(text)) text = text.replace(/[.,]/gu, '')
  else if (/^\d{1,3}(?:,\d{3})+\.\d+$/u.test(text)) text = text.replaceAll(',', '')
  else if (/^\d{1,3}(?:\.\d{3})+,\d+$/u.test(text)) text = text.replaceAll('.', '').replace(',', '.')
  else text = text.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/u.test(text)) return refuse(row, column, 'number')
  const [whole, fraction = ''] = text.split('.')
  const trimmed = fraction.replace(/0+$/u, '')
  return whole!.replace(/^0+(?=\d)/u, '') + (trimmed ? '.' + trimmed : '')
}

/** Backslash quotes separators in an attribute/value name; exported labels remain reversible. */
export function exportImportAttributes(pairs: readonly { attribute: string; value: string }[]) {
  const escapeName = (value: string) => value.replace(/[\\;:]/gu, (char) => '\\' + char)
  return pairs.map((pair) => escapeName(pair.attribute) + ':' + escapeName(pair.value)).join(';')
}
export function importAttributeValues(value: string, row: number) {
  if (!value.trim()) return []
  const pairs: { attribute: string; value: string }[] = [],
    seen = new Set<string>()
  let attribute = '',
    name = '',
    separated = false
  const add = () => {
    const key = importNameKey(attribute)
    if (!separated || !key || !name.trim() || seen.has(key)) return refuse(row, 'values', 'attribute')
    seen.add(key)
    pairs.push({ attribute: attribute.trim(), value: name.trim() })
    attribute = ''
    name = ''
    separated = false
  }
  for (let index = 0; index < value.length; index++) {
    let char = value[index]!
    if (char === '\\' && /[\\;:]/u.test(value[index + 1] ?? '')) char = value[++index]!
    else if (char === ';') {
      add()
      continue
    } else if (char === ':' && !separated) {
      separated = true
      continue
    }
    if (separated) name += char
    else attribute += char
  }
  add()
  return pairs
}
/** Three fractional digits must not be read back as a thousands separator. */
export const exportImportMoney = (value: unknown) =>
  value == null ? '' : /^\d{1,3}\.\d{3}$/u.test(String(value)) ? String(value) + '0' : String(value)
