import { writePricelistItems, recordWriteEffects, PricingRecordRefused } from '../record-writer.ts'
import { dependencyEffects, lockPricing, validateActive } from '../dependency-policy.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { invalid } from '../validation.ts'
import { categoryFailure, lockCategories, requireActiveCategory } from '../../product/category-policy.ts'

export async function savePricelistHandler(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx(async (ctx) => {
      await lockCategories(ctx)
      await lockPricing(ctx)
      if (!ctx.scope.company) return invalid('company', 'cần chọn company')
      const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
      if (!company) return invalid('company', 'company không tồn tại')
      const currency = String(args.currency ?? company.currency)
      if (currency !== company.currency)
        return invalid('currency', `phải dùng currency ${String(company.currency)} của company`)
      const existing = (await ctx.db.select('pricing.Pricelist', { id: args.id }))[0]
      if (args.items !== undefined) await writePricelistItems(ctx, args, existing)
      const values = { ...args, currency, sequence: args.sequence ?? 16, active: args.active ?? true }
      const dependency = await validateActive(ctx, args.id, values.active as boolean)
      if (dependency) throw new PricingRecordRefused(dependency)
      if (values.active) {
        for (const item of await ctx.db.select('pricing.PricelistItem', { pricelistId: args.id }))
          if (item.appliedOn === '2_product_category') await requireActiveCategory(ctx, item.categoryId)
      }
      const cs = ctx
        .change('pricing.Pricelist', values, existing ?? null)
        .cast(['id', 'name', 'currency', 'sequence', 'active'])
        .required(['name', 'currency'])
      if (!cs.valid) throw new PricingRecordRefused({ ok: false, errors: cs.errors })
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    })
  } catch (error) {
    if (error instanceof PricingRecordRefused) return error.result
    const refused = categoryFailure(error)
    if (refused) return refused
    throw error
  }
}

export const savePricelistFunctions = {
  savePricelist: defineFn({
    input: {
      id: 'id',
      name: 'text',
      currency: 'text?',
      sequence: 'int?',
      active: 'bool?',
      items: 'json?',
      expectedRevision: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...recordWriteEffects,
      ...dependencyEffects,
      'read:pricing.Pricelist',
      'write:pricing.Pricelist',
      'read:company.Company',
      'read:pricing.PricelistItem',
      'read:product.Category',
      'write:product.Category',
    ],
    idempotent: true,
    agent: true,
    handler: savePricelistHandler,
  }),
}
