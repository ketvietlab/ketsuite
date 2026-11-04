import type { Ctx, Row } from '@ketvietlab/ketjs'
import { accountingDateText, fiscalYearKey } from './date.ts'
import { minorText, MONEY_POLICY_VERSION, moneyMinor } from './money.ts'
import { claimPostingPeriod } from './period.ts'
import { invalid, Refusal, refused, n, claimMoveRevision, today } from './validation.ts'
import { ledgerOf, accountOf } from './ledger.ts'
import { settlesEarlierDocument, taxInEffect } from './tax-quote.ts'

export async function nextMoveName(ctx: Ctx, journal: Row, accountingDate: string): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const current = (await ctx.db.select('account.Journal', { id: journal.id }))[0]
    if (!current) throw new Error('journal disappeared while assigning its sequence')
    const previous = n(current.sequenceNumber)
    const changed = await ctx.db.compareAndSet(
      'account.Journal',
      { id: journal.id },
      { sequenceNumber: current.sequenceNumber },
      { sequenceNumber: previous + 1 },
    )
    if ('dryRun' in changed || changed.matched)
      return `${String(journal.code).toUpperCase()}/${fiscalYearKey(accountingDate)}/${String(previous + 1).padStart(5, '0')}`
  }
  throw new Error('journal sequence did not settle after concurrent updates')
}

