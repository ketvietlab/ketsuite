import { asc, dateBucket, defineFn, eq, from, inArray, lt } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addDecimals, compareDecimals } from '../../account/money.ts'
import {
  ANALYSIS_GROUPS,
  companyTimezone,
  currentPeriod,
  invoicedOrders,
  lineMargins,
  periodKind,
  periodRange,
  previousPeriod,
  soldLines,
  soldOrders,
  sum,
  templatesOf,
} from '../analysis.ts'
import type { AnalysisGroup } from '../analysis.ts'
import { userNames } from '../customers.ts'
import { company, ours } from '../scope.ts'
import { companyCurrency } from './shared.ts'

type Group = AnalysisGroup

const READ_EFFECTS = [
  'read:company.Company',
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:sale.Team',
  'read:user.User',
  'read:partner.Partner',
  'read:product.Product',
  'read:product.Template',
] as const

/** The period asked for, else the one of this kind holding today; a bad key is refused, not guessed. */
async function window(ctx: Ctx, args: Row, kind: 'month' | 'year') {
  const timezone = await companyTimezone(ctx)
  const period =
    args.period == null || args.period === '' ? currentPeriod(kind, timezone) : String(args.period)
  const range = periodKind(period) ? periodRange(period, timezone) : null
  if (!range) return null
  const previous = previousPeriod(period)!
  return { timezone, period, range, previous, previousRange: periodRange(previous, timezone)! }
}
const refused = () => ({ ok: false, errors: [{ field: 'period', message: 'sale.error.analysis.period' }] })

/** What a group's key is for an order: its month, salesperson, team or customer ('' for none). */
const orderKey = (group: Group, order: Row, timezone: string) =>
  group === 'month'
    ? String(dateBucket(order.dateOrder, 'month', timezone) ?? '')
    : String(order[group === 'user' ? 'userId' : group === 'team' ? 'teamId' : 'partnerId'] ?? '')

/** Each order line with the group it falls in; products group lines, the rest whole orders. */
async function groupedLines(ctx: Ctx, group: Group, orders: Row[], timezone: string) {
  const lines = await soldLines(
    ctx,
    orders.map((order) => String(order.id)),
  )
  const orderOf = new Map(orders.map((order) => [String(order.id), order]))
  const templates =
    group === 'product'
      ? await templatesOf(
          ctx,
          lines.map((line) => String(line.productId ?? '')),
        )
      : new Map<string, string>()
  return lines.map((line) => ({
    line,
    key:
      group === 'product'
        ? (templates.get(String(line.productId ?? '')) ?? '')
        : orderKey(group, orderOf.get(String(line.orderId))!, timezone),
  }))
}

/** The names of the groups' keys. */
async function labels(ctx: Ctx, group: Group, keys: string[]): Promise<Map<string, string>> {
  const ids = keys.filter(Boolean)
  if (group === 'month' || !ids.length) return new Map(ids.map((key) => [key, key]))
  if (group === 'user') return userNames(ctx, ids) as Promise<Map<string, string>>
  if (group === 'team')
    return new Map((await ours(ctx, 'sale.Team')).map((row) => [String(row.id), String(row.name)]))
  const table = ctx.table(group === 'partner' ? 'partner.Partner' : 'product.Template')
  const rows = await ctx.db.all(from(table).select(table.id, table.name).where(inArray(table.id, ids)))
  return new Map(rows.map((row) => [String(row.id), String(row.name ?? '')]))
}

const ordered = <T extends { key: string; label: string }>(
  group: Group,
  rows: T[],
  amount: (row: T) => string,
) =>
  rows.sort((a, b) =>
    group === 'month'
      ? a.key.localeCompare(b.key)
      : compareDecimals(amount(b), amount(a)) ||
        a.label.localeCompare(b.label, 'vi') ||
        a.key.localeCompare(b.key),
  )

/**
 * Sales of a period grouped by month, salesperson, team, customer or product (D19): untaxed amount and
 * orders per group, with the totals of the period and of the one before. A product's amount is its
 * lines' and its orders those with a line for it.
 */
