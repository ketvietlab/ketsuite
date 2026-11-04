import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { insertDraftMove, quoteTaxLineForPosting, type TaxShare } from '../../account/functions.ts'
import {
  canonicalDecimalText,
  decimalSign,
  minorText,
  moneyMinor,
  negateDecimalText,
  scaleOf,
  subtractDecimals,
  sumMoneyMinor,
} from '../../account/money.ts'
import { invalid, now, productContext } from './shared.ts'
import { billedQuantity, refreshBilled, receivedQuantity, refreshInvoiceStatus } from '../order-amounts.ts'

export async function createVendorBillHandler(ctx: Ctx, args: Record<string, unknown>) {
  const order = (await ctx.db.select('purchase.Order', { id: args.orderId }))[0]
  if (order?.state !== 'purchase') return invalid('orderId', 'only a confirmed purchase order can be billed')
  const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
  if (existing) return { ok: true, id: args.id, amountTotal: existing.amountTotal }
  const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
  const expense = (await ctx.db.select('account.Account', { id: args.expenseAccountId }))[0]
  const payable = (await ctx.db.select('account.Account', { id: args.payableAccountId }))[0]
  if (journal?.type !== 'purchase') return invalid('journalId', 'vendor bills require a purchase journal')
  // With stock valuation posting, the receipt already put the goods on 156 against the receipt
  // account (151 on TT99), so the bill clears that account instead of expensing the goods again.
  const clearing = ctx.manifest.models['stock.AccountingSetting']
    ? (
        await ctx.db.select('stock.AccountingSetting', {
          id: `stock-accounting:${String(ctx.scope.company)}`,
        })
      )[0]
    : undefined
  const clears = Boolean(
    clearing?.journalId && expense && String(clearing.supplierAccountId) === String(expense.id),
  )
  if (!expense || (!clears && !String(expense.accountType).startsWith('expense')))
    return invalid('expenseAccountId', 'an expense account is required')
  if (payable?.accountType !== 'liability_payable')
    return invalid('payableAccountId', 'a payable account is required')
  type Billable = {
    line: Row
    quantity: string
    subtotal: string
    taxAmount: string
    shares: Array<TaxShare & { accountId: unknown }>
  }
  const collect = async (scoped: Ctx): Promise<Billable[] | ReturnType<typeof invalid>> => {
    const billable: Billable[] = []
    for (const line of await scoped.db.select('purchase.OrderLine', { orderId: args.orderId })) {
      const context = await productContext(scoped, line.productId)
      const method = String(
        context?.template.purchaseMethod ?? (context?.template.type === 'service' ? 'purchase' : 'receive'),
      )
      const basis =
        method === 'purchase'
          ? canonicalDecimalText(line.productQty)
          : canonicalDecimalText(String(await receivedQuantity(scoped, line)))
      // Read what the bills say rather than a counter, so two drafts prepared
      // at once cannot both bill the same quantity.
      const quantity = subtractDecimals(basis, await billedQuantity(scoped, line.id))
      if (decimalSign(quantity) <= 0) continue
      const quote = await quoteTaxLineForPosting(scoped, {
        taxIds: line.taxId ? [line.taxId] : [],
        quantity,
        priceUnit: line.priceUnit,
        discount: line.discount,
        taxUse: 'purchase',
      })
      if (quote.ok !== true) return invalid('taxId', String(quote.errors[0]?.message ?? 'invalid tax'))
      const shares: Array<TaxShare & { accountId: unknown }> = []
      for (const share of quote.shares) {
        if (moneyMinor(share.amount, quote.scale) === 0n) continue
        const accountId = (quote.shares.length === 1 ? args.taxAccountId : null) ?? share.accountId
        if (!accountId || !(await scoped.db.select('account.Account', { id: accountId }))[0])
          return invalid('taxAccountId', 'a valid tax account is required')
        shares.push({ ...share, accountId })
      }
      billable.push({
        line,
        quantity,
        subtotal: quote.amountUntaxed,
        taxAmount: quote.amountTax,
        shares,
      })
    }
    return billable
  }
  const preview = await collect(ctx)
  if (!Array.isArray(preview)) return preview
  if (!preview.length) return invalid('lines', 'there is no received or ordered quantity left to bill')
  const invoiceDate = String(args.invoiceDate ?? now())
  const scale = scaleOf(order.currency)
  let total = 0n
  const written = await ctx.tx(async (tx) => {
    const billable = await collect(tx)
    if (!Array.isArray(billable)) return billable
    if (!billable.length) return invalid('lines', 'there is no received or ordered quantity left to bill')
    const untaxed = sumMoneyMinor(
      billable.map((item) => item.subtotal),
      scale,
    )
    const tax = sumMoneyMinor(
      billable.map((item) => item.taxAmount),
      scale,
    )
    total = untaxed + tax
    const zero = minorText(0n, scale)
    // Accounting stamps its journal sequence when the bill is posted; until
    // then a draft showed its raw identifier, so the buyer's own screen
    // listed a UUID where a document number belongs. An order can be billed
    // more than once — after a cancellation, or in instalments — and a move
    // name is unique per journal, so the draft is numbered within its order.
    const draftNumber =
      (await tx.db.select('account.Move', { ref: order.name, journalId: args.journalId })).length + 1
    const move: Row = {
      id: args.id,
      name: `${String(order.name)}/${String(draftNumber)}`,
      ref: order.name,
      date: invoiceDate,
      moveType: 'in_invoice',
      state: 'draft',
      journalId: args.journalId,
      partnerId: order.partnerId,
      invoiceDate,
      invoiceDateDue: invoiceDate,
      paymentTermId: args.paymentTermId ?? null,
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
      const subtotal = minorText(moneyMinor(item.subtotal, scale), scale)
      moveLines.push({
        id: baseId,
        moveId: args.id,
        name: item.line.name,
        accountId: args.expenseAccountId,
        partnerId: order.partnerId,
        productId: item.line.productId,
        productUomId: item.line.productUomId,
        quantity: item.quantity,
        priceUnit: item.line.priceUnit,
        discount: item.line.discount,
        taxId: item.line.taxId,
        debit: subtotal,
        credit: zero,
        balance: subtotal,
        dateMaturity: null,
        displayType: null,
        reconciled: false,
        amountResidual: zero,
        sequence,
        purchaseLineId: item.line.id,
      })
      sequence += 10
      for (const share of item.shares) {
        const amount = minorText(moneyMinor(share.amount, scale), scale)
        moveLines.push({
          id: `${baseId}:tax:${String(share.taxId)}`,
          moveId: args.id,
          name: share.name,
          accountId: share.accountId,
          partnerId: order.partnerId,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: amount,
          discount: '0',
          taxId: share.taxId,
          debit: amount,
          credit: zero,
          balance: amount,
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: zero,
          sequence: sequence++,
          purchaseLineId: item.line.id,
        })
      }
    }
    const totalText = minorText(total, scale)
    moveLines.push({
      id: `${String(args.id)}:counterpart`,
      moveId: args.id,
      name: order.name,
      accountId: args.payableAccountId,
      partnerId: order.partnerId,
      productId: null,
      productUomId: null,
      quantity: '1',
      priceUnit: totalText,
      discount: '0',
      taxId: null,
      debit: zero,
      credit: totalText,
      balance: negateDecimalText(totalText),
      dateMaturity: invoiceDate,
      displayType: null,
      reconciled: false,
      amountResidual: totalText,
      sequence: sequence + 10,
      purchaseLineId: null,
    })
    await insertDraftMove(tx, { move, lines: moveLines })
    await refreshBilled(tx, args.orderId)
    await refreshInvoiceStatus(tx, args.orderId)
    return { ok: true }
  })
  if ((written as Row).ok !== true) return written
  return { ok: true, id: args.id, amountTotal: minorText(total, scale) }
}

export const billsFunctions: Record<string, FnSpec> = {
  createVendorBill: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      journalId: 'id',
      expenseAccountId: 'id',
      payableAccountId: 'id',
      taxAccountId: 'id?',
      invoiceDate: 'datetime?',
      paymentTermId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', amountTotal: 'decimal?', errors: 'json?' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.Order',
      'write:purchase.OrderLine',
      'read:product.Product',
      'read:product.Template',
      'read:account.Journal',
      'read:stock.AccountingSetting',
      'read:account.Account',
      'read:account.Tax',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'read:stock.Move',
      'read:uom.Unit',
      'write:account.Move',
      'write:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: createVendorBillHandler,
  }),
}
