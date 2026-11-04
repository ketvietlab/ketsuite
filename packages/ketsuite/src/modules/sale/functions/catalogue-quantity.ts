import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { COMBO_DEMAND_EFFECTS } from '../combo-demand.ts'
import { linesFunctions } from './lines.ts'
import { lineEditFunctions } from './line-edit.ts'
import { changeCatalogueQuantity } from '../catalogue-quantity.ts'

export async function setCatalogueQuantity(ctx: Ctx, args: Row) {
  return changeCatalogueQuantity(ctx, args)
}

export const setCatalogueQuantityHandler = (ctx: Ctx, args: Row) => setCatalogueQuantity(ctx, args)

export const catalogueQuantityFunctions = {
  setCatalogueQuantity: defineFn({
    input: { id: 'id', productId: 'id', quantity: 'decimal', expectedRevision: 'int' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      ...linesFunctions.addLine!.effects!,
      ...lineEditFunctions.updateLine.effects!,
      ...COMBO_DEMAND_EFFECTS,
      'read:account.Move',
    ],
    agent: true,
    idempotent: true,
    handler: setCatalogueQuantityHandler,
  }),
}
