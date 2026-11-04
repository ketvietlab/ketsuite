type Row = Record<string, unknown>
const object = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null

/** A cell value as the counting function reads it: an empty cell is an empty figure, never zero. */
const figure = (value: unknown) => (value == null ? '' : String(value))

/**
 * Reads the count grid's posted changes (`{added, updated, removed, order}`) against the lines the
 * modal holds. Only structure is checked here; the server checks every figure, reason and line.
 * A changed reason sends the line's figure along, since a saved line always carries one.
 * Typed pieces travel as `pieces` beside the line's previous figure; a deployment that counts in
 * pieces converts them on the server, and any other ignores them.
 */
export function postedCountLines(
  held: readonly Row[],
  raw: string,
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
    // The grid offers no new rows: found goods come in through their own dialog.
    if (list('added').length) return null
    const lines = new Map(held.map((line) => [String(line.id), line]))
    const removed: string[] = []
    for (const id of list('removed')) {
      if (typeof id !== 'string' || !lines.has(id)) return null
      removed.push(id)
    }
    const saved: Row[] = []
    for (const value of list('updated')) {
      const change = object(value)
      const values = object(change?.values)
      const id = String(change?.id ?? '')
      const line = lines.get(id)
      if (!line || !values) return null
      if (removed.includes(id)) continue
      // Pieces typed on a line counted in pieces go along for the server to convert, unless the
      // counted quantity was typed too: the quantity is what the count books.
      const pieces =
        line.piecesEnabled === true &&
        Object.hasOwn(values, 'pieces') &&
        !Object.hasOwn(values, 'counted') &&
        values.pieces != null &&
        values.pieces !== ''
          ? { pieces: String(values.pieces) }
          : {}
      saved.push({
        lineId: id,
        counted: figure(Object.hasOwn(values, 'counted') ? values.counted : line.counted),
        ...pieces,
        ...(['qualityGood', 'qualityPoor', 'qualityLost'].some(
          (key) => Object.hasOwn(values, key) || line[key] != null,
        )
          ? Object.fromEntries(
              ['qualityGood', 'qualityPoor', 'qualityLost'].map((key) => [
                key,
                Object.hasOwn(values, key) ? values[key] : (line[key] ?? 0),
              ]),
            )
          : {}),
        ...(Object.hasOwn(values, 'reasonCode') ? { reasonCode: String(values.reasonCode ?? '') } : {}),
        ...(Object.hasOwn(values, 'reason') ? { reason: String(values.reason ?? '') } : {}),
      })
    }
    return { lines: saved, removed }
  } catch {
    return null
  }
}
