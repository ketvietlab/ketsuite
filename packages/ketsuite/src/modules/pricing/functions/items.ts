import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

export function listPricelistItemsHandler(ctx: Ctx, args: Row) {
  return ctx.db.select('pricing.PricelistItem', { pricelistId: args.pricelistId })
}

export const listPricelistItemsFunctions = {
  listPricelistItems: defineFn({
    input: { pricelistId: 'id' },
    effects: ['read:pricing.PricelistItem'],
    agent: true,
    handler: listPricelistItemsHandler,
  }),
}
