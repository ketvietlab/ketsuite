// Records pasted as CSV or a JSON array, read before anything is written: the same rules as the demo's import,
// with the reasons in the reader's language.

/** The columns a record takes from an import, each mapped from a column of the file. */
export const IMPORT_FIELDS = ['name', 'phone', 'email', 'contactName', 'source', 'externalId'] as const
export type ImportRow = Record<(typeof IMPORT_FIELDS)[number], string> & { consent: boolean }
type Say = (vi: string, en: string) => string

/** What is wrong with the file as a whole; it names no row. */
export class ImportRefused extends Error {}

const normalize = (value: unknown) => String(value ?? '').trim()

/** CSV as the demo reads it: quoted values, doubled quotes, one header row naming each column once. */
const csvRows = (source: string, say: Say): Record<string, string>[] => {
  const matrix: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        value += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(value.replace(/\r$/, ''))
      value = ''
      if (char === '\n') {
        if (row.some((cell) => cell.trim())) matrix.push(row)
        row = []
      }
    } else value += char
  }
  if (quoted) throw new ImportRefused(say('Dấu nháy CSV chưa đóng.', 'A CSV quote is not closed.'))
  row.push(value.replace(/\r$/, ''))
  if (row.some((cell) => cell.trim())) matrix.push(row)
  const headers = matrix.shift()?.map(normalize) ?? []
  if (!headers.length || new Set(headers).size !== headers.length || headers.some((header) => !header))
    throw new ImportRefused(
      say('Tên cột CSV phải có giá trị và không trùng.', 'CSV column names must be present and distinct.'),
    )
  return matrix.map((cells) => {
    if (cells.length !== headers.length)
      throw new ImportRefused(say('Số cột CSV không khớp.', 'A CSV row has the wrong number of columns.'))
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
  })
}

/** The rows of a pasted file, mapped onto the record's columns. Throws `ImportRefused` for a file it cannot read. */
export const parseSalesImport = (
  input: Record<string, string>,
  say: Say,
): { headers: string[]; rows: ImportRow[] } => {
  const source = String(input.data ?? '')
  if (source.length > 80_000) throw new ImportRefused(say('Tối đa 80 KB dữ liệu.', 'Up to 80 KB of data.'))
  let rows: unknown
  if (input.format === 'json' || source.trim().startsWith('[')) {
    try {
      rows = JSON.parse(source)
    } catch {
      throw new ImportRefused(say('JSON không hợp lệ.', 'The JSON is not valid.'))
    }
  } else rows = csvRows(source, say)
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > 100 ||
    rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    throw new ImportRefused(say('Cần 1–100 dòng dữ liệu.', 'Enter 1 to 100 rows.'))
  const objects = rows as Record<string, unknown>[]
  const headers = [...new Set(objects.flatMap((row) => Object.keys(row)))]
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((key) => [key, input[`map-${key}`] || key]))
  const consent = ['on', 'true', '1', 'yes'].includes(String(input.importConsent ?? ''))
  return {
    headers,
    rows: objects.map((row) => ({
      ...(Object.fromEntries(
        IMPORT_FIELDS.map((key) => [key, normalize(row[mapping[key] ?? key])]),
      ) as Record<(typeof IMPORT_FIELDS)[number], string>),
      source: normalize(row[mapping.source ?? 'source']) || 'Import',
      consent,
    })),
  }
}

/** A row's own faults, before any record is looked up. */
export const importIssues = (row: ImportRow, say: Say): string[] => [
  ...(row.name ? [] : [say('Thiếu tiêu đề', 'Missing title')]),
  ...(row.phone || row.email ? [] : [say('Thiếu điện thoại/email', 'Missing phone or email')]),
  ...(row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ? [say('Email sai', 'Invalid email')] : []),
]
