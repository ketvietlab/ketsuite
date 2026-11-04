import { copyOrderInTransaction } from './copy-order.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { resetOrder } from './reset-order.ts'
import { createOrder } from './create-order.ts'
import { writeQuotationLine, removeQuotationLine, saveDraftInTransaction } from './functions/lines.ts'
import { editSaleLine } from './line-edit.ts'
import { applyQuotationGrid } from './quotation-grid.ts'
import { changeCatalogueQuantity } from './catalogue-quantity.ts'
import { saveCatalogueDraft } from './functions/catalogue-draft.ts'
import { saveVariantMatrix } from './variant-matrix.ts'
import { applyDiscount } from './functions/discounts.ts'
import { setOptionalSections } from './functions/sections.ts'
import { saveOrderDeliveryPromise } from './delivery-promise-write.ts'
import { ours } from './scope.ts'

/**
 * Domain writers for a caller-owned transaction. The module's function descriptors
 * retain input, effects and permissions; compositions must merge their own effects,
 * roll back a returned refusal and never invoke these outside a transaction.
 */
export const quotationMutations: Record<string, (ctx: Ctx, args: Row) => Promise<Row>> = {
  createOrder,
  copyOrder: copyOrderInTransaction,
  resetOrder,
  addLine: (ctx, args) => writeQuotationLine(ctx, args),
  removeLine: removeQuotationLine,
  async saveDraft(ctx, args) {
    await saveDraftInTransaction(ctx, args)
    return { ok: true, id: args.id, revision: (await ours(ctx, 'sale.Order', { id: args.id }))[0]?.revision }
  },
  updateLine: (ctx, args) => editSaleLine(ctx, args, false, true),
  applyLineGrid: (ctx, args) => applyQuotationGrid(ctx, args, true),
  setCatalogueQuantity: (ctx, args) => changeCatalogueQuantity(ctx, args, true),
  saveCatalogueDraft: (ctx, args) => saveCatalogueDraft(ctx, args, true),
  setVariantMatrix: (ctx, args) => saveVariantMatrix(ctx, args, true),
  applyDiscount: (ctx, args) => applyDiscount(ctx, args, true),
  setOptionalSections: (ctx, args) => setOptionalSections(ctx, args, true),
  saveDeliveryPromise: (ctx, args) => saveOrderDeliveryPromise(ctx, args, true),
}

export async function quotationMutationOrderId(ctx: Ctx, key: string, args: Row) {
  if (key === 'addLine') return args.orderId
  if (key === 'updateLine' || key === 'removeLine')
    return (await ours(ctx, 'sale.OrderLine', { id: args.id }))[0]?.orderId
  return args.id
}
