import type { Ctx, Row } from '@ketvietlab/ketjs'
import { copyOrderInTransaction } from '../sale/copy-order.ts'
import { ours } from '../sale/scope.ts'
import { SaleRefused } from '../sale/functions/shared.ts'
import { applyLoyaltyCode } from '../loyalty/order-functions.ts'
import { saleSnapshot } from './functions/shared.ts'
import { copyQuotationPreferences } from '../sale_template/copy-preferences.ts'
import { validateSaleCode } from './sale-code.ts'

/** Reconsider reusable program codes on the copy's date; never carry customer card spending. */
export async function copyQuotationWithCodes(ctx: Ctx, args: Row) {
  const copied = await copyOrderInTransaction(ctx, args)
  if (copied.ok !== true || copied.replayed) return copied
  const source = (await ours(ctx, 'sale.Order', { id: args.sourceId }))[0]!
  await copyQuotationPreferences(ctx, source, args.id)
  const applications = await ours(ctx, 'loyalty.Application', { orderType: 'sale', orderId: args.sourceId })
  for (const application of applications.filter((row) => row.code && row.state !== 'dismissed')) {
    const program = (await ours(ctx, 'loyalty.Program', { id: application.programId }))[0]
    if (program?.salePolicyVersion !== 1 || program.programType !== 'promo_code') continue
    const snapshot = await saleSnapshot(ctx, String(args.id))
    if (!snapshot) throw new SaleRefused({ ok: false })
    if ((await validateSaleCode(ctx, snapshot, application.code)).ok !== true) continue
    const applied = await applyLoyaltyCode(ctx, { order: snapshot, code: application.code })
    if (applied.ok !== true) throw new SaleRefused(applied)
  }
  return copied
}
