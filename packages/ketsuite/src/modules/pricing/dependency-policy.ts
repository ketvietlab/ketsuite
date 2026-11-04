import type { Ctx, Row } from '@ketvietlab/ketjs'
export const dependencyEffects = ['read:pricing.Namespace', 'write:pricing.Namespace']
export const pricingRefusal = (field: string, key: string) => ({
  ok: false,
  errors: [{ field, messageKey: 'pricing.error.' + key }],
})
/** Caller owns the transaction. Every graph or active-state writer takes this company lock. */
export async function lockPricing(ctx: Ctx) {
  const id = String(ctx.scope.company) + ':pricing'
  await ctx.db.insertIfAbsent('pricing.Namespace', { id, revision: 0 })
  const held = await ctx.db.compareAndSet('pricing.Namespace', { id }, { revision: 0 }, { revision: 0 })
  if (!('dryRun' in held) && !held.matched) throw new Error('pricing namespace changed')
}
const references = (row: Row) =>
  row.computePrice !== 'fixed' && row.base === 'pricelist' && row.basePricelistId
export async function validateDependency(ctx: Ctx, candidate: Row) {
  if (!references(candidate)) return null
  const lists = await ctx.db.select('pricing.Pricelist')
  const current = lists.find((row) => row.id === candidate.pricelistId)
  const base = lists.find((row) => row.id === candidate.basePricelistId)
  if (!base || base.active === false || base.currency !== current?.currency)
    return pricingRefusal('basePricelistId', 'baseActive')
  const rows = (await ctx.db.select('pricing.PricelistItem')).filter((row) => row.id !== candidate.id)
  rows.push(candidate)
  const visited = new Set<string>()
  const reaches = (id: string): boolean => {
    if (id === String(candidate.pricelistId)) return true
    if (visited.has(id)) return false
    visited.add(id)
    return rows.some(
      (row) => String(row.pricelistId) === id && references(row) && reaches(String(row.basePricelistId)),
    )
  }
  return reaches(String(candidate.basePricelistId)) ? pricingRefusal('basePricelistId', 'cycle') : null
}
export async function validateActive(ctx: Ctx, id: unknown, active: boolean) {
  const rows = await ctx.db.select('pricing.PricelistItem')
  if (active) {
    for (const row of rows.filter((row) => row.pricelistId === id)) {
      const failure = await validateDependency(ctx, row)
      if (failure) return failure
    }
  } else {
    const lists = await ctx.db.select('pricing.Pricelist')
    if (
      rows.some(
        (row) =>
          references(row) &&
          row.basePricelistId === id &&
          lists.some((list) => list.id === row.pricelistId && list.id !== id && list.active !== false),
      )
    )
      return pricingRefusal('active', 'referenced')
  }
  return null
}
