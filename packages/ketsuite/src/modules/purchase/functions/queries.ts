import {
  defineFn,
  desc,
  eq,
  from,
  ilike,
  inArray,
  or,
  type Ctx,
  type FnSpec,
  type Row,
} from '@ketvietlab/ketjs'
import { quantityText, wildcard, productContext } from './shared.ts'
import { billedQuantity, receivedQuantity, invoiceStatus } from '../order-amounts.ts'
import { approvalSummary } from '../approval.ts'

export function listOrdersHandler(ctx: Ctx, args: Record<string, unknown>) {
  const O = ctx.table('purchase.Order')
  const states = Array.isArray(args.states) ? args.states.map(String) : []
  const limit = Math.max(1, Math.min(Math.trunc(Number(args.limit) || 500), 2_000))
  return ctx.db.all(
    from(O)
      .where(
        eq(O.companyId, ctx.scope.company),
        ...(args.state ? [eq(O.state, String(args.state))] : []),
        ...(states.length ? [inArray(O.state, states)] : []),
        ...(args.partnerId ? [eq(O.partnerId, String(args.partnerId))] : []),
        ...(args.search
          ? [
              or(
                ilike(O.name, `%${wildcard(args.search)}%`, true),
                ilike(O.partnerRef, `%${wildcard(args.search)}%`, true),
              ),
            ]
          : []),
      )
      .orderBy(desc(O.dateOrder), desc(O.id))
      .limit(limit)
      .offset(Math.max(0, Math.trunc(Number(args.offset) || 0))),
  )
}

export async function listOrderMetricsHandler(ctx: Ctx, args: Record<string, unknown>) {
  const orderIds = Array.isArray(args.orderIds) ? [...new Set(args.orderIds.map(String).filter(Boolean))] : []
  if (!orderIds.length) return []
  const L = ctx.table('purchase.OrderLine')
  const lines = await ctx.db.all(from(L).where(inArray(L.orderId, orderIds)))
  const lineIds = lines.map((line) => String(line.id))
  const M = ctx.table('stock.Move')
  const moves = lineIds.length ? await ctx.db.all(from(M).where(inArray(M.purchaseLineId, lineIds))) : []
  const pickingIds = [...new Set(moves.flatMap((move) => (move.pickingId ? [String(move.pickingId)] : [])))]
  const P = ctx.table('stock.Picking')
  const pickingStates = new Map<string, string>()
  if (pickingIds.length)
    for (const picking of await ctx.db.all(from(P).where(inArray(P.id, pickingIds))))
      pickingStates.set(String(picking.id), String(picking.state))
  const orderByLine = new Map(lines.map((line) => [String(line.id), String(line.orderId)]))
  return orderIds.map((orderId) => ({
    orderId,
    itemCount: lines.filter((line) => String(line.orderId) === orderId).length,
    pickingStates: [
      ...new Set(
        moves
          .filter((move) => orderByLine.get(String(move.purchaseLineId)) === orderId)
          .flatMap((move) =>
            move.pickingId && pickingStates.has(String(move.pickingId))
              ? [pickingStates.get(String(move.pickingId))!]
              : [],
          ),
      ),
    ],
  }))
}

export async function getOrderHandler(ctx: Ctx, args: Record<string, unknown>) {
  const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  if (!order) return null
  const stored = await ctx.db.select('purchase.OrderLine', { orderId: args.id })
  // Received and billed are read from the warehouse and the ledger rather
  // than from the columns caching them, so the order is right whether or not
  // anyone has pressed a sync button since the goods arrived.
  const lines: Row[] = []
  const moves: Row[] = []
  const billLines: Row[] = []
  for (const line of stored) {
    moves.push(...(await ctx.db.select('stock.Move', { purchaseLineId: line.id })))
    billLines.push(...(await ctx.db.select('account.MoveLine', { purchaseLineId: line.id })))
    lines.push({
      ...line,
      qtyReceived: quantityText(await receivedQuantity(ctx, line)),
      qtyInvoiced: await billedQuantity(ctx, line.id),
    })
  }
  const bills: Row[] = []
  for (const id of new Set(billLines.map((line) => String(line.moveId)))) {
    const bill = (await ctx.db.select('account.Move', { id }))[0]
    if (bill) bills.push(bill)
  }
  const detailedMoves: Row[] = await Promise.all(
    moves.map(async (move) => ({
      ...move,
      tracking: String((await productContext(ctx, move.productId))?.template.tracking ?? 'none'),
      lines: await ctx.db.select('stock.MoveLine', { moveId: move.id }),
    })),
  )
  const pickingIds = [
    ...new Set(detailedMoves.flatMap((move) => (move.pickingId ? [String(move.pickingId)] : []))),
  ]
  const P = ctx.table('stock.Picking')
  const pickings = pickingIds.length
    ? (await ctx.db.all(from(P).where(inArray(P.id, pickingIds)))).map((picking) => ({
        ...picking,
        moves: detailedMoves.filter((move) => String(move.pickingId) === String(picking.id)),
      }))
    : []
  return {
    ...order,
    invoiceStatus: await invoiceStatus(ctx, args.id),
    approval: await approvalSummary(ctx, order),
    lines,
    moves: detailedMoves,
    pickings,
    bills,
  }
}

export const queriesFunctions: Record<string, FnSpec> = {
  listOrders: defineFn({
    input: {
      state: 'text?',
      states: 'json?',
      partnerId: 'id?',
      search: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: ['read:purchase.Order'],
    agent: true,
    handler: listOrdersHandler,
  }),
  listOrderMetrics: defineFn({
    input: { orderIds: 'json' },
    effects: ['read:purchase.OrderLine', 'read:stock.Move', 'read:stock.Picking'],
    agent: true,
    handler: listOrderMetricsHandler,
  }),
  getOrder: defineFn({
    input: { id: 'id' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'read:purchase.OrderApproval',
      'read:purchase.Configuration',
      'read:user.User',
      'read:stock.Move',
      'read:stock.MoveLine',
      'read:stock.Picking',
      'read:account.MoveLine',
      'read:account.Move',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    agent: true,
    handler: getOrderHandler,
  }),
}
