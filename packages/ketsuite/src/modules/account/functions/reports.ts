import { and, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { minorText, moneyMinor } from '../money.ts'
import { n } from '../validation.ts'
import { ledgerOf, postedMoves, linesOfMoves, accountsById } from '../ledger.ts'
import { slice } from '../querying.ts'
import { accountingFilterDateText } from '../date.ts'
import { OPEN_ITEM_TYPES } from '../payment-state.ts'

export async function trialBalanceHandler(ctx: Ctx, args: Row) {
  if (args.balances === true) return trialBalanceWithBalances(ctx, args)
  const { scale } = await ledgerOf(ctx)
  const accounts = await ctx.db.select('account.Account')
  // The date window belongs to the move, so it narrows the move query and the
  // journal items are then fetched for those moves alone.
  const moves = await postedMoves(ctx, args.dateFrom, args.dateTo)
  const result = new Map<string, { debit: bigint; credit: bigint }>()
  for (const line of await linesOfMoves(ctx, [...moves.keys()])) {
    const held = result.get(String(line.accountId)) ?? { debit: 0n, credit: 0n }
    held.debit += moneyMinor(line.debit, scale)
    held.credit += moneyMinor(line.credit, scale)
    result.set(String(line.accountId), held)
  }
  return accounts
    .map((account) => {
      const held = result.get(String(account.id)) ?? { debit: 0n, credit: 0n }
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        debit: minorText(held.debit, scale),
        credit: minorText(held.credit, scale),
        balance: minorText(held.debit - held.credit, scale),
      }
    })
    .filter((row) => moneyMinor(row.debit, scale) !== 0n || moneyMinor(row.credit, scale) !== 0n)
}

/**
 * The trial balance a chart is closed with: each account's balance before the
 * window, what the window moved and the balance at its end, the two balances
 * split into a debit or a credit column by their sign. An account with no
 * balance and no movement is left out unless `includeEmpty` asks for every one.
 */
async function trialBalanceWithBalances(ctx: Ctx, args: Row) {
  const { scale } = await ledgerOf(ctx)
  const accounts = await ctx.db.select('account.Account')
  const fromDate = accountingFilterDateText(args.dateFrom)
  // Everything posted up to the end of the window: what came before its first day is the opening.
  const moves = await postedMoves(ctx, undefined, args.dateTo)
  const held = new Map<string, { opening: bigint; debit: bigint; credit: bigint }>()
  for (const line of await linesOfMoves(ctx, [...moves.keys()])) {
    const move = moves.get(String(line.moveId))
    const row = held.get(String(line.accountId)) ?? { opening: 0n, debit: 0n, credit: 0n }
    const debit = moneyMinor(line.debit, scale)
    const credit = moneyMinor(line.credit, scale)
    if (fromDate && String(move?.accountingDate) < fromDate) row.opening += debit - credit
    else {
      row.debit += debit
      row.credit += credit
    }
    held.set(String(line.accountId), row)
  }
  const side = (value: bigint) => ({
    debit: minorText(value > 0n ? value : 0n, scale),
    credit: minorText(value < 0n ? -value : 0n, scale),
  })
  return accounts
    .map((account) => {
      const row = held.get(String(account.id)) ?? { opening: 0n, debit: 0n, credit: 0n }
      const closing = row.opening + row.debit - row.credit
      const opening = side(row.opening)
      const end = side(closing)
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        openingDebit: opening.debit,
        openingCredit: opening.credit,
        debit: minorText(row.debit, scale),
        credit: minorText(row.credit, scale),
        balance: minorText(row.debit - row.credit, scale),
        closingDebit: end.debit,
        closingCredit: end.credit,
        empty: row.opening === 0n && row.debit === 0n && row.credit === 0n,
      }
    })
    .filter((row) => args.includeEmpty === true || !row.empty)
    .sort((a, b) => (String(a.code) < String(b.code) ? -1 : String(a.code) > String(b.code) ? 1 : 0))
}

export const trialBalanceFunction = defineFn({
  // `balances` adds the opening and closing balances, split into debit and credit;
  // `includeEmpty` keeps the accounts with nothing to show.
  input: { dateFrom: 'date?', dateTo: 'date?', balances: 'bool?', includeEmpty: 'bool?' },
  effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine', 'read:company.Company'],
  agent: true,
  handler: trialBalanceHandler,
})

