import templates from '../sale_template/index.ts'
import { applyTemplateInTransaction, createQuotationInTransaction } from '../sale_template/domain.ts'
import { quotationWithBenefits } from './quotation-writer.ts'
import { withOrderHistory } from '../sale/order-history.ts'

/** Commerce template writers share quotation benefit recalculation and rollback. */
export function saleTemplatesWithLoyalty() {
  const id = async (_ctx: unknown, args: Record<string, unknown>) => args.id
  return {
    ...templates,
    depends: [...templates.depends, 'loyalty'],
    functions: withOrderHistory({
      ...templates.functions,
      createQuotation: quotationWithBenefits(
        templates.functions.createQuotation!,
        createQuotationInTransaction,
        id,
        true,
      ),
      applyQuotation: quotationWithBenefits(
        templates.functions.applyQuotation!,
        (ctx, args) => applyTemplateInTransaction(ctx, args, false),
        id,
      ),
      addSection: quotationWithBenefits(
        templates.functions.addSection!,
        (ctx, args) => applyTemplateInTransaction(ctx, args, true),
        id,
      ),
    }),
  }
}
