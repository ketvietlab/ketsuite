import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { accountingDateText } from '../date.ts'
import { minorText, MONEY_POLICY_VERSION, moneyMinor } from '../money.ts'
import {
  invalid,
  Refusal,
  refused,
  n,
  rowMatches,
  instantText,
  MOVE_LINE_CREATE_FIELDS,
  claimMoveRevision,
  today,
} from '../validation.ts'
import { ledgerOf, accountsById } from '../ledger.ts'
import { postMoveById } from '../posting.ts'
import { reconcileFunction } from './payments.ts'

export async function postMoveHandler(ctx: Ctx, args: Row) {
  return postMoveById(ctx, args.id, args.expectedRevision)
}

export const postMoveFunction = defineFn({
  input: { id: 'id', expectedRevision: 'int?' },
  output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
  effects: [
    'read:account.Move',
    'read:account.MoveLine',
    'read:account.Journal',
    'read:account.Tax',
    'read:account.Account',
    'read:account.PeriodPolicy',
    'read:company.Company',
    'write:account.Journal',
    'write:account.Move',
    'write:account.PeriodPolicy',
    'write:account.AuditEvent',
  ],
  idempotent: true,
  agent: true,
  handler: postMoveHandler,
})

export async function cancelMoveHandler(ctx: Ctx, args: Row) {
  const move = (await ctx.db.select('account.Move', { id: args.id }))[0]
  if (!move) return invalid('id', 'moveMissing')
  if (move.state === 'cancel') return { ok: true, id: args.id }
  if (move.sourceModule) return invalid('id', 'moveSourceOwned')
  if (move.state === 'posted') return invalid('state', 'moveNotCancellable')
  try {
    await ctx.tx(async (tx) => {
      const current = (await tx.db.select('account.Move', { id: args.id }))[0]
      if (!current) throw new Refusal('moveMissing')
      if (current.state === 'cancel') return
      if (current.state === 'posted') throw new Refusal('moveNotCancellable')
      if (!(await claimMoveRevision(tx, current, args.expectedRevision))) throw new Refusal('moveConcurrent')
      await tx.db.update('account.Move', { id: args.id }, { state: 'cancel' })
    })
    return { ok: true, id: args.id }
  } catch (error) {
    return refused('expectedRevision', error)
  }
}

export const cancelMoveFunction = defineFn({
  input: { id: 'id', expectedRevision: 'int?' },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: ['read:account.Move', 'write:account.Move'],
  idempotent: true,
  agent: true,
  handler: cancelMoveHandler,
})

