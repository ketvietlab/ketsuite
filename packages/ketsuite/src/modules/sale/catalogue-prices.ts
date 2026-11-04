import type { Ctx, Row } from '@ketvietlab/ketjs'
import { multiplyDecimals, subtractDecimals } from '../account/money.ts'
import { linePriceFunctions } from '../pricing/functions/line-price.ts'
import { sellableProduct } from '../product/sellable.ts'
import { ours } from './scope.ts'

export type CatalogueVariant = Row & { template: Row; values: Row[] }
export async function cataloguePrices(ctx: Ctx, order: Row, variants: CatalogueVariant[]) {
  const lines = (await ours(ctx, 'sale.OrderLine', { orderId: order.id }))
    .filter(
      (line) =>
        !line.displayType && !line.comboParentId && line.comboBasePrice == null && line.lineKind !== 'reward',
    )
    .sort((a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)))
  const units = new Map((await ctx.db.select('uom.Unit')).map((unit) => [String(unit.id), String(unit.name)]))
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  const rows: Row[] = []
  for (const variant of variants) {
    const line = lines.find((line) => line.productId === variant.id)
    let price: string | null = null
    const unitId = String(line?.productUomId ?? variant.template.uomId)
    if (line)
      price = multiplyDecimals(
        line.priceUnit,
        subtractDecimals('1', multiplyDecimals(line.discount ?? '0', '0.01')),
      )
    else if (order.pricelistId) {
      const quote = (await linePriceFunctions.priceForLine.handler(ctx, {
        pricelistId: order.pricelistId,
        productId: variant.id,
        uomId: unitId,
        quantity: '1',
        date: order.dateOrder,
      })) as Row
      if (quote.ok === true && quote.currency === order.currency) price = String(quote.price)
    } else {
      const product = await sellableProduct(ctx, variant.id, unitId)
      if (product.ok && company?.currency === order.currency) price = product.value.listPrice
    }
    rows.push({
      id: variant.id,
      templateId: variant.templateId,
      name: variant.displayName,
      code: variant.defaultCode ?? null,
      unitId,
      unit: units.get(unitId) ?? '',
      price,
      currency: order.currency,
      quantity: line?.productUomQty ?? '0',
      lineId: line?.id ?? null,
    })
  }
  return rows
}
