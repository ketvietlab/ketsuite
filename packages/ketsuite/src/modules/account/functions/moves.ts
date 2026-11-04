import { and, defineFn, eq, from, ilike, inArray, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { accountingFilterDateText, accountingDateText, moveAccountingDate } from '../date.ts'
import {
  compareDecimals,
  canonicalDecimalText,
  minorText,
  MONEY_POLICY_VERSION,
  moneyMinor,
  scaleOf,
} from '../money.ts'
import { MOVE_TYPES } from '../vocabulary.ts'
import {
  invalid,
  Refusal,
  refused,
  rowMatches,
  instantText,
  MOVE_CREATE_FIELDS,
  MOVE_LINE_CREATE_FIELDS,
  claimMoveRevision,
  today,
  wildcard,
} from '../validation.ts'
import { ledgerOf, accountOf, accountsById } from '../ledger.ts'
import { slice, moveTypeList, paymentStateList } from '../querying.ts'
import { dueDate } from '../payment-terms.ts'

export async function listMovesHandler(ctx: Ctx, args: Row) {
  const M = ctx.table('account.Move')
  const where = [
    ...(args.moveType ? [eq(M.moveType, args.moveType)] : []),
    ...(moveTypeList(args.moveTypes).length ? [inArray(M.moveType, moveTypeList(args.moveTypes))] : []),
    ...(args.state ? [eq(M.state, args.state)] : []),
    ...(args.paymentState ? [eq(M.paymentState, args.paymentState)] : []),
    ...(paymentStateList(args.paymentStates).length
      ? [inArray(M.paymentState, paymentStateList(args.paymentStates))]
      : []),
    ...(args.partnerId ? [eq(M.partnerId, args.partnerId)] : []),
    ...(args.search
      ? [
          or(
            ilike(M.name, `%${wildcard(args.search)}%`, true),
            ilike(M.ref, `%${wildcard(args.search)}%`, true),
          ),
        ]
      : []),
  ]
  const { timezone } = await ledgerOf(ctx)
  const dateFrom = accountingFilterDateText(args.dateFrom)
  const dateTo = accountingFilterDateText(args.dateTo)
  const loaded = (await ctx.db.all(where.length ? from(M).where(and(...where)) : from(M))) as Row[]
  const rows = loaded
    .map((move): Row => ({ ...move, accountingDate: moveAccountingDate(move, timezone) }))
    .filter(
      (move) =>
        (!dateFrom || String(move.accountingDate) >= dateFrom) &&
        (!dateTo || String(move.accountingDate) <= dateTo),
    )
    .sort((left, right) => {
      const held =
        String(left.accountingDate).localeCompare(String(right.accountingDate)) ||
        String(left.id).localeCompare(String(right.id))
      return args.order === 'desc' ? -held : held
    })
  return slice(rows, args.limit, args.offset)
}

export const listMovesFunction = defineFn({
  input: {
    moveType: 'text?',
    moveTypes: 'json?',
    state: 'text?',
    paymentState: 'text?',
    paymentStates: 'json?',
    partnerId: 'id?',
    search: 'text?',
    dateFrom: 'date?',
    dateTo: 'date?',
    order: 'text?',
    limit: 'int?',
    offset: 'int?',
  },
  effects: ['read:account.Move', 'read:company.Company'],
  agent: true,
  handler: listMovesHandler,
})

export async function countMovesHandler(ctx: Ctx, args: Row) {
  const M = ctx.table('account.Move')
  const where = [
    ...(args.moveType ? [eq(M.moveType, args.moveType)] : []),
    ...(moveTypeList(args.moveTypes).length ? [inArray(M.moveType, moveTypeList(args.moveTypes))] : []),
    ...(args.state ? [eq(M.state, args.state)] : []),
    ...(args.paymentState ? [eq(M.paymentState, args.paymentState)] : []),
    ...(args.partnerId ? [eq(M.partnerId, args.partnerId)] : []),
  ]
  return { count: await ctx.db.count(where.length ? from(M).where(and(...where)) : from(M)) }
}

export const countMovesFunction = defineFn({
  input: {
    moveType: 'text?',
    moveTypes: 'json?',
    state: 'text?',
    paymentState: 'text?',
    partnerId: 'id?',
  },
  output: { count: 'int' },
  effects: ['read:account.Move'],
  agent: true,
  handler: countMovesHandler,
})

export async function listMoveResidualsHandler(ctx: Ctx, args: Row) {
  const { scale } = await ledgerOf(ctx)
  const ids = Array.isArray(args.moveIds) ? [...new Set(args.moveIds.map(String).filter(Boolean))] : []
  const totals = new Map(ids.map((id) => [id, 0n]))
  const L = ctx.table('account.MoveLine')
  for (let at = 0; at < ids.length; at += 400) {
    const chunk = ids.slice(at, at + 400)
    for (const line of await ctx.db.all(from(L).where(inArray(L.moveId, chunk)))) {
      const residual = moneyMinor(line.amountResidual, scale)
      if (residual > 0n) totals.set(String(line.moveId), (totals.get(String(line.moveId)) ?? 0n) + residual)
    }
  }
  return ids.map((moveId) => ({
    moveId,
    amountResidual: minorText(totals.get(moveId) ?? 0n, scale),
  }))
}

export const listMoveResidualsFunction = defineFn({
  input: { moveIds: 'json' },
  effects: ['read:account.MoveLine', 'read:company.Company'],
  agent: true,
  handler: listMoveResidualsHandler,
})

export async function listOpenItemsHandler(ctx: Ctx, args: Row) {
  const { scale, timezone } = await ledgerOf(ctx)
  const byId = await accountsById(ctx)
  const reconcilable = [...byId.values()].filter((row) => row.reconcile === true).map((row) => row.id)
  if (!reconcilable.length) return []
  const posted = new Map(
    (await ctx.db.select('account.Move', { state: 'posted' })).map((move) => [
      String(move.id),
      { ...move, accountingDate: moveAccountingDate(move, timezone) },
    ]),
  )
  if (!posted.size) return []
  const L = ctx.table('account.MoveLine')
  const lines = await ctx.db.all(
    from(L).where(
      and(
        eq(L.reconciled, false),
        inArray(L.accountId, args.accountId ? [args.accountId] : reconcilable),
        ...(args.partnerId ? [eq(L.partnerId, args.partnerId)] : []),
      ),
    ),
  )
  const rows = lines
    .filter((line) => posted.has(String(line.moveId)) && moneyMinor(line.amountResidual, scale) > 0n)
    .map((line): Row & { move: Row } => ({ ...line, move: posted.get(String(line.moveId))! }))
    .sort(
      (a, b) =>
        String(a.move.accountingDate).localeCompare(String(b.move.accountingDate)) ||
        String(a.id).localeCompare(String(b.id)),
    )
  return slice(rows, args.limit, args.offset)
}

export const listOpenItemsFunction = defineFn({
  input: { partnerId: 'id?', accountId: 'id?', limit: 'int?', offset: 'int?' },
  effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine', 'read:company.Company'],
  agent: true,
  handler: listOpenItemsHandler,
})

export async function getMoveHandler(ctx: Ctx, args: Row) {
  const move = (await ctx.db.select('account.Move', { id: args.id }))[0]
  return move ? { ...move, lines: await ctx.db.select('account.MoveLine', { moveId: args.id }) } : null
}

export const getMoveFunction = defineFn({
  input: { id: 'id' },
  effects: ['read:account.Move', 'read:account.MoveLine'],
  agent: true,
  handler: getMoveHandler,
})

export async function createMoveHandler(ctx: Ctx, args: Row) {
  const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
  if (!journal) return invalid('journalId', 'journalMissing')
  const moveType = String(args.moveType ?? 'entry')
  if (!MOVE_TYPES.includes(moveType as never)) return invalid('moveType', 'moveTypeUnsupported')
  if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
    return invalid('partnerId', 'partnerMissing')
  if (args.paymentTermId && !(await ctx.db.select('account.PaymentTerm', { id: args.paymentTermId }))[0])
    return invalid('paymentTermId', 'paymentTermMissing')
  const { currency, scale, timezone } = await ledgerOf(ctx)
  const date = instantText(args.date ?? today())
  const invoiceDate = args.invoiceDate == null ? null : instantText(args.invoiceDate)
  const accountingDate = accountingDateText(args.accountingDate ?? date, timezone)
  const documentDate = accountingDateText(
    args.documentDate ?? invoiceDate ?? args.accountingDate ?? date,
    timezone,
  )
  const invoiceDateDue =
    args.invoiceDateDue != null
      ? instantText(args.invoiceDateDue)
      : invoiceDate
        ? await dueDate(ctx, args.paymentTermId, new Date(invoiceDate))
        : null
  const row: Row = {
    id: args.id,
    name: String(args.id),
    ref: args.ref ?? null,
    date,
    accountingDate,
    documentDate,
    moveType,
    state: 'draft',
    journalId: args.journalId,
    partnerId: args.partnerId ?? null,
    invoiceDate,
    invoiceDateDue,
    paymentTermId: args.paymentTermId ?? null,
    paymentState: moveType === 'entry' ? 'paid' : 'not_paid',
    currency,
    amountUntaxed: minorText(0n, scale),
    amountTax: minorText(0n, scale),
    amountTotal: minorText(0n, scale),
    moneyPolicyVersion: MONEY_POLICY_VERSION,
    postedAt: null,
    revision: 0,
  }
  const inserted = await ctx.db.insertIfAbsent('account.Move', row)
  if ('dryRun' in inserted || inserted.inserted) return { ok: true, id: args.id }

  const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
  const fields = [
    ...MOVE_CREATE_FIELDS,
    ...(args.date == null ? [] : ['date']),
    ...(args.accountingDate == null && args.date == null ? [] : ['accountingDate']),
    ...(args.documentDate == null &&
    args.invoiceDate == null &&
    args.accountingDate == null &&
    args.date == null
      ? []
      : ['documentDate']),
  ]
  if (!existing || !rowMatches(existing, row, fields)) return invalid('id', 'moveIdReused')
  return { ok: true, id: args.id }
}

export const createMoveFunction = defineFn({
  input: {
    id: 'id',
    journalId: 'id',
    moveType: 'text?',
    date: 'datetime?',
    accountingDate: 'date?',
    documentDate: 'date?',
    ref: 'text?',
    partnerId: 'id?',
    invoiceDate: 'datetime?',
    invoiceDateDue: 'datetime?',
    paymentTermId: 'id?',
  },
  output: { ok: 'bool', id: 'id?', errors: 'json?' },
  effects: [
    'read:account.Journal',
    'read:account.Move',
    'read:account.PaymentTerm',
    'read:account.PaymentTermLine',
    'read:partner.Partner',
    'read:company.Company',
    'write:account.Move',
  ],
  idempotent: true,
  agent: true,
  handler: createMoveHandler,
})

export async function addMoveLineHandler(ctx: Ctx, args: Row) {
  const move = (await ctx.db.select('account.Move', { id: args.moveId }))[0]
  if (!move) return invalid('moveId', 'lineDraftOnly')
  const account = await accountOf(ctx, args.accountId)
  if (!account) return invalid('accountId', 'accountMissing')
  if (args.taxId && !(await ctx.db.select('account.Tax', { id: args.taxId }))[0])
    return invalid('taxId', 'taxMissing')
  const scale = scaleOf(move.currency)
  let debit: bigint
  let credit: bigint
  let quantity: string
  let priceUnit: string
  let discount: string
  try {
    debit = moneyMinor(args.debit ?? '0', scale)
    credit = moneyMinor(args.credit ?? '0', scale)
    quantity = canonicalDecimalText(args.quantity ?? '1')
    priceUnit = canonicalDecimalText(args.priceUnit ?? '0')
    discount = canonicalDecimalText(args.discount ?? '0')
  } catch {
    return invalid('debit', 'moneyExactString')
  }
  if (
    move.moveType !== 'entry' &&
    (args.lineKind === 'discount' ? compareDecimals(priceUnit, '0') > 0 : compareDecimals(priceUnit, '0') < 0)
  )
    return invalid('priceUnit', 'taxPriceInvalid')
  if (debit < 0n || credit < 0n || (debit > 0n && credit > 0n)) return invalid('debit', 'lineSideBoth')
  const row: Row = {
    id: args.id,
    moveId: args.moveId,
    lineKind: args.lineKind === 'discount' ? 'discount' : null,
    name: args.name,
    accountId: args.accountId,
    partnerId: args.partnerId ?? move.partnerId ?? null,
    productId: args.productId ?? null,
    productUomId: args.productUomId ?? null,
    quantity,
    priceUnit,
    discount,
    taxId: args.taxId ?? null,
    debit: minorText(debit, scale),
    credit: minorText(credit, scale),
    balance: minorText(debit - credit, scale),
    dateMaturity: args.dateMaturity == null ? null : instantText(args.dateMaturity),
    displayType: args.displayType ?? null,
    reconciled: false,
    amountResidual: account.reconcile
      ? minorText(debit >= credit ? debit - credit : credit - debit, scale)
      : minorText(0n, scale),
    sequence: args.sequence ?? 10,
  }
  const sameLine = (held: Row | undefined): boolean =>
    Boolean(held && rowMatches(held, row, MOVE_LINE_CREATE_FIELDS))

  try {
    return await ctx.tx(async (tx) => {
      const current = (await tx.db.select('account.Move', { id: args.moveId }))[0]
      if (!current) throw new Refusal('lineDraftOnly')

      // A retry remains successful after the move was posted. Only a genuinely
      // new line is subject to the draft-state gate.
      const existing = (await tx.db.select('account.MoveLine', { id: args.id }))[0]
      if (existing) {
        if (!sameLine(existing)) throw new Refusal('lineIdTaken')
        return { ok: true, id: args.id, existing: true }
      }
      if (current.state !== 'draft') throw new Refusal('lineDraftOnly')
      if (!(await claimMoveRevision(tx, current, args.expectedRevision))) throw new Refusal('moveConcurrent')

      const inserted = await tx.db.insertIfAbsent('account.MoveLine', row)
      if ('dryRun' in inserted || inserted.inserted) return { ok: true, id: args.id, existing: false }
      const held = (await tx.db.select('account.MoveLine', { id: args.id }))[0]
      if (!sameLine(held)) throw new Refusal('lineIdTaken')
      return { ok: true, id: args.id, existing: true }
    })
  } catch (error) {
    if (error instanceof Refusal && error.code === 'moveConcurrent') {
      const held = (await ctx.db.select('account.MoveLine', { id: args.id }))[0]
      if (sameLine(held)) return { ok: true, id: args.id, existing: true }
      const settled = (await ctx.db.select('account.Move', { id: args.moveId }))[0]
      if (settled?.state !== 'draft') return invalid('moveId', 'lineDraftOnly')
    }
    const field =
      error instanceof Refusal && error.code === 'lineIdTaken'
        ? 'id'
        : error instanceof Refusal && error.code === 'lineDraftOnly'
          ? 'moveId'
          : 'expectedRevision'
    return refused(field, error)
  }
}

export const addMoveLineFunction = defineFn({
  input: {
    id: 'id',
    moveId: 'id',
    lineKind: 'text?',
    name: 'text',
    accountId: 'id',
    partnerId: 'id?',
    productId: 'id?',
    productUomId: 'id?',
    quantity: 'decimal?',
    priceUnit: 'decimal?',
    discount: 'decimal?',
    taxId: 'id?',
    debit: 'decimal?',
    credit: 'decimal?',
    dateMaturity: 'datetime?',
    displayType: 'text?',
    sequence: 'int?',
    expectedRevision: 'int?',
  },
  output: { ok: 'bool', id: 'id?', existing: 'bool?', errors: 'json?' },
  effects: [
    'read:account.Move',
    'read:account.MoveLine',
    'read:account.Account',
    'read:account.Tax',
    'write:account.Move',
    'write:account.MoveLine',
  ],
  idempotent: true,
  agent: true,
  handler: addMoveLineHandler,
})

export const movesFunctions: Record<string, FnSpec> = {
  listMoves: listMovesFunction,
  countMoves: countMovesFunction,
  listMoveResiduals: listMoveResidualsFunction,
  listOpenItems: listOpenItemsFunction,
  getMove: getMoveFunction,
  createMove: createMoveFunction,
  addMoveLine: addMoveLineFunction,
}
