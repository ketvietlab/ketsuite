import type { Ctx, Row } from '@ketvietlab/ketjs'
import { quoteTaxLineForPosting } from '../account/functions.ts'
import {
  addDecimals,
  compareDecimals,
  minorText,
  moneyMinor,
  negateDecimalText,
  scaleOf,
} from '../account/money.ts'
import { n, quantityRound, quantityText, inUnit, productContext } from './functions/shared.ts'

export async function totals(ctx: Ctx, orderId: unknown) {
  const order = (await ctx.db.select('purchase.Order', { id: orderId }))[0]
  if (!order) return
  const scale = scaleOf(order.currency)
  let untaxed = 0n
  let tax = 0n
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId })) {
    const quote = await quoteTaxLineForPosting(ctx, {
      taxIds: line.taxId ? [line.taxId] : [],
      quantity: line.productQty,
      priceUnit: line.priceUnit,
      discount: line.discount,
      taxUse: 'purchase',
    })
    if (quote.ok !== true) throw new Error(String(quote.errors[0]?.message ?? 'invalid purchase tax'))
    untaxed += moneyMinor(quote.amountUntaxed, scale)
    tax += moneyMinor(quote.amountTax, scale)
  }
  await ctx.db.update(
    'purchase.Order',
    { id: orderId },
    {
      amountUntaxed: minorText(untaxed, scale),
      amountTax: minorText(tax, scale),
      amountTotal: minorText(untaxed + tax, scale),
      revision: n(order.revision) + 1,
    },
  )
}

/**
 * What a purchase line has actually been billed, read from the bills themselves.
 * The stored counter was incremented when a bill was drafted and never reversed,
 * so cancelling a bill left the order billed for ever and a second bill was
 * refused. Deriving it also settles two bills drafted at the same time: both
 * read the same rows inside their own transaction instead of a stale count.
 */
export async function billedQuantity(ctx: Ctx, lineId: unknown): Promise<string> {
  let billed = '0'
  for (const moveLine of await ctx.db.select('account.MoveLine', { purchaseLineId: lineId })) {
    if (!moveLine.productId) continue
    const move = (await ctx.db.select('account.Move', { id: moveLine.moveId }))[0]
    if (!move || move.state === 'cancel') continue
    billed = addDecimals(
      billed,
      move.moveType === 'in_refund' ? negateDecimalText(moveLine.quantity) : moveLine.quantity,
    )
  }
  return billed
}

export async function refreshBilled(ctx: Ctx, orderId: unknown): Promise<void> {
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId }))
    await ctx.db.update(
      'purchase.OrderLine',
      { id: line.id },
      { qtyInvoiced: await billedQuantity(ctx, line.id) },
    )
}

/**
 * What the warehouse has received, converted back into the unit the line was
 * ordered in. Stock is told to receive in the product's own unit, so the raw
 * move quantity is not comparable to `productQty`.
 */
export async function receivedQuantity(ctx: Ctx, line: Row): Promise<number> {
  const context = await productContext(ctx, line.productId)
  const stockUom = context?.template.uomId ?? line.productUomId
  let received = 0
  for (const move of await ctx.db.select('stock.Move', { purchaseLineId: line.id, state: 'done' }))
    received += n(move.quantity)
  const converted = await inUnit(ctx, received, stockUom, line.productUomId)
  return quantityRound(converted ?? received)
}

export async function refreshReceived(ctx: Ctx, orderId: unknown): Promise<void> {
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId }))
    await ctx.db.update(
      'purchase.OrderLine',
      { id: line.id },
      { qtyReceived: quantityText(await receivedQuantity(ctx, line)) },
    )
}

export async function invoiceStatus(ctx: Ctx, orderId: unknown): Promise<string> {
  const order = (await ctx.db.select('purchase.Order', { id: orderId }))[0]
  if (order?.state !== 'purchase') return 'no'
  let billable = '0'
  let invoiced = '0'
  for (const line of await ctx.db.select('purchase.OrderLine', { orderId })) {
    const context = await productContext(ctx, line.productId)
    const method = String(
      context?.template.purchaseMethod ?? (context?.template.type === 'service' ? 'purchase' : 'receive'),
    )
    billable = addDecimals(
      billable,
      method === 'purchase' ? line.productQty : String(await receivedQuantity(ctx, line)),
    )
    invoiced = addDecimals(invoiced, await billedQuantity(ctx, line.id))
  }
  return compareDecimals(billable, invoiced) > 0
    ? 'to invoice'
    : compareDecimals(invoiced, '0') > 0
      ? 'invoiced'
      : 'no'
}

export async function refreshInvoiceStatus(ctx: Ctx, orderId: unknown) {
  await ctx.db.update('purchase.Order', { id: orderId }, { invoiceStatus: await invoiceStatus(ctx, orderId) })
}
