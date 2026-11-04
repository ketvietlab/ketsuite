import type { Ctx, Row } from '@ketvietlab/ketjs'
import { accountingDateText } from './date.ts'
import { canonicalDecimalText, minorText, MONEY_POLICY_VERSION, moneyMinor } from './money.ts'
import { rowMatches } from './validation.ts'
import { ledgerOf, accountOf } from './ledger.ts'

export class DraftMoveBoundaryError extends Error {
  field: string
  constructor(field: string, message: string) {
    super(message)
    this.field = field
  }
}

export const boundaryError = (field: string, message: string): never => {
  throw new DraftMoveBoundaryError(field, message)
}

/**
 * The sole transaction-level boundary for a complete draft journal entry.
 *
 * Sale, Purchase and POS build their domain document inside a transaction, then
 * hand the complete move here. The boundary re-derives every monetary invariant
 * before any ledger row is accepted. Callers must pass their transaction context;
 * this helper deliberately does not open a nested transaction.
 */
export async function insertDraftMove(
  ctx: Ctx,
  input: { move: Row; lines: Row[] },
): Promise<{ id: string; existing: boolean }> {
  const { currency, scale, timezone } = await ledgerOf(ctx)
  const moveId = String(input.move.id ?? '')
  if (!moveId) boundaryError('move.id', 'a draft move id is required')
  if (input.move.state !== 'draft')
    boundaryError('move.state', 'the shared boundary only accepts draft moves')
  if (String(input.move.currency) !== currency)
    boundaryError('move.currency', 'the move currency must match the active company ledger')
  const journal = (await ctx.db.select('account.Journal', { id: input.move.journalId }))[0]
  if (!journal) boundaryError('move.journalId', 'the journal does not exist in the active company')
  if (journal.active === false)
    boundaryError('move.journalId', 'an inactive journal cannot receive a new draft move')
  if (input.lines.length < 2) boundaryError('lines', 'a draft move needs at least two lines')

  const ids = new Set<string>()
  const normalizedLines: Row[] = []
  let debitTotal = 0n
  let creditTotal = 0n
  let residualTotal = 0n
  const accountCache = new Map<string, Row>()
  for (const given of input.lines) {
    const id = String(given.id ?? '')
    if (!id || ids.has(id)) boundaryError('lines.id', 'journal item ids must be present and unique')
    ids.add(id)
    if (String(given.moveId) !== moveId)
      boundaryError('lines.moveId', 'every journal item must belong to the draft move')
    const accountId = String(given.accountId ?? '')
    let account = accountCache.get(accountId)
    if (!account) {
      const loaded = await accountOf(ctx, accountId)
      if (!loaded)
        throw new DraftMoveBoundaryError(
          'lines.accountId',
          'a journal item account is outside the active company',
        )
      account = loaded
      accountCache.set(accountId, loaded)
    }
    if (account.active === false)
      boundaryError('lines.accountId', 'an inactive account cannot receive a new journal item')
    const { debit, credit, balance, residual, quantity, priceUnit, discount } = (() => {
      try {
        return {
          debit: moneyMinor(given.debit ?? '0', scale),
          credit: moneyMinor(given.credit ?? '0', scale),
          balance: moneyMinor(given.balance ?? '0', scale),
          residual: moneyMinor(given.amountResidual ?? '0', scale),
          quantity: canonicalDecimalText(given.quantity ?? '1'),
          priceUnit: canonicalDecimalText(given.priceUnit ?? '0'),
          discount: canonicalDecimalText(given.discount ?? '0'),
        }
      } catch {
        throw new DraftMoveBoundaryError(
          'lines.amount',
          'journal item decimals must be canonical exact strings',
        )
      }
    })()
    if (debit < 0n || credit < 0n || (debit > 0n && credit > 0n))
      boundaryError('lines.side', 'a journal item must use one non-negative side')
    if (debit === 0n && credit === 0n)
      boundaryError('lines.side', 'a journal item needs a non-zero debit or credit')
    if (balance !== debit - credit)
      boundaryError('lines.balance', 'journal item balance must equal debit minus credit')
    const magnitude = balance < 0n ? -balance : balance
    if (residual < 0n || residual > magnitude)
      boundaryError('lines.amountResidual', 'journal item residual must be within its balance')
    if (account.reconcile === true) {
      if (given.reconciled === true ? residual !== 0n : residual !== magnitude)
        boundaryError('lines.amountResidual', 'a reconcilable draft line must carry its full residual')
    } else if (residual !== 0n)
      boundaryError('lines.amountResidual', 'a non-reconcilable account cannot carry a residual')
    if (given.reconciled === true)
      boundaryError('lines.reconciled', 'a draft journal item cannot already be reconciled')
    debitTotal += debit
    creditTotal += credit
    residualTotal += residual
    normalizedLines.push({
      ...given,
      quantity,
      priceUnit,
      discount,
      debit: minorText(debit, scale),
      credit: minorText(credit, scale),
      balance: minorText(balance, scale),
      reconciled: false,
      amountResidual: minorText(residual, scale),
    })
  }
  if (debitTotal !== creditTotal)
    boundaryError('lines', 'the draft move must balance exactly at company-currency scale')

  let { untaxed, tax, total } = (() => {
    try {
      return {
        untaxed: moneyMinor(input.move.amountUntaxed ?? '0', scale),
        tax: moneyMinor(input.move.amountTax ?? '0', scale),
        total: moneyMinor(input.move.amountTotal ?? '0', scale),
      }
    } catch {
      throw new DraftMoveBoundaryError('move.amountTotal', 'move totals must be canonical exact strings')
    }
  })()
  if (String(input.move.moveType) === 'entry') {
    // A journal entry's displayed total is its balanced turnover. Contra lines
    // can make the source transaction's net amount smaller than this gross
    // debit/credit total, so an entry does not carry invoice subtotal semantics.
    untaxed = debitTotal
    tax = 0n
    total = debitTotal
  } else {
    if (untaxed + tax !== total)
      boundaryError('move.amountTotal', 'untaxed plus tax must equal the document total')
    if (total !== residualTotal)
      boundaryError('move.amountTotal', 'the document total must equal its open-item counterparts')
  }
  const move: Row = {
    ...input.move,
    currency,
    accountingDate: accountingDateText(input.move.accountingDate ?? input.move.date, timezone),
    documentDate: accountingDateText(
      input.move.documentDate ?? input.move.invoiceDate ?? input.move.accountingDate ?? input.move.date,
      timezone,
    ),
    amountUntaxed: minorText(untaxed, scale),
    amountTax: minorText(tax, scale),
    amountTotal: minorText(total, scale),
    postedAt: null,
    moneyPolicyVersion: MONEY_POLICY_VERSION,
    revision: 0,
  }

  const inserted = await ctx.db.insertIfAbsent('account.Move', move)
  if (!('dryRun' in inserted) && !inserted.inserted) {
    const existing = (await ctx.db.select('account.Move', { id: moveId }))[0]
    const storedLines = await ctx.db.select('account.MoveLine', { moveId })
    const sameMove = Boolean(
      existing &&
        rowMatches(
          existing,
          move,
          Object.keys(move).filter((field) => field !== 'companyId' && field !== 'revision'),
        ),
    )
    const byId = new Map(storedLines.map((row) => [String(row.id), row]))
    const sameLines =
      storedLines.length === normalizedLines.length &&
      normalizedLines.every((line) => {
        const held = byId.get(String(line.id))
        return Boolean(
          held &&
            rowMatches(
              held,
              line,
              Object.keys(line).filter((field) => field !== 'companyId'),
            ),
        )
      })
    if (!sameMove || !sameLines)
      boundaryError('move.id', 'the draft move id is already used by different financial content')
    return { id: moveId, existing: true }
  }
  for (const line of normalizedLines) {
    const result = await ctx.db.insertIfAbsent('account.MoveLine', line)
    if (!('dryRun' in result) && !result.inserted)
      boundaryError('lines.id', 'a journal item id is already used outside this draft move')
  }
  return { id: moveId, existing: false }
}