export async function postMoveById(
  ctx: Ctx,
  id: unknown,
  expectedRevision?: unknown,
  // A caller already inside a transaction (stock completion) posts on its own connection,
  // since adapters do not nest transactions.
  options: { inTransaction?: boolean } = {},
): Promise<Record<string, unknown>> {
  const move = (await ctx.db.select('account.Move', { id }))[0]
  if (!move) return invalid('id', 'moveMissing')
  if (move.state === 'posted') {
    await ctx.db.insertIfAbsent('account.AuditEvent', {
      id: `move:${String(move.id)}:posted`,
      subjectType: 'move',
      subjectId: String(move.id),
      action: 'posted',
      actorId: ctx.actor ?? null,
      accountingDate: move.accountingDate,
      reason: null,
      relatedId: null,
      details: { journalId: move.journalId, name: move.name, moneyPolicyVersion: move.moneyPolicyVersion },
      createdAt: move.postedAt ?? today(),
    })
    return { ok: true, id: move.id, name: move.name }
  }
  if (move.state !== 'draft') return invalid('state', 'moveDraftOnly')
  const { currency, scale, timezone } = await ledgerOf(ctx)
  if (String(move.currency) !== currency) return invalid('currency', 'moveCurrencyMismatch')
  const journal = (await ctx.db.select('account.Journal', { id: move.journalId }))[0]
  if (!journal) return invalid('journalId', 'journalMissing')
  if (journal.active === false) return invalid('journalId', 'journalInactive')
  const lines = await ctx.db.select('account.MoveLine', { moveId: id })
  if (lines.length < 2) return invalid('lines', 'linesTooFew')
  let debit = 0n
  let credit = 0n
  let residualTotal = 0n
  const accounts = new Map<string, Row>()
  for (const line of lines) {
    let lineDebit: bigint
    let lineCredit: bigint
    let balance: bigint
    let residual: bigint
    try {
      lineDebit = moneyMinor(line.debit, scale)
      lineCredit = moneyMinor(line.credit, scale)
      balance = moneyMinor(line.balance, scale)
      residual = moneyMinor(line.amountResidual, scale)
    } catch {
      return invalid('lines', 'moneyExactString')
    }
    if (lineDebit < 0n || lineCredit < 0n || (lineDebit > 0n && lineCredit > 0n))
      return invalid('lines', 'lineSideBoth')
    if (lineDebit === 0n && lineCredit === 0n) return invalid('lines', 'lineAmountRequired')
    if (balance !== lineDebit - lineCredit) return invalid('lines', 'lineBalanceInvalid')

    const accountId = String(line.accountId)
    let account = accounts.get(accountId)
    if (!account) {
      account = (await accountOf(ctx, accountId)) ?? undefined
      if (!account) return invalid('lines.accountId', 'accountMissing')
      accounts.set(accountId, account)
    }
    if (account.active === false) return invalid('lines.accountId', 'accountInactive')
    const magnitude = balance < 0n ? -balance : balance
    if (
      line.reconciled === true ||
      residual < 0n ||
      residual > magnitude ||
      (account.reconcile === true ? residual !== magnitude : residual !== 0n)
    )
      return invalid('lines.amountResidual', 'lineResidualInvalid')
    debit += lineDebit
    credit += lineCredit
    residualTotal += residual
  }
  if (debit !== credit)
    return invalid('lines', 'entryUnbalanced', {
      debit: minorText(debit, scale),
      credit: minorText(credit, scale),
    })
  if (move.moveType !== 'entry') {
    let untaxed: bigint
    let tax: bigint
    let total: bigint
    try {
      untaxed = moneyMinor(move.amountUntaxed, scale)
      tax = moneyMinor(move.amountTax, scale)
      total = moneyMinor(move.amountTotal, scale)
    } catch {
      return invalid('amountTotal', 'moneyExactString')
    }
    if (untaxed + tax !== total || total !== residualTotal) return invalid('amountTotal', 'moveTotalInvalid')
  }
  const postedAt = today()
  // An invoice already carries the totals its own line builder computed. A manual
  // entry has none, and a ledger that shows every entry as 0 is not a ledger.
  const totals =
    move.moveType === 'entry'
      ? {
          amountUntaxed: minorText(debit, scale),
          amountTax: minorText(0n, scale),
          amountTotal: minorText(debit, scale),
        }
      : {}
  let assigned: string
  try {
    const settle = async (tx: Ctx) => {
      const current = (await tx.db.select('account.Move', { id }))[0]
      if (!current) throw new Refusal('moveMissing')
      if (current.state === 'posted') return String(current.name)
      if (current.state !== 'draft') throw new Refusal('moveDraftOnly')
      // The validated line snapshot belongs to the revision read above. Claim that
      // exact revision even when the caller did not supply a token: if a line was
      // added after validation, posting must retry and validate the new set.
      const validatedRevision = expectedRevision ?? move.revision ?? null
      if (!(await claimMoveRevision(tx, current, validatedRevision))) throw new Refusal('moveConcurrent')
      let accountingDate: string
      let documentDate: string
      try {
        accountingDate = accountingDateText(current.accountingDate ?? current.date, timezone)
        documentDate = accountingDateText(
          current.documentDate ?? current.invoiceDate ?? current.accountingDate ?? current.date,
          timezone,
        )
      } catch {
        throw new Refusal('accountingDateInvalid')
      }
      // Whatever drafted the document (an invoice, a sale, a point of sale, the form),
      // a new one cannot carry a rate that does not apply on its date.
      if (!settlesEarlierDocument(current))
        for (const taxId of new Set(lines.map((line) => line.taxId).filter((held) => held != null))) {
          const tax = (await tx.db.select('account.Tax', { id: taxId }))[0]
          if (tax && !taxInEffect(tax, documentDate))
            throw new Refusal('taxOutOfEffect', { name: tax.name, date: documentDate })
        }
      let locked: Awaited<ReturnType<typeof claimPostingPeriod>>
      try {
        locked = await claimPostingPeriod(tx, {
          accountingDate,
          moveType: current.moveType,
          journalType: journal.type,
          hasTax: lines.some((line) => line.taxId != null),
          closingEntry: current.closingEntry === true,
        })
      } catch {
        throw new Refusal('periodConcurrent')
      }
      if (locked?.scope === 'kind')
        throw new Refusal('periodKindLocked', { dateFrom: locked.dateFrom, dateTo: locked.dateTo })
      if (locked) throw new Refusal('periodLocked', locked)
      const name = await nextMoveName(tx, journal, accountingDate)
      await tx.db.update(
        'account.Move',
        { id },
        {
          name,
          state: 'posted',
          accountingDate,
          documentDate,
          moneyPolicyVersion: MONEY_POLICY_VERSION,
          postedAt,
          ...totals,
        },
      )
      await tx.db.insertIfAbsent('account.AuditEvent', {
        id: `move:${String(id)}:posted`,
        subjectType: 'move',
        subjectId: String(id),
        action: 'posted',
        actorId: tx.actor ?? null,
        accountingDate,
        reason: null,
        relatedId: null,
        details: { journalId: journal.id, name, moneyPolicyVersion: MONEY_POLICY_VERSION },
        createdAt: postedAt,
      })
      return name
    }
    assigned = options.inTransaction ? await settle(ctx) : await ctx.tx(settle)
  } catch (error) {
    // Two replicas may both validate the same draft and one may lose the CAS only
    // because the other already posted it. That retry has reached its requested
    // state and is therefore an idempotent success, not a conflict.
    if (error instanceof Refusal && error.code === 'moveConcurrent') {
      const settled = (await ctx.db.select('account.Move', { id }))[0]
      if (settled?.state === 'posted') return { ok: true, id: settled.id, name: settled.name }
    }
    return refused(
      error instanceof Refusal && error.code === 'accountingDateInvalid'
        ? 'accountingDate'
        : error instanceof Refusal && error.code === 'periodLocked'
          ? 'accountingDate'
          : error instanceof Refusal && error.code === 'taxOutOfEffect'
            ? 'lines'
            : 'expectedRevision',
      error,
    )
  }
  return { ok: true, id: move.id, name: assigned }
}
