import type { Ctx, Row } from '@ketvietlab/ketjs'
import { invalid, issue } from '../../loyalty/engine.ts'
import { reverseOrderLoyalty } from '../../loyalty/order-functions.ts'
import { ours } from '../../sale/scope.ts'
import { confirmSaleWithLoyalty, cancelSaleWithLoyalty, loyaltyTransaction } from '../order-lifecycle.ts'

export const confirmOrderHandler = confirmSaleWithLoyalty
export const cancelOrderHandler = cancelSaleWithLoyalty

export async function refundOrderHandler(ctx: Ctx, args: Row) {
  return loyaltyTransaction(ctx, async (tx) => {
    const order = (await ours(tx, 'sale.Order', { id: args.originalOrderId }))[0]
    if (!order) return invalid(issue('originalOrderId', 'loyalty.error.order'))
    const loyalty = (await reverseOrderLoyalty(
      tx,
      {
        orderType: 'sale',
        orderId: args.originalOrderId,
      },
      { inTransaction: true },
    )) as Row
    if (loyalty.ok === true)
      await tx.db.update('sale.Order', { id: args.originalOrderId }, { loyaltyState: 'reversed' })
    return loyalty.ok === true
      ? { ok: true, id: args.id, originalOrderId: args.originalOrderId, loyalty }
      : loyalty
  })
}
