import { lineInvoicePolicy } from '../configuration.ts'
import { invoiceQuantities } from '../invoice-quantities.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { insertDraftMove, quoteTaxLineForPosting, type TaxShare } from '../../account/functions.ts'
import {
  addDecimals,
  compareDecimals,
  minorText,
  moneyMinor,
  scaleOf,
  sumMoneyMinor,
} from '../../account/money.ts'
import { ours } from '../scope.ts'
import { ORDER_EVENT_EFFECTS, recordOrderEvent } from '../order-history.ts'
import { invalid, now, paymentTermDue, contextOf, refreshStatus, claimRevision } from './shared.ts'

export async function createInvoiceHandler(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.orderId }))[0]
  if (order?.state !== 'sale') return invalid('orderId', 'only a confirmed sales order can be invoiced')
  if (order.invoiceAuthority != null && order.invoiceAuthority !== 'local')
    return invalid('invoiceAuthority', 'invoicing is disabled for this order')
  const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
  if (existing) return { ok: true, id: args.id, amountTotal: existing.amountTotal }
  const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0],
    revenue = (await ctx.db.select('account.Account', { id: args.revenueAccountId }))[0],
    receivable = (await ctx.db.select('account.Account', { id: args.receivableAccountId }))[0]
  if (journal?.type !== 'sale') return invalid('journalId', 'customer invoices require a sales journal')
  if (!revenue || !String(revenue.accountType).startsWith('income'))
    return invalid('revenueAccountId', 'an income account is required')
  if (receivable?.accountType !== 'asset_receivable')
    return invalid('receivableAccountId', 'a receivable account is required')
  const billable: Array<{
    line: Row
    quantity: string
    subtotal: string
    taxAmount: string
    shares: TaxShare[]
  }> = []
  // A soft error raised once the transaction has started writing has to
  // unwind it: `adapter.tx` commits on a normal return and rolls back only on
  // a throw, so returning the error would leave a half-written invoice behind.
  class Refused extends Error {
    result: Record<string, unknown>
    constructor(result: Record<string, unknown>) {
      super('refused')
      this.result = result
    }
  }
  const build = async (tx: Ctx) => {
    billable.length = 0
    for (const line of await ours(tx, 'sale.OrderLine', { orderId: args.orderId })) {
      if (line.displayType || line.comboBasePrice != null) continue
      const context = await contextOf(tx, line.productId),
        policy = lineInvoicePolicy(line, context?.template)
      const quantity = invoiceQuantities(line, policy).qtyToInvoice
      if (compareDecimals(quantity, '0') <= 0) continue
      const quote = await quoteTaxLineForPosting(tx, {
        productId: line.productId,
        taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : undefined),
        quantity,
        priceUnit: line.priceUnit,
        discount: line.discount,
        allowNegativePrice: line.lineKind === 'reward' || line.lineKind === 'discount',
        discountLine: line.lineKind === 'discount',
      })
      if (quote.ok !== true) throw new Refused(quote)
      for (const share of quote.shares) {
        const accountId = (quote.shares.length === 1 ? args.taxAccountId : null) ?? share.accountId
        if (!accountId || !(await tx.db.select('account.Account', { id: accountId }))[0])
          throw new Refused(invalid('taxAccountId', 'a valid tax account is required'))
      }
      billable.push({
        line,
        quantity,
        subtotal: quote.amountUntaxed,
        taxAmount: quote.amountTax,
        shares: quote.shares,
      })
    }
    if (!billable.some((item) => item.line.lineKind !== 'discount' && item.line.lineKind !== 'reward'))
      throw new Refused(invalid('lines', 'there is no ordered or delivered quantity left to invoice'))
  }
  const invoiceDate = String(args.invoiceDate ?? now())
  // The payment term decides when this is due; `account` computes it the same
  // way for the invoices it raises itself. Writing the invoice date into both
  // fields made every order-sourced invoice due on the day it was issued, so
  // ageing showed it overdue from the start.
  const due = await paymentTermDue(ctx, order.paymentTermId, new Date(invoiceDate))
  const scale = scaleOf(order.currency)
  let untaxed = 0n,
    tax = 0n,
    total = 0n
  try {
    await ctx.tx(async (tx) => {
      const current = (await ours(tx, 'sale.Order', { id: args.orderId }))[0]
      if (current?.state !== 'sale' || !(await claimRevision(tx, current)))
        throw new Refused(invalid('orderId', 'sales order changed'))
      await build(tx)
      untaxed = sumMoneyMinor(
        billable.map((item) => item.subtotal),
        scale,
      )
      tax = sumMoneyMinor(
        billable.map((item) => item.taxAmount),
        scale,
      )
      total = untaxed + tax
      if (total < 0n) throw new Refused(invalid('lines', 'sale.error.invoiceNegative'))
      const zero = minorText(0n, scale)
      const move: Row = {
        id: args.id,
        name: String(args.id),
        ref: order.name,
        date: invoiceDate,
        moveType: 'out_invoice',
        state: 'draft',
        journalId: args.journalId,
        partnerId: order.partnerId,
        invoiceDate,
        invoiceDateDue: due,
        paymentTermId: order.paymentTermId,
        paymentState: 'not_paid',
        currency: order.currency,
        amountUntaxed: minorText(untaxed, scale),
        amountTax: minorText(tax, scale),
        amountTotal: minorText(total, scale),
        postedAt: null,
        revision: 0,
      }
      const moveLines: Row[] = []
      let sequence = 10
      for (const item of billable) {
        const baseId = `${String(args.id)}:${String(item.line.id)}`
        const subtotalMinor = moneyMinor(item.subtotal, scale)
        const balance = -subtotalMinor
        moveLines.push({
          id: baseId,
          moveId: args.id,
          name: item.line.name,
          lineKind: item.line.lineKind ?? null,
          accountId: args.revenueAccountId,
          partnerId: order.partnerId,
          productId: item.line.productId,
          productUomId: item.line.productUomId,
          quantity: item.quantity,
          priceUnit: item.line.priceUnit,
          discount: item.line.discount,
          taxId: item.line.taxId,
          debit: minorText(balance > 0n ? balance : 0n, scale),
          credit: minorText(balance < 0n ? -balance : 0n, scale),
          balance: minorText(balance, scale),
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: zero,
          sequence,
          saleLineId: item.line.id,
        })
        sequence += 10
        for (const share of item.shares) {
          const amountMinor = moneyMinor(share.amount, scale)
          const amount = minorText(amountMinor, scale)
          if (amountMinor === 0n) continue
          const balance = -amountMinor
          const accountId = (item.shares.length === 1 ? args.taxAccountId : null) ?? share.accountId
          moveLines.push({
            id: `${baseId}:tax:${String(share.taxId)}`,
            moveId: args.id,
            name: share.name,
            accountId,
            partnerId: order.partnerId,
            productId: null,
            productUomId: null,
            quantity: '1',
            priceUnit: amount,
            discount: '0',
            taxId: share.taxId,
            debit: minorText(balance > 0n ? balance : 0n, scale),
            credit: minorText(balance < 0n ? -balance : 0n, scale),
            balance: minorText(balance, scale),
            dateMaturity: null,
            displayType: null,
            reconciled: false,
            amountResidual: zero,
            sequence: sequence++,
            saleLineId: item.line.id,
          })
        }
      }
      const totalText = minorText(total, scale)
      moveLines.push({
        id: `${String(args.id)}:counterpart`,
        moveId: args.id,
        name: order.name,
        accountId: args.receivableAccountId,
        partnerId: order.partnerId,
        productId: null,
        productUomId: null,
        quantity: '1',
        priceUnit: totalText,
        discount: '0',
        taxId: null,
        debit: totalText,
        credit: zero,
        balance: totalText,
        dateMaturity: due,
        displayType: null,
        reconciled: false,
        amountResidual: totalText,
        sequence: sequence + 10,
        saleLineId: null,
      })
      await insertDraftMove(tx, { move, lines: moveLines })
      for (const item of billable)
        await tx.db.update(
          'sale.OrderLine',
          { id: item.line.id },
          { qtyInvoiced: addDecimals(item.line.qtyInvoiced ?? '0', item.quantity) },
        )
      // Who raised the invoice is the accountant's question (D7); it is answered with the invoice.
      await recordOrderEvent(tx, args.orderId, {
        action: 'invoice',
        relatedId: args.id,
        key: `${String(args.orderId)}:invoice:${String(args.id)}`,
      })
    })
  } catch (error) {
    if (error instanceof Refused) return error.result
    throw error
  }
  await refreshStatus(ctx, args.orderId)
  return { ok: true, id: args.id, amountTotal: minorText(total, scale) }
}

export const invoicesFunctions: Record<string, FnSpec> = {
  createInvoice: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      journalId: 'id',
      revenueAccountId: 'id',
      receivableAccountId: 'id',
      taxAccountId: 'id?',
      invoiceDate: 'datetime?',
    },
    output: { ok: 'bool', id: 'id?', amountTotal: 'decimal?', errors: 'json?' },
    effects: [
      'read:sale.Order',
      'read:sale.OrderLine',
      'write:sale.Order',
      'write:sale.OrderLine',
      'read:product.Product',
      'read:product.Template',
      'read:account.Journal',
      'read:account.Account',
      'read:account.Tax',
      'read:account.ProductTax',
      // paymentTermDue walks the term's lines to work out when this falls due.
      'read:account.PaymentTermLine',
      'read:account.Move',
      'read:company.Company',
      'write:account.Move',
      'write:account.MoveLine',
      ...ORDER_EVENT_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: createInvoiceHandler,
  }),
}