export async function reverseMoveHandler(ctx: Ctx, args: Row) {
  const move = (await ctx.db.select('account.Move', { id: args.id }))[0]
  if (!move) return invalid('id', 'moveMissing')
  if (move.state !== 'posted') return invalid('state', 'movePostedOnly')
  if (move.sourceModule) return invalid('id', 'moveSourceOwned')
  const reversalId = String(args.reversalId)
  if (move.reversedById && String(move.reversedById) !== reversalId)
    return invalid('reversalId', 'moveAlreadyReversed')

  const already = (await ctx.db.select('account.Move', { id: args.reversalId }))[0]
  const lines = (await ctx.db.select('account.MoveLine', { moveId: args.id })).sort(
    (a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)),
  )
  if (!lines.length) return invalid('lines', 'reversalNoLines')
  const journalId = args.journalId ?? already?.journalId ?? move.journalId
  if (!(await ctx.db.select('account.Journal', { id: journalId }))[0])
    return invalid('journalId', 'journalMissing')

  const { currency, scale, timezone } = await ledgerOf(ctx)
  if (String(move.currency) !== currency) return invalid('currency', 'moveCurrencyMismatch')
  const byId = await accountsById(ctx)
  let date = instantText(args.date ?? already?.date ?? today())
  let accountingDate: string
  let documentDate: string
  try {
    accountingDate = accountingDateText(args.accountingDate ?? already?.accountingDate ?? date, timezone)
    documentDate = accountingDateText(args.documentDate ?? already?.documentDate ?? accountingDate, timezone)
  } catch {
    return invalid('accountingDate', 'accountingDateInvalid')
  }
  const reversalRow: Row = {
    id: reversalId,
    name: reversalId,
    // The reference is the document being corrected, not a sentence about it:
    // this module has no translator, and a ledger read in Vietnamese must not
    // grow English prose.
    ref: args.ref ?? already?.ref ?? move.name,
    date,
    accountingDate,
    documentDate,
    moveType: 'entry',
    state: 'draft',
    journalId,
    partnerId: move.partnerId ?? null,
    invoiceDate: null,
    invoiceDateDue: null,
    paymentTermId: null,
    paymentState: 'paid',
    currency: move.currency,
    amountUntaxed: move.amountUntaxed,
    amountTax: move.amountTax,
    amountTotal: move.amountTotal,
    moneyPolicyVersion: MONEY_POLICY_VERSION,
    postedAt: null,
    reversalOfId: move.id,
    reversedById: null,
    reversalStatus: 'creating',
    revision: 0,
  }
  const mirrorRows = lines.map((line): Row => {
    const debit = moneyMinor(line.credit, scale)
    const credit = moneyMinor(line.debit, scale)
    const reconcilable = byId.get(String(line.accountId))?.reconcile === true
    return {
      id: `${reversalId}:${String(line.id)}`,
      moveId: reversalId,
      name: line.name,
      accountId: line.accountId,
      partnerId: line.partnerId ?? null,
      productId: line.productId ?? null,
      productUomId: line.productUomId ?? null,
      quantity: line.quantity,
      lineKind: line.lineKind ?? null,
      priceUnit: line.priceUnit,
      discount: line.discount,
      taxId: line.taxId ?? null,
      debit: minorText(debit, scale),
      credit: minorText(credit, scale),
      balance: minorText(debit - credit, scale),
      dateMaturity: null,
      displayType: line.displayType ?? null,
      reconciled: false,
      amountResidual: minorText(
        reconcilable ? (debit >= credit ? debit - credit : credit - debit) : 0n,
        scale,
      ),
      sequence: line.sequence,
    }
  })

  try {
    const settled = await ctx.tx(async (tx) => {
      const source = (await tx.db.select('account.Move', { id: args.id }))[0]
      if (!source) throw new Refusal('moveMissing')
      if (source.state !== 'posted') throw new Refusal('movePostedOnly')
      if (source.reversedById && String(source.reversedById) !== reversalId)
        throw new Refusal('moveAlreadyReversed')
      if (!source.reversedById) {
        const claimed = await tx.db.compareAndSet(
          'account.Move',
          { id: args.id },
          { reversedById: source.reversedById ?? null },
          { reversedById: reversalId },
        )
        if (!('dryRun' in claimed) && !claimed.matched) {
          const current = (await tx.db.select('account.Move', { id: args.id }))[0]
          if (String(current?.reversedById ?? '') !== reversalId) throw new Refusal('moveAlreadyReversed')
        }
      }
      const inserted = await tx.db.insertIfAbsent('account.Move', reversalRow)
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const existing = (await tx.db.select('account.Move', { id: reversalId }))[0]
        const moveFields = [
          'ref',
          'moveType',
          'journalId',
          'partnerId',
          'invoiceDate',
          'paymentTermId',
          'currency',
          'moneyPolicyVersion',
          'reversalOfId',
          ...(args.date == null ? [] : ['date']),
          ...(args.accountingDate == null ? [] : ['accountingDate']),
          ...(args.documentDate == null ? [] : ['documentDate']),
        ]
        const storedLines = await tx.db.select('account.MoveLine', { moveId: reversalId })
        const byLineId = new Map(storedLines.map((held) => [String(held.id), held]))
        const sameLines =
          storedLines.length === mirrorRows.length &&
          mirrorRows.every((wanted) => {
            const held = byLineId.get(String(wanted.id))
            return Boolean(held && rowMatches(held, wanted, MOVE_LINE_CREATE_FIELDS))
          })
        if (
          !existing ||
          !['draft', 'posted'].includes(String(existing.state)) ||
          !rowMatches(existing, reversalRow, moveFields) ||
          !sameLines
        )
          throw new Refusal('reversalIdReused')
        return existing
      }
      for (const row of mirrorRows) await tx.db.insert('account.MoveLine', row)
      return reversalRow
    })
    date = String(settled.date)
  } catch (error) {
    return refused('reversalId', error)
  }

  const posted = await postMoveById(ctx, reversalId)
  if (posted.ok !== true) return posted
  const postedReversal = (await ctx.db.select('account.Move', { id: reversalId }))[0]
  if (postedReversal?.reversalStatus === 'creating' || !postedReversal?.reversalStatus)
    await ctx.db.update('account.Move', { id: reversalId }, { reversalStatus: 'posted' })
  if (postedReversal?.reversalStatus !== 'completed')
    await ctx.db.update('account.Move', { id: reversalId }, { reversalStatus: 'reconciling' })

  // Close what the original left open, as far as each side still allows.
  for (const line of lines) {
    if (byId.get(String(line.accountId))?.reconcile !== true) continue
    const mirror = (await ctx.db.select('account.MoveLine', { id: `${reversalId}:${String(line.id)}` }))[0]
    const fresh = (await ctx.db.select('account.MoveLine', { id: line.id }))[0]
    if (!mirror || !fresh) continue
    const freshResidual = moneyMinor(fresh.amountResidual, scale)
    const mirrorResidual = moneyMinor(mirror.amountResidual, scale)
    const amount = freshResidual < mirrorResidual ? freshResidual : mirrorResidual
    if (amount <= 0n) continue
    const debitFirst = moneyMinor(fresh.balance, scale) > 0n
    const result = await reconcileFunction.handler(ctx, {
      id: `${reversalId}:reconcile:${String(line.id)}`,
      debitMoveId: debitFirst ? fresh.id : mirror.id,
      creditMoveId: debitFirst ? mirror.id : fresh.id,
      amount: minorText(amount, scale),
      date,
    })
    if ((result as Row).ok !== true) return result as Record<string, unknown>
  }

  try {
    await ctx.tx(async (tx) => {
      const source = (await tx.db.select('account.Move', { id: args.id }))[0]
      const reversal = (await tx.db.select('account.Move', { id: reversalId }))[0]
      if (!source || String(source.reversedById ?? '') !== reversalId)
        throw new Refusal('moveAlreadyReversed')
      if (!reversal || String(reversal.reversalOfId ?? '') !== String(source.id))
        throw new Refusal('reversalIdReused')
      if (source.moveType !== 'entry')
        await tx.db.update('account.Move', { id: args.id }, { paymentState: 'reversed' })

      // A payment's own move is an `entry`, so the line above never reaches it
      // and the payment kept reading `paid` after the money had been reversed
      // out of the books — the ledger and the payments list disagreeing about
      // whether a customer had paid.
      for (const payment of await tx.db.select('account.Payment', { moveId: args.id }))
        await tx.db.update('account.Payment', { id: payment.id }, { state: 'reversed' })
      await tx.db.update('account.Move', { id: reversalId }, { reversalStatus: 'completed' })
      await tx.db.insertIfAbsent('account.AuditEvent', {
        id: `move:${String(args.id)}:reversed:${reversalId}`,
        subjectType: 'move',
        subjectId: String(args.id),
        action: 'reversed',
        actorId: tx.actor ?? null,
        accountingDate: reversal.accountingDate,
        reason: args.reason ?? args.ref ?? source.name,
        relatedId: reversalId,
        details: { originalId: source.id, reversalId, replacementId: null },
        createdAt: today(),
      })
    })
  } catch (error) {
    return refused('reversalId', error)
  }
  return { ok: true, id: args.id, reversalId, name: posted.name }
}

export const reverseMoveFunction = defineFn({
  input: {
    id: 'id',
    reversalId: 'id',
    date: 'datetime?',
    accountingDate: 'date?',
    documentDate: 'date?',
    ref: 'text?',
    reason: 'text?',
    journalId: 'id?',
  },
  output: { ok: 'bool', id: 'id?', reversalId: 'id?', name: 'text?', errors: 'json?' },
  effects: [
    'read:account.Move',
    'read:account.MoveLine',
    'read:account.Account',
    'read:account.Journal',
    'read:account.PartialReconcile',
    'read:account.Payment',
    'read:account.PeriodPolicy',
    'read:company.Company',
    'write:account.Journal',
    'write:account.Move',
    'write:account.MoveLine',
    'write:account.PartialReconcile',
    'write:account.Payment',
    'write:account.PeriodPolicy',
    'write:account.AuditEvent',
  ],
  idempotent: true,
  agent: true,
  handler: reverseMoveHandler,
})

export const postingFunctions: Record<string, FnSpec> = {
  postMove: postMoveFunction,
  cancelMove: cancelMoveFunction,
  reverseMove: reverseMoveFunction,
}
