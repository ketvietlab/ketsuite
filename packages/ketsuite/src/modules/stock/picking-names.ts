import type { Ctx } from '@ketvietlab/ketjs'
import { ours } from './scope.ts'

/** What a transfer's number says it does: comes in, goes out or moves inside (K17, mock `pickingCodes`). */
const CODES: Record<string, string> = { incoming: 'NK', outgoing: 'XK', internal: 'CK' }

/** What numbering adds to a caller that already reads the transfer and its operation type. */
export const PICKING_NAME_EFFECTS = [
  'read:stock.Warehouse',
  'read:stock.PickingSequence',
  'write:stock.PickingSequence',
] as const

/**
 * The next number of a warehouse's transfers of a kind, as HCM/NK/0003: one sequence per warehouse and
 * kind, whatever operation type or module makes the transfer (mock `nextPickingName`). A warehouse that
 * is gone, or a kind with no code, leaves the caller's own name.
 */
export async function nextPickingName(ctx: Ctx, warehouseId: unknown, code: unknown) {
  const kind = CODES[String(code)]
  const warehouse = warehouseId ? (await ours(ctx, 'stock.Warehouse', { id: warehouseId }))[0] : undefined
  if (!kind || !warehouse || !ctx.scope.company) return null
  // Keyed by the company too: `id` is a tenant-wide primary key.
  const id = `${ctx.scope.company}:${String(warehouse.id)}:${kind}`
  await ctx.db.insertIfAbsent('stock.PickingSequence', { id, nextNumber: 1 })
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const row = (await ours(ctx, 'stock.PickingSequence', { id }))[0]
    if (!row) throw new Error('stock picking sequence row disappeared while assigning a number')
    const current = Number(row.nextNumber)
    const taken = await ctx.db.compareAndSet(
      'stock.PickingSequence',
      { id },
      { nextNumber: row.nextNumber },
      { nextNumber: current + 1 },
    )
    if ('dryRun' in taken || taken.matched)
      return `${String(warehouse.code || 'WH')}/${kind}/${String(current).padStart(4, '0')}`
  }
  throw new Error('stock picking sequence did not settle after concurrent updates')
}

/** The next number for a transfer of an operation type, from its warehouse and kind. */
export async function nextPickingNameOfType(ctx: Ctx, pickingTypeId: unknown) {
  const type = pickingTypeId ? (await ours(ctx, 'stock.PickingType', { id: pickingTypeId }))[0] : undefined
  return type ? nextPickingName(ctx, type.warehouseId, type.code) : null
}
