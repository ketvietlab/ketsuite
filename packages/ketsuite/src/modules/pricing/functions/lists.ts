import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

export function listPricelistsHandler(ctx: Ctx) {
  return ctx.db.select('pricing.Pricelist')
}

export const listPricelistsFunctions = {
  listPricelists: defineFn({
    input: {},
    effects: ['read:pricing.Pricelist'],
    agent: true,
    handler: listPricelistsHandler,
  }),
}
