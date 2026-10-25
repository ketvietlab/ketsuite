import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { atomic, claimDraftRevision, decimal, invalid, n, now, recompute } from './helpers.ts'

async function providerSettlementReplay(ctx: Ctx, args: Row): Promise<Row | null> {
  const attemptId = String(args.providerAttemptId ?? '').trim()
  const [byId, byAttempt, order, reservation] = await Promise.all([
    ctx.db.select('pos.Payment', { id: args.id }),
    ctx.db.select('pos.Payment', { providerAttemptId: attemptId }),
    ctx.db.select('pos.Order', { id: args.orderId }),
    ctx.db.select('pos.ProviderPaymentLock', { id: attemptId }),
  ])
  if (byId[0] && byAttempt[0] && byId[0].id !== byAttempt[0].id)
    return invalid('providerAttemptId', 'provider attempt is already linked to another tender')
  const existing = byId[0] ?? byAttempt[0]
  if (!existing) return null
  const currentOrder = order[0]
  const lock = reservation[0]
  const same =
    Boolean(currentOrder) &&
    existing.id === args.id &&
    existing.orderId === args.orderId &&
    existing.paymentMethodId === args.paymentMethodId &&
    existing.kind === 'provider' &&
    (existing.state ?? 'captured') === 'captured' &&
    existing.reversalOfId == null &&
    n(existing.appliedAmount ?? existing.amount) === n(args.amount) &&
    String(existing.providerAttemptId ?? '') === attemptId &&
    String(existing.reference ?? '') === String(args.providerReference ?? '').trim() &&
    currentOrder.currency === String(args.currency) &&
    lock?.orderId === args.orderId &&
    lock.paymentMethodId === args.paymentMethodId &&
    n(lock.amount) === n(args.amount) &&
    lock.currency === String(args.currency) &&
    ['settled', 'finalizing', 'finalized'].includes(String(lock.state)) &&
    lock.settledPaymentId === existing.id
  return same
    ? {
        ok: true,
        id: existing.id,
        revision: n(currentOrder!.revision),
        appliedAmount: existing.appliedAmount ?? existing.amount,
        providerAttemptId: attemptId,
      }
    : invalid('id', 'provider tender id is already used by a different settlement')
}

