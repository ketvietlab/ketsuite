// Netting sets what a partner owes the company against what the company owes that partner,
// without money changing hands. One posted entry carries a line per open document it settles,
// on that document's own receivable or payable account, and each line is reconciled against its
// document: the receivables close by credit, the payables by debit. The amount is spread over
// each side due first and never exceeds the smaller side.
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { accountingDateText } from './date.ts'
import { functions, insertDraftMove, ledgerOf, postMoveById } from './functions.ts'
import { accountsById } from './ledger.ts'
import { updatePaymentState } from './payment-state.ts'
import { minorText, moneyMinor } from './money.ts'

const issue = (field: string, code: string, message: string, params?: Record<string, unknown>) => ({
  field,
  code: `account.error.${code}`,
  message,
  params,
})
const failure = (...errors: ReturnType<typeof issue>[]) => ({ ok: false as const, errors })

type Side = 'receivable' | 'payable'
type OpenItem = {
  lineId: string
  moveId: string
  name: string
  accountId: string
  documentDate: string
  dueDate: string
  open: bigint
}
type Applied = OpenItem & { applied: bigint }

const SIDE_TYPES: Record<Side, string> = { receivable: 'asset_receivable', payable: 'liability_payable' }

const byDue = (a: OpenItem, b: OpenItem) =>
  a.dueDate.localeCompare(b.dueDate) ||
  a.documentDate.localeCompare(b.documentDate) ||
  a.name.localeCompare(b.name) ||
  a.lineId.localeCompare(b.lineId)

/**
 * The partner's open documents on one side, due first: receivables still owed to the company
 * (debit lines) or payables the company still owes (credit lines), on posted entries only.
 */
async function openItems(
  ctx: Ctx,
  partnerId: string | null,
  scale: number,
): Promise<Map<Side, Array<OpenItem & { partnerId: string }>>> {
  const accounts = new Map((await ctx.db.select('account.Account')).map((row) => [String(row.id), row]))
  const posted = new Map(
    (await ctx.db.select('account.Move', { state: 'posted' })).map((move) => [String(move.id), move]),
  )
  const sides = new Map<Side, Array<OpenItem & { partnerId: string }>>([
    ['receivable', []],
    ['payable', []],
  ])
  const lines = partnerId
    ? await ctx.db.select('account.MoveLine', { partnerId })
    : await ctx.db.select('account.MoveLine')
  for (const line of lines) {
    const move = posted.get(String(line.moveId))
    if (!move || !line.partnerId || line.reconciled === true) continue
    const open = moneyMinor(line.amountResidual, scale)
    if (open <= 0n) continue
    const type = String(accounts.get(String(line.accountId))?.accountType ?? '')
    const balance = moneyMinor(line.balance, scale)
    const side: Side | null =
      type === SIDE_TYPES.receivable && balance > 0n
        ? 'receivable'
        : type === SIDE_TYPES.payable && balance < 0n
          ? 'payable'
          : null
    if (!side) continue
    const documentDate = String(move.documentDate ?? move.accountingDate)
    sides.get(side)!.push({
      lineId: String(line.id),
      moveId: String(move.id),
      name: String(move.name ?? move.id),
      accountId: String(line.accountId),
      partnerId: String(line.partnerId),
      documentDate,
      dueDate: String(line.dateMaturity ?? move.invoiceDateDue ?? documentDate).slice(0, 10),
      open,
    })
  }
  for (const items of sides.values()) items.sort(byDue)
  return sides
}

const spread = (items: OpenItem[], amount: bigint): Applied[] => {
  let left = amount
  return items.map((item) => {
    const applied = left < item.open ? left : item.open
    left -= applied
    return { ...item, applied }
  })
}

const total = (items: OpenItem[]) => items.reduce((sum, item) => sum + item.open, 0n)

type Plan = {
  receivables: Applied[]
  payables: Applied[]
  receivable: bigint
  payable: bigint
  available: bigint
  amount: bigint
}

