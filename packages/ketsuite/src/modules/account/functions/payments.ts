import { and, asc, defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { accountingDateText, moveAccountingDate } from '../date.ts'
import { minorText, MONEY_POLICY_VERSION, moneyMinor, sumMoneyMinor } from '../money.ts'
import { PAYMENT_TYPES, PARTNER_TYPES, PAYMENT_SETTLEMENT_KINDS } from '../vocabulary.ts'
import {
  invalid,
  Refusal,
  refused,
  rowMatches,
  instantText,
  claimMoveRevision,
  today,
} from '../validation.ts'
import { ledgerOf, accountOf, accountsById } from '../ledger.ts'
import { insertDraftMove } from '../draft-moves.ts'
import { paginate } from '../querying.ts'
import { postMoveById } from '../posting.ts'
import { updatePaymentState } from '../payment-state.ts'

export async function listPaymentsHandler(ctx: Ctx, args: Row) {
  const P = ctx.table('account.Payment')
  const where = [
    ...(args.partnerId ? [eq(P.partnerId, args.partnerId)] : []),
    ...(args.state ? [eq(P.state, args.state)] : []),
  ]
  const q = (where.length ? from(P).where(and(...where)) : from(P)).orderBy(
    asc(P.accountingDate),
    asc(P.date),
    asc(P.id),
  )
  return ctx.db.all(paginate(q, args.limit, args.offset))
}

export const listPaymentsFunction = defineFn({
  input: { partnerId: 'id?', state: 'text?', limit: 'int?', offset: 'int?' },
  effects: ['read:account.Payment'],
  agent: true,
  handler: listPaymentsHandler,
})

export async function postStoredValueBalanceHandler(ctx: Ctx, args: Row) {
  const operation = String(args.operation)
  if (!['issue', 'expire'].includes(operation)) return invalid('operation', 'storedValueOperationUnsupported')
  const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
  if (!journal || String(journal.type) !== 'general') return invalid('journalId', 'journalNotStoredValue')
  const [liability, counterpart] = await Promise.all([
    accountOf(ctx, args.liabilityAccountId),
    accountOf(ctx, args.counterpartAccountId),
  ])
  if (!liability || !String(liability.accountType).startsWith('liability'))
    return invalid('liabilityAccountId', 'journalStoredValueAccount')
  const counterpartType = String(counterpart?.accountType ?? '')
  if (
    !counterpart ||
    (operation === 'issue' && !counterpartType.startsWith('asset')) ||
    (operation === 'expire' && !counterpartType.startsWith('income'))
  )
    return invalid('counterpartAccountId', 'storedValueCounterpart')
  if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
    return invalid('partnerId', 'partnerMissing')
  const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
  const { currency, scale, timezone } = await ledgerOf(ctx)
  let amount: bigint
  try {
    amount = moneyMinor(args.amount, scale)
  } catch {
    return invalid('amount', 'moneyExactString')
  }
  if (amount <= 0n) return invalid('amount', 'amountPositive')
  const amountText = minorText(amount, scale)
  const zero = minorText(0n, scale)
  const date = instantText(args.date ?? existing?.date ?? today())
  let accountingDate: string
  let documentDate: string
  try {
    accountingDate = accountingDateText(args.accountingDate ?? existing?.accountingDate ?? date, timezone)
    documentDate = accountingDateText(args.documentDate ?? existing?.documentDate ?? accountingDate, timezone)
  } catch {
    return invalid('accountingDate', 'accountingDateInvalid')
  }
  const increasing = operation === 'issue'
  const line = (id: string, account: Row, debitSide: boolean, sequence: number): Row => ({
    id,
    moveId: args.id,
    name: `account.stored_value.${operation}`,
    accountId: account.id,
    partnerId: args.partnerId ?? null,
    productId: null,
    productUomId: null,
    quantity: '1',
    priceUnit: amountText,
    discount: '0',
    taxId: null,
    debit: debitSide ? amountText : zero,
    credit: debitSide ? zero : amountText,
    balance: debitSide ? amountText : minorText(-amount, scale),
    dateMaturity: null,
    displayType: null,
    reconciled: false,
    amountResidual: account.reconcile === true ? amountText : zero,
    sequence,
  })
  try {
    await ctx.tx(async (tx) => {
      await insertDraftMove(tx, {
        move: {
          id: args.id,
          name: String(args.id),
          ref: args.reference ?? null,
          date,
          accountingDate,
          documentDate,
          moveType: 'entry',
          state: 'draft',
          journalId: args.journalId,
          partnerId: args.partnerId ?? null,
          invoiceDate: null,
          invoiceDateDue: null,
          paymentTermId: null,
          paymentState: 'paid',
          currency,
          amountUntaxed: amountText,
          amountTax: zero,
          amountTotal: amountText,
          postedAt: null,
          revision: 0,
        },
        lines: [
          line(`${String(args.id)}:counterpart`, counterpart, increasing, 10),
          line(`${String(args.id)}:liability`, liability, !increasing, 20),
        ],
      })
    })
  } catch (error) {
    return refused('id', error)
  }
  const posted = await postMoveById(ctx, args.id)
  if (posted.ok !== true) return posted
  return { ok: true, id: args.id, moveId: args.id, operation, amount: amountText }
}

export const postStoredValueBalanceFunction = defineFn({
  input: {
    id: 'id',
    operation: 'text',
    journalId: 'id',
    liabilityAccountId: 'id',
    counterpartAccountId: 'id',
    amount: 'decimal',
    partnerId: 'id?',
    date: 'datetime?',
    accountingDate: 'date?',
    documentDate: 'date?',
    reference: 'text?',
  },
  output: { ok: 'bool', id: 'id?', moveId: 'id?', operation: 'text?', amount: 'decimal?', errors: 'json?' },
  effects: [
    'read:account.Journal',
    'read:account.Account',
    'read:account.Move',
    'read:account.MoveLine',
    'read:account.PeriodPolicy',
    'read:company.Company',
    'read:partner.Partner',
    'write:account.Journal',
    'write:account.Move',
    'write:account.MoveLine',
    'write:account.PeriodPolicy',
    'write:account.AuditEvent',
  ],
  idempotent: true,
  agent: true,
  handler: postStoredValueBalanceHandler,
})

export async function registerPaymentHandler(ctx: Ctx, args: Row): Promise<unknown> {
  if (!PAYMENT_TYPES.includes(args.paymentType as never))
    return invalid('paymentType', 'paymentTypeUnsupported')
  if (!PARTNER_TYPES.includes(args.partnerType as never))
    return invalid('partnerType', 'partnerTypeUnsupported')
  const settlementKind = String(args.settlementKind ?? 'liquidity')
  if (!PAYMENT_SETTLEMENT_KINDS.includes(settlementKind as never))
    return invalid('settlementKind', 'paymentSettlementKindUnsupported')
  const { currency, scale, timezone } = await ledgerOf(ctx)
  let amount: bigint
  try {
    amount = moneyMinor(args.amount, scale)
  } catch {
    return invalid('amount', 'moneyExactString')
  }
  if (amount <= 0n) return invalid('amount', 'amountPositive')
  const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
  if (!journal?.defaultAccountId) return invalid('journalId', 'journalLiquidityMissing')
  const settlementAccount = await accountOf(ctx, journal.defaultAccountId)
  if (settlementKind === 'liquidity') {
    if (!['bank', 'cash'].includes(String(journal.type))) return invalid('journalId', 'journalNotLiquidity')
  } else {
    if (String(journal.type) !== 'general') return invalid('journalId', 'journalNotStoredValue')
    if (!String(settlementAccount?.accountType ?? '').startsWith('liability'))
      return invalid('journalId', 'journalStoredValueAccount')
  }
  const destination = await accountOf(ctx, args.destinationAccountId)
  if (!destination) return invalid('destinationAccountId', 'destinationMissing')
  const forCustomer = args.partnerType === 'customer'
  if (destination.accountType !== (forCustomer ? 'asset_receivable' : 'liability_payable'))
    return invalid(
      'destinationAccountId',
      forCustomer ? 'destinationMustBeReceivable' : 'destinationMustBePayable',
    )
  const existing = (await ctx.db.select('account.Payment', { id: args.id }))[0]
  const date = instantText(args.date ?? existing?.date ?? today())
  let accountingDate: string
  let documentDate: string
  try {
    accountingDate = accountingDateText(args.accountingDate ?? existing?.accountingDate ?? date, timezone)
    documentDate = accountingDateText(args.documentDate ?? existing?.documentDate ?? accountingDate, timezone)
  } catch {
    return invalid('accountingDate', 'accountingDateInvalid')
  }
  if (
    existing &&
    (moneyMinor(existing.amount, scale) !== amount ||
      String(existing.name) !== String(args.name) ||
      String(existing.paymentType) !== String(args.paymentType) ||
      String(existing.partnerType) !== String(args.partnerType) ||
      String(existing.partnerId ?? '') !== String(args.partnerId ?? '') ||
      String(existing.journalId) !== String(args.journalId) ||
      String(existing.destinationAccountId) !== String(args.destinationAccountId) ||
      String(existing.reconcileLineId ?? '') !== String(args.reconcileLineId ?? '') ||
      String(existing.invoiceId ?? '') !== String(args.invoiceId ?? '') ||
      instantText(existing.date) !== date ||
      moveAccountingDate(existing, timezone) !== accountingDate ||
      String(existing.documentDate ?? accountingDate) !== documentDate ||
      String(existing.memo ?? '') !== String(args.memo ?? '') ||
      String(existing.paymentReference ?? '') !== String(args.paymentReference ?? '') ||
      String(existing.settlementKind ?? 'liquidity') !== settlementKind ||
      String(existing.currency) !== currency)
  )
    return invalid('id', 'paymentIdReused')
  if (existing?.state === 'reversed') return { ok: true, id: args.id, moveId: existing.moveId }
  if (
    existing &&
    args.reconcileLineId &&
    (
      await ctx.db.select('account.PartialReconcile', {
        id: `${String(args.id)}:reconcile:${String(args.reconcileLineId)}`,
      })
    )[0]
  ) {
    const posted = await postMoveById(ctx, existing.moveId)
    if (posted.ok !== true) return posted
    if (existing.state !== 'paid') await ctx.db.update('account.Payment', { id: args.id }, { state: 'paid' })
    return { ok: true, id: args.id, moveId: existing.moveId }
  }
  let reconcileTarget: Row | null = null
  if (args.reconcileLineId) {
    reconcileTarget = (await ctx.db.select('account.MoveLine', { id: args.reconcileLineId }))[0] ?? null
    if (!reconcileTarget) return invalid('reconcileLineId', 'openItemMissing')
    if (reconcileTarget.accountId !== args.destinationAccountId)
      return invalid('reconcileLineId', 'openItemAccountMismatch')
    const expectedDebit = args.paymentType === 'inbound'
    const targetBalance = moneyMinor(reconcileTarget.balance, scale)
    if ((expectedDebit && targetBalance <= 0n) || (!expectedDebit && targetBalance >= 0n))
      return invalid('reconcileLineId', 'openItemDirection')
    if (amount > moneyMinor(reconcileTarget.amountResidual, scale))
      return invalid('amount', 'amountExceedsOpenItem')
  }
  const reconcilePayment = async (paymentMoveId: string) => {
    if (!reconcileTarget) return null
    const counterpartId = `${paymentMoveId}:counterpart`
    const result = await reconcileFunction.handler(ctx, {
      id: `${String(args.id)}:reconcile:${String(reconcileTarget.id)}`,
      debitMoveId: args.paymentType === 'inbound' ? reconcileTarget.id : counterpartId,
      creditMoveId: args.paymentType === 'inbound' ? counterpartId : reconcileTarget.id,
      amount: minorText(amount, scale),
      date,
    })
    return (result as Row).ok === true ? null : result
  }
  if (existing) {
    // A retry of the same call is a success. A different payment under an id
    // that is already taken is not: the stored move is left as it was, and
    // reconciling it for a newly supplied amount would settle an open item
    // against money the ledger never recorded.
    const posted = await postMoveById(ctx, existing.moveId)
    if (posted.ok !== true) return posted
    if (existing.state !== 'paid') await ctx.db.update('account.Payment', { id: args.id }, { state: 'paid' })
    const failed = await reconcilePayment(String(existing.moveId))
    return failed ?? { ok: true, id: args.id, moveId: existing.moveId }
  }
  const moveId = `${String(args.id)}:move`,
    inbound = args.paymentType === 'inbound'
  try {
    await ctx.tx(async (tx) => {
      if (args.invoiceId) {
        const invoice = (await tx.db.select('account.Move', { id: args.invoiceId }))[0]
        if (!invoice) throw new Refusal('moveMissing')
        if (!(await claimMoveRevision(tx, invoice, args.expectedRevision)))
          throw new Refusal('moveConcurrent')
      }
      const paymentMove: Row = {
        id: moveId,
        name: moveId,
        ref: args.paymentReference ?? args.memo ?? null,
        date,
        accountingDate,
        documentDate,
        moveType: 'entry',
        state: 'draft',
        journalId: args.journalId,
        partnerId: args.partnerId ?? null,
        invoiceDate: null,
        invoiceDateDue: null,
        paymentTermId: null,
        paymentState: 'paid',
        currency,
        amountUntaxed: minorText(amount, scale),
        amountTax: minorText(0n, scale),
        amountTotal: minorText(amount, scale),
        moneyPolicyVersion: MONEY_POLICY_VERSION,
        postedAt: null,
        revision: 0,
      }
      const line = (id: string, accountId: unknown, debitSide: boolean, reconcilable: boolean): Row => ({
        id,
        moveId,
        name: args.memo ?? args.name,
        accountId,
        partnerId: args.partnerId ?? null,
        productId: null,
        productUomId: null,
        quantity: '1',
        priceUnit: minorText(amount, scale),
        discount: '0',
        taxId: null,
        debit: minorText(debitSide ? amount : 0n, scale),
        credit: minorText(debitSide ? 0n : amount, scale),
        balance: minorText(debitSide ? amount : -amount, scale),
        dateMaturity: null,
        displayType: null,
        reconciled: false,
        amountResidual: minorText(reconcilable ? amount : 0n, scale),
        sequence: debitSide ? 10 : 20,
      })
      await insertDraftMove(tx, {
        move: paymentMove,
        lines: [
          line(`${moveId}:liquidity`, journal.defaultAccountId, inbound, false),
          line(`${moveId}:counterpart`, args.destinationAccountId, !inbound, true),
        ],
      })
      const paymentRow: Row = {
        id: args.id,
        name: args.name,
        paymentType: args.paymentType,
        partnerType: args.partnerType,
        partnerId: args.partnerId ?? null,
        journalId: args.journalId,
        destinationAccountId: args.destinationAccountId,
        amount: minorText(amount, scale),
        date,
        accountingDate,
        documentDate,
        memo: args.memo ?? null,
        paymentReference: args.paymentReference ?? null,
        settlementKind,
        state: 'in_process',
        currency,
        moneyPolicyVersion: MONEY_POLICY_VERSION,
        moveId,
        reconcileLineId: args.reconcileLineId ?? null,
        invoiceId: args.invoiceId ?? null,
      }
      const inserted = await tx.db.insertIfAbsent('account.Payment', paymentRow)
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const held = (await tx.db.select('account.Payment', { id: args.id }))[0]
        if (
          !held ||
          !rowMatches(held, paymentRow, [
            'name',
            'paymentType',
            'partnerType',
            'partnerId',
            'journalId',
            'destinationAccountId',
            'amount',
            'date',
            'accountingDate',
            'documentDate',
            'memo',
            'paymentReference',
            'settlementKind',
            'currency',
            'moneyPolicyVersion',
            'moveId',
            'reconcileLineId',
            'invoiceId',
          ])
        )
          throw new Refusal('paymentIdReused')
      }
    })
  } catch (error) {
    if (error instanceof Refusal && error.code === 'moveConcurrent') {
      const settled = (await ctx.db.select('account.Payment', { id: args.id }))[0]
      if (settled) return (await registerPaymentFunction.handler(ctx, args)) as Record<string, unknown>
    }
    return refused('expectedRevision', error)
  }
  const posted = await postMoveById(ctx, moveId)
  if (posted.ok !== true) return posted
  await ctx.db.update('account.Payment', { id: args.id }, { state: 'paid' })
  const failed = await reconcilePayment(moveId)
  if (failed) return failed
  return { ok: true, id: args.id, moveId }
}