export async function generalLedgerHandler(ctx: Ctx, args: Row) {
  const moves = await postedMoves(ctx, args.dateFrom, args.dateTo)
  const { scale } = await ledgerOf(ctx)
  const codes = new Map(
    (await ctx.db.select('account.Account')).map((row) => [String(row.id), String(row.code)]),
  )
  const every = await linesOfMoves(ctx, [...moves.keys()])
  const byMove = new Map<string, Row[]>()
  for (const line of every)
    byMove.set(String(line.moveId), [...(byMove.get(String(line.moveId)) ?? []), line])
  // The accounts on the other side of a line in its own entry, as a ledger prints them:
  // a debit line names the accounts credited, a credit line the accounts debited.
  const contraOf = (line: Row): string => {
    const side = moneyMinor(line.debit, scale) > 0n ? 'credit' : 'debit'
    const found = (byMove.get(String(line.moveId)) ?? [])
      .filter(
        (other) =>
          other.id !== line.id &&
          String(other.accountId) !== String(line.accountId) &&
          moneyMinor(other[side], scale) > 0n,
      )
      .map((other) => codes.get(String(other.accountId)) ?? '')
      .filter(Boolean)
    return [...new Set(found)].sort().join(', ')
  }
  const wanted = args.accountId
    ? every.filter((line) => String(line.accountId) === String(args.accountId))
    : every
  const rows = wanted
    .map((line): Row & { move: Row } => ({
      ...line,
      contraAccountCodes: contraOf(line),
      move: moves.get(String(line.moveId))!,
    }))
    .sort(
      (a, b) =>
        String(a.move.accountingDate).localeCompare(String(b.move.accountingDate)) ||
        String(a.moveId).localeCompare(String(b.moveId)) ||
        n(a.sequence) - n(b.sequence),
    )
  return slice(rows, args.limit, args.offset)
}

export const generalLedgerFunction = defineFn({
  input: {
    accountId: 'id?',
    dateFrom: 'date?',
    dateTo: 'date?',
    limit: 'int?',
    offset: 'int?',
  },
  effects: ['read:account.Move', 'read:account.MoveLine', 'read:account.Account', 'read:company.Company'],
  agent: true,
  handler: generalLedgerHandler,
})

export async function partnerStatementHandler(ctx: Ctx, args: Row) {
  const byId = await accountsById(ctx)
  const control = [...byId.values()]
    .filter((row) => OPEN_ITEM_TYPES.includes(String(row.accountType)))
    .map((row) => row.id)
  if (!control.length) return []
  const moves = new Map(
    [...(await postedMoves(ctx, args.dateFrom, args.dateTo))].filter(
      ([, move]) => String(move.partnerId) === String(args.partnerId),
    ),
  )
  if (!moves.size) return []
  const L = ctx.table('account.MoveLine')
  const lines = await ctx.db.all(
    from(L).where(and(eq(L.partnerId, args.partnerId), inArray(L.accountId, control))),
  )
  const rows = lines
    .filter((line) => moves.has(String(line.moveId)))
    .map((line): Row & { move: Row } => ({ ...line, move: moves.get(String(line.moveId))! }))
    .sort(
      (a, b) =>
        String(a.move.accountingDate).localeCompare(String(b.move.accountingDate)) ||
        String(a.id).localeCompare(String(b.id)),
    )
  return slice(rows, args.limit, args.offset)
}

export const partnerStatementFunction = defineFn({
  input: {
    partnerId: 'id',
    dateFrom: 'date?',
    dateTo: 'date?',
    limit: 'int?',
    offset: 'int?',
  },
  effects: ['read:account.Move', 'read:account.MoveLine', 'read:account.Account', 'read:company.Company'],
  agent: true,
  handler: partnerStatementHandler,
})

export const reportsFunctions: Record<string, FnSpec> = {
  trialBalance: trialBalanceFunction,
  generalLedger: generalLedgerFunction,
  partnerStatement: partnerStatementFunction,
}
