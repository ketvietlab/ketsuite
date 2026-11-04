import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { VARIANT_PRICE_EFFECTS } from '../../product/variant-price.ts'
import { convertQty, type Unit } from '../../uom/convert.ts'
import { priceFor } from '../base-price.ts'
import { invalid } from '../validation.ts'

export async function priceForHandler(ctx: Ctx, args: Row) {
  const pricelist = (await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0]
  if (!pricelist) return invalid('pricelistId', 'bảng giá không tồn tại')
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
  if (!product) return invalid('productId', 'biến thể không tồn tại')
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]!
  let quantity = Number(args.quantity)
  if (args.uomId) {
    if (!template.uomId) return invalid('uomId', 'template chưa có UoM mặc định')
    const from = (await ctx.db.select('uom.Unit', { id: args.uomId }))[0]
    const to = (await ctx.db.select('uom.Unit', { id: template.uomId }))[0]
    if (!from || !to) return invalid('uomId', 'đơn vị không tồn tại')
    try {
      quantity = convertQty(quantity, from as unknown as Unit, to as unknown as Unit)
    } catch (error) {
      return invalid('uomId', (error as Error).message)
    }
  }
  try {
    const result = await priceFor(
      ctx,
      String(args.pricelistId),
      product,
      template,
      quantity,
      String(args.date ?? new Date().toISOString()),
      new Set(),
    )
    return { ok: true, price: String(result.price), currency: pricelist.currency, ruleId: result.ruleId }
  } catch (error) {
    return { ok: false, errors: [{ field: 'pricelistId', message: (error as Error).message }] }
  }
}

export const priceForFunctions = {
  priceFor: defineFn({
    input: { pricelistId: 'id', productId: 'id', quantity: 'decimal', uomId: 'id?', date: 'datetime?' },
    output: { ok: 'bool', price: 'decimal?', currency: 'text?', ruleId: 'id?', errors: 'json?' },
    effects: [
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:product.Product',
      'read:product.Template',
      'read:product.Category',
      'read:product.Cost',
      ...VARIANT_PRICE_EFFECTS,
      'read:uom.Unit',
    ],
    agent: true,
    handler: priceForHandler,
  }),
}