export const registerPaymentFunction = defineFn({
  input: {
    id: 'id',
    name: 'text',
    paymentType: 'text',
    partnerType: 'text',
    partnerId: 'id?',
    journalId: 'id',
    destinationAccountId: 'id',
    amount: 'decimal',
    date: 'datetime?',
    accountingDate: 'date?',
    documentDate: 'date?',
    memo: 'text?',
    paymentReference: 'text?',
    settlementKind: 'text?',
    reconcileLineId: 'id?',
    invoiceId: 'id?',
    expectedRevision: 'int?',
  },
  output: { ok: 'bool', id: 'id?', moveId: 'id?', errors: 'json?' },
  effects: [
    'read:account.Payment',
    'read:account.Journal',
    'read:account.Account',
    'read:account.Move',
    'read:account.MoveLine',
    'read:account.PartialReconcile',
    'read:account.PeriodPolicy',
    'read:company.Company',
    'write:account.Payment',
    'write:account.Journal',
    'write:account.Move',
    'write:account.MoveLine',
    'write:account.PartialReconcile',
    'write:account.PeriodPolicy',
    'write:account.AuditEvent',
  ],
  idempotent: true,
  agent: true,
  handler: registerPaymentHandler,
})

export async function registerInvoicePaymentHandler(ctx: Ctx, args: Row) {
  const invoice = (await ctx.db.select('account.Move', { id: args.invoiceId }))[0]
  if (!invoice) return invalid('invoiceId', 'moveMissing')
  if (invoice.moveType !== 'out_invoice') return invalid('invoiceId', 'invoicePaymentType')
  if (invoice.state !== 'posted') return invalid('state', 'invoicePaymentState')

  const existing = (await ctx.db.select('account.Payment', { id: args.id }))[0]
  if (existing && String(existing.invoiceId ?? '') !== String(args.invoiceId))
    return invalid('id', 'paymentIdReused')

  const { scale } = await ledgerOf(ctx)
  const accounts = await accountsById(ctx)
  const receivables = (await ctx.db.select('account.MoveLine', { moveId: args.invoiceId }))
    .filter(
      (line) =>
        accounts.get(String(line.accountId))?.accountType === 'asset_receivable' &&
        moneyMinor(line.amountResidual, scale) > 0n,
    )
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  if (!receivables.length) {
    if (existing) return { ok: true, id: args.id, moveId: existing.moveId, amount: String(existing.amount) }
    return invalid('invoiceId', 'invoicePaymentResidual')
  }
  const destinationIds = [...new Set(receivables.map((line) => String(line.accountId)))]
  if (destinationIds.length !== 1) return invalid('invoiceId', 'invoicePaymentAccounts')
  const amount = existing
    ? moneyMinor(existing.amount, scale)
    : sumMoneyMinor(
        receivables.map((line) => line.amountResidual),
        scale,
      )

  const registered = (await registerPaymentFunction.handler(ctx, {
    id: args.id,
    name: `Payment ${String(invoice.name)}`,
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: invoice.partnerId,
    journalId: args.journalId,
    destinationAccountId: destinationIds[0],
    amount: minorText(amount, scale),
    date: args.date ?? today(),
    ...(args.accountingDate ? { accountingDate: args.accountingDate } : {}),
    ...(args.documentDate ? { documentDate: args.documentDate } : {}),
    memo: String(invoice.name),
    paymentReference: String(invoice.name),
    invoiceId: args.invoiceId,
    expectedRevision: args.expectedRevision,
  })) as Row
  if (registered.ok !== true) return registered

  const counterpartId = `${String(registered.moveId)}:counterpart`
  for (const line of receivables) {
    const current = (await ctx.db.select('account.MoveLine', { id: line.id }))[0]
    const residual = moneyMinor(current?.amountResidual ?? '0', scale)
    if (residual <= 0n) continue
    const reconciled = (await reconcileFunction.handler(ctx, {
      id: `${String(args.id)}:invoice:${String(line.id)}`,
      debitMoveId: line.id,
      creditMoveId: counterpartId,
      amount: minorText(residual, scale),
      date: args.date ?? today(),
    })) as Row
    if (reconciled.ok !== true) return reconciled
  }
  return {
    ok: true,
    id: args.id,
    moveId: registered.moveId,
    amount: minorText(amount, scale),
  }
}

