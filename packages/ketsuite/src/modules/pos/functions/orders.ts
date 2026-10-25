import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  appendAudit,
  atomic,
  claimDraftRevision,
  claimOrderRevision,
  createOrderEffects,
  currencyOf,
  invalid,
  n,
  nextOrderNumber,
  now,
} from './helpers.ts'

export function listOrdersHandler(ctx: Ctx, args: Row) {
  return ctx.db.select('pos.Order', {
    ...(args.state ? { state: args.state } : {}),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
  })
}

export async function getOrderHandler(ctx: Ctx, args: Row) {
  const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
  return order
    ? {
        ...order,
        lines: await ctx.db.select('pos.OrderLine', { orderId: args.id }),
        payments: await ctx.db.select('pos.Payment', { orderId: args.id }),
        exchange: order.exchangeId
          ? ((await ctx.db.select('pos.Exchange', { id: order.exchangeId }))[0] ?? null)
          : null,
      }
    : null
}

export async function getReceiptHandler(ctx: Ctx, args: Row) {
  const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
  if (!order || !['paid', 'done'].includes(String(order.state)) || !order.receiptId) return null
  const receipt = (await ctx.db.select('pos.ReceiptDocument', { id: order.receiptId }))[0]
  return receipt?.orderId === order.id ? receipt : null
}

/** Creates a draft POS order. createExchange runs it inside the exchange transaction. */
export async function createPosOrder(ctx: Ctx, args: Row) {
  const existing = (await ctx.db.select('pos.Order', { id: args.id }))[0]
  if (existing) {
    const same =
      existing.sessionId === args.sessionId &&
      (args.uuid === undefined || existing.uuid === args.uuid) &&
      (args.deviceId === undefined || existing.deviceId === args.deviceId)
    return same
      ? { ok: true, id: args.id, name: existing.name, revision: n(existing.revision) }
      : invalid('id', 'order id is already used by a different command')
  }
  if (args.uuid) {
    const offline = (await ctx.db.select('pos.Order', { uuid: args.uuid }))[0]
    if (offline) {
      const same =
        offline.sessionId === args.sessionId &&
        (args.deviceId === undefined || offline.deviceId === args.deviceId)
      return same
        ? { ok: true, id: offline.id, name: offline.name, revision: n(offline.revision) }
        : invalid('uuid', 'order uuid is already used by a different command')
    }
  }
  const session = (await ctx.db.select('pos.Session', { id: args.sessionId }))[0]
  if (session?.state !== 'opened') return invalid('sessionId', 'orders require an open POS session')
  if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
    return invalid('partnerId', 'customer does not exist')
  const sequenceNumber = await nextOrderNumber(ctx, args.sessionId),
    name = `Order ${String(sequenceNumber).padStart(5, '0')}`,
    posReference = `POS/${String(sequenceNumber).padStart(5, '0')}`
  await ctx.db.insert('pos.Order', {
    id: args.id,
    uuid: args.uuid ?? args.id,
    name,
    posReference,
    sequenceNumber,
    sessionId: args.sessionId,
    configId: session.configId,
    partnerId: args.partnerId ?? null,
    state: 'draft',
    invoiceStatus: args.toInvoice ? 'to_invoice' : 'to_invoice',
    isRefund: false,
    refundedOrderId: null,
    dateOrder: now(),
    currency: await currencyOf(ctx),
    amountUntaxed: '0',
    amountTax: '0',
    amountExact: '0',
    amountRounding: '0',
    amountTotal: '0',
    amountPaid: '0',
    amountReturn: '0',
    toInvoice: true,
    accountMoveId: null,
    pickingId: null,
    note: args.note ?? null,
    revision: 0,
    operatorId: args.operatorId ?? null,
    deviceId: args.deviceId ?? null,
    priceBookRevision: args.priceBookRevision ?? null,
  })
  return { ok: true, id: args.id, name, revision: 0 }
}

