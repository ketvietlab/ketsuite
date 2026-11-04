import { and, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import {
  accountingFilterDateText,
  assertAccountingTimezone,
  DEFAULT_ACCOUNTING_TIMEZONE,
  moveAccountingDate,
} from './date.ts'
import { scaleOf } from './money.ts'
import { Refusal } from './validation.ts'

/** The currency a ledger write is denominated in, with the scale its arithmetic must use. */
export type Ledger = { currency: string; scale: number; timezone: string }

export async function ledgerOf(ctx: Ctx): Promise<Ledger> {
  if (!ctx.scope.company) throw new Error('accounting requires an active company')
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (!company) throw new Error(`company ${ctx.scope.company} does not exist`)
  const currency = String(company.currency)
  const timezone = assertAccountingTimezone(company.accountingTimezone ?? DEFAULT_ACCOUNTING_TIMEZONE)
  return { currency, scale: scaleOf(currency), timezone }
}

export async function accountOf(ctx: Ctx, id: unknown): Promise<Row | null> {
  return (await ctx.db.select('account.Account', { id }))[0] ?? null
}

/**
 * The ids of every posted move inside an optional inclusive civil-date window. A statement of
 * income passes `closing: false`: a closing entry only moves the result it reports into equity.
 */
export async function postedMoves(
  ctx: Ctx,
  dateFrom: unknown,
  dateTo: unknown,
  options: { closing?: boolean } = {},
): Promise<Map<string, Row>> {
  const { currency, timezone } = await ledgerOf(ctx)
  const fromDate = accountingFilterDateText(dateFrom)
  const toDate = accountingFilterDateText(dateTo)
  const M = ctx.table('account.Move')
  const moves = await ctx.db.all(from(M).where(eq(M.state, 'posted')))
  const selected: Array<[string, Row]> = []
  for (const held of moves) {
    if (String(held.currency) !== currency) throw new Refusal('moveCurrencyMismatch')
    const accountingDate = moveAccountingDate(held, timezone)
    if (fromDate && accountingDate < fromDate) continue
    if (toDate && accountingDate > toDate) continue
    if (options.closing === false && held.closingEntry === true) continue
    selected.push([String(held.id), { ...held, accountingDate }])
  }
  return new Map(selected)
}

/**
 * Journal items belonging to the given moves. The ids go into the query so the
 * database does the narrowing; chunking keeps a long reporting window from
 * building a parameter list no driver will accept.
 */
export async function linesOfMoves(ctx: Ctx, moveIds: string[], accountId?: unknown): Promise<Row[]> {
  if (!moveIds.length) return []
  const L = ctx.table('account.MoveLine')
  const rows: Row[] = []
  for (let at = 0; at < moveIds.length; at += 400) {
    const chunk = moveIds.slice(at, at + 400)
    rows.push(
      ...(await ctx.db.all(
        from(L).where(and(inArray(L.moveId, chunk), ...(accountId ? [eq(L.accountId, accountId)] : []))),
      )),
    )
  }
  return rows
}

/**
 * Every account of the active company, by id. Callers that classify a whole page
 * of journal items need this once instead of a lookup per line — a chart of
 * accounts is bounded by a company's configured chart while a ledger is not.
 */
export async function accountsById(ctx: Ctx): Promise<Map<string, Row>> {
  return new Map((await ctx.db.select('account.Account')).map((row) => [String(row.id), row]))
}