export const registerInvoicePaymentFunction = defineFn({
  input: {
    id: 'id',
    invoiceId: 'id',
    journalId: 'id',
    expectedRevision: 'int?',
    date: 'datetime?',
    accountingDate: 'date?',
    documentDate: 'date?',
  },
  output: { ok: 'bool', id: 'id?', moveId: 'id?', amount: 'decimal?', errors: 'json?' },
  effects: [
    'read:account.Payment',
    'read:account.Journal',
    'read:account.Account',
    'read:account.Move',
    'read:account.MoveLine',
    'read:account.PartialReconcile',
    'read:account.PeriodPolicy',
    'read:company.Company',
    'write:account.Payment',
    'write:account.Journal',
    'write:account.Move',
    'write:account.MoveLine',
    'write:account.PartialReconcile',
    'write:account.PeriodPolicy',
    'write:account.AuditEvent',
  ],
  idempotent: true,
  agent: true,
  handler: registerInvoicePaymentHandler,
})

export async function reconcileHandler(ctx: Ctx, args: Row) {
  const { scale } = await ledgerOf(ctx)
  let amount: bigint
  try {
    amount = moneyMinor(args.amount, scale)
  } catch {
    return invalid('amount', 'moneyExactString')
  }
  if (amount <= 0n) return invalid('amount', 'reconcileAmountPositive')
  if ((await ctx.db.select('account.PartialReconcile', { id: args.id }))[0]) return { ok: true, id: args.id }
  let moveIds: [unknown, unknown] | null = null
  try {
    moveIds = await ctx.tx(async (tx) => {
      const debit = (await tx.db.select('account.MoveLine', { id: args.debitMoveId }))[0]
      const credit = (await tx.db.select('account.MoveLine', { id: args.creditMoveId }))[0]
      if (
        !debit ||
        !credit ||
        moneyMinor(debit.balance, scale) <= 0n ||
        moneyMinor(credit.balance, scale) >= 0n
      )
        throw new Refusal('reconcileSides')
      if (debit.accountId !== credit.accountId) throw new Refusal('reconcileAccountMismatch')
      const [debitMove, creditMove] = await Promise.all([
        tx.db.select('account.Move', { id: debit.moveId }),
        tx.db.select('account.Move', { id: credit.moveId }),
      ])
      if (debitMove[0]?.state !== 'posted' || creditMove[0]?.state !== 'posted')
        throw new Refusal('reconcilePostedOnly')
      const account = await accountOf(tx, debit.accountId)
      if (!account?.reconcile) throw new Refusal('reconcileNotAllowed')
      const debitHeld = moneyMinor(debit.amountResidual, scale)
      const creditHeld = moneyMinor(credit.amountResidual, scale)
      if (amount > debitHeld || amount > creditHeld) throw new Refusal('reconcileAmountExceeds')
      const held = await tx.db.insertIfAbsent('account.PartialReconcile', {
        id: args.id,
        debitMoveId: args.debitMoveId,
        creditMoveId: args.creditMoveId,
        amount: minorText(amount, scale),
        date: args.date ?? today(),
        state: 'active',
        actorId: args.actorId ?? null,
        reason: args.reason ?? null,
        reversedAt: null,
        reversedBy: null,
        reversalReason: null,
      })
      if (!('dryRun' in held) && !held.inserted) return [debit.moveId, credit.moveId]
      const debitResidual = debitHeld - amount
      const creditResidual = creditHeld - amount
      const debitWrite = await tx.db.compareAndSet(
        'account.MoveLine',
        { id: debit.id },
        { amountResidual: debit.amountResidual },
        { amountResidual: minorText(debitResidual, scale), reconciled: debitResidual === 0n },
      )
      const creditWrite = await tx.db.compareAndSet(
        'account.MoveLine',
        { id: credit.id },
        { amountResidual: credit.amountResidual },
        { amountResidual: minorText(creditResidual, scale), reconciled: creditResidual === 0n },
      )
      if (
        (!('dryRun' in debitWrite) && !debitWrite.matched) ||
        (!('dryRun' in creditWrite) && !creditWrite.matched)
      )
        throw new Refusal('reconcileConcurrent')
      return [debit.moveId, credit.moveId]
    })
  } catch (error) {
    return refused('lines', error)
  }
  if (moveIds) {
    const accounts = await accountsById(ctx)
    await updatePaymentState(ctx, moveIds[0], accounts)
    await updatePaymentState(ctx, moveIds[1], accounts)
  }
  return { ok: true, id: args.id }
}

export const reconcileFunction = defineFn({
  input: {
    id: 'id',
    debitMoveId: 'id',
    creditMoveId: 'id',
    amount: 'decimal',
    date: 'datetime?',
    actorId: 'text?',
    reason: 'text?',
  },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: [
    'read:account.Move',
    'read:account.MoveLine',
    'read:account.Account',
    'read:account.PartialReconcile',
    'read:company.Company',
    'write:account.Move',
    'write:account.MoveLine',
    'write:account.PartialReconcile',
  ],
  idempotent: true,
  agent: true,
  handler: reconcileHandler,
})

export const paymentsFunctions: Record<string, FnSpec> = {
  listPayments: listPaymentsFunction,
  postStoredValueBalance: postStoredValueBalanceFunction,
  registerPayment: registerPaymentFunction,
  registerInvoicePayment: registerInvoicePaymentFunction,
  reconcile: reconcileFunction,
}
