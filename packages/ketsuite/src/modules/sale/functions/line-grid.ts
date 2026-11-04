import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { lineEditFunctions } from './line-edit.ts'
import { linesFunctions } from './lines.ts'
import { applyQuotationGrid } from '../quotation-grid.ts'
import { updatePrices } from '../update-prices.ts'
import { saleRecordResult } from '../record-result.ts'
import { DELIVERED_COST_EFFECTS } from '../delivered-cost.ts'

export async function applyLineGridHandler(ctx: Ctx, args: Row) {
  return applyQuotationGrid(ctx, args)
}

export async function updatePricesHandler(ctx: Ctx, args: Row) {
  return saleRecordResult(await updatePrices(ctx, args))
}

const GRID_EFFECTS = [
  ...new Set([
    ...linesFunctions.addLine!.effects!,
    ...lineEditFunctions.updateLine.effects!,
    'read:account.Move',
    ...DELIVERED_COST_EFFECTS,
  ]),
]

export const lineGridFunctions = {
  applyLineGrid: defineFn({
    input: { id: 'id', expectedRevision: 'int', changes: 'json' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: GRID_EFFECTS,
    idempotent: true,
    agent: true,
    handler: applyLineGridHandler,
  }),
  // Reprice a quotation by its pricelist, optionally switching it first (D14).
  updatePrices: defineFn({
    input: { id: 'id', expectedRevision: 'int', pricelistId: 'id?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      ...new Set([...GRID_EFFECTS, 'read:pricing.Pricelist', 'read:stock.Move', 'read:account.MoveLine']),
    ],
    idempotent: true,
    agent: true,
    handler: updatePricesHandler,
  }),
}
