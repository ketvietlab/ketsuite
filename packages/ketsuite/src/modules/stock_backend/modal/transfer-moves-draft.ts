type Row = Record<string, unknown>
const object = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null
/** A cell value as `addMove` reads it: an empty cell is empty text, never zero. */
const figure = (value: unknown) => (value == null ? '' : String(value))

/**
 * Reads the products grid's posted changes (`{added, updated, removed, order}`) as `addMoves`
 * entries. The grid only adds products: a saved product line is not changed or removed here, so
 * any update or removal, an unknown product or a malformed change sends nothing (null). A new row's
 * move id is `newId` of its grid id, so that one modal reading posts it under one id, and it is named
 * after its product. Only structure is checked here; the server checks every unit and quantity.
 */
export function postedTransferMoves(
  products: readonly Row[],
  raw: string,
  newId: (gridId: string) => string,
): Row[] | null {
  if (!raw) return []
  try {
    const changes = object(JSON.parse(raw))
    if (!changes) return null
    const list = (key: string): unknown[] => {
      if (changes[key] == null) return []
      if (!Array.isArray(changes[key])) throw new Error('Invalid grid change')
      return changes[key] as unknown[]
    }
    if (list('updated').length || list('removed').length) return null
    const named = new Map(products.map((product) => [String(product.id), String(product.name)]))
    const moves: Row[] = []
    for (const value of list('added')) {
      const change = object(value)
      const values = object(change?.values)
      const id = typeof change?.id === 'string' ? change.id : ''
      const productId = values?.productId == null ? '' : String(values.productId)
      if (!id || !values || !named.has(productId)) return null
      moves.push({
        id: newId(id),
        name: named.get(productId),
        productId,
        productUomId: figure(values.productUomId),
        productUomQty: figure(values.productUomQty),
      })
    }
    return moves
  } catch {
    return null
  }
}
