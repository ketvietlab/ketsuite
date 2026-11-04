import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals, multiplyDecimals } from '../../account/money.ts'
import { sellableProduct } from '../../product/sellable.ts'
import { linePriceFunctions } from '../../pricing/functions/line-price.ts'
import { saleUnitRatio } from '../unit-ratio.ts'
import { ours } from '../scope.ts'
import { listLineUnitsHandler, lineUnitsFunctions } from './line-units.ts'

/** Protected picker data. Cost never rides the public product or order reader. */
async function lineUnitPrices(ctx: Ctx, args: Row, includeCost: boolean) {
  const order = (await ours(ctx, 'sale.Order', { id: args.orderId }))[0]
  if (!order) return []
  let quantity: string
  try {
    quantity =
      typeof args.quantity === 'number' && Number.isFinite(args.quantity)
        ? args.quantity.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 })
        : String(args.quantity)
    if (compareDecimals(quantity, '0') < 0) return []
  } catch {
    return []
  }
  const found = await sellableProduct(ctx, args.productId, undefined, { allowCombo: true })
  if (!found.ok) return []
  const { product, template, listPrice } = found.value
  if (
    (product.companyId && product.companyId !== ctx.scope.company) ||
    (template.companyId && template.companyId !== ctx.scope.company)
  )
    return []
  const cost = includeCost ? (await ours(ctx, 'product.Cost', { productId: args.productId }))[0] : undefined
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  const currency = String(company?.currency ?? 'VND')
  const units = await listLineUnitsHandler(ctx, args)
  const result: Row[] = []
  for (const unit of units) {
    const factor = await saleUnitRatio(ctx, unit.id, template.uomId)
    if (factor === null) continue
    const ratio = factor.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 })
    let discount = '0'
    let priceUnit = multiplyDecimals(listPrice, ratio)
    let priceSteps: Row[] = [{ from: 0, row: { priceUnit, discount: 0 } }]
    if (order.pricelistId) {
      const quote = (await linePriceFunctions.priceForLine.handler(ctx, {
        pricelistId: order.pricelistId,
        productId: product.id,
        uomId: unit.id,
        quantity,
        date: order.dateOrder,
        includeBreaks: true,
      })) as Row
      if (quote.ok !== true || quote.currency !== order.currency) continue
      priceUnit = String(quote.priceUnit ?? quote.price)
      discount = String(quote.discount ?? '0')
      priceSteps = (quote.priceBreaks as Row[]).map((step) => ({
        from: Number(step.quantity),
        row: { priceUnit: step.priceUnit, discount: Number(step.discount) },
      }))
    }
    const marginLocked =
      template.type === 'combo' || cost?.standardPrice == null || currency !== order.currency
    result.push({
      ...unit,
      priceUnit,
      discount,
      currency,
      priceSteps,
      ...(includeCost
        ? { marginLocked, unitCost: marginLocked ? null : multiplyDecimals(cost!.standardPrice, ratio) }
        : {}),
    })
  }
  return result
}

export async function listLinePricing(ctx: Ctx, args: Row) {
  return lineUnitPrices(ctx, args, true)
}
export async function listLinePricesHandler(ctx: Ctx, args: Row) {
  return lineUnitPrices(ctx, args, false)
}

export const listLinePricingHandler = (ctx: Ctx, args: Row) => listLinePricing(ctx, args)

export const linePricingFunctions = {
  listLinePrices: defineFn({
    input: { orderId: 'id', productId: 'id', quantity: 'decimal', search: 'text?', limit: 'int?' },
    effects: [
      ...lineUnitsFunctions.listLineUnits.effects!,
      ...linePriceFunctions.priceForLine.effects!,
      'read:sale.Order',
      'read:company.Company',
    ],
    agent: true,
    handler: listLinePricesHandler,
  }),
  listLinePricing: defineFn({
    input: { orderId: 'id', productId: 'id', quantity: 'decimal', search: 'text?', limit: 'int?' },
    effects: [
      ...lineUnitsFunctions.listLineUnits.effects!,
      ...linePriceFunctions.priceForLine.effects!,
      'read:sale.Order',
      'read:product.Cost',
      'read:company.Company',
    ],
    agent: true,
    handler: listLinePricingHandler,
  }),
}