async function planNetting(ctx: Ctx, partnerId: string, asked: bigint | null, scale: number): Promise<Plan> {
  const sides = await openItems(ctx, partnerId, scale)
  const receivables = sides.get('receivable')!
  const payables = sides.get('payable')!
  const receivable = total(receivables)
  const payable = total(payables)
  const available = receivable < payable ? receivable : payable
  const amount = asked === null || asked > available ? available : asked
  return {
    receivables: spread(receivables, amount),
    payables: spread(payables, amount),
    receivable,
    payable,
    available,
    amount,
  }
}

const shown = (items: Applied[], scale: number) =>
  items.map((item) => ({
    lineId: item.lineId,
    moveId: item.moveId,
    name: item.name,
    accountId: item.accountId,
    documentDate: item.documentDate,
    dueDate: item.dueDate,
    open: minorText(item.open, scale),
    applied: minorText(item.applied, scale),
  }))

const parseAmount = (value: unknown, scale: number): bigint | null | 'invalid' => {
  const text = value == null ? '' : String(value).trim()
  if (!text) return null
  try {
    const amount = moneyMinor(text, scale)
    return amount > 0n ? amount : 'invalid'
  } catch {
    return 'invalid'
  }
}

/**
 * Reconcile each line of a posted netting entry with the open document it names: same account,
 * same partner, the other side. Running it again only matches what is still open.
 */