export async function analyzeSalesHandler(ctx: Ctx, args: Row) {
  const span = await window(ctx, args, 'year')
  if (!span) return refused()
  const group: Group = ANALYSIS_GROUPS.includes(args.groupBy as Group) ? (args.groupBy as Group) : 'month'
  const currency = await companyCurrency(ctx)
  const [orders, before] = await Promise.all([
    soldOrders(ctx, span.range, currency),
    soldOrders(ctx, span.previousRange, currency),
  ])
  const totals = new Map<string, { revenue: string; orders: Set<string> }>()
  const add = (key: string, orderId: string, amount: unknown) => {
    const row = totals.get(key) ?? { revenue: '0', orders: new Set<string>() }
    row.revenue = addDecimals(row.revenue, amount ?? '0')
    row.orders.add(orderId)
    totals.set(key, row)
  }
  if (group === 'product')
    for (const { line, key } of await groupedLines(ctx, group, orders, span.timezone))
      add(key, String(line.orderId), line.priceSubtotal)
  else
    for (const order of orders)
      add(orderKey(group, order, span.timezone), String(order.id), order.amountUntaxed)
  const names = await labels(ctx, group, [...totals.keys()])
  return {
    ok: true,
    period: span.period,
    previous: span.previous,
    groupBy: group,
    currency,
    totals: { revenue: sum(orders.map((order) => order.amountUntaxed)), orders: orders.length },
    previousTotals: { revenue: sum(before.map((order) => order.amountUntaxed)), orders: before.length },
    groups: ordered(
      group,
      [...totals].map(([key, row]) => ({
        key,
        label: names.get(key) ?? '',
        revenue: row.revenue,
        orders: row.orders.size,
      })),
      (row) => row.revenue,
    ),
  }
}

/**
 * Gross profit of the same orders and groups (D18): untaxed amount less cost per line. Lines whose cost
 * is unknown add nothing and are counted, so a reader knows the figure is short.
 */
export async function analyzeSalesMarginHandler(ctx: Ctx, args: Row) {
  const span = await window(ctx, args, 'year')
  if (!span) return refused()
  const group: Group = ANALYSIS_GROUPS.includes(args.groupBy as Group) ? (args.groupBy as Group) : 'month'
  const currency = await companyCurrency(ctx)
  const profit = async (range: [string, string]) => {
    const orders = await soldOrders(ctx, range, currency)
    const lines = await groupedLines(ctx, group, orders, span.timezone)
    const margins = await lineMargins(
      ctx,
      lines.map((item) => item.line),
    )
    const groups = new Map<string, { margin: string; unknownLines: number }>()
    for (const { line, key } of lines) {
      const row = groups.get(key) ?? { margin: '0', unknownLines: 0 }
      const margin = margins.get(String(line.id))
      if (margin == null) row.unknownLines++
      else row.margin = addDecimals(row.margin, margin)
      groups.set(key, row)
    }
    return groups
  }
  const [current, before] = await Promise.all([profit(span.range), profit(span.previousRange)])
  const total = (groups: Map<string, { margin: string; unknownLines: number }>) => ({
    margin: sum([...groups.values()].map((row) => row.margin)),
    unknownLines: [...groups.values()].reduce((count, row) => count + row.unknownLines, 0),
  })
  return {
    ok: true,
    period: span.period,
    previous: span.previous,
    groupBy: group,
    currency,
    totals: total(current),
    previousTotals: total(before),
    groups: [...current].map(([key, row]) => ({ key, ...row })),
  }
}

/**
 * The sales overview of a month (D18): what was sold and invoiced against the month before, what is
 * open, each team in use against its monthly target, sales per salesperson and quotations about to
 * expire. Anyone who reads Sales reads the company's figures.
 */
