import type { Ctx, Row } from '@ketvietlab/ketjs'
import { InventoryRefused, invalid } from './inventory-validation.ts'
import { mutateTransferQuant, reserveEffects } from './stock-ledger.ts'
import { quantityText } from './quantity-text.ts'

export const MOVE_DEMAND_EFFECTS = reserveEffects

/** Resize pending demand in the caller's transaction, releasing only unpicked reservations. */
export async function resizeMoveDemand(ctx: Ctx, id: unknown, demand: number) {
  let move = (await ctx.db.select('stock.Move', { id }))[0]
  if (!move || !Number.isFinite(demand) || demand < 0 || ['done', 'cancel'].includes(String(move.state)))
    throw new InventoryRefused(invalid('productUomQty', 'Pending stock demand cannot be changed.'))
  if (move.pickingId) {
    const picking = (await ctx.db.select('stock.Picking', { id: move.pickingId }))[0]
    if (!picking || ['done', 'cancel'].includes(String(picking.state)))
      throw new InventoryRefused(invalid('productUomQty', 'The transfer has already ended.'))
    const lock = await ctx.db.compareAndSet(
      'stock.Picking',
      { id: picking.id },
      { state: picking.state },
      { state: picking.state },
    )
    if (!('dryRun' in lock) && !lock.matched)
      throw new InventoryRefused(invalid('productUomQty', 'The transfer changed; reload it.'))
    move = (await ctx.db.select('stock.Move', { id }))[0]!
    if (['done', 'cancel'].includes(String(move.state)))
      throw new InventoryRefused(invalid('productUomQty', 'The stock move has already ended.'))
  }
  const lines = (await ctx.db.select('stock.MoveLine', { moveId: id })).sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  )
  const picked = lines.filter((line) => line.picked).reduce((sum, line) => sum + Number(line.quantity), 0)
  if (demand + 0.000001 < picked)
    throw new InventoryRefused(
      invalid('productUomQty', 'Demand cannot be reduced below the picked quantity.'),
    )
  let release = Math.max(0, lines.reduce((sum, line) => sum + Number(line.quantity), 0) - demand)
  const source = (await ctx.db.select('stock.Location', { id: move.locationId }))[0]
  for (const line of lines.filter((row) => !row.picked).reverse()) {
    const removed = Math.min(release, Number(line.quantity))
    if (removed <= 0) continue
    if (source && ['internal', 'transit'].includes(String(source.usage)))
      await mutateTransferQuant(ctx, {
        productId: move.productId,
        locationId: move.locationId,
        lotId: line.lotId,
        quantity: 0,
        reserved: -removed,
      })
    const quantity = Number(line.quantity) - removed
    await ctx.db.update(
      'stock.MoveLine',
      { id: line.id },
      { quantity: quantityText(quantity), quantityProductUom: quantityText(quantity) },
    )
    release -= removed
  }
  await ctx.db.update(
    'stock.Move',
    { id },
    { productUomQty: String(demand), state: demand === 0 ? 'cancel' : 'confirmed' },
  )
  if (demand === 0 && move.pickingId) {
    const siblings = await ctx.db.select('stock.Move', { pickingId: move.pickingId })
    if (siblings.every((row) => row.state === 'cancel'))
      await ctx.db.update('stock.Picking', { id: move.pickingId }, { state: 'cancel' })
  }
}

/**
 * Cancel a move that has not ended in the caller's transaction, giving back what its unpicked lines
 * hold. Cancelling a transfer and cancelling the sales order that made it both end their moves here,
 * so neither leaves goods held for a move no one will do (K18, K20). Returns how much went back to
 * stock, so the caller can offer it to transfers still waiting (K60).
 */
export async function cancelMove(ctx: Ctx, move: Row): Promise<number> {
  if (['done', 'cancel'].includes(String(move.state))) return 0
  let released = 0
  for (const line of await ctx.db.select('stock.MoveLine', { moveId: move.id })) {
    // Per line, for the same reason completePicking works per line: the
    // goods sit where the line says, not where the move does.
    const source = (await ctx.db.select('stock.Location', { id: line.locationId }))[0]
    if (!line.picked && source && ['internal', 'transit'].includes(String(source.usage))) {
      released += Number(line.quantity)
      await mutateTransferQuant(ctx, {
        productId: move.productId,
        locationId: line.locationId,
        lotId: line.lotId,
        quantity: 0,
        reserved: -Number(line.quantity),
      })
    }
    await ctx.db.update(
      'stock.MoveLine',
      { id: line.id },
      { quantity: '0', quantityProductUom: '0', picked: true },
    )
  }
  await ctx.db.update('stock.Move', { id: move.id }, { state: 'cancel', quantity: '0', picked: false })
  return released
}
