import type { Ctx, Row } from '@ketvietlab/ketjs'
import { ours } from './scope.ts'
import { deliveryPatch, deliveryRefusal, expectedDeliveryDate, deliverySchedule } from './delivery-promise.ts'
import { claimRevision, externalOrder, authorityRefusal, SaleRefused } from './functions/shared.ts'
import { updatePickingState } from '../stock/stock-ledger.ts'

export async function saveOrderDeliveryPromise(ctx: Ctx, args: Row, inTransaction = false) {
  try {
    const save = async (tx: Ctx) => {
      const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (!order) return deliveryRefusal('id', 'missing')
      if (externalOrder(order)) return authorityRefusal()
      if (order.locked || !['draft', 'sent', 'sale'].includes(String(order.state)))
        return deliveryRefusal('state', 'locked')
      const refused = await deliveryPatch(tx, args, order)
      if (refused) return refused
      if (args.expectedRevision == null || !(await claimRevision(tx, order, args.expectedRevision)))
        throw new SaleRefused(deliveryRefusal('expectedRevision', 'conflict'))
      const patch: Row = {}
      if (Object.hasOwn(args, 'shippingPolicy')) patch.shippingPolicy = args.shippingPolicy ?? 'direct'
      if (Object.hasOwn(args, 'commitmentDate'))
        patch.commitmentDate = args.commitmentDate ? await deliverySchedule(tx, args.commitmentDate) : null
      await tx.db.update('sale.Order', { id: order.id }, patch)
      const current = { ...order, ...patch }
      const lines = await ours(tx, 'sale.OrderLine', { orderId: order.id })
      const expectedDate = await expectedDeliveryDate(tx, current, lines)
      const promise = current.commitmentDate || expectedDate
      const scheduledDate = promise ? await deliverySchedule(tx, promise) : null
      if (scheduledDate && current.stockAuthority !== 'external') {
        const seen = new Set<unknown>()
        for (const line of lines)
          for (const move of await tx.db.select('stock.Move', { saleLineId: line.id })) {
            if (!move.pickingId || seen.has(move.pickingId)) continue
            seen.add(move.pickingId)
            const picking = (await ours(tx, 'stock.Picking', { id: move.pickingId }))[0]
            if (!picking || ['done', 'cancel'].includes(String(picking.state))) continue
            const type = (await ours(tx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
            if (type?.code !== 'outgoing') continue
            const changed = await tx.db.compareAndSet(
              'stock.Picking',
              { id: picking.id },
              { state: picking.state },
              { scheduledDate, moveType: current.shippingPolicy ?? 'direct' },
            )
            if (!('dryRun' in changed) && !changed.matched)
              throw new SaleRefused(deliveryRefusal('expectedRevision', 'conflict'))
            // Shipping at once or as goods come changes when the delivery is ready.
            await updatePickingState(tx, picking.id)
          }
      }
      return { ok: true, id: args.id, expectedDate }
    }
    return inTransaction ? await save(ctx) : await ctx.tx(save)
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
}
