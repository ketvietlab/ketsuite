type Item = { id: string; productId: string; extraPrice: string }
type Row = Record<string, unknown>
const object = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null

/** Interpret only grid structure here; the server validates every desired product and price. */
export function postedComboItems(held: readonly Item[], raw: string): unknown {
  if (!raw) return held.map(({ productId, extraPrice }) => ({ productId, extraPrice }))
  try {
    const changes = object(JSON.parse(raw))
    if (!changes) return null
    const rows = new Map(held.map((row) => [row.id, { ...row }]))
    const list = (key: string): unknown[] => {
      if (changes[key] == null) return []
      if (!Array.isArray(changes[key])) throw new Error('Invalid grid change')
      return changes[key]
    }
    for (const id of list('removed')) if (typeof id !== 'string' || !rows.delete(id)) return null
    for (const value of list('updated')) {
      const change = object(value),
        values = object(change?.values)
      const row = rows.get(String(change?.id ?? ''))
      if (!row || !values) return null
      for (const key of ['productId', 'extraPrice'] as const)
        if (Object.hasOwn(values, key)) row[key] = String(values[key] ?? '')
    }
    for (const value of list('added')) {
      const change = object(value),
        values = object(change?.values)
      if (!change || typeof change.id !== 'string' || !change.id || rows.has(change.id) || !values)
        return null
      rows.set(change.id, {
        id: change.id,
        productId: String(values.productId ?? ''),
        extraPrice: String(values.extraPrice ?? ''),
      })
    }
    const order = list('order')
    if (
      order.length &&
      (order.length !== rows.size ||
        new Set(order).size !== order.length ||
        order.some((id) => typeof id !== 'string' || !rows.has(id)))
    )
      return null
    const sorted = order.length ? order.map((id) => rows.get(String(id))!) : [...rows.values()]
    return sorted.map(({ productId, extraPrice }) => ({ productId, extraPrice }))
  } catch {
    return null
  }
}
