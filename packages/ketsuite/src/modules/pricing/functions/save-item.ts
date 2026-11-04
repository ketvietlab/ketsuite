import { dependencyEffects, lockPricing, validateDependency, pricingRefusal } from '../dependency-policy.ts'
import { compareDecimals, exactDecimal } from '../../account/money.ts'
import { PACKAGING_EFFECTS, pricingPackaging } from '../packaging.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { APPLIED_ON, COMPUTE_PRICE, PRICE_BASES, at } from '../validation.ts'
import { categoryFailure, requireActiveCategory } from '../../product/category-policy.ts'

export async function savePricelistItem(ctx: Ctx, args: Row) {
  if (args.appliedOn === '2_product_category') await requireActiveCategory(ctx, args.categoryId)
  await lockPricing(ctx)
  if (!APPLIED_ON.includes(args.appliedOn as never)) return pricingRefusal('appliedOn', 'choice')
  if (!COMPUTE_PRICE.includes(args.computePrice as never)) return pricingRefusal('computePrice', 'choice')
  const base = args.computePrice === 'fixed' ? 'list_price' : (args.base ?? 'list_price')
  args = { ...args, base, basePricelistId: base === 'pricelist' ? args.basePricelistId : null }
  if (args.computePrice === 'percentage' && base === 'standard_price')
    return pricingRefusal('base', 'costFormula')
  const discount =
    args.computePrice === 'percentage' ? (args.percentPrice ?? '0') : (args.priceDiscount ?? '0')
  if (
    args.computePrice !== 'fixed' &&
    (compareDecimals(discount, args.computePrice === 'formula' ? '-1000' : '0') < 0 ||
      compareDecimals(discount, '100') > 0)
  )
    return pricingRefusal(args.computePrice === 'formula' ? 'priceDiscount' : 'percentPrice', 'discountRange')
  const surcharge = exactDecimal(args.priceSurcharge ?? '0')
  if (surcharge.coefficient % 10n ** BigInt(surcharge.scale) !== 0n)
    return pricingRefusal('priceSurcharge', 'integerSurcharge')
  if (!PRICE_BASES.includes(base as never)) return pricingRefusal('base', 'choice')
  if (!(await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0])
    return pricingRefusal('pricelistId', 'missing')
  const start = at(args.dateStart)
  const end = at(args.dateEnd)
  if (start !== null && end !== null && start >= end) return pricingRefusal('dateEnd', 'dateRange')
  if (Number(args.minQuantity ?? 0) < 0) return pricingRefusal('minQuantity', 'nonnegative')
  if (Number(args.priceRound ?? 0) < 0) return pricingRefusal('priceRound', 'nonnegative')
  if (base === 'pricelist' && !args.basePricelistId) return pricingRefusal('basePricelistId', 'baseRequired')
  const dependency = await validateDependency(ctx, args)
  if (dependency) return dependency
  const target =
    args.appliedOn === '0_product_variant'
      ? args.productId
      : args.appliedOn === '1_product'
        ? args.templateId
        : args.appliedOn === '2_product_category'
          ? args.categoryId
          : true
  if (!target) return pricingRefusal('appliedOn', 'targetRequired')
  if (
    args.appliedOn === '0_product_variant' &&
    !(await ctx.db.select('product.Product', { id: args.productId }))[0]
  )
    return pricingRefusal('productId', 'missing')
  if (
    args.appliedOn === '1_product' &&
    !(await ctx.db.select('product.Template', { id: args.templateId }))[0]
  )
    return pricingRefusal('templateId', 'missing')
  if (
    args.appliedOn === '2_product_category' &&
    !(await ctx.db.select('product.Category', { id: args.categoryId }))[0]
  )
    return pricingRefusal('categoryId', 'missing')
  let uomId = args.uomId || null
  if (uomId) {
    if (!['0_product_variant', '1_product'].includes(String(args.appliedOn)))
      return pricingRefusal('uomId', 'packagingScope')
    const packaging = await pricingPackaging(ctx, args)
    if (uomId === packaging.template?.uomId) uomId = null
    else if (!packaging.units.some((unit) => unit.id === uomId))
      return pricingRefusal('uomId', 'packagingAvailable')
  }
  const existing = (await ctx.db.select('pricing.PricelistItem', { id: args.id }))[0]
  const creationOrder = existing
    ? (existing.creationOrder ?? null)
    : 1 +
      Math.max(
        0,
        ...(await ctx.db.select('pricing.PricelistItem')).map((row) => Number(row.creationOrder ?? 0)),
      )
  const values = {
    ...args,
    creationOrder,
    uomId,
    base,
    minQuantity: args.minQuantity ?? '0',
    fixedPrice: args.fixedPrice ?? '0',
    percentPrice: args.percentPrice ?? '0',
    priceDiscount: args.priceDiscount ?? '0',
    priceRound: args.priceRound ?? '0',
    priceSurcharge: args.priceSurcharge ?? '0',
    priceMinMargin: args.priceMinMargin ?? '0',
    priceMaxMargin: args.priceMaxMargin ?? '0',
  }
  const cs = ctx
    .change('pricing.PricelistItem', values, existing ?? null)
    .cast([
      'id',
      'pricelistId',
      'creationOrder',
      'dateStart',
      'dateEnd',
      'minQuantity',
      'appliedOn',
      'categoryId',
      'templateId',
      'productId',
      'uomId',
      'base',
      'basePricelistId',
      'computePrice',
      'fixedPrice',
      'percentPrice',
      'priceDiscount',
      'priceRound',
      'priceSurcharge',
      'priceMinMargin',
      'priceMaxMargin',
    ])
    .required(['pricelistId', 'appliedOn', 'base', 'computePrice'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  return { ok: true, id: args.id }
}

export async function savePricelistItemHandler(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx((tx) => savePricelistItem(tx, args))
  } catch (error) {
    const refused = categoryFailure(error)
    if (refused) return refused
    throw error
  }
}

export const savePricelistItemFunctions = {
  savePricelistItem: defineFn({
    input: {
      id: 'id',
      pricelistId: 'id',
      dateStart: 'datetime?',
      dateEnd: 'datetime?',
      minQuantity: 'decimal?',
      appliedOn: 'text',
      categoryId: 'id?',
      templateId: 'id?',
      productId: 'id?',
      uomId: 'id?',
      base: 'text?',
      basePricelistId: 'id?',
      computePrice: 'text',
      fixedPrice: 'decimal?',
      percentPrice: 'decimal?',
      priceDiscount: 'decimal?',
      priceRound: 'decimal?',
      priceSurcharge: 'decimal?',
      priceMinMargin: 'decimal?',
      priceMaxMargin: 'decimal?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...PACKAGING_EFFECTS,
      ...dependencyEffects,
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'write:pricing.PricelistItem',
      'read:product.Category',
      'write:product.Category',
      'read:product.Template',
      'read:product.Product',
    ],
    idempotent: true,
    agent: true,
    handler: savePricelistItemHandler,
  }),
}
