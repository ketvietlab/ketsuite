import { copyQuotationWithCodes } from './copy-quotation.ts'
import { quotationWithBenefits } from './quotation-writer.ts'
import sale from '../sale/index.ts'
import { functions } from './functions/index.ts'
import { confirmSaleWithLoyalty, cancelSaleWithLoyalty } from './order-lifecycle.ts'
import { quotationMutations, quotationMutationOrderId } from '../sale/quotation-mutations.ts'
import type { FnSpec } from '@ketvietlab/ketjs'
import { withOrderHistory } from '../sale/order-history.ts'

/** Commerce uses the same atomic workflow for native Sale and adapter endpoints. */
export function saleWithLoyalty() {
  const writes: Record<string, FnSpec> = {}
  for (const [key, write] of Object.entries(quotationMutations))
    writes[key] = quotationWithBenefits(
      sale.functions[key]!,
      key === 'copyOrder' ? copyQuotationWithCodes : write,
      (ctx, args) => quotationMutationOrderId(ctx, key, args),
      key === 'createOrder' || key === 'copyOrder',
    )

  return {
    ...sale,
    depends: [...sale.depends, 'loyalty'],
    functions: withOrderHistory({
      ...sale.functions,
      ...writes,
      confirmOrder: {
        ...sale.functions.confirmOrder!,
        effects: functions.confirmOrder!.effects,
        handler: confirmSaleWithLoyalty,
      },
      cancelOrder: {
        ...sale.functions.cancelOrder!,
        effects: functions.cancelOrder!.effects,
        handler: cancelSaleWithLoyalty,
      },
    }),
  }
}
