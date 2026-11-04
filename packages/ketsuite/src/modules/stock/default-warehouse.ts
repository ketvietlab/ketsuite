type Row = Record<string, unknown>

/**
 * The warehouse a new document starts in: the one warehouse the caller is assigned to, or the company's only
 * warehouse when the caller is assigned to none. Anyone who may work in several starts with none chosen, so
 * nobody books into a warehouse by mistake.
 */
export const defaultWarehouseId = (warehouses: readonly Row[]): string | null => {
  const assigned = warehouses.filter((row) => row.assigned === true)
  const pool = assigned.length ? assigned : warehouses
  return pool.length === 1 ? String(pool[0]!.id) : null
}
