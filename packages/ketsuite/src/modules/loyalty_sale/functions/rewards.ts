import { refreshQuotationBenefits } from '../quotation-benefits.ts'
import { claimSaleProgramNamespace } from '../programs.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { invalid, issue } from '../../loyalty/engine.ts'
import { applyOrderReward, removeOrderReward } from '../../loyalty/order-functions.ts'
import { ours } from '../../sale/scope.ts'
import { claimRevision, externalOrder } from '../../sale/functions/shared.ts'
import { saleSnapshot, materializeReward, removeRewardLines } from './shared.ts'
import { loyaltyTransaction } from '../order-lifecycle.ts'

export async function claimQuotation(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.orderId }))[0]
  if (!order || !['draft', 'sent'].includes(String(order.state)) || order.locked || externalOrder(order))
    return invalid(issue('orderId', 'loyalty.error.state'))
  if (!(await claimRevision(ctx, order, args.expectedRevision)))
    return invalid(issue('expectedRevision', 'sale.error.orderChanged'))
  return { ok: true }
}

export function applyRewardHandler(ctx: Ctx, args: Row) {
  return loyaltyTransaction(ctx, async (tx) => {
    await claimSaleProgramNamespace(tx)
    const claimed = await claimQuotation(tx, args)
    if (claimed.ok !== true) return claimed
    const order = await saleSnapshot(tx, String(args.orderId))
    if (!order) return invalid(issue('orderId', 'loyalty.error.order'))
    const applied = await applyOrderReward(
      tx,
      {
        order,
        programId: args.programId,
        rewardId: args.rewardId,
        ...(args.points === undefined ? {} : { points: args.points }),
      },
      { inTransaction: true },
    )
    if (applied.ok !== true) return applied
    const materialized = await materializeReward(
      tx,
      String(args.orderId),
      String(args.programId),
      applied.reward as Row,
    )
    if (materialized.ok !== true) return materialized
    await refreshQuotationBenefits(tx, String(args.orderId))
    return applied
  })
}

export function removeRewardHandler(ctx: Ctx, args: Row) {
  return loyaltyTransaction(ctx, async (tx) => {
    await claimSaleProgramNamespace(tx)
    const claimed = await claimQuotation(tx, args)
    if (claimed.ok !== true) return claimed
    const removed = await removeOrderReward(
      tx,
      { orderType: 'sale', orderId: args.orderId, programId: args.programId },
      { inTransaction: true },
    )
    if (removed.ok !== true) return removed
    await removeRewardLines(tx, String(args.orderId), String(args.programId))
    await refreshQuotationBenefits(tx, String(args.orderId), new Set([String(args.programId)]))
    return removed
  })
}
