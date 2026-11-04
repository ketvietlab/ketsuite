type Row = Record<string, unknown>
const object = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null
const FIELDS = ['name', 'splitMethod', 'amount'] as const

/** A saved cost as the grid holds it. */
export const heldCostLine = (line: Row) => ({
  id: String(line.id),
  name: String(line.name ?? ''),
  splitMethod: String(line.splitMethod ?? 'quantity'),
  amount: line.amount == null || line.amount === '' ? null : Number(line.amount),
})

/**
 * The costs a draft saves, read from the grid's posted changes (`{added, updated, removed, order}`) over the
 * costs it holds: the whole list in the grid's order, since a save replaces them. `undefined` keeps them
 * as they are (nothing changed, or a value that is not the grid's). Figures stay text for the server to
 * check against the currency.
 */
export function postedCostLines(held: readonly Row[], raw: string): Row[] | undefined {
  if (!raw) return undefined
  let changes: Row | null
  try {
    changes = object(JSON.parse(raw))
  } catch {
    return undefined
  }
  if (!changes) return undefined
  const list = (key: string) => (Array.isArray(changes![key]) ? (changes![key] as unknown[]) : [])
  const removed = new Set(list('removed').map(String))
  const updated = new Map(
    list('updated').flatMap((value) => {
      const change = object(value)
      const values = object(change?.values)
      return typeof change?.id === 'string' && values ? [[change.id, values] as const] : []
    }),
  )
  const added = list('added')
    .map(object)
    .filter((change): change is Row => typeof change?.id === 'string' && Boolean(object(change.values)))
  if (!removed.size && !updated.size && !added.length && !Array.isArray(changes.order)) return undefined
  const rows: Row[] = held
    .map((line) => ({ ...heldCostLine(line), ...(updated.get(String(line.id)) ?? {}) }))
    .filter((line) => !removed.has(String(line.id)))
  for (const change of [...added].sort((a, b) => Number(a.index) - Number(b.index)))
    rows.splice(Math.min(Number(change.index) || 0, rows.length), 0, {
      ...(object(change.values) ?? {}),
      id: change.id,
    })
  const order = Array.isArray(changes.order) ? (changes.order as unknown[]).map(String) : null
  if (order) rows.sort((a, b) => order.indexOf(String(a.id)) - order.indexOf(String(b.id)))
  return rows.map((row) =>
    Object.fromEntries(FIELDS.map((key) => [key, row[key] == null ? '' : String(row[key])])),
  )
}
