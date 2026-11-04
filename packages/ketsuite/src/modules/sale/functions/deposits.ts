import { defineFn, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { reconcileFunction, registerPaymentHandler } from '../../account/functions/payments.ts'
import { compareDecimals, minorText, moneyMinor, percentOfMinor, scaleOf } from '../../account/money.ts'
import { ours } from '../scope.ts'
import { authorityRefusal, externalOrder, invalid, now } from './shared.ts'

/**
 * Deposits (D9). A deposit, or an advance securing the contract, is not invoiced: for goods the
 * invoice is made when ownership passes, paid or not (Decree 123/2020, art. 9). So "collect a
 * deposit" records a customer receipt in Accounting against the receivable account, linked to the
 * order, and once the invoice is posted the receipt is set off against it.
 */
const counterpart = (moveId: unknown) => `${String(moveId)}:counterpart`

/** The order's deposits with what each still holds for an invoice. */
export async function depositsOf(ctx: Ctx, orderId: string): Promise<Row[]> {
  const links = await ours(ctx, 'sale.OrderDeposit', { orderId })
  if (!links.length) return []
  const P = ctx.table('account.Payment'),
    L = ctx.table('account.MoveLine'),
    J = ctx.table('account.Journal')
  const payments = await ctx.db.all(
    from(P).where(
      inArray(
        P.id,
        links.map((link) => String(link.paymentId)),
      ),
    ),
  )
  const lines = payments.length
    ? await ctx.db.all(
        from(L).where(
          inArray(
            L.id,
            payments.map((payment) => counterpart(payment.moveId)),
          ),
        ),
      )
    : []
  const journals = payments.length
    ? await ctx.db.all(
        from(J).where(inArray(J.id, [...new Set(payments.map((payment) => String(payment.journalId)))])),
      )
    : []
  const M = ctx.table('account.Move')
  const moves = payments.length
    ? await ctx.db.all(
        from(M).where(
          inArray(
            M.id,
            payments.map((payment) => String(payment.moveId)),
          ),
        ),
      )
    : []
  // The receipt goes by its posted entry's number in the journal's sequence.
  const moveName = new Map(moves.map((move) => [String(move.id), String(move.name)]))
  const residual = new Map(lines.map((line) => [String(line.id), String(line.amountResidual)]))
  const journalName = new Map(journals.map((journal) => [String(journal.id), String(journal.name)]))
  return payments
    .map((payment) => ({
      id: String(payment.id),
      name: moveName.get(String(payment.moveId)) ?? String(payment.name),
      moveId: String(payment.moveId),
      amount: String(payment.amount),
      // What the receipt's credit on the receivable has left to set off.
      unapplied: residual.get(counterpart(payment.moveId))?.replace(/^-/, '') ?? '0',
      date: payment.date,
      journalId: String(payment.journalId),
      journalName: journalName.get(String(payment.journalId)) ?? String(payment.journalId),
      receivableAccountId: String(payment.destinationAccountId),
      state: String(payment.state),
      currency: String(payment.currency),
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id))
}

/** What the order's deposits add up to, reversed receipts left out. */
const heldMinor = (deposits: Row[], scale: number) =>
  deposits
    .filter((deposit) => deposit.state !== 'reversed')
    .reduce((total, deposit) => total + moneyMinor(deposit.amount, scale), 0n)

/**
 * Collect a deposit on a sent quotation or a confirmed order: a percent of its total or an amount,
 * received into a bank or cash journal against a receivable account, never more than the order's
 * total less the deposits already taken. Retrying with the same id returns the same receipt.
 */
export async function collectDepositHandler(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.orderId }))[0]
  if (!order) return invalid('orderId', 'sale.error.deposit.missing')
  if (externalOrder(order)) return authorityRefusal()
  const linked = (await ours(ctx, 'sale.OrderDeposit', { paymentId: args.id }))[0]
  if (linked && String(linked.orderId) !== String(order.id)) return invalid('id', 'sale.error.deposit.reused')
  if (!linked && !['sent', 'sale'].includes(String(order.state)))
    return invalid('orderId', 'sale.error.deposit.state')
  const scale = scaleOf(order.currency)
  const total = moneyMinor(order.amountTotal ?? '0', scale)
  const byPercent = args.percent != null && args.percent !== ''
  const byAmount = args.amount != null && args.amount !== ''
  if (byPercent === byAmount) return invalid('amount', 'sale.error.deposit.amountOrPercent')
  let amount: bigint
  try {
    if (byPercent && (compareDecimals(args.percent, '0') <= 0 || compareDecimals(args.percent, '100') > 0))
      return invalid('percent', 'sale.error.deposit.percent')
    amount = byPercent ? percentOfMinor(total, args.percent) : moneyMinor(args.amount, scale)
  } catch {
    return invalid(byPercent ? 'percent' : 'amount', 'sale.error.deposit.amount')
  }
  if (amount <= 0n) return invalid(byPercent ? 'percent' : 'amount', 'sale.error.deposit.amount')
  if (!linked) {
    const held = heldMinor(await depositsOf(ctx, String(order.id)), scale)
    if (held + amount > total) return invalid(byPercent ? 'percent' : 'amount', 'sale.error.deposit.exceeds')
  }
  const result = (await registerPaymentHandler(ctx, {
    id: args.id,
    name: String(args.id),
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: order.partnerId,
    journalId: args.journalId,
    destinationAccountId: args.receivableAccountId,
    amount: minorText(amount, scale),
    ...(args.date ? { date: args.date } : {}),
    memo: args.memo ?? null,
    paymentReference: order.name,
  })) as Row
  if (result.ok !== true) return result
  if (!linked)
    await ctx.db.insert('sale.OrderDeposit', {
      id: String(args.id),
      orderId: order.id,
      paymentId: args.id,
      createdAt: now(),
    })
  return { ok: true, id: String(args.id), amount: minorText(amount, scale) }
}

