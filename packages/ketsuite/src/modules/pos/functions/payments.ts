import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { minorText, moneyMinor, scaleOf } from '../../account/money.ts'
import { absoluteMinor, appendAudit, claimDraftRevision, invalid, n, now, recompute } from './helpers.ts'

export async function addPaymentHandler(ctx: Ctx, args: Row) {
  const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
  if (order?.state !== 'draft') return invalid('orderId', 'payments can only be added to a new order')
  if (order.paymentLockId) return invalid('orderId', 'order is locked by an external payment attempt')
  const scale = scaleOf(order.currency)
  let tendered: bigint
  try {
    tendered = moneyMinor(args.tenderedAmount ?? args.amount, scale)
  } catch {
    return invalid('tenderedAmount', 'payment must be a valid monetary amount')
  }
  if ((order.isRefund && tendered >= 0n) || (!order.isRefund && tendered <= 0n))
    return invalid(
      'tenderedAmount',
      order.isRefund ? 'refund payments must be negative' : 'payment must be positive',
    )
  const linked = (
    await ctx.db.select('pos.ConfigPaymentMethod', {
      configId: order.configId,
      paymentMethodId: args.paymentMethodId,
    })
  )[0]
  const method = (await ctx.db.select('pos.PaymentMethod', { id: args.paymentMethodId }))[0]
  if (!linked || !method)
    return invalid('paymentMethodId', 'payment method is not configured for this point of sale')
  if (!method.isCash && !String(args.reference ?? '').trim())
    return invalid('reference', 'manual non-cash tender requires a reference')
  const existing = (await ctx.db.select('pos.Payment', { id: args.id }))[0]
  if (existing) {
    const same =
      existing.orderId === args.orderId &&
      existing.paymentMethodId === args.paymentMethodId &&
      moneyMinor(existing.tenderedAmount ?? existing.amount, scale) === tendered &&
      String(existing.reference ?? '') === String(args.reference ?? '')
    return same
      ? {
          ok: true,
          id: args.id,
          revision: n(order.revision),
          appliedAmount: existing.appliedAmount ?? existing.amount,
          change: minorText(
            moneyMinor(existing.tenderedAmount ?? existing.amount, scale) -
              moneyMinor(existing.appliedAmount ?? existing.amount, scale),
            scale,
          ),
        }
      : invalid('id', 'tender id is already used by a different command')
  }
  const captured = (await ctx.db.select('pos.Payment', { orderId: args.orderId })).filter(
    (payment) => (payment.state ?? 'captured') === 'captured',
  )
  const capturedAmount = captured.reduce(
    (sum, payment) => sum + absoluteMinor(moneyMinor(payment.appliedAmount ?? payment.amount, scale)),
    0n,
  )
  const payable = absoluteMinor(moneyMinor(order.amountTotal, scale))
  const remaining = payable > capturedAmount ? payable - capturedAmount : 0n
  if (remaining === 0n) return invalid('amount', 'the order is already fully covered')
  const tenderedAbsolute = absoluteMinor(tendered)
  if (!method.isCash && tenderedAbsolute > remaining)
    return invalid('tenderedAmount', 'manual non-cash tender cannot exceed the remaining payable')
  const appliedAbsolute = method.isCash && tenderedAbsolute > remaining ? remaining : tenderedAbsolute
  const direction = order.isRefund ? -1n : 1n
  const applied = direction * appliedAbsolute
  const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.insert('pos.Payment', {
    id: args.id,
    orderId: args.orderId,
    configId: order.configId,
    sessionId: order.sessionId,
    paymentMethodId: args.paymentMethodId,
    currency: order.currency,
    amount: minorText(applied, scale),
    tenderedAmount: minorText(tendered, scale),
    appliedAmount: minorText(applied, scale),
    state: 'captured',
    kind: method.isCash ? 'cash' : 'manual',
    reference: args.reference ?? null,
    providerAttemptId: null,
    operatorId: args.operatorId ?? null,
    deviceId: args.deviceId ?? null,
    paymentDate: now(),
  })
  await recompute(ctx, args.orderId)
  return {
    ok: true,
    id: args.id,
    revision: claim.revision,
    appliedAmount: minorText(applied, scale),
    change: minorText(tendered - applied, scale),
  }
}

export async function voidPaymentHandler(ctx: Ctx, args: Row) {
  if (!String(args.reason).trim()) return invalid('reason', 'voiding a tender requires a reason')
  const payment = (await ctx.db.select('pos.Payment', { id: args.id }))[0]
  if (!payment || payment.orderId !== args.orderId)
    return invalid('id', 'tender does not belong to this order')
  if (String(payment.kind).startsWith('provider'))
    return invalid('id', 'provider tenders must be reversed through their payment rail')
  const order = (await ctx.db.select('pos.Order', { id: args.orderId }))[0]
  if (payment.state === 'voided') {
    return { ok: true, id: args.id, revision: n(order?.revision) }
  }
  if (order?.paymentLockId)
    return invalid('orderId', 'manual tenders cannot change while an external payment is pending')
  const claim = await claimDraftRevision(ctx, args.orderId, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.update('pos.Payment', { id: args.id }, { state: 'voided' })
  await recompute(ctx, args.orderId)
  await appendAudit(ctx, {
    id: `payment:${String(args.id)}:voided`,
    subjectType: 'payment',
    subjectId: String(args.id),
    configId: order.configId,
    sessionId: order.sessionId,
    action: 'payment.voided',
    actorId: args.operatorId,
    deviceId: payment.deviceId ?? order.deviceId,
    reason: args.reason,
    relatedId: args.orderId,
    details: { amount: payment.appliedAmount ?? payment.amount, revision: claim.revision },
  })
  return { ok: true, id: args.id, revision: claim.revision }
}

export const paymentsFunctions: Record<string, FnSpec> = {
  addPayment: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      paymentMethodId: 'id',
      amount: 'decimal?',
      tenderedAmount: 'decimal?',
      reference: 'text?',
      operatorId: 'text?',
      deviceId: 'text?',
      expectedRevision: 'int?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      appliedAmount: 'decimal?',
      change: 'decimal?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pos.Payment',
      'write:pos.Payment',
      'read:pos.OrderLine',
      'write:pos.Order',
    ],
    idempotent: true,
    agent: true,
    handler: addPaymentHandler,
  }),
  voidPayment: defineFn({
    input: { id: 'id', orderId: 'id', expectedRevision: 'int', reason: 'text', operatorId: 'text?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.OrderLine',
      'read:pos.Payment',
      'write:pos.Payment',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: voidPaymentHandler,
  }),
}
