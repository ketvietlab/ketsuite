import type { Ctx, Row } from '@ketvietlab/ketjs'
import {
  addDecimals,
  compareDecimals,
  exactDecimal,
  multiplyDecimals,
  roundedQuotient,
  subtractDecimals,
} from '../account/money.ts'
import { variantPriceExtras, variantSalePrice } from '../product/variant-price.ts'
import { matchingRules } from './rule-selection.ts'

const roundPrice = (amount: string, step: unknown): string => {
  const a = exactDecimal(amount)
  const b = exactDecimal(step)
  return multiplyDecimals(
    String(roundedQuotient(a.coefficient * 10n ** BigInt(b.scale), b.coefficient * 10n ** BigInt(a.scale))),
    step,
  )
}

/** The price of one sales-line unit; quantity thresholds stay in that same unit. */
export async function linePrice(
  ctx: Ctx,
  pricelistId: string,
  product: Row,
  template: Row,
  quantity: string,
  date: string,
  uomId: string | undefined,
  ratio: string,
  seen = new Set<string>(),
): Promise<{ price: string; priceUnit: string; discount: string; ruleId: string | null }> {
  const listed = async () => {
    const price = multiplyDecimals(await variantSalePrice(ctx, product, template), ratio)
    return { price, priceUnit: price, discount: '0', ruleId: null }
  }
  if (seen.size >= 32 || seen.has(pricelistId)) return listed()
  const nextSeen = new Set(seen).add(pricelistId)
  const rule = (await matchingRules(ctx, pricelistId, product, template, quantity, date, uomId))[0]
  if (!rule) return listed()
  // A package's fixed amount is already per package. Template extras remain per base unit.
  if (rule.computePrice === 'fixed') {
    const extra = rule.appliedOn === '1_product' ? await variantPriceExtras(ctx, product, template) : '0'
    const price = addDecimals(
      multiplyDecimals(rule.fixedPrice, rule.uomId ? '1' : ratio),
      multiplyDecimals(extra, ratio),
    )
    return { price, priceUnit: price, discount: '0', ruleId: String(rule.id) }
  }
  let base: string
  if (rule.base === 'standard_price') {
    const cost = (await ctx.db.select('product.Cost', { productId: product.id }))[0]
    base = multiplyDecimals(cost?.standardPrice ?? '0', ratio)
  } else if (rule.base === 'pricelist') {
    const nested = (await ctx.db.select('pricing.Pricelist', { id: rule.basePricelistId }))[0]
    const current = (await ctx.db.select('pricing.Pricelist', { id: pricelistId }))[0]
    if (!nested || nested.currency !== current?.currency)
      throw new Error('base pricelist must use company currency')
    base = (
      await linePrice(
        ctx,
        String(rule.basePricelistId),
        product,
        template,
        quantity,
        date,
        uomId,
        ratio,
        nextSeen,
      )
    ).price
  } else base = multiplyDecimals(await variantSalePrice(ctx, product, template), ratio)
  let price = subtractDecimals(
    base,
    multiplyDecimals(
      base,
      rule.computePrice === 'percentage' ? rule.percentPrice : rule.priceDiscount,
      '0.01',
    ),
  )
  if (rule.computePrice === 'formula') {
    // Surcharge and margins are amounts per rule unit: a package rule's are per package, a base-unit
    // rule's scale to the line's unit. The rounding step stays as entered.
    const perLine = (amount: unknown) => multiplyDecimals(amount ?? '0', rule.uomId ? '1' : ratio)
    if (compareDecimals(rule.priceRound, '0') > 0) price = roundPrice(price, rule.priceRound)
    price = addDecimals(price, perLine(rule.priceSurcharge))
    const minimum = addDecimals(base, perLine(rule.priceMinMargin))
    const maximum = addDecimals(base, perLine(rule.priceMaxMargin))
    if (compareDecimals(rule.priceMinMargin, '0') !== 0 && compareDecimals(price, minimum) < 0)
      price = minimum
    if (compareDecimals(rule.priceMaxMargin, '0') !== 0 && compareDecimals(price, maximum) > 0)
      price = maximum
  }
  if (compareDecimals(price, '0') < 0) price = '0'
  return {
    price,
    priceUnit: rule.computePrice === 'percentage' ? base : price,
    discount: rule.computePrice === 'percentage' ? String(rule.percentPrice) : '0',
    ruleId: String(rule.id),
  }
}
