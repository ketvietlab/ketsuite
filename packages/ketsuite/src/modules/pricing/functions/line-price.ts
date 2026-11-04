import { quantityBreaks } from '../rule-selection.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../../account/money.ts'
import { sellableProduct } from '../../product/sellable.ts'
import { VARIANT_PRICE_EFFECTS } from '../../product/variant-price.ts'
import { unitRatio } from '../../uom/unit-ratio.ts'
import { linePrice } from '../line-price.ts'
import { PACKAGING_EFFECTS } from '../packaging.ts'
import { invalid } from '../validation.ts'

export async function priceForLineHandler(ctx: Ctx, args: Row) {
  const pricelist = (await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0]
  if (!pricelist) return invalid('pricelistId', 'pricelist does not exist')
  if (compareDecimals(args.quantity, '0') < 0) return invalid('quantity', 'quantity cannot be negative')
  const resolved = await sellableProduct(ctx, args.productId, args.uomId, { allowCombo: true })
  if (!resolved.ok) return invalid(resolved.field, resolved.message)
  const { product, template } = resolved.value
  const uomId = String(args.uomId ?? template.uomId)
  const ratio = await unitRatio(ctx, uomId, template.uomId)
  if (ratio === null) return invalid('uomId', 'unit cannot be converted')
  try {
    const result = await linePrice(
      ctx,
      String(args.pricelistId),
      product,
      template,
      String(args.quantity),
      String(args.date ?? new Date().toISOString()),
      uomId,
      ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }),
    )
    const priceBreaks: Row[] = []
    if (args.includeBreaks) {
      const points = await quantityBreaks(
        ctx,
        String(args.pricelistId),
        product,
        template,
        String(args.date ?? new Date().toISOString()),
        uomId,
      )
      for (const quantity of points)
        priceBreaks.push({
          quantity,
          ...(await linePrice(
            ctx,
            String(args.pricelistId),
            product,
            template,
            quantity,
            String(args.date ?? new Date().toISOString()),
            uomId,
            ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }),
          )),
        })
    }
    return {
      ok: true,
      ...result,
      currency: pricelist.currency,
      uomId,
      ...(args.includeBreaks ? { priceBreaks } : {}),
    }
  } catch (error) {
    return invalid('pricelistId', (error as Error).message)
  }
}

export const linePriceFunctions = {
  priceForLine: defineFn({
    input: {
      pricelistId: 'id',
      productId: 'id',
      quantity: 'decimal',
      uomId: 'id?',
      date: 'datetime?',
      includeBreaks: 'bool?',
    },
    output: {
      ok: 'bool',
      price: 'decimal?',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      currency: 'text?',
      ruleId: 'id?',
      uomId: 'id?',
      errors: 'json?',
      priceBreaks: 'json?',
    },
    effects: [
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:product.Product',
      'read:product.Template',
      'read:product.Category',
      'read:product.Cost',
      ...VARIANT_PRICE_EFFECTS,
      ...PACKAGING_EFFECTS,
    ],
    agent: true,
    handler: priceForLineHandler,
  }),
}
