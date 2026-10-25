import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { minorText, moneyMinor, scaleOf } from '../../account/money.ts'
import { appendAudit, claimSessionRevision, currencyOf, invalid, n, now } from './helpers.ts'

export async function recordCashMovementHandler(ctx: Ctx, args: Row) {
  if (!['in', 'out'].includes(String(args.direction)))
    return invalid('direction', 'cash movement direction must be in or out')
  if (!String(args.reason).trim()) return invalid('reason', 'cash movement requires a reason')
  const session = (await ctx.db.select('pos.Session', { id: args.sessionId }))[0]
  if (session?.state !== 'opened') return invalid('state', 'cash movement requires an open shift')
  const scale = scaleOf(await currencyOf(ctx))
  const amount = moneyMinor(args.amount, scale)
  if (amount <= 0n) return invalid('amount', 'cash movement amount must be positive')
  const existing = (await ctx.db.select('pos.CashMovement', { id: args.id }))[0]
  if (existing) {
    const same =
      existing.sessionId === args.sessionId &&
      existing.direction === args.direction &&
      moneyMinor(existing.amount, scale) === amount
    return same
      ? { ok: true, id: args.id, revision: n(session.revision) }
      : invalid('id', 'cash movement id is already used by a different command')
  }
  const claim = await claimSessionRevision(ctx, args.sessionId, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.insert('pos.CashMovement', {
    id: args.id,
    sessionId: args.sessionId,
    configId: session.configId,
    direction: args.direction,
    amount: minorText(amount, scale),
    reason: String(args.reason),
    note: args.note ?? null,
    actorId: args.actorId,
    deviceId: args.deviceId ?? null,
    occurredAt: now(),
    reversalOfId: null,
  })
  await appendAudit(ctx, {
    id: `cash-movement:${String(args.id)}:recorded`,
    subjectType: 'cash_movement',
    subjectId: String(args.id),
    configId: session.configId,
    sessionId: args.sessionId,
    action: 'cash_movement.recorded',
    actorId: args.actorId,
    deviceId: args.deviceId,
    reason: args.reason,
    relatedId: args.sessionId,
    details: { direction: args.direction, amount: minorText(amount, scale), revision: claim.revision },
  })
  return { ok: true, id: args.id, revision: claim.revision }
}

export async function reverseCashMovementHandler(ctx: Ctx, args: Row) {
  if (!String(args.reason).trim()) return invalid('reason', 'cash movement reversal requires a reason')
  const session = (await ctx.db.select('pos.Session', { id: args.sessionId }))[0]
  if (session?.state !== 'opened') return invalid('state', 'cash movement reversal requires an open shift')
  const original = (await ctx.db.select('pos.CashMovement', { id: args.movementId }))[0]
  if (!original || original.sessionId !== args.sessionId)
    return invalid('movementId', 'cash movement does not belong to this shift')
  if (original.reversalOfId) return invalid('movementId', 'a reversal cannot itself be reversed')
  const prior = (await ctx.db.select('pos.CashMovement', { reversalOfId: args.movementId }))[0]
  if (prior)
    return prior.id === args.id
      ? { ok: true, id: prior.id, revision: n(session.revision) }
      : invalid('movementId', 'cash movement is already reversed')
  const claim = await claimSessionRevision(ctx, args.sessionId, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.insert('pos.CashMovement', {
    id: args.id,
    sessionId: args.sessionId,
    configId: session.configId,
    direction: original.direction === 'in' ? 'out' : 'in',
    amount: original.amount,
    reason: String(args.reason),
    note: args.note ?? null,
    actorId: args.actorId,
    deviceId: args.deviceId ?? null,
    occurredAt: now(),
    reversalOfId: original.id,
  })
  await appendAudit(ctx, {
    id: `cash-movement:${String(args.id)}:reversed`,
    subjectType: 'cash_movement',
    subjectId: String(args.id),
    configId: session.configId,
    sessionId: args.sessionId,
    action: 'cash_movement.reversed',
    actorId: args.actorId,
    deviceId: args.deviceId,
    reason: args.reason,
    relatedId: original.id,
    details: { sessionId: args.sessionId, amount: original.amount, revision: claim.revision },
  })
  return { ok: true, id: args.id, revision: claim.revision }
}

export const cashFunctions: Record<string, FnSpec> = {
  recordCashMovement: defineFn({
    input: {
      id: 'id',
      sessionId: 'id',
      direction: 'text',
      amount: 'decimal',
      reason: 'text',
      note: 'text?',
      actorId: 'text',
      deviceId: 'text?',
      expectedRevision: 'int',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.CashMovement',
      'write:pos.CashMovement',
      'read:company.Company',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: recordCashMovementHandler,
  }),
  reverseCashMovement: defineFn({
    input: {
      id: 'id',
      sessionId: 'id',
      movementId: 'id',
      expectedRevision: 'int',
      reason: 'text',
      note: 'text?',
      actorId: 'text',
      deviceId: 'text?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.CashMovement',
      'write:pos.CashMovement',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: reverseCashMovementHandler,
  }),
}
