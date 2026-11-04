import type { Ctx, Row } from '@ketvietlab/ketjs'

/** Optional extension: retain commercial preferences, never signature/payment results. */
export async function copyQuotationPreferences(ctx: Ctx, source: Row, id: unknown) {
  const keys = ['templateSignature', 'templatePayment', 'templatePrepaymentPercent']
  const values = Object.fromEntries(
    keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]),
  )
  if (Object.keys(values).length) await ctx.db.update('sale.Order', { id }, values)
}
