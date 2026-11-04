import { deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { invalid } from './validation.ts'

export async function saveProductTax(ctx: Ctx, args: Row) {
  if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
    return invalid('templateId', 'productMissing')
  const held = (await ctx.db.select('account.ProductTax', { templateId: args.templateId }))[0]
  if (!args.taxId) {
    if (held) {
      const ProductTax = ctx.table('account.ProductTax')
      await ctx.db.del(deleteFrom(ProductTax).where(eq(ProductTax.id, held.id)))
    }
    return { ok: true }
  }
  const tax = (await ctx.db.select('account.Tax', { id: args.taxId }))[0]
  if (!tax) return invalid('taxId', 'taxMissing')
  if (!['sale', 'none'].includes(String(tax.typeTaxUse)))
    return invalid('taxId', 'taxDirectionMismatch', { name: tax.name })
  if (held) {
    await ctx.db.update('account.ProductTax', { id: held.id }, { taxId: args.taxId })
    return { ok: true, id: held.id }
  }
  const id = `product-tax:${String(ctx.scope.company ?? '')}:${String(args.templateId)}`
  await ctx.db.insert('account.ProductTax', {
    id,
    templateId: args.templateId,
    taxId: args.taxId,
  })
  return { ok: true, id }
}
