import { defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { userNames } from '../customers.ts'
import { company, ours } from '../scope.ts'
import { salespeople } from '../teams.ts'

const LIMIT = 500
const byLabel = (a: { id: string; name: string }, b: { id: string; name: string }) =>
  a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id)

/**
 * What the quotation and sales order lists offer to filter by (D19): every salesperson of the company
 * (whether or not they sold yet), every team (archived ones marked), the customers found on the list's
 * own orders and the products any line of the company sells, at most 500 of each.
 */
export async function getOrderFilterChoicesHandler(ctx: Ctx, args: Row) {
  const O = ctx.table('sale.Order')
  const states = args.quotations === true ? ['draft', 'sent', 'cancel'] : ['sale']
  const mine = [eq(O.companyId, company(ctx)), inArray(O.state, states)]
  const [people, teams, partnerGroups] = await Promise.all([
    salespeople(ctx),
    ours(ctx, 'sale.Team'),
    ctx.db.group(
      from(O)
        .where(...mine)
        .groupBy({ col: O.partnerId })
        .limit(LIMIT),
    ),
  ])
  const sellers = [...people]
  // A salesperson who left keeps their orders; they stay a choice while an order names them.
  const sold = await ctx.db.group(
    from(O)
      .where(...mine)
      .groupBy({ col: O.userId })
      .limit(LIMIT),
  )
  for (const group of sold)
    if (group.key[0] && !people.has(String(group.key[0]))) sellers.push(String(group.key[0]))
  const names = await userNames(ctx, sellers)
  const partnerIds = partnerGroups.map((group) => String(group.key[0] ?? '')).filter(Boolean)
  const P = ctx.table('partner.Partner')
  const partners = partnerIds.length
    ? await ctx.db.all(from(P).select(P.id, P.name).where(inArray(P.id, partnerIds)))
    : []
  // Products are templates: the ones the company's lines sell.
  const L = ctx.table('sale.OrderLine'),
    V = ctx.table('product.Product'),
    T = ctx.table('product.Template')
  const lineGroups = await ctx.db.group(
    from(L)
      .where(eq(L.companyId, company(ctx)))
      .groupBy({ col: L.productId })
      .limit(LIMIT * 4),
  )
  const variantIds = lineGroups.map((group) => String(group.key[0] ?? '')).filter(Boolean)
  const variants = variantIds.length
    ? await ctx.db.all(from(V).select(V.templateId).where(inArray(V.id, variantIds)))
    : []
  const templateIds = [...new Set(variants.map((row) => String(row.templateId)))].slice(0, LIMIT)
  const templates = templateIds.length
    ? await ctx.db.all(from(T).select(T.id, T.name).where(inArray(T.id, templateIds)))
    : []
  return {
    salespeople: sellers.map((id) => ({ id, name: names.get(id) ?? id })).sort(byLabel),
    teams: teams
      .map((row) => ({ id: String(row.id), name: String(row.name), active: row.active !== false }))
      .sort((a, b) => Number(b.active) - Number(a.active) || byLabel(a, b)),
    customers: partners.map((row) => ({ id: String(row.id), name: String(row.name ?? '') })).sort(byLabel),
    products: templates.map((row) => ({ id: String(row.id), name: String(row.name ?? '') })).sort(byLabel),
  }
}

export const filterFunctions: Record<string, FnSpec> = {
  getOrderFilterChoices: defineFn({
    input: { quotations: 'bool?' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'read:sale.Team',
      'read:user.Membership',
      'read:user.User',
      'read:partner.Partner',
      'read:product.Product',
      'read:product.Template',
    ],
    agent: true,
    handler: getOrderFilterChoicesHandler,
  }),
}