export function lockProviderPaymentHandler(ctx: Ctx, args: Row) {
  return atomic(ctx, async (tx) => {
    const attemptId = String(args.providerAttemptId ?? '').trim()
    if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
    const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
    if (!order) return invalid('orderId', 'order does not exist')
    const amount = n(args.amount)
    if ((order.isRefund && amount >= 0) || (!order.isRefund && amount <= 0))
      return invalid('amount', order.isRefund ? 'refund amount must be negative' : 'amount must be positive')
    const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
    if (reservation) {
      const same =
        reservation.orderId === args.orderId &&
        reservation.paymentMethodId === args.paymentMethodId &&
        n(reservation.amount) === amount &&
        reservation.currency === order.currency
      if (!same) return invalid('providerAttemptId', 'provider attempt is bound to another payment intent')
      if (!['locked', 'settled', 'finalizing', 'finalized'].includes(String(reservation.state)))
        return invalid('providerAttemptId', 'provider attempt can no longer lock this order')
      if (reservation.state === 'locked' && String(order.paymentLockId ?? '') !== attemptId)
        return invalid('providerAttemptId', 'provider attempt lock membership is inconsistent')
      return {
        ok: true,
        orderId: order.id,
        revision: n(order.revision),
        amount: decimal(amount),
        currency: order.currency,
        configId: order.configId,
      }
    }
    if (order.state !== 'draft') return invalid('orderId', 'only a draft order can be locked')
    const unresolved = (await tx.db.select('pos.ProviderPaymentLock', { orderId: order.id })).find((lock) =>
      ['locked', 'needs_review', 'reversing', 'finalizing'].includes(String(lock.state)),
    )
    if (unresolved) return invalid('providerAttemptId', 'order has an unresolved external payment attempt')
    const linked = (
      await tx.db.select('pos.ConfigPaymentMethod', {
        configId: order.configId,
        paymentMethodId: args.paymentMethodId,
      })
    )[0]
    const method = (await tx.db.select('pos.PaymentMethod', { id: args.paymentMethodId }))[0]
    if (!linked || !method || method.isCash || method.active === false)
      return invalid('paymentMethodId', 'provider payment requires a configured non-cash method')
    const captured = (await tx.db.select('pos.Payment', { orderId: args.orderId })).filter(
      (payment) => (payment.state ?? 'captured') === 'captured',
    )
    const remaining = Math.max(
      0,
      Math.abs(n(order.amountTotal)) -
        captured.reduce((sum, payment) => sum + Math.abs(n(payment.appliedAmount ?? payment.amount)), 0),
    )
    if (remaining <= 0.000001 || Math.abs(amount) > remaining + 0.000001)
      return invalid('amount', 'provider attempt exceeds the remaining payable')
    const createdAt = now()
    const inserted = await tx.db.insertIfAbsent('pos.ProviderPaymentLock', {
      id: attemptId,
      orderId: args.orderId,
      paymentMethodId: args.paymentMethodId,
      amount: decimal(amount),
      currency: order.currency,
      state: 'locked',
      settledPaymentId: null,
      reversalPaymentId: null,
      createdAt,
      updatedAt: createdAt,
    })
    if (!('dryRun' in inserted) && !inserted.inserted) {
      const winner = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
      const currentOrder = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
      const same =
        winner?.orderId === args.orderId &&
        winner.paymentMethodId === args.paymentMethodId &&
        n(winner.amount) === amount &&
        winner.currency === order.currency &&
        ['locked', 'settled', 'finalizing', 'finalized'].includes(String(winner.state)) &&
        (winner.state !== 'locked' || String(currentOrder?.paymentLockId ?? '') === attemptId)
      return same
        ? {
            ok: true,
            orderId: currentOrder!.id,
            revision: n(currentOrder!.revision),
            amount: decimal(amount),
            currency: order.currency,
            configId: currentOrder!.configId,
          }
        : invalid('providerAttemptId', 'provider attempt is bound to another payment intent')
    }
    const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
    if (claim.ok !== true) return claim
    await tx.db.update(
      'pos.Order',
      { id: args.orderId },
      {
        paymentLockId: attemptId,
        paymentLockMethodId: args.paymentMethodId,
        paymentLockAmount: decimal(amount),
      },
    )
    return {
      ok: true,
      orderId: order.id,
      revision: claim.revision,
      amount: decimal(amount),
      currency: order.currency,
      configId: order.configId,
    }
  })
}

export function unlockProviderPaymentHandler(ctx: Ctx, args: Row) {
  return atomic(ctx, async (tx) => {
    const attemptId = String(args.providerAttemptId ?? '').trim()
    if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
    const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
    if (!order) return invalid('orderId', 'order does not exist')
    const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
    if (!order.paymentLockId) {
      return reservation?.orderId === args.orderId && reservation.state === 'released'
        ? { ok: true, orderId: order.id, revision: n(order.revision) }
        : invalid('providerAttemptId', 'payment attempt does not own an active order lock')
    }
    if (String(order.paymentLockId) !== attemptId)
      return invalid('providerAttemptId', 'payment attempt does not own the order lock')
    if (
      !reservation ||
      reservation.orderId !== args.orderId ||
      reservation.state !== 'locked' ||
      reservation.paymentMethodId !== order.paymentLockMethodId ||
      n(reservation.amount) !== n(order.paymentLockAmount) ||
      reservation.currency !== order.currency
    )
      return invalid('providerAttemptId', 'provider attempt lock membership is inconsistent')
    if ((await tx.db.select('pos.Payment', { providerAttemptId: attemptId }))[0])
      return invalid('providerAttemptId', 'a settled provider payment cannot be unlocked')
    const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
    if (claim.ok !== true) return claim
    await tx.db.update(
      'pos.Order',
      { id: args.orderId },
      { paymentLockId: null, paymentLockMethodId: null, paymentLockAmount: null },
    )
    await tx.db.update('pos.ProviderPaymentLock', { id: attemptId }, { state: 'released', updatedAt: now() })
    return { ok: true, orderId: order.id, revision: claim.revision }
  })
}

