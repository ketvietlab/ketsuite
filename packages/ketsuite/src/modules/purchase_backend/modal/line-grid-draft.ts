type Row = Record<string, unknown>
const object = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null
/** A cell value as the line functions read it: an empty cell is empty text, never zero. */
const figure = (value: unknown) => (value == null ? '' : String(value))
const LINE_FIELDS = ['productQty', 'priceUnit', 'productUomId', 'discount', 'taxId'] as const

/**
 * Reads the order's line grid (`{added, updated, removed, order}`) as `purchase.saveLines` input. A
 * changed line sends only the cells that changed; a new line sends its product and every cell, its id
 * being `newId` of its grid id so that one modal reading posts it under one id. Unknown lines, new
 * lines without a product and malformed changes send nothing (null). Only structure is checked here;
 * the server checks every product, figure, unit, tax and permission.
 */
export function postedPurchaseLines(
  lines: readonly Row[],
  raw: string,
  newId: (gridId: string) => string,
): { lines: Row[]; removed: string[] } | null {
  if (!raw) return { lines: [], removed: [] }
  try {
    const changes = object(JSON.parse(raw))
    if (!changes) return null
    const list = (key: string): unknown[] => {
      if (changes[key] == null) return []
      if (!Array.isArray(changes[key])) throw new Error('Invalid grid change')
      return changes[key] as unknown[]
    }
    const held = new Set(lines.map((line) => String(line.id)))
    const removed: string[] = []
    for (const id of list('removed')) {
      if (typeof id !== 'string' || !held.has(id)) return null
      removed.push(id)
    }
    const posted: Row[] = []
    for (const value of list('updated')) {
      const change = object(value)
      const values = object(change?.values)
      const id = typeof change?.id === 'string' ? change.id : ''
      if (!held.has(id) || !values || removed.includes(id)) return null
      const row: Row = { id }
      for (const key of LINE_FIELDS) if (Object.hasOwn(values, key)) row[key] = figure(values[key])
      if (Object.keys(row).length > 1) posted.push(row)
    }
    for (const value of list('added')) {
      const change = object(value)
      const values = object(change?.values)
      const id = typeof change?.id === 'string' ? change.id : ''
      const productId = values?.productId == null ? '' : String(values.productId)
      if (!id || !values || !productId) return null
      posted.push({
        id: newId(id),
        productId,
        ...Object.fromEntries(LINE_FIELDS.map((key) => [key, figure(values[key])])),
      })
    }
    return { lines: posted, removed }
  } catch {
    return null
  }
}