export async function getSalesOverviewHandler(ctx: Ctx, args: Row) {
  const span = await window(ctx, args, 'month')
  if (!span) return refused()
  const currency = await companyCurrency(ctx)
  const O = ctx.table('sale.Order')
  const [orders, before, invoiced, invoicedBefore, open, toInvoice, teams] = await Promise.all([
    soldOrders(ctx, span.range, currency),
    soldOrders(ctx, span.previousRange, currency),
    invoicedOrders(ctx, span.range, currency),
    invoicedOrders(ctx, span.previousRange, currency),
    ctx.db.all(
      from(O)
        .select(O.amountUntaxed)
        .where(eq(O.companyId, company(ctx)), inArray(O.state, ['draft', 'sent']), eq(O.currency, currency)),
    ),
    ctx.db.all(
      from(O)
        .select(O.amountUntaxed)
        .where(
          eq(O.companyId, company(ctx)),
          eq(O.state, 'sale'),
          eq(O.invoiceStatus, 'to invoice'),
          eq(O.currency, currency),
        ),
    ),
    ours(ctx, 'sale.Team'),
  ])
  // A team's invoicing counts the invoices of its orders, whenever those were ordered.
  const invoicedIds = [...new Set(invoiced.map((row) => row.orderId))]
  const teamOf = new Map(
    (invoicedIds.length
      ? await ctx.db.all(from(O).select(O.id, O.teamId).where(inArray(O.id, invoicedIds)))
      : []
    ).map((row) => [String(row.id), String(row.teamId ?? '')]),
  )
  const bySeller = new Map<string, string>()
  for (const order of orders)
    if (order.userId)
      bySeller.set(
        String(order.userId),
        addDecimals(bySeller.get(String(order.userId)) ?? '0', order.amountUntaxed),
      )
  const names = await userNames(ctx, [...bySeller.keys()])
  // Quotations sent and expiring within a week, or already expired without being confirmed.
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString()
  const expiring = await ctx.db.all(
    from(O)
      .select(O.id, O.name, O.partnerId, O.validityDate, O.amountUntaxed)
      .where(eq(O.companyId, company(ctx)), eq(O.state, 'sent'), lt(O.validityDate, soon))
      .orderBy(asc(O.validityDate))
      .limit(20),
  )
  const partners = await labels(
    ctx,
    'partner',
    expiring.map((row) => String(row.partnerId)),
  )
  const now = new Date().toISOString()
  return {
    ok: true,
    period: span.period,
    previous: span.previous,
    currency,
    revenue: sum(orders.map((order) => order.amountUntaxed)),
    previousRevenue: sum(before.map((order) => order.amountUntaxed)),
    orders: orders.length,
    invoiced: sum(invoiced.map((row) => row.amount)),
    previousInvoiced: sum(invoicedBefore.map((row) => row.amount)),
    openQuotations: { count: open.length, amount: sum(open.map((row) => row.amountUntaxed)) },
    toInvoice: { count: toInvoice.length, amount: sum(toInvoice.map((row) => row.amountUntaxed)) },
    teams: teams
      .filter((team) => team.active !== false)
      .map((team) => ({
        id: String(team.id),
        name: String(team.name),
        target: String(team.monthlyTarget ?? '0'),
        invoiced: sum(
          invoiced.filter((row) => teamOf.get(row.orderId) === String(team.id)).map((row) => row.amount),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    salespeople: [...bySeller]
      .map(([id, revenue]) => ({ id, name: names.get(id) ?? '', revenue }))
      .sort((a, b) => compareDecimals(b.revenue, a.revenue) || a.name.localeCompare(b.name, 'vi')),
    expiring: expiring.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      partnerName: partners.get(String(row.partnerId)) ?? '',
      validityDate: row.validityDate,
      amount: String(row.amountUntaxed ?? '0'),
      expired: String(row.validityDate) < now,
    })),
  }
}

export const analysisFunctions: Record<string, FnSpec> = {
  analyzeSales: defineFn({
    input: { period: 'text?', groupBy: 'text?' },
    effects: [...READ_EFFECTS],
    agent: true,
    handler: analyzeSalesHandler,
  }),
  analyzeSalesMargin: defineFn({
    input: { period: 'text?', groupBy: 'text?' },
    effects: [...READ_EFFECTS, 'read:sale.OrderLineCost'],
    agent: true,
    handler: analyzeSalesMarginHandler,
  }),
  getSalesOverview: defineFn({
    input: { period: 'text?' },
    effects: [...READ_EFFECTS, 'read:account.Move', 'read:account.MoveLine'],
    agent: true,
    handler: getSalesOverviewHandler,
  }),
}
