import { createHash } from 'node:crypto'
import type { Row } from '@ketvietlab/ketjs'
/** Same normalized read on SQLite/PostgreSQL; includes every persisted rule field. */
export function pricelistRevision(record: Row, items: Row[]) {
  const row = (value: Row) =>
    Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [
          key,
          (key === 'dateStart' || key === 'dateEnd') && entry ? new Date(String(entry)).toISOString() : entry,
        ]),
    )
  return createHash('sha256')
    .update(
      JSON.stringify([
        row(record),
        [...items].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(row),
      ]),
    )
    .digest('hex')
}
