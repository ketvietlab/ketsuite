type Row = Record<string, unknown>
const object = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null
/** A cell value as the line functions read it: an empty cell is empty text, never zero. */
const figure = (value: unknown) => (value == null ? '' : String(value))
const LINE_FIELDS = ['moveId', 'quantity', 'lotId', 'name', 'expirationDate', 'picked'] as const

/** A saved move line as the transfer grid holds it. */
export const heldLineValues = (line: Row) => ({
  moveId: String(line.moveId),
  quantity: line.quantity == null || line.quantity === '' ? null : Number(line.quantity),
  lotId: line.lotId ? String(line.lotId) : null,
  name: String(line.receiptLotName ?? ''),
  expirationDate: line.receiptExpiryDate ? String(line.receiptExpiryDate) : null,
  picked: line.picked === true,
})

/**
 * Reads the transfer grid's posted changes (`{added, updated, removed, order}`) against the moves the
 * modal holds, as `savePickingLines` entries. A changed line sends all its values, with the receipt
 * revision it was read at; a changed price sends `unitCost`. Only structure is checked here; the
 * server checks every figure, lot and permission. Removed rows are refused: lines are not removed here.
 * A new row's line id is `newId` of its grid id, so that one modal reading posts it under one id.
 */
export function postedPickingLines(
  moves: readonly Row[],
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
    if (list('removed').length) return null
    const moveIds = new Set(moves.map((move) => String(move.id)))
    const held = new Map(
      moves.flatMap((move) =>
        ((move.lines as Row[] | undefined) ?? []).map((line) => [String(line.id), line]),
      ),
    )
    const entry = (value: unknown, fresh: boolean): Row | null => {
      const change = object(value)
      const values = object(change?.values)
      const id = typeof change?.id === 'string' ? change.id : ''
      const line = held.get(id)
      if (!id || !values || fresh === Boolean(line)) return null
      const merged = { ...(line ? heldLineValues(line) : {}), ...values }
      if (!moveIds.has(String(merged.moveId))) return null
      const row: Row = { id: fresh ? newId(id) : id, moveId: String(merged.moveId) }
      if (fresh || LINE_FIELDS.some((key) => Object.hasOwn(values, key)))
        Object.assign(row, {
          quantity: figure(merged.quantity),
          lotId: merged.lotId ? String(merged.lotId) : null,
          name: String(merged.name ?? ''),
          expirationDate: merged.expirationDate ? String(merged.expirationDate) : '',
          picked: merged.picked === true,
          ...(line?.receiptRevision ? { expectedRevision: String(line.receiptRevision) } : {}),
        })
      // A new line leaves an empty price to the average, as a saved line does.
      if (Object.hasOwn(values, 'unitCost') && (!fresh || figure(values.unitCost)))
        row.unitCost = figure(values.unitCost)
      return row
    }
    const lines: Row[] = []
    for (const [key, fresh] of [
      ['updated', false],
      ['added', true],
    ] as const)
      for (const value of list(key)) {
        const row = entry(value, fresh)
        if (!row) return null
        lines.push(row)
      }
    return lines
  } catch {
    return null
  }
}
