import { claimSaleProgramNamespace } from './programs.ts'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { loyaltyTransaction } from './order-lifecycle.ts'
import { ours } from '../sale/scope.ts'
import { saleRecordResult } from '../sale/record-result.ts'
import {
  quotationBenefitEffects,
  refreshQuotationBenefits,
  removedQuotationBenefits,
} from './quotation-benefits.ts'

/** Wrap a domain writer, retaining its public descriptor and one atomic commit. */
export function quotationWithBenefits(
  spec: FnSpec,
  write: (ctx: Ctx, args: Row) => Promise<Row>,
  orderIdOf: (ctx: Ctx, args: Row) => Promise<unknown>,
  replayCreate = false,
): FnSpec {
  return {
    ...spec,
    effects: [...new Set([...(spec.effects ?? []), ...quotationBenefitEffects])],
    handler: async (ctx, args) =>
      saleRecordResult(
        await loyaltyTransaction(ctx, async (tx) => {
          await claimSaleProgramNamespace(tx)
          const orderId = await orderIdOf(tx, args)
          const beforeOrder = orderId ? (await ours(tx, 'sale.Order', { id: orderId }))[0] : null
          const before = orderId ? await ours(tx, 'sale.OrderLine', { orderId }) : []
          const result = await write(tx, args)
          if (result.ok !== true || !orderId || ((replayCreate || args.create === true) && beforeOrder))
            return result
          const removed = await removedQuotationBenefits(tx, String(orderId), before)
          await refreshQuotationBenefits(tx, String(orderId), removed)
          const after = (await ours(tx, 'sale.Order', { id: orderId }))[0]
          return Object.hasOwn(result, 'revision') ? { ...result, revision: after?.revision } : result
        }),
      ),
  }
}
