import { linePriceFunctions } from '../../pricing/functions/line-price.ts'
import { COMBO_DEMAND_EFFECTS } from '../combo-demand.ts'
import { COMBO_LINE_EFFECTS } from '../combo-lines.ts'
import { VARIANT_PRICE_EFFECTS } from '../../product/variant-price.ts'
import { VARIANT_NAME_EFFECTS } from '../../product/functions/variants.ts'
import { LINE_COST_EFFECTS } from '../line-cost.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { editSaleLine } from '../line-edit.ts'

export async function updateLine(ctx: Ctx, args: Row) {
  return editSaleLine(ctx, args)
}

export const lineEditFunctions = {
  updateLine: defineFn({
    input: {
      id: 'id',
      expectedRevision: 'int',
      productUomQty: 'decimal?',
      productId: 'id?',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxIds: 'json?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      ...LINE_COST_EFFECTS,
      ...linePriceFunctions.priceForLine.effects!,
      ...COMBO_LINE_EFFECTS,
      ...COMBO_DEMAND_EFFECTS,
      ...VARIANT_PRICE_EFFECTS,
      ...VARIANT_NAME_EFFECTS,
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:stock.Move',
      'read:account.MoveLine',
      'read:product.Cost',
      'read:uom.Unit',
      'read:sale.Order',
      'write:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'read:company.Company',
      'read:product.Product',
      'read:product.Template',
      'read:account.Tax',
      'read:account.ProductTax',
    ],
    idempotent: true,
    agent: true,
    handler: updateLine,
  }),
}
