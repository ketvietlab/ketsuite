import type { Ctx, Row } from '@ketvietlab/ketjs'
import { unitRatio } from '../uom/unit-ratio.ts'

export const PACKAGING_EFFECTS = ['read:product.TemplateUom', 'read:product.ProductUom', 'read:uom.Unit']

/** Packaging belongs to the selected template, plus this company's variant links. */
export async function pricingPackaging(ctx: Ctx, args: Row) {
  const product =
    args.appliedOn === '0_product_variant'
      ? (await ctx.db.select('product.Product', { id: args.productId }))[0]
      : undefined
  const template =
    args.appliedOn === '1_product' || product
      ? (await ctx.db.select('product.Template', { id: product?.templateId ?? args.templateId }))[0]
      : undefined
  if (!template) return { template, units: [] as Row[] }
  const ids = new Set(
    (await ctx.db.select('product.TemplateUom', { templateId: template.id })).map((link) =>
      String(link.uomId),
    ),
  )
  if (product)
    for (const link of await ctx.db.select('product.ProductUom', { productId: product.id }))
      if (String(link.companyId) === ctx.scope.company) ids.add(String(link.uomId))
  ids.delete(String(template.uomId))
  const units: Row[] = []
  for (const id of ids) {
    const unit = (await ctx.db.select('uom.Unit', { id }))[0]
    if (
      unit &&
      unit.active !== false &&
      unit.active !== 0 &&
      (await unitRatio(ctx, id, template.uomId)) !== null
    )
      units.push(unit)
  }
  return { template, units }
}
