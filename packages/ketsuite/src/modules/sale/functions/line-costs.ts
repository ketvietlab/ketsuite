import { multiplyDecimals, subtractDecimals } from '../../account/money.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { ours } from '../scope.ts'

export async function getLineCostsHandler(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!order) return []
  const costs = await ours(ctx, 'sale.OrderLineCost', { orderId: args.id })
  const lines = await ours(ctx, 'sale.OrderLine', { orderId: args.id })
  const free = lines.filter((line) => !line.productId && !line.displayType)
  return [
    ...costs,
    ...free.map((line) => ({
      id: `free:${String(line.id)}`,
      orderId: order.id,
      lineId: line.id,
      productId: null,
      productUomId: null,
      baseUomId: null,
      factor: '1',
      baseCost: '0',
      unitCost: '0',
      currency: order.currency,
      capturedAt: null,
    })),
  ].map((cost) => {
    const line = lines.find((row) => row.id === cost.lineId)
    return {
      ...cost,
      margin:
        line && cost.unitCost != null
          ? subtractDecimals(line.priceSubtotal, multiplyDecimals(cost.unitCost, line.productUomQty))
          : null,
    }
  })
}

export const lineCostsFunctions = {
  getLineCosts: defineFn({
    input: { id: 'id' },
    effects: ['read:sale.Order', 'read:sale.OrderLineCost', 'read:sale.OrderLine'],
    idempotent: true,
    agent: true,
    handler: getLineCostsHandler,
  }),
}
