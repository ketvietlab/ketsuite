import type { Ctx, Row } from '@ketvietlab/ketjs'
import { addDecimals } from '../account/money.ts'

/** Effects a reader of `variantSalePrice` declares. */
export const VARIANT_PRICE_EFFECTS = [
  'read:product.ProductValue',
  'read:product.TemplateAttributeValue',
  'read:product.TemplateAttributeLine',
]

/**
 * What one variant sells for before any pricelist (P3/P28): its own price when set,
 * otherwise the template price plus the extras of the values that make the variant.
 */
export async function variantSalePrice(ctx: Ctx, product: Row, template: Row): Promise<string> {
  if (product.listPriceOverride != null && String(product.listPriceOverride).trim() !== '')
    return String(product.listPriceOverride)
  const extras = await variantPriceExtras(ctx, product, template)
  return extras === '0'
    ? String(template.listPrice ?? '0')
    : addDecimals(String(template.listPrice ?? '0'), extras)
}

/** The extras of the values that make one variant; a template-wide fixed price adds them too (P30). */
export async function variantPriceExtras(ctx: Ctx, product: Row, template: Row): Promise<string> {
  let extras = '0'
  const links = await ctx.db.select('product.ProductValue', { productId: product.id })
  const valueIds = new Set(links.map((link) => String(link.templateAttributeValueId)))
  // A variant written before value links existed is still known by its combination.
  const combination = /^(manual|archived|pending):/.test(String(product.combinationKey ?? ''))
    ? []
    : String(product.combinationKey ?? '')
        .split(',')
        .filter(Boolean)
  if (!valueIds.size && !combination.length) return extras
  const wanted = new Set(combination)
  for (const line of await ctx.db.select('product.TemplateAttributeLine', { templateId: template.id }))
    for (const value of await ctx.db.select('product.TemplateAttributeValue', { lineId: line.id })) {
      const linked = valueIds.size ? valueIds.has(String(value.id)) : wanted.has(String(value.valueId))
      if (linked && value.priceExtra != null) extras = addDecimals(extras, value.priceExtra)
    }
  return extras
}
