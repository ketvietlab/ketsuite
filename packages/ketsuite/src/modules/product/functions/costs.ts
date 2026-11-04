import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { saveProductCost } from '../save-cost.ts'
import { stockPositionEffects } from '../stock-policy.ts'
export async function setCostHandler(ctx: Ctx, args: Record<string, unknown>) {
  return saveProductCost(ctx, args)
}

export const costsFunctions: Record<string, FnSpec> = {
  setCost: defineFn({
    input: { productId: 'id', standardPrice: 'decimal?', amount: 'decimal?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'write:product.Template',
      'read:product.Cost',
      'write:product.Cost',
      ...stockPositionEffects,
    ],
    idempotent: true,
    agent: true,
    handler: setCostHandler,
  }),
}