export async function updateOrderHandler(ctx: Ctx, args: Row) {
  const order = (await ctx.db.select('pos.Order', { id: args.id }))[0]
  if (order?.paymentLockId) return invalid('id', 'order is locked by an external payment attempt')
  if (order?.isRefund && (args.partnerId || args.clearPartner))
    return invalid('partnerId', 'a return must keep the original invoice customer')
  if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
    return invalid('partnerId', 'customer does not exist')
  const claim = await claimDraftRevision(ctx, args.id, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.update(
    'pos.Order',
    { id: args.id },
    {
      ...(args.clearPartner ? { partnerId: null } : args.partnerId ? { partnerId: args.partnerId } : {}),
      ...(args.note !== undefined ? { note: args.note } : {}),
    },
  )
  return { ok: true, id: args.id, revision: claim.revision }
}

export function cancelOrderHandler(ctx: Ctx, args: Row) {
  return atomic(ctx, async (tx) => {
    const order = (await tx.db.select('pos.Order', { id: args.id }))[0]
    if (!order) return invalid('id', 'order does not exist')
    if (order.state === 'cancel') return { ok: true, id: args.id, revision: n(order.revision) }
    if (order.state !== 'draft') return invalid('state', 'paid orders must be refunded, not cancelled')
    if (order.paymentLockId)
      return invalid('paymentLockId', 'external payment must be reconciled before cancellation')
    const providerPayment = (await tx.db.select('pos.Payment', { orderId: args.id })).find(
      (payment) => payment.kind === 'provider' && (payment.state ?? 'captured') === 'captured',
    )
    if (providerPayment) return invalid('state', 'provider tenders must be reversed before cancellation')
    const claim = await claimDraftRevision(tx, args.id, args.expectedRevision)
    if (claim.ok !== true) return claim
    if (order.isRefund && order.refundedOrderId) {
      const released = await claimOrderRevision(tx, order.refundedOrderId)
      if (released.ok !== true) return released
    }
    await tx.db.update('pos.Order', { id: args.id }, { state: 'cancel' })
    await appendAudit(tx, {
      id: `order:${String(args.id)}:cancelled`,
      subjectType: 'order',
      subjectId: String(args.id),
      configId: order.configId,
      sessionId: order.sessionId,
      action: 'order.cancelled',
      actorId: order.operatorId,
      deviceId: order.deviceId,
      relatedId: order.sessionId,
      details: { revision: claim.revision },
    })
    return { ok: true, id: args.id, revision: claim.revision }
  })
}

export const ordersFunctions: Record<string, FnSpec> = {
  listOrders: defineFn({
    input: { state: 'text?', sessionId: 'id?' },
    effects: ['read:pos.Order'],
    agent: true,
    handler: listOrdersHandler,
  }),
  getOrder: defineFn({
    input: { id: 'id' },
    effects: ['read:pos.Order', 'read:pos.OrderLine', 'read:pos.Payment', 'read:pos.Exchange'],
    agent: true,
    handler: getOrderHandler,
  }),
  getReceipt: defineFn({
    input: { orderId: 'id' },
    effects: ['read:pos.Order', 'read:pos.ReceiptDocument'],
    agent: true,
    handler: getReceiptHandler,
  }),
  createOrder: defineFn({
    input: {
      id: 'id',
      uuid: 'text?',
      sessionId: 'id',
      partnerId: 'id?',
      toInvoice: 'bool?',
      note: 'text?',
      operatorId: 'text?',
      deviceId: 'text?',
      priceBookRevision: 'text?',
    },
    output: { ok: 'bool', id: 'id?', name: 'text?', revision: 'int?', errors: 'json?' },
    effects: [...createOrderEffects],
    idempotent: true,
    agent: true,
    handler: createPosOrder,
  }),
  updateOrder: defineFn({
    input: {
      id: 'id',
      expectedRevision: 'int',
      partnerId: 'id?',
      clearPartner: 'bool?',
      note: 'text?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Order', 'write:pos.Order', 'read:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: updateOrderHandler,
  }),
  cancelOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Order', 'write:pos.Order', 'read:pos.Payment', 'write:pos.AuditEvent'],
    idempotent: true,
    agent: true,
    handler: cancelOrderHandler,
  }),
}
