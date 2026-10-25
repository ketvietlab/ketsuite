// Portable task exchange; shared by native delivery and Atlas. No fixture writes here.
export const exchangeSchema = 'flow.task-exchange'
export const exchangeVersion = 1
export const exchangeFields = Object.freeze([
  'sourceId',
  'id',
  'expectedVersion',
  'title',
  'description',
  'priority',
  'points',
  'dueDate',
  'startDate',
  'columnId',
  'typeId',
  'tagIds',
  'assigneeIds',
  'fieldValues',
  'checklist',
])
const jsonFields = new Set(['tagIds', 'assigneeIds', 'fieldValues', 'checklist'])
const numericFields = new Set(['expectedVersion', 'points'])
const spreadsheetEscape = (value) =>
  /^[=+\-@\t\r\n ]/.test(value) || value.startsWith("'") ? "'" + value : value
const quote = (value) => '"' + String(value).replaceAll('"', '""') + '"'
export function encodeExchange(rows, format = 'json') {
  if (format === 'json')
    return JSON.stringify({ schema: exchangeSchema, version: exchangeVersion, rows }, null, 2)
  if (format !== 'csv') throw new Error('exchange_format')
  const header = ['schema', 'version', 'present', 'nulls', ...exchangeFields]
  return [
    header.map(quote).join(','),
    ...rows.map((row) =>
      header
        .map((key) => {
          const value =
            key === 'schema'
              ? exchangeSchema
              : key === 'version'
                ? exchangeVersion
                : key === 'present'
                  ? JSON.stringify(Object.keys(row).filter((k) => row[k] !== undefined))
                  : key === 'nulls'
                    ? JSON.stringify(Object.keys(row).filter((k) => row[k] === null))
                    : row[key]
          if (value === undefined || value === null) return quote('')
          const cell = jsonFields.has(key) ? JSON.stringify(value) : String(value)
          return quote(spreadsheetEscape(cell))
        })
        .join(','),
    ),
  ].join('\r\n')
}

export function csvCells(text) {
  const rows = [],
    cells = []
  let cell = '',
    quoted = false,
    closed = false,
    started = false
  const pushCell = () => {
    cells.push(cell)
    cell = ''
    closed = false
    started = false
  }
  const pushRow = () => {
    pushCell()
    rows.push(cells.splice(0))
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') {
        quoted = false
        closed = true
      } else cell += c
      continue
    }
    if (c === '"') {
      if (started || closed) throw new Error('exchange_csv_quote')
      quoted = true
      started = true
    } else if (c === ',') pushCell()
    else if (c === '\r' || c === '\n') {
      pushRow()
      if (c === '\r' && text[i + 1] === '\n') i++
    } else {
      if (closed) throw new Error('exchange_csv_quote')
      cell += c
      started = true
    }
  }
  if (quoted) throw new Error('exchange_csv_quote')
  if (started || closed || cell || cells.length) pushRow()
  return rows
}

export function decodeExchange(text, format = 'json') {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 16 * 1024 * 1024)
    throw new Error('exchange_file_limit')
  let document
  if (format === 'json') document = JSON.parse(text)
  else if (format === 'csv') {
    const rows = csvCells(text.replace(/^\uFEFF/, '')),
      header = rows.shift()
    if (
      !header ||
      new Set(header).size !== header.length ||
      !header.includes('schema') ||
      !header.includes('version') ||
      header.some((key) => !['schema', 'version', 'present', 'nulls', ...exchangeFields].includes(key))
    )
      throw new Error('exchange_csv_header')
    document = {
      schema: exchangeSchema,
      version: exchangeVersion,
      rows: rows.map((cells) => {
        if (cells.length !== header.length) throw new Error('exchange_csv_columns')
        const raw = Object.fromEntries(
          header.map((key, i) => [key, cells[i].startsWith("'") ? cells[i].slice(1) : cells[i]]),
        )
        if (raw.schema !== exchangeSchema || raw.version !== String(exchangeVersion))
          throw new Error('exchange_schema')
        const row = {},
          present = raw.present ? JSON.parse(raw.present) : null,
          nulls = raw.nulls ? JSON.parse(raw.nulls) : []
        if (
          (present &&
            (!Array.isArray(present) ||
              new Set(present).size !== present.length ||
              present.some((key) => !exchangeFields.includes(key)))) ||
          !Array.isArray(nulls) ||
          nulls.some((key) => !present?.includes(key))
        )
          throw new Error('exchange_csv_presence')
        for (const key of exchangeFields) {
          const value = raw[key]
          if (value === undefined || (present ? !present.includes(key) : value === '')) continue
          if (nulls.includes(key)) {
            row[key] = null
            continue
          }
          if (numericFields.has(key) && value === '') throw new Error('exchange_number')
          row[key] = jsonFields.has(key) ? JSON.parse(value) : numericFields.has(key) ? Number(value) : value
          if (numericFields.has(key) && !Number.isFinite(row[key])) throw new Error('exchange_number')
        }
        return row
      }),
    }
  } else throw new Error('exchange_format')
  if (
    !document ||
    document.schema !== exchangeSchema ||
    document.version !== exchangeVersion ||
    !Array.isArray(document.rows) ||
    document.rows.length > 10000
  )
    throw new Error('exchange_schema')
  const ids = new Set()
  for (const row of document.rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !exchangeFields.includes(key)) ||
      typeof row.sourceId !== 'string' ||
      !row.sourceId.trim() ||
      row.sourceId.length > 1000 ||
      ids.has(row.sourceId)
    )
      throw new Error('exchange_source')
    for (const [key, maximum] of [
      ['tagIds', 30],
      ['assigneeIds', 30],
      ['checklist', 200],
    ])
      if (row[key] !== undefined && (!Array.isArray(row[key]) || row[key].length > maximum))
        throw new Error('exchange_shape')
    if (
      row.fieldValues !== undefined &&
      (!row.fieldValues ||
        typeof row.fieldValues !== 'object' ||
        Array.isArray(row.fieldValues) ||
        Object.keys(row.fieldValues).length > 200)
    )
      throw new Error('exchange_shape')
    if (
      (row.title !== undefined && (typeof row.title !== 'string' || row.title.length > 1000)) ||
      (row.description !== undefined &&
        row.description !== null &&
        (typeof row.description !== 'string' || row.description.length > 100000))
    )
      throw new Error('exchange_shape')
    ids.add(row.sourceId)
  }
  return document.rows
}

/** Keep a legal RPC batch below the byte budget as well as the record limit. */
export function exchangeBatch(rows, offset, maximumBytes = 900000) {
  const batch = []
  let bytes = 2
  for (const row of rows.slice(offset, offset + 100)) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length + 1
    if (bytes + size > maximumBytes) {
      if (!batch.length) throw new Error('exchange_row_limit')
      break
    }
    batch.push(row)
    bytes += size
  }
  return batch
}
