import type { Ctx, Row } from '@ketvietlab/ketjs'

/** Whether the deployment keeps this catalogue model per company (Commerce) rather than shared. */
export function companyScoped(ctx: Ctx, model: string) {
  const scope = ctx.manifest.models[model]?.scope
  return scope === 'company' || scope === 'company+branch'
}
/** Imports resolve names and costs only in the active company, even for multi-company readers. */
export function importCatalogue(ctx: Ctx, model: string, where: Row = {}) {
  return ctx.db.select(model, {
    ...where,
    ...(companyScoped(ctx, model) ? { companyId: ctx.scope.company } : {}),
  })
}
export const importCategoryPath = (row: Row, categories: Row[], seen = new Set<unknown>()): string => {
  if (seen.has(row.id)) return ''
  seen.add(row.id)
  const parent = categories.find((item) => item.id === row.parentId)
  return parent ? importCategoryPath(parent, categories, seen) + ' / ' + String(row.name) : String(row.name)
}