export function settleProviderPaymentHandler(ctx: Ctx, args: Row) {
  return atomic(ctx, async (tx) => {
    const attemptId = String(args.providerAttemptId ?? '').trim()
    const reference = String(args.providerReference ?? '').trim()
    if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
    if (!reference) return invalid('providerReference', 'provider settlement reference is required')
    const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
    if (!order) return invalid('orderId', 'order does not exist')
    if (String(args.currency) !== String(order.currency))
      return invalid('currency', 'provider settlement currency does not match the locked order')
    const amount = n(args.amount)
    if ((order.isRefund && amount >= 0) || (!order.isRefund && amount <= 0))
      return invalid(
        'amount',
        order.isRefund ? 'provider refunds must be negative' : 'provider payments must be positive',
      )
    const replay = await providerSettlementReplay(tx, args)
    if (replay) return replay
    if (order.state !== 'draft') return invalid('orderId', 'payments can only settle a new order')
    const linked = (
      await tx.db.select('pos.ConfigPaymentMethod', {
        configId: order.configId,
        paymentMethodId: args.paymentMethodId,
      })
    )[0]
    const method = (await tx.db.select('pos.PaymentMethod', { id: args.paymentMethodId }))[0]
    if (!linked || !method || method.isCash || method.active === false)
      return invalid('paymentMethodId', 'provider settlement requires a configured non-cash method')
    const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
    if (
      String(order.paymentLockId ?? '') !== attemptId ||
      String(order.paymentLockMethodId ?? '') !== String(args.paymentMethodId) ||
      n(order.paymentLockAmount) !== amount ||
      !reservation ||
      reservation.orderId !== args.orderId ||
      reservation.paymentMethodId !== args.paymentMethodId ||
      n(reservation.amount) !== amount ||
      reservation.currency !== args.currency ||
      reservation.state !== 'locked'
    )
      return invalid('providerAttemptId', 'provider attempt does not own the current order lock')
    const captured = (await tx.db.select('pos.Payment', { orderId: args.orderId })).filter(
      (payment) => (payment.state ?? 'captured') === 'captured',
    )
    const remaining = Math.max(
      0,
      Math.abs(n(order.amountTotal)) -
        captured.reduce((sum, payment) => sum + Math.abs(n(payment.appliedAmount ?? payment.amount)), 0),
    )
    if (remaining <= 0.000001) return invalid('amount', 'the order is already fully covered')
    if (Math.abs(amount) > remaining + 0.000001)
      return invalid('amount', 'provider settlement exceeds the remaining payable')
    const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
    if (claim.ok !== true) {
      const converged = await providerSettlementReplay(tx, args)
      return converged?.ok === true ? converged : claim
    }
    await tx.db.insert('pos.Payment', {
      id: args.id,
      orderId: args.orderId,
      configId: order.configId,
      sessionId: order.sessionId,
      paymentMethodId: args.paymentMethodId,
      currency: order.currency,
      amount: decimal(amount),
      tenderedAmount: decimal(amount),
      appliedAmount: decimal(amount),
      state: 'captured',
      kind: 'provider',
      reference,
      providerAttemptId: attemptId,
      reversalOfId: null,
      operatorId: args.operatorId ?? null,
      deviceId: args.deviceId ?? null,
      paymentDate: now(),
    })
    await recompute(tx, args.orderId)
    await tx.db.update(
      'pos.ProviderPaymentLock',
      { id: attemptId },
      { state: 'settled', settledPaymentId: args.id, updatedAt: now() },
    )
    return {
      ok: true,
      id: args.id,
      revision: claim.revision,
      appliedAmount: decimal(amount),
      providerAttemptId: attemptId,
    }
  })
}

