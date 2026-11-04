import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../account/money.ts'
import { at } from './validation.ts'

async function categoryAncestors(ctx: Ctx, id: unknown): Promise<Set<string>> {
  const result = new Set<string>()
  let cursor = id == null ? null : String(id)
  while (cursor && !result.has(cursor)) {
    result.add(cursor)
    const row = (await ctx.db.select('product.Category', { id: cursor }))[0]
    cursor = row?.parentId == null ? null : String(row.parentId)
  }
  return result
}

const applies = (
  item: Row,
  product: Row,
  template: Row,
  categories: Set<string>,
  qty: string | number,
  date: string,
  uomId?: string,
) => {
  const when = at(date) ?? 0
  const start = at(item.dateStart)
  const end = at(item.dateEnd)
  if (item.uomId && item.uomId !== uomId) return false
  if (typeof qty === 'number' ? Number(item.minQuantity) > qty : compareDecimals(item.minQuantity, qty) > 0)
    return false
  if (start !== null && start > when) return false
  if (end !== null && end < when) return false
  if (item.appliedOn === '0_product_variant') return item.productId === product.id
  if (item.appliedOn === '1_product') return item.templateId === template.id
  if (item.appliedOn === '2_product_category') return categories.has(String(item.categoryId))
  return item.appliedOn === '3_global'
}

export async function matchingRules(
  ctx: Ctx,
  pricelistId: string,
  product: Row,
  template: Row,
  qty: string | number,
  date: string,
  uomId?: string,
) {
  const categories = await categoryAncestors(ctx, template.categoryId)
  const categoryRank = new Map([...categories].map((categoryId, index) => [categoryId, index]))
  return (await ctx.db.select('pricing.PricelistItem', { pricelistId }))
    .filter((item) => applies(item, product, template, categories, qty, date, uomId))
    .sort((a, b) => {
      const specific = String(a.appliedOn).localeCompare(String(b.appliedOn))
      if (specific) return specific
      // A matching descendant category is more specific than any ancestor quantity tier.
      if (a.appliedOn === '2_product_category') {
        const category =
          Number(categoryRank.get(String(a.categoryId)) ?? Number.MAX_SAFE_INTEGER) -
          Number(categoryRank.get(String(b.categoryId)) ?? Number.MAX_SAFE_INTEGER)
        if (category) return category
      }
      const packaging = Number(Boolean(b.uomId)) - Number(Boolean(a.uomId))
      if (packaging) return packaging
      const quantity =
        typeof qty === 'number'
          ? Number(b.minQuantity) - Number(a.minQuantity)
          : compareDecimals(b.minQuantity, a.minQuantity)
      if (quantity) return quantity
      return (
        Number(b.creationOrder ?? 0) - Number(a.creationOrder ?? 0) ||
        String(b.id).localeCompare(String(a.id))
      )
    })
}

/** Quantity boundaries include eligible base lists, with cycle-safe traversal. */
export async function quantityBreaks(
  ctx: Ctx,
  pricelistId: string,
  product: Row,
  template: Row,
  date: string,
  uomId?: string,
  seen = new Set<string>(),
): Promise<string[]> {
  if (seen.has(pricelistId) || seen.size >= 32) return []
  const visited = new Set(seen).add(pricelistId),
    categories = await categoryAncestors(ctx, template.categoryId)
  const points = new Set<string>(['0'])
  for (const row of await ctx.db.select('pricing.PricelistItem', { pricelistId })) {
    if (!applies(row, product, template, categories, String(row.minQuantity), date, uomId)) continue
    points.add(String(row.minQuantity))
    if (row.computePrice !== 'fixed' && row.base === 'pricelist' && row.basePricelistId)
      for (const value of await quantityBreaks(
        ctx,
        String(row.basePricelistId),
        product,
        template,
        date,
        uomId,
        visited,
      ))
        points.add(value)
  }
  return [...points].sort((a, b) => compareDecimals(a, b))
}