async function settleNetting(ctx: Ctx, id: string, partnerId: string, scale: number): Promise<Row> {
  const sides = await openItems(ctx, partnerId, scale)
  const reconcile = functions.reconcile!
  const lines = (await ctx.db.select('account.MoveLine', { moveId: id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  )
  for (const line of lines) {
    let left = moneyMinor(line.amountResidual, scale)
    if (left <= 0n || line.reconciled === true) continue
    const debit = moneyMinor(line.balance, scale) > 0n
    // A document paid in instalments has several open lines under one number, due first.
    const targets = sides
      .get(debit ? 'payable' : 'receivable')!
      .filter(
        (item) =>
          item.moveId !== id && item.accountId === String(line.accountId) && item.name === String(line.name),
      )
    for (const target of targets) {
      if (left === 0n) break
      const amount = left < target.open ? left : target.open
      const matched = (await reconcile.handler(ctx, {
        // One partial per pair of lines, so a retry never mistakes an old match for a new one.
        id: `${id}:partial:${String(line.id)}:${target.lineId}`,
        debitMoveId: debit ? line.id : target.lineId,
        creditMoveId: debit ? target.lineId : line.id,
        amount: minorText(amount, scale),
        actorId: ctx.actor ?? null,
        reason: 'netting',
      })) as Row
      if (matched.ok !== true) return matched
      target.open -= amount
      left -= amount
    }
    if (left > 0n)
      return failure(issue('lines', 'nettingDocumentClosed', 'a netted document is no longer open'))
  }
  return { ok: true }
}

export const nettingFunctions: Record<string, FnSpec> = {
  listNettablePartners: defineFn({
    input: {},
    effects: [
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Account',
      'read:partner.Partner',
      'read:company.Company',
    ],
    agent: true,
    handler: async (ctx) => {
      const { scale } = await ledgerOf(ctx)
      const sides = await openItems(ctx, null, scale)
      const owing = new Set(sides.get('receivable')!.map((item) => item.partnerId))
      const ids = [...new Set(sides.get('payable')!.map((item) => item.partnerId))].filter((id) =>
        owing.has(id),
      )
      const partners = new Map((await ctx.db.select('partner.Partner')).map((row) => [String(row.id), row]))
      return ids
        .map((id) => ({ id, name: String(partners.get(id)?.name ?? id) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
  }),
  previewNetting: defineFn({
    input: { partnerId: 'id', amount: 'decimal?' },
    effects: ['read:account.Move', 'read:account.MoveLine', 'read:account.Account', 'read:company.Company'],
    agent: true,
    handler: async (ctx, args) => {
      const { scale } = await ledgerOf(ctx)
      const asked = parseAmount(args.amount, scale)
      if (asked === 'invalid')
        return failure(issue('amount', 'nettingAmountPositive', 'netting amount must be positive'))
      const plan = await planNetting(ctx, String(args.partnerId), asked, scale)
      if (asked !== null && asked > plan.available)
        return failure(
          issue('amount', 'nettingExceeds', 'netting amount exceeds what both sides hold', {
            amount: minorText(plan.available, scale),
          }),
        )
      return {
        ok: true,
        receivables: shown(plan.receivables, scale),
        payables: shown(plan.payables, scale),
        receivable: minorText(plan.receivable, scale),
        payable: minorText(plan.payable, scale),
        available: minorText(plan.available, scale),
        amount: minorText(plan.amount, scale),
      }
    },
  }),
  postNetting: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      amount: 'decimal?',
      journalId: 'id?',
      accountingDate: 'date?',
      reference: 'text?',
    },
    output: { ok: 'bool', id: 'id?', amount: 'decimal?', errors: 'json?' },
    effects: [
      'read:account.Journal',
      'read:account.Account',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.PartialReconcile',
      'read:account.PeriodPolicy',
      'read:partner.Partner',
      'read:company.Company',
      'write:account.Journal',
      'write:account.Move',
      'write:account.MoveLine',
      'write:account.PartialReconcile',
      'write:account.PeriodPolicy',
      'write:account.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const id = String(args.id)
      const existing = (await ctx.db.select('account.Move', { id }))[0]
      if (existing?.state === 'posted') {
        // A retry after the entry posted finishes whatever matching did not happen.
        const { scale } = await ledgerOf(ctx)
        const matched = await settleNetting(ctx, id, String(existing.partnerId), scale)
        return matched.ok === true ? { ok: true, id, amount: existing.amountTotal } : matched
      }
      if (existing) return failure(issue('id', 'moveIdReused', 'netting id belongs to another entry'))
      const partnerId = String(args.partnerId)
      if (!(await ctx.db.select('partner.Partner', { id: partnerId }))[0])
        return failure(issue('partnerId', 'partnerMissing', 'partner does not exist'))
      const { currency, scale, timezone } = await ledgerOf(ctx)
      const asked = parseAmount(args.amount, scale)
      if (asked === 'invalid')
        return failure(issue('amount', 'nettingAmountPositive', 'netting amount must be positive'))
      const journal = args.journalId
        ? (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
        : (await ctx.db.select('account.Journal', { type: 'general' }))
            .filter((row) => row.active !== false)
            .sort((a, b) => String(a.code).localeCompare(String(b.code)))[0]
      if (!journal || String(journal.type) !== 'general')
        return failure(issue('journalId', 'nettingJournal', 'netting needs a general journal'))
      let accountingDate: string
      try {
        accountingDate = accountingDateText(args.accountingDate ?? new Date().toISOString(), timezone)
      } catch {
        return failure(issue('accountingDate', 'accountingDateInvalid', 'accounting date is invalid'))
      }
      const plan = await planNetting(ctx, partnerId, asked, scale)
      if (plan.available === 0n)
        return failure(issue('partnerId', 'nothingToNet', 'partner has nothing open on both sides'))
      if (asked !== null && asked > plan.available)
        return failure(
          issue('amount', 'nettingExceeds', 'netting amount exceeds what both sides hold', {
            amount: minorText(plan.available, scale),
          }),
        )
      const zero = minorText(0n, scale)
      const amountText = minorText(plan.amount, scale)
      // Each settled document gets its own line on its own account, so it can be reconciled
      // against exactly that document: credit closes a receivable, debit closes a payable.
      const settled = [
        ...plan.payables.filter((item) => item.applied > 0n).map((item) => ({ item, debit: true })),
        ...plan.receivables.filter((item) => item.applied > 0n).map((item) => ({ item, debit: false })),
      ]
      const lines: Row[] = settled.map(({ item, debit }, index) => {
        const value = minorText(item.applied, scale)
        return {
          id: `${id}:line:${index + 1}`,
          moveId: id,
          // The document it settles: the entry reads as what it closed, and a retry finds it again.
          name: item.name,
          accountId: item.accountId,
          partnerId,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: value,
          discount: '0',
          taxId: null,
          debit: debit ? value : zero,
          credit: debit ? zero : value,
          balance: debit ? value : minorText(-item.applied, scale),
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: value,
          sequence: (index + 1) * 10,
        }
      })
      try {
        await ctx.tx(async (tx) => {
          await insertDraftMove(tx, {
            move: {
              id,
              name: id,
              ref: args.reference ?? null,
              date: new Date().toISOString(),
              accountingDate,
              documentDate: accountingDate,
              moveType: 'entry',
              state: 'draft',
              journalId: journal.id,
              partnerId,
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
            lines,
          })
        })
      } catch (error) {
        return failure(issue('id', 'nettingRefused', error instanceof Error ? error.message : String(error)))
      }
      const posted = await postMoveById(ctx, id)
      if (posted.ok !== true) return posted
      const matched = await settleNetting(ctx, id, partnerId, scale)
      if (matched.ok !== true) return matched
      return { ok: true, id, amount: amountText }
    },
  }),
  reverseNetting: defineFn({
    input: { id: 'id', reversalId: 'id', accountingDate: 'date?', reason: 'text?' },
    output: { ok: 'bool', id: 'id?', reversalId: 'id?', errors: 'json?' },
    effects: [
      'read:account.Journal',
      'read:account.Account',
      'read:account.Move',
      'read:account.MoveLine',
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
    handler: async (ctx, args) => {
      const id = String(args.id)
      // Any entry can come through here: one that matched nothing of its own reverses as usual,
      // and reverseMove refuses what cannot be reversed.
      const { scale } = await ledgerOf(ctx)
      // Undo each match first, so the documents it settled are open again rather than the
      // reversal entry carrying what they owe.
      const touched = new Set<string>()
      const partials = (await ctx.db.select('account.PartialReconcile')).filter(
        (row) =>
          String(row.id).startsWith(`${id}:partial:`) && row.reason === 'netting' && row.state !== 'reversed',
      )
      for (const partial of partials) {
        const amount = moneyMinor(partial.amount, scale)
        for (const lineId of [partial.debitMoveId, partial.creditMoveId]) {
          const line = (await ctx.db.select('account.MoveLine', { id: lineId }))[0]
          if (!line) continue
          touched.add(String(line.moveId))
          await ctx.db.update(
            'account.MoveLine',
            { id: line.id },
            {
              amountResidual: minorText(moneyMinor(line.amountResidual, scale) + amount, scale),
              reconciled: false,
            },
          )
        }
        await ctx.db.update(
          'account.PartialReconcile',
          { id: partial.id },
          {
            state: 'reversed',
            reversedAt: new Date().toISOString(),
            reversedBy: ctx.actor ?? null,
            reversalReason: args.reason ?? null,
          },
        )
      }
      if (touched.size) {
        const accounts = await accountsById(ctx)
        for (const moveId of touched) if (moveId !== id) await updatePaymentState(ctx, moveId, accounts)
      }
      const reversed = (await functions.reverseMove!.handler(ctx, {
        id,
        reversalId: args.reversalId,
        ...(args.accountingDate ? { accountingDate: args.accountingDate } : {}),
        ...(args.reason ? { reason: args.reason } : {}),
      })) as Row
      if (reversed.ok !== true) return reversed
      return { ok: true, id, reversalId: args.reversalId }
    },
  }),
}