/**
 * Set a deposit off against a posted invoice of the same order, for as much as both still hold.
 * Retrying after it was applied changes nothing.
 */
export async function applyDepositHandler(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.orderId }))[0]
  if (!order) return invalid('orderId', 'sale.error.deposit.missing')
  if (externalOrder(order)) return authorityRefusal()
  const link = (await ours(ctx, 'sale.OrderDeposit', { orderId: order.id, paymentId: args.paymentId }))[0]
  const payment = link ? (await ctx.db.select('account.Payment', { id: args.paymentId }))[0] : undefined
  if (!payment) return invalid('paymentId', 'sale.error.deposit.missing')
  const id = `${String(args.paymentId)}:apply:${String(args.invoiceId)}`
  if ((await ctx.db.select('account.PartialReconcile', { id }))[0]) return { ok: true, id }
  const invoice = (await ctx.db.select('account.Move', { id: args.invoiceId }))[0]
  // The invoice must be this order's: one of its lines bills a line of the order.
  const orderLines = await ours(ctx, 'sale.OrderLine', { orderId: order.id })
  const L = ctx.table('account.MoveLine')
  const billed =
    invoice && orderLines.length
      ? await ctx.db.all(
          from(L).where(
            inArray(
              L.saleLineId,
              orderLines.map((line) => String(line.id)),
            ),
          ),
        )
      : []
  if (!invoice || invoice.moveType !== 'out_invoice' || !billed.some((line) => line.moveId === invoice.id))
    return invalid('invoiceId', 'sale.error.deposit.invoice')
  if (invoice.state !== 'posted') return invalid('invoiceId', 'sale.error.deposit.invoicePosted')
  const [debit] = await ctx.db.select('account.MoveLine', { id: counterpart(invoice.id) })
  const [credit] = await ctx.db.select('account.MoveLine', { id: counterpart(payment.moveId) })
  if (!debit || !credit) return invalid('invoiceId', 'sale.error.deposit.invoice')
  if (debit.accountId !== credit.accountId) return invalid('invoiceId', 'sale.error.deposit.account')
  const scale = scaleOf(invoice.currency)
  const owed = moneyMinor(debit.amountResidual, scale)
  const residual = moneyMinor(credit.amountResidual, scale)
  const held = residual < 0n ? -residual : residual
  const amount = owed < held ? owed : held
  if (amount <= 0n) return invalid('invoiceId', 'sale.error.deposit.nothing')
  const result = (await reconcileFunction.handler(ctx, {
    id,
    debitMoveId: debit.id,
    creditMoveId: credit.id,
    amount: minorText(amount, scale),
    date: now(),
  })) as Row
  return result.ok === true ? { ok: true, id, amount: minorText(amount, scale) } : result
}

const PAYMENT_EFFECTS = [
  'read:sale.Order',
  'read:sale.OrderDeposit',
  'read:account.Payment',
  'read:account.Journal',
  'read:account.Account',
  'read:account.Move',
  'read:account.MoveLine',
  'read:account.PartialReconcile',
  'write:account.Move',
  'write:account.MoveLine',
  'write:account.PartialReconcile',
] as const

export const depositsFunctions: Record<string, FnSpec> = {
  collectDeposit: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      amount: 'decimal?',
      percent: 'decimal?',
      journalId: 'id',
      receivableAccountId: 'id',
      date: 'datetime?',
      memo: 'text?',
    },
    output: { ok: 'bool', id: 'id?', amount: 'text?', errors: 'json?' },
    effects: [
      ...PAYMENT_EFFECTS,
      'read:account.PeriodPolicy',
      'read:company.Company',
      'write:account.Payment',
      'write:account.Journal',
      'write:account.PeriodPolicy',
      'write:account.AuditEvent',
      'write:sale.OrderDeposit',
    ],
    idempotent: true,
    agent: true,
    handler: collectDepositHandler,
  }),
  applyDeposit: defineFn({
    input: { orderId: 'id', paymentId: 'id', invoiceId: 'id' },
    output: { ok: 'bool', id: 'text?', amount: 'text?', errors: 'json?' },
    effects: [...PAYMENT_EFFECTS, 'read:sale.OrderLine', 'read:company.Company'],
    idempotent: true,
    agent: true,
    handler: applyDepositHandler,
  }),
}