export function reviewProviderPaymentHandler(ctx: Ctx, args: Row) {
  return atomic(ctx, async (tx) => {
    const attemptId = String(args.providerAttemptId ?? '').trim()
    const targetState = String(args.state ?? '').trim()
    if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
    if (!['needs_review', 'reversing'].includes(targetState))
      return invalid('state', 'provider review state must be needs_review or reversing')
    const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
    if (!order) return invalid('orderId', 'order does not exist')
    const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
    const payment = (await tx.db.select('pos.Payment', { providerAttemptId: attemptId }))[0]
    if (
      order.state !== 'draft' ||
      !reservation ||
      reservation.orderId !== order.id ||
      reservation.paymentMethodId !== payment?.paymentMethodId ||
      n(reservation.amount) !== n(payment?.appliedAmount ?? payment?.amount) ||
      reservation.currency !== order.currency ||
      reservation.settledPaymentId !== payment?.id ||
      payment?.orderId !== order.id ||
      payment.paymentMethodId !== reservation.paymentMethodId ||
      payment.kind !== 'provider' ||
      payment.state !== 'captured' ||
      payment.reversalOfId != null
    )
      return invalid('providerAttemptId', 'captured provider settlement is not reviewable')
    if (reservation.state === targetState)
      return {
        ok: true,
        orderId: order.id,
        revision: n(order.revision),
        state: targetState,
      }
    const allowed =
      (targetState === 'needs_review' && reservation.state === 'settled') ||
      (targetState === 'reversing' && reservation.state === 'needs_review')
    if (!allowed)
      return invalid('state', 'provider payment review state cannot move backwards or be reopened')
    const claim = await claimDraftRevision(tx, order.id, args.expectedRevision)
    if (claim.ok !== true) return claim
    const changed = await tx.db.compareAndSet(
      'pos.ProviderPaymentLock',
      { id: attemptId },
      { state: reservation.state },
      { state: targetState, updatedAt: now() },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid('state', 'provider payment reconciliation changed; reload it before continuing')
    return { ok: true, orderId: order.id, revision: claim.revision, state: targetState }
  })
}

export function reverseProviderPaymentHandler(ctx: Ctx, args: Row) {
  return atomic(ctx, async (tx) => {
    const attemptId = String(args.providerAttemptId ?? '').trim()
    const reversalId = String(args.providerReversalId ?? '').trim()
    const reference = String(args.reversalReference ?? '').trim()
    if (!attemptId) return invalid('providerAttemptId', 'provider attempt id is required')
    if (!reversalId || reversalId === attemptId)
      return invalid('providerReversalId', 'provider reversal id must be distinct and non-empty')
    if (!reference) return invalid('reversalReference', 'provider reversal reference is required')
    const order = (await tx.db.select('pos.Order', { id: args.orderId }))[0]
    if (!order) return invalid('orderId', 'order does not exist')
    if (String(args.currency) !== String(order.currency))
      return invalid('currency', 'provider reversal currency does not match the order')
    const original = (await tx.db.select('pos.Payment', { providerAttemptId: attemptId }))[0]
    if (
      !original ||
      original.orderId !== args.orderId ||
      original.kind !== 'provider' ||
      original.reversalOfId != null
    )
      return invalid('providerAttemptId', 'captured provider tender does not belong to this order')
    const amount = n(args.amount)
    if (amount === 0 || n(original.appliedAmount ?? original.amount) !== amount)
      return invalid('amount', 'provider reversal must exactly match the captured tender')
    const byId = (await tx.db.select('pos.Payment', { id: args.id }))[0]
    const byOriginal = (await tx.db.select('pos.Payment', { reversalOfId: original.id }))[0]
    if (byId && byOriginal && byId.id !== byOriginal.id)
      return invalid('id', 'provider tender is already linked to another reversal')
    const existing = byId ?? byOriginal
    const reservation = (await tx.db.select('pos.ProviderPaymentLock', { id: attemptId }))[0]
    if (existing) {
      const same =
        existing.id === args.id &&
        existing.orderId === args.orderId &&
        existing.paymentMethodId === original.paymentMethodId &&
        existing.kind === 'provider_reversal' &&
        existing.state === 'reversed' &&
        n(existing.appliedAmount ?? existing.amount) === -amount &&
        existing.providerAttemptId === reversalId &&
        existing.reference === reference &&
        existing.reversalOfId === original.id &&
        original.state === 'reversed' &&
        reservation?.state === 'reversed' &&
        reservation.reversalPaymentId === existing.id &&
        String(order.paymentLockId ?? '') !== attemptId
      return same
        ? {
            ok: true,
            id: existing.id,
            revision: n(order.revision),
            reversedPaymentId: original.id,
            appliedAmount: existing.appliedAmount ?? existing.amount,
          }
        : invalid('id', 'provider reversal id is already used by another command')
    }
    if (order.state !== 'draft')
      return invalid('orderId', 'only a captured tender on a draft order can be compensated')
    const otherUnresolved = (await tx.db.select('pos.ProviderPaymentLock', { orderId: args.orderId })).find(
      (lock) =>
        String(lock.id) !== attemptId &&
        ['locked', 'needs_review', 'reversing', 'finalizing'].includes(String(lock.state)),
    )
    if (
      original.state !== 'captured' ||
      otherUnresolved ||
      reservation?.orderId !== args.orderId ||
      reservation.paymentMethodId !== original.paymentMethodId ||
      n(reservation.amount) !== amount ||
      reservation.currency !== args.currency ||
      reservation.state !== 'reversing' ||
      reservation.settledPaymentId !== original.id
    )
      return invalid('providerAttemptId', 'provider settlement is not eligible for compensation')
    const collision = (await tx.db.select('pos.Payment', { providerAttemptId: reversalId }))[0]
    if (collision) return invalid('providerReversalId', 'provider reversal id is already in use')
    const claim = await claimDraftRevision(tx, args.orderId, args.expectedRevision)
    if (claim.ok !== true) return claim
    const reversedAmount = decimal(-amount)
    await tx.db.insert('pos.Payment', {
      id: args.id,
      orderId: args.orderId,
      configId: order.configId,
      sessionId: order.sessionId,
      paymentMethodId: original.paymentMethodId,
      currency: order.currency,
      amount: reversedAmount,
      tenderedAmount: reversedAmount,
      appliedAmount: reversedAmount,
      state: 'reversed',
      kind: 'provider_reversal',
      reference,
      providerAttemptId: reversalId,
      reversalOfId: original.id,
      operatorId: args.operatorId ?? null,
      deviceId: original.deviceId ?? null,
      paymentDate: now(),
    })
    await tx.db.update('pos.Payment', { id: original.id }, { state: 'reversed' })
    if (String(order.paymentLockId ?? '') === attemptId)
      await tx.db.update(
        'pos.Order',
        { id: args.orderId },
        { paymentLockId: null, paymentLockMethodId: null, paymentLockAmount: null },
      )
    await tx.db.update(
      'pos.ProviderPaymentLock',
      { id: attemptId },
      { state: 'reversed', reversalPaymentId: args.id, updatedAt: now() },
    )
    await recompute(tx, args.orderId)
    return {
      ok: true,
      id: args.id,
      revision: claim.revision,
      reversedPaymentId: original.id,
      appliedAmount: reversedAmount,
    }
  })
}

export const providerPaymentsFunctions: Record<string, FnSpec> = {
  lockProviderPayment: defineFn({
    exposure: 'internal',
    input: {
      orderId: 'id',
      paymentMethodId: 'id',
      amount: 'decimal',
      providerAttemptId: 'text',
      expectedRevision: 'int',
    },
    output: {
      ok: 'bool',
      orderId: 'id?',
      revision: 'int?',
      amount: 'decimal?',
      currency: 'text?',
      configId: 'id?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pos.Payment',
    ],
    idempotent: true,
    handler: lockProviderPaymentHandler,
  }),
  unlockProviderPayment: defineFn({
    exposure: 'internal',
    input: { orderId: 'id', providerAttemptId: 'text', expectedRevision: 'int' },
    output: { ok: 'bool', orderId: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.Payment',
    ],
    idempotent: true,
    handler: unlockProviderPaymentHandler,
  }),
  settleProviderPayment: defineFn({
    exposure: 'internal',
    input: {
      id: 'id',
      orderId: 'id',
      paymentMethodId: 'id',
      amount: 'decimal',
      currency: 'text',
      providerAttemptId: 'text',
      providerReference: 'text',
      operatorId: 'text?',
      deviceId: 'text?',
      expectedRevision: 'int',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      appliedAmount: 'decimal?',
      providerAttemptId: 'text?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pos.Payment',
      'write:pos.Payment',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.OrderLine',
      'write:pos.Order',
    ],
    idempotent: true,
    handler: settleProviderPaymentHandler,
  }),
  reviewProviderPayment: defineFn({
    exposure: 'internal',
    input: {
      orderId: 'id',
      providerAttemptId: 'text',
      state: 'text',
      expectedRevision: 'int',
    },
    output: { ok: 'bool', orderId: 'id?', revision: 'int?', state: 'text?', errors: 'json?' },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.Payment',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
    ],
    idempotent: true,
    handler: reviewProviderPaymentHandler,
  }),
  reverseProviderPayment: defineFn({
    exposure: 'internal',
    input: {
      id: 'id',
      orderId: 'id',
      providerAttemptId: 'text',
      providerReversalId: 'text',
      amount: 'decimal',
      currency: 'text',
      reversalReference: 'text',
      expectedRevision: 'int',
      operatorId: 'text?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      reversedPaymentId: 'id?',
      appliedAmount: 'decimal?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Order',
      'write:pos.Order',
      'read:pos.Payment',
      'write:pos.Payment',
      'read:pos.ProviderPaymentLock',
      'write:pos.ProviderPaymentLock',
      'read:pos.OrderLine',
    ],
    idempotent: true,
    handler: reverseProviderPaymentHandler,
  }),
}
