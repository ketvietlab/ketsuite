import { eq, from, inArray, type Ctx, type Row } from '@ketvietlab/ketjs'
import { company, companyKey, ours } from './scope.ts'
import { lockSalesConfiguration, salesConfiguration } from './configuration.ts'
import { invalid } from './functions/shared.ts'

export const warningReadEffects = [
  'read:sale.Configuration',
  'read:sale.PartnerWarning',
  'read:partner.Partner',
  'read:product.Product',
  'read:product.Template',
] as const
export async function partnerSalesWarning(ctx: Ctx, partnerId: unknown) {
  if (!partnerId) return null
  const partner = (await ctx.db.select('partner.Partner', { id: partnerId }))[0]
  if (!partner) return null
  const enabled = (await salesConfiguration(ctx)).saleWarnings === true
  const row = enabled ? (await ours(ctx, 'sale.PartnerWarning', { partnerId }))[0] : null
  return {
    partnerId,
    name: partner.name,
    enabled,
    message: row?.message ?? '',
    revision: Number(row?.revision ?? 0),
  }
}
export async function savePartnerSalesWarning(ctx: Ctx, args: Row) {
  const message = String(args.message ?? '').trim()
  if (message.length > 300) return invalid('message', 'sale.error.warningLength')
  return ctx.tx(async (tx) => {
    const configuration = await lockSalesConfiguration(tx)
    if (!configuration?.saleWarnings) return invalid('message', 'sale.error.warningsDisabled')
    if (!(await tx.db.select('partner.Partner', { id: args.partnerId })).length)
      return invalid('partnerId', 'sale.error.warningPartner')
    const row = (await ours(tx, 'sale.PartnerWarning', { partnerId: args.partnerId }))[0]
    const revision = Number(row?.revision ?? 0)
    if (revision !== Number(args.expectedRevision))
      return invalid('expectedRevision', 'sale.error.warningChanged')
    if ((row?.message ?? '') === message) return { ok: true, partnerId: args.partnerId, revision }
    const id = row?.id ?? companyKey(tx, 'partner-warning', String(args.partnerId))
    if (row) await tx.db.update('sale.PartnerWarning', { id }, { message, revision: revision + 1 })
    else await tx.db.insert('sale.PartnerWarning', { id, partnerId: args.partnerId, message, revision: 1 })
    return { ok: true, partnerId: args.partnerId, revision: revision + 1 }
  })
}

/** Live advisory only: customer first, then each product template once, including gifts. */
export async function orderSalesWarnings(ctx: Ctx, order: Row, lines: Row[]) {
  if (order.state === 'cancel' || !(await salesConfiguration(ctx)).saleWarnings) return []
  const result: Row[] = []
  const customer = await partnerSalesWarning(ctx, order.partnerId)
  if (customer?.message)
    result.push({ kind: 'partner', id: order.partnerId, name: customer.name, message: customer.message })
  const ids = [...new Set(lines.filter((line) => line.productId).map((line) => String(line.productId)))]
  if (!ids.length) return result
  const P = ctx.table('product.Product'),
    T = ctx.table('product.Template')
  const scoped = ctx.manifest.models['product.Product']?.scope === 'company'
  const products = await ctx.db.all(
    from(P).where(inArray(P.id, ids), ...(scoped ? [eq(P.companyId, company(ctx))] : [])),
  )
  const byId = new Map(products.map((row) => [String(row.id), row]))
  const templateIds = [
    ...new Set(ids.flatMap((id) => (byId.get(id)?.templateId ? [String(byId.get(id)!.templateId)] : []))),
  ]
  if (!templateIds.length) return result
  const templates = await ctx.db.all(
    from(T).where(inArray(T.id, templateIds), ...(scoped ? [eq(T.companyId, company(ctx))] : [])),
  )
  const byTemplate = new Map(templates.map((row) => [String(row.id), row]))
  for (const id of templateIds) {
    const template = byTemplate.get(id)
    const message = String(template?.saleWarning ?? '').trim()
    if (template && message) result.push({ kind: 'product', id, name: template.name, message })
  }
  return result
}
