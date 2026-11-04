import type { Ctx, Row } from '@ketvietlab/ketjs'
import { cancelMove } from '../stock/move-demand.ts'
import { offerFreedGoods } from '../stock/reservation-policy.ts'
import { ours } from './scope.ts'
import {
  invalid,
  externalOrder,
  authorityRefusal,
  n,
  movesOf,
  invoiceLinesOf,
  recordOrderLifecycle,
  SaleRefused,
  claimRevision,
} from './functions/shared.ts'
import { recordOrderEvent } from './order-history.ts'

export async function cancelOrder(ctx: Ctx, args: Row, options: { inTransaction?: boolean } = {}) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!order) return invalid('id', 'sales order does not exist')
  if (args.expectedRevision !== undefined && n(order.revision) !== n(args.expectedRevision))
    return invalid('expectedRevision', 'sales order changed')
  if (externalOrder(order)) return authorityRefusal()
  if (order.state === 'cancel') return { ok: true, id: args.id }
  try {
    const commit = async (tx: Ctx) => {
      const current = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (!current || !(await claimRevision(tx, current, args.expectedRevision)))
        throw new SaleRefused(invalid('expectedRevision', 'sales order changed'))
      const lines = await ours(tx, 'sale.OrderLine', { orderId: args.id })
      const lineIds = lines.map((line) => String(line.id))
      const moves = await movesOf(tx, lineIds)
      if (moves.some((move) => move.state === 'done'))
        throw new SaleRefused(invalid('state', 'a delivered order cannot be cancelled'))
      if ((await invoiceLinesOf(tx, lineIds)).length)
        throw new SaleRefused(invalid('state', 'an invoiced order cannot be cancelled'))
      // K20: the delivery's held goods go back to stock with it.
      // K60: and go on to the transfers waiting for them.
      const freed = new Map<unknown, unknown[]>()
      for (const move of moves)
        if ((await cancelMove(tx, move)) > 0)
          freed.set(move.pickingId, [...(freed.get(move.pickingId) ?? []), move.productId])
      for (const pickingId of [...new Set(moves.map((move) => move.pickingId).filter(Boolean))])
        await tx.db.update('stock.Picking', { id: pickingId }, { state: 'cancel' })
      for (const [pickingId, productIds] of freed) await offerFreedGoods(tx, pickingId, productIds)
      await tx.db.update('sale.Order', { id: args.id }, { state: 'cancel' })
      // A draft quotation has no fulfillment to cancel. Only an order that
      // had entered the sale state publishes a cancellation fact.
      if (current.state === 'sale') await recordOrderLifecycle(tx, args.id, 'cancelled')
      await recordOrderEvent(tx, args.id, { action: 'cancel' })
    }
    await (options.inTransaction ? commit(ctx) : ctx.tx(commit))
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
  return { ok: true, id: args.id }
}
