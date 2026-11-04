import { dateBucket, eq, from, gte, inArray, isNull, localDayRange, lt } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { addDecimals, multiplyDecimals, subtractDecimals } from '../account/money.ts'
import { company } from './scope.ts'

/**
 * Sales figures read from the books (D18). A period is a month (`2026-10`), a quarter (`2026-Q4`) or a
 * year (`2026`) of the company's calendar, the same keys as the list grouping's buckets.
 */
/** What sales can be grouped by (D19). */
export const ANALYSIS_GROUPS = ['month', 'user', 'team', 'partner', 'product'] as const
export type AnalysisGroup = (typeof ANALYSIS_GROUPS)[number]

const PERIOD = /^(\d{4})(?:-(0[1-9]|1[0-2])|-Q([1-4]))?$/
export type PeriodKind = 'month' | 'quarter' | 'year'

export const periodKind = (key: string): PeriodKind | null => {
  const match = PERIOD.exec(key)
  return !match ? null : match[2] ? 'month' : match[3] ? 'quarter' : 'year'
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The first day of the period and the first day after it, as local calendar dates. */
export function periodDays(key: string): { start: string; end: string } | null {
  const match = PERIOD.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const [first, months] = match[2]
    ? [Number(match[2]), 1]
    : match[3]
      ? [(Number(match[3]) - 1) * 3 + 1, 3]
      : [1, 12]
  const after = first + months
  return {
    start: `${year}-${pad(first)}-01`,
    end: after > 12 ? `${year + 1}-01-01` : `${year}-${pad(after)}-01`,
  }
}

/** The period of the same length just before. */
export function previousPeriod(key: string): string | null {
  const match = PERIOD.exec(key)
  if (!match) return null
  const year = Number(match[1])
  if (match[2]) return Number(match[2]) === 1 ? `${year - 1}-12` : `${year}-${pad(Number(match[2]) - 1)}`
  if (match[3]) return Number(match[3]) === 1 ? `${year - 1}-Q4` : `${year}-Q${Number(match[3]) - 1}`
  return String(year - 1)
}

/** The instants a period covers in the company's timezone: from its first local midnight to the next period's. */
export function periodRange(key: string, timezone: string): [string, string] | null {
  const days = periodDays(key)
  return days ? [localDayRange(days.start, timezone)[0], localDayRange(days.end, timezone)[0]] : null
}

export async function companyTimezone(ctx: Ctx): Promise<string> {
  const C = ctx.table('company.Company')
  const row = ctx.scope.company ? await ctx.db.one(from(C).where(eq(C.id, ctx.scope.company))) : null
  return String(row?.accountingTimezone || 'Asia/Ho_Chi_Minh')
}

/** The period of this kind that holds today in the company's calendar. */
export const currentPeriod = (kind: PeriodKind, timezone: string, now = new Date()) =>
  String(dateBucket(now.toISOString(), kind, timezone))

/** Confirmed orders dated in the range, in the company's currency (D18: quotations and cancelled orders do not count). */
export async function soldOrders(ctx: Ctx, range: [string, string], currency: string): Promise<Row[]> {
  const O = ctx.table('sale.Order')
  return ctx.db.all(
    from(O)
      .select(O.id, O.amountUntaxed, O.userId, O.teamId, O.partnerId, O.dateOrder)
      .where(
        eq(O.companyId, company(ctx)),
        eq(O.state, 'sale'),
        eq(O.currency, currency),
        gte(O.dateOrder, range[0]),
        lt(O.dateOrder, range[1]),
      ),
  )
}

const CHUNK = 500
async function chunked(ids: readonly string[], read: (part: string[]) => Promise<Row[]>): Promise<Row[]> {
  const rows: Row[] = []
  for (let i = 0; i < ids.length; i += CHUNK) rows.push(...(await read(ids.slice(i, i + CHUNK))))
  return rows
}

/** The commercial lines of the orders, sections and notes left out: their amounts add up to the orders'. */
export async function soldLines(ctx: Ctx, orderIds: readonly string[]): Promise<Row[]> {
  const L = ctx.table('sale.OrderLine')
  const rows = await chunked(orderIds, (part) =>
    ctx.db.all(
      from(L)
        .select(L.id, L.orderId, L.productId, L.productUomQty, L.priceSubtotal, L.displayType)
        .where(eq(L.companyId, company(ctx)), inArray(L.orderId, part)),
    ),
  )
  return rows.filter((row) => !row.displayType)
}

/** Each variant's template. */
export async function templatesOf(ctx: Ctx, productIds: readonly string[]): Promise<Map<string, string>> {
  const V = ctx.table('product.Product')
  const ids = [...new Set(productIds.filter(Boolean))]
  const rows = await chunked(ids, (part) =>
    ctx.db.all(from(V).select(V.id, V.templateId).where(inArray(V.id, part))),
  )
  return new Map(rows.map((row) => [String(row.id), String(row.templateId)]))
}

/**
 * Each line's gross profit: its untaxed amount less what it cost (stock K25). A line without a product
 * costs nothing; a line whose cost is unknown has no profit and is counted apart.
 */
export async function lineMargins(ctx: Ctx, lines: readonly Row[]): Promise<Map<string, string | null>> {
  const C = ctx.table('sale.OrderLineCost')
  const orderIds = [...new Set(lines.map((line) => String(line.orderId)))]
  const costs = await chunked(orderIds, (part) =>
    ctx.db.all(
      from(C)
        .select(C.lineId, C.unitCost)
        .where(eq(C.companyId, company(ctx)), inArray(C.orderId, part)),
    ),
  )
  const unit = new Map(
    costs.map((row) => [String(row.lineId), row.unitCost == null ? null : String(row.unitCost)]),
  )
  return new Map(
    lines.map((line) => {
      const cost = line.productId ? unit.get(String(line.id)) : '0'
      return [
        String(line.id),
        cost == null
          ? null
          : subtractDecimals(line.priceSubtotal ?? '0', multiplyDecimals(cost, line.productUomQty ?? '0')),
      ]
    }),
  )
}

/**
 * Posted customer invoices dated in the range that still stand, made from sales orders (D10): drafts,
 * cancelled and reversed invoices and the reversals themselves do not count; a refund counts negative.
 * Returns each invoice's untaxed amount with the order it was made from.
 */
export async function invoicedOrders(ctx: Ctx, range: [string, string], currency: string) {
  const M = ctx.table('account.Move'),
    ML = ctx.table('account.MoveLine'),
    L = ctx.table('sale.OrderLine')
  const moves = await ctx.db.all(
    from(M)
      .select(M.id, M.moveType, M.amountUntaxed)
      .where(
        eq(M.companyId, company(ctx)),
        inArray(M.moveType, ['out_invoice', 'out_refund']),
        eq(M.state, 'posted'),
        eq(M.currency, currency),
        isNull(M.reversedById),
        isNull(M.reversalOfId),
        gte(M.invoiceDate, range[0]),
        lt(M.invoiceDate, range[1]),
      ),
  )
  const items = await chunked(
    moves.map((row) => String(row.id)),
    (part) => ctx.db.all(from(ML).select(ML.moveId, ML.saleLineId).where(inArray(ML.moveId, part))),
  )
  const lineOf = new Map<string, string>()
  for (const item of items)
    if (item.saleLineId && !lineOf.has(String(item.moveId)))
      lineOf.set(String(item.moveId), String(item.saleLineId))
  const lines = await chunked([...new Set(lineOf.values())], (part) =>
    ctx.db.all(from(L).select(L.id, L.orderId).where(inArray(L.id, part))),
  )
  const orderOf = new Map(lines.map((row) => [String(row.id), String(row.orderId)]))
  return moves.flatMap((move) => {
    const orderId = orderOf.get(lineOf.get(String(move.id)) ?? '')
    if (!orderId) return []
    const amount = String(move.amountUntaxed ?? '0')
    return [{ orderId, amount: move.moveType === 'out_refund' ? subtractDecimals('0', amount) : amount }]
  })
}

export const sum = (values: Iterable<unknown>) => {
  let total = '0'
  for (const value of values) total = addDecimals(total, value ?? '0')
  return total
}
