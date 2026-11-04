import type { Ctx, Row } from '@ketvietlab/ketjs'
import { multiplyDecimals } from '../account/money.ts'
import { sellableProduct } from '../product/sellable.ts'
import { linePriceFunctions } from '../pricing/functions/line-price.ts'
import { saleUnitRatio } from './unit-ratio.ts'
import { invalid } from './functions/shared.ts'

/** Requote only explicit automatic prices; historical and legacy prices remain caller-owned. */
export async function automaticLinePrice(ctx: Ctx, order: Row, line: Row, quantity: unknown): Promise<Row> {
  const found = await sellableProduct(ctx, line.productId, line.productUomId)
  if (!found.ok) return invalid('productId', found.message)
  if (order.pricelistId) {
    const quote = (await linePriceFunctions.priceForLine.handler(ctx, {
      pricelistId: order.pricelistId,
      productId: line.productId,
      uomId: line.productUomId,
      quantity,
      date: order.dateOrder,
    })) as Row
    if (quote.ok !== true) return quote
    if (quote.currency !== order.currency) return invalid('priceUnit', 'sale.error.quoteFailed')
    return { ok: true, priceUnit: quote.priceUnit ?? quote.price, discount: quote.discount ?? '0' }
  }
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (String(company?.currency ?? 'VND') !== order.currency)
    return invalid('priceUnit', 'sale.error.quoteFailed')
  const ratio = await saleUnitRatio(ctx, line.productUomId, found.value.template.uomId)
  if (ratio == null) return invalid('productUomId', 'sale.error.quoteFailed')
  return {
    ok: true,
    priceUnit: multiplyDecimals(
      found.value.listPrice,
      ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }),
    ),
  }
}
