import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { functions as stockFunctions } from '../../stock/functions.ts'
import { invalid, n, now, claimRevision, productContext } from './shared.ts'
import { refreshBilled, refreshReceived, invoiceStatus, refreshInvoiceStatus } from '../order-amounts.ts'

export async function receiveOrderReceiptHandler(ctx: Ctx, args: Record<string, unknown>) {
  const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  if (!order) return invalid('id', 'purchase order does not exist')
  if (args.expectedRevision !== undefined && n(order.revision) !== n(args.expectedRevision))
    return invalid('expectedRevision', 'purchase order changed')
  if (order.state !== 'purchase') return invalid('state', 'only a purchase order can be received')
  const lines = await ctx.db.select('purchase.OrderLine', { orderId: args.id })
  const moves: Row[] = []
  for (const line of lines) moves.push(...(await ctx.db.select('stock.Move', { purchaseLineId: line.id })))
  const receiptMoves = moves.filter((move) => String(move.pickingId) === String(args.receiptId))
  const picking = (await ctx.db.select('stock.Picking', { id: args.receiptId }))[0]
  if (!picking || !receiptMoves.length)
    return invalid('receiptId', 'receipt does not belong to the purchase order')
  if (picking.state === 'cancel') return invalid('state', 'a cancelled receipt cannot be received')
  const quantities: Array<{ moveLineId: string; quantity: number }> = []
  for (const move of receiptMoves) {
    const prepared = await ctx.db.select('stock.MoveLine', { moveId: move.id })
    const quantity = prepared.reduce((sum, row) => sum + n(row.quantity), 0)
    if (!prepared.length || Math.abs(quantity - n(move.productUomQty)) > 0.000001)
      return invalid('receiptId', 'receipt quantities need warehouse review before mobile receipt')
    const context = await productContext(ctx, move.productId)
    const tracking = String(context?.template.tracking ?? 'none')
    if (tracking !== 'none' && prepared.some((row) => !row.lotId))
      return invalid('receiptId', 'tracked receipt lines need lot or serial review')
    for (const row of prepared) quantities.push({ moveLineId: String(row.id), quantity: n(row.quantity) })
  }
  const current = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  if (!current || !(await claimRevision(ctx, current, args.expectedRevision)))
    return invalid('expectedRevision', 'purchase order changed')
  // completePicking owns its own atomic stock transaction. Claim the order
  // version immediately before entering it instead of nesting transactions,
  // which is not portable across SQLite and PostgreSQL adapters.
  const completed = (await stockFunctions.completePicking!.handler(ctx, {
    id: args.receiptId,
    quantities,
    createBackorder: false,
  })) as Row
  if (completed.ok !== true) return completed
  await refreshReceived(ctx, args.id)
  await refreshInvoiceStatus(ctx, args.id)
  const receipt = (await ctx.db.select('stock.Picking', { id: args.receiptId }))[0]
  return {
    ok: true,
    id: args.id,
    receiptId: args.receiptId,
    receivedAt: receipt?.dateDone ?? now(),
    lineCount: quantities.length,
  }
}

export async function syncReceiptsHandler(ctx: Ctx, args: Record<string, unknown>) {
  const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  if (!order) return invalid('id', 'purchase order does not exist')
  await refreshReceived(ctx, args.id)
  await refreshBilled(ctx, args.id)
  await refreshInvoiceStatus(ctx, args.id)
  return { ok: true, id: args.id, invoiceStatus: await invoiceStatus(ctx, args.id) }
}

export const receiptsFunctions: Record<string, FnSpec> = {
  receiveOrderReceipt: defineFn({
    input: { id: 'id', receiptId: 'id', expectedRevision: 'int?' },
    output: {
      ok: 'bool',
      id: 'id?',
      receiptId: 'id?',
      receivedAt: 'datetime?',
      lineCount: 'int?',
      errors: 'json?',
    },
    effects: [
      ...(stockFunctions.completePicking!.effects ?? []),
      'read:purchase.Order',
      'write:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.OrderLine',
      'read:account.Move',
      'read:account.MoveLine',
      'read:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: receiveOrderReceiptHandler,
  }),
  syncReceipts: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', invoiceStatus: 'text?', errors: 'json?' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'write:purchase.OrderLine',
      'write:purchase.Order',
      'read:stock.Move',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
      'read:account.Move',
      'read:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: syncReceiptsHandler,
  }),
}
