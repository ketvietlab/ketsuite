import { validateSaleCode } from '../sale-code.ts'
import { ours } from '../../sale/scope.ts'
import { refreshQuotationBenefits } from '../quotation-benefits.ts'
import { claimSaleProgramNamespace } from '../programs.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { invalid, issue, normalizeCode } from '../../loyalty/engine.ts'
import { evaluateLoyaltyOrder, applyLoyaltyCode, removeOrderReward } from '../../loyalty/order-functions.ts'
import { saleSnapshot } from './shared.ts'
import { claimQuotation } from './rewards.ts'
import { loyaltyTransaction } from '../order-lifecycle.ts'

export async function evaluateOrderHandler(ctx: Ctx, args: Row) {
  const order = await saleSnapshot(ctx, String(args.orderId))
  if (!order) return invalid(issue('orderId', 'loyalty.error.order'))
  const applications = await ours(ctx, 'loyalty.Application', { orderType: 'sale', orderId: args.orderId })
  return evaluateLoyaltyOrder(ctx, {
    order: { ...order, codes: applications.map((row) => row.code).filter(Boolean) },
  })
}

export function applyCodeHandler(ctx: Ctx, args: Row) {
  return loyaltyTransaction(ctx, async (tx) => {
    await claimSaleProgramNamespace(tx)
    const claimed = await claimQuotation(tx, args)
    if (claimed.ok !== true) return claimed
    const order = await saleSnapshot(tx, String(args.orderId))
    if (!order) return invalid(issue('orderId', 'loyalty.error.order'))
    const validation = await validateSaleCode(tx, order, args.code)
    if (validation.ok !== true) return validation
    const code = normalizeCode(args.code)
    const rule = (await ours(tx, 'loyalty.Rule', { normalizedCode: code })).find((row) => row.active)
    const wallet = (await ours(tx, 'loyalty.Wallet', { normalizedCode: code })).find((row) => row.active)
    const programId = rule?.programId ?? wallet?.programId
    const program = programId ? (await ours(tx, 'loyalty.Program', { id: programId }))[0] : null
    if (program?.salePolicyVersion === 1) {
      const removed = await removeOrderReward(
        tx,
        { orderType: 'sale', orderId: args.orderId, programId },
        { inTransaction: true },
      )
      if (removed.ok !== true) return removed
    }
    const applied = await applyLoyaltyCode(tx, { order, code: args.code })
    if (applied.ok !== true) return applied
    await refreshQuotationBenefits(tx, String(args.orderId))
    return applied
  })
}
