import type { Ctx, Row } from '@ketvietlab/ketjs'
import { createHash } from 'node:crypto'
import { functions as accountFunctions } from '../../account/functions.ts'
import { minorText, moneyMinor, scaleOf, sumMoneyMinor } from '../../account/money.ts'
import { functions as stockFunctions } from '../../stock/functions.ts'
import { toProductUnit } from '../../stock/units.ts'

export const POS_ORDER_STATES = ['draft', 'cancel', 'paid', 'done'] as const

export const POS_SESSION_STATES = [
  'opening_control',
  'opened',
  'closing_control',
  'pending_approval',
  'closed',
] as const

export const POS_TENDER_STATES = ['captured', 'voided'] as const

export const POS_INVOICE_STATUSES = ['invoiced', 'to_invoice'] as const

export const POS_PAYMENT_SETTLEMENT_KINDS = ['liquidity', 'stored_value'] as const

export const invalid = (field: string, message: string) => ({
  ok: false as const,
  errors: [{ field, message }],
})

export const n = (value: unknown) => Number(value ?? 0)

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export const decimal = (value: number) => String(money(value))

export const now = () => new Date().toISOString()

type AuditInput = {
  id: string
  subjectType: 'session' | 'order' | 'payment' | 'cash_movement' | 'exchange'
  subjectId: string
  configId: unknown
  sessionId: unknown
  action: string
  actorId?: unknown
  deviceId?: unknown
  reason?: unknown
  relatedId?: unknown
  details?: Row
  occurredAt?: string
}

export const traceHash = (kind: string, value: unknown): string | null => {
  const held = String(value ?? '').trim()
  return held ? createHash('sha256').update(`pos:${kind}\n${held}`).digest('hex') : null
}

/**
 * Sensitive POS commands are retryable, so their audit identity must be retryable too.
 * Callers derive the id from the command/domain identity and this helper never updates
 * an existing event.
 */
export const appendAudit = (ctx: Ctx, event: AuditInput) =>
  ctx.db.insertIfAbsent('pos.AuditEvent', {
    id: event.id,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    configId: event.configId,
    sessionId: event.sessionId,
    action: event.action,
    actorId: event.actorId ?? ctx.actor ?? null,
    deviceId: event.deviceId ?? null,
    reason: event.reason == null ? null : String(event.reason).trim().slice(0, 500),
    relatedId: event.relatedId ?? null,
    details: event.details ?? {},
    correlationHash: traceHash('correlation', ctx.correlationId),
    actorHash: traceHash('actor', event.actorId),
    subjectHash: traceHash(event.subjectType, event.subjectId),
    relatedHash: traceHash('related', event.relatedId),
    sessionHash: traceHash('session', event.sessionId),
    deviceHash: traceHash('device', event.deviceId),
    occurredAt: event.occurredAt ?? now(),
  })

type RevisionClaim = { ok: true; order: Row; revision: number } | ReturnType<typeof invalid>

class AtomicFailure extends Error {
  readonly result: Row

  constructor(result: Row) {
    super('POS command rejected')
    this.result = result
  }
}

const activeAtomicContexts = new WeakSet<Ctx>()

export const atomic = async (ctx: Ctx, body: (tx: Ctx) => Promise<Row>): Promise<Row> => {
  try {
    // Composite POS commands reuse the transaction-bound context handed to the
    // outer command. Opening another adapter transaction here would fail on
    // PostgreSQL and would split one retail intent into partial commits.
    if (activeAtomicContexts.has(ctx)) {
      const result = await body(ctx)
      if (result.ok !== true) throw new AtomicFailure(result)
      return result
    }
    return await ctx.tx(async (tx) => {
      activeAtomicContexts.add(tx)
      try {
        const result = await body(tx)
        if (result.ok !== true) throw new AtomicFailure(result)
        return result
      } finally {
        activeAtomicContexts.delete(tx)
      }
    })
  } catch (error) {
    if (error instanceof AtomicFailure) return error.result
    throw error
  }
}

export async function claimDraftRevision(
  ctx: Ctx,
  id: unknown,
  expectedRevision?: unknown,
): Promise<RevisionClaim> {
  const order = (await ctx.db.select('pos.Order', { id }))[0]
  if (!order) return invalid('orderId', 'order does not exist')
  if (order.state !== 'draft') return invalid('state', 'only a draft order can be changed')
  const current = n(order.revision)
  if (expectedRevision !== undefined && n(expectedRevision) !== current)
    return invalid('expectedRevision', 'the order changed; reload it before continuing')
  const changed = await ctx.db.compareAndSet(
    'pos.Order',
    { id: order.id },
    { revision: order.revision ?? null },
    { revision: current + 1 },
  )
  if (!('dryRun' in changed) && !changed.matched)
    return invalid('expectedRevision', 'the order changed; reload it before continuing')
  return { ok: true, order, revision: current + 1 }
}

export async function claimOrderRevision(
  ctx: Ctx,
  id: unknown,
  expectedRevision?: unknown,
): Promise<RevisionClaim> {
  const order = (await ctx.db.select('pos.Order', { id }))[0]
  if (!order) return invalid('orderId', 'order does not exist')
  const current = n(order.revision)
  if (expectedRevision !== undefined && n(expectedRevision) !== current)
    return invalid('expectedRevision', 'the order changed; reload it before continuing')
  const changed = await ctx.db.compareAndSet(
    'pos.Order',
    { id: order.id },
    { revision: order.revision ?? null },
    { revision: current + 1 },
  )
  if (!('dryRun' in changed) && !changed.matched)
    return invalid('expectedRevision', 'the order changed; reload it before continuing')
  return { ok: true, order, revision: current + 1 }
}

export async function claimSessionRevision(
  ctx: Ctx,
  id: unknown,
  expectedRevision?: unknown,
): Promise<{ ok: true; session: Row; revision: number } | ReturnType<typeof invalid>> {
  const session = (await ctx.db.select('pos.Session', { id }))[0]
  if (!session) return invalid('id', 'session does not exist')
  const current = n(session.revision)
  if (expectedRevision !== undefined && n(expectedRevision) !== current)
    return invalid('expectedRevision', 'the shift changed; reload it before continuing')
  const changed = await ctx.db.compareAndSet(
    'pos.Session',
    { id: session.id },
    { revision: session.revision ?? null },
    { revision: current + 1 },
  )
  if (!('dryRun' in changed) && !changed.matched)
    return invalid('expectedRevision', 'the shift changed; reload it before continuing')
  return { ok: true, session, revision: current + 1 }
}

export async function currencyOf(ctx: Ctx) {
  if (!ctx.scope.company) throw new Error('point of sale requires an active company')
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (!company) throw new Error(`company ${ctx.scope.company} does not exist`)
  return String(company.currency)
}

export const absoluteMinor = (value: bigint) => (value < 0n ? -value : value)

export async function trackingAvailability(ctx: Ctx, order: Row, line: Row): Promise<Row> {
  const config = (await ctx.db.select('pos.Config', { id: order.configId }))[0]
  if (!config) throw new Error(`POS configuration ${String(order.configId)} does not exist`)
  const based = await toProductUnit(ctx, line.productId, line.productUomId, Math.abs(n(line.qty)))
  if (!based) throw new Error(`POS line ${String(line.id)} has an incompatible unit`)
  const availability = (await stockFunctions.trackedAvailability!.handler(ctx, {
    productId: line.productId,
    warehouseId: config.warehouseId,
    at: order.dateOrder,
  })) as Row
  return {
    orderId: String(order.id),
    lineId: String(line.id),
    productId: String(line.productId),
    tracking: String(availability.tracking ?? 'none'),
    requiredQuantity: String(based.quantity),
    selections: Array.isArray(line.lotSelections) ? line.lotSelections : [],
    lots: Array.isArray(availability.lots) ? availability.lots : [],
  }
}

export async function nextOrderNumber(ctx: Ctx, sessionId: unknown) {
  const key = String(sessionId)
  await ctx.db.insertIfAbsent('pos.Sequence', { id: key, nextNumber: 1 })
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const row = (await ctx.db.select('pos.Sequence', { id: key }))[0]!
    const current = n(row.nextNumber)
    const changed = await ctx.db.compareAndSet(
      'pos.Sequence',
      { id: key },
      { nextNumber: row.nextNumber },
      { nextNumber: current + 1 },
    )
    if ('dryRun' in changed || changed.matched) return current
  }
  throw new Error('POS order sequence did not settle after concurrent updates')
}

export async function recompute(ctx: Ctx, orderId: unknown) {
  const order = (await ctx.db.select('pos.Order', { id: orderId }))[0]
  if (!order) throw new Error(`POS order ${String(orderId)} does not exist`)
  const scale = scaleOf(order.currency)
  const lines = await ctx.db.select('pos.OrderLine', { orderId })
  const untaxed = sumMoneyMinor(
    lines.map((line) => line.priceSubtotal),
    scale,
  )
  const total = sumMoneyMinor(
    lines.map((line) => line.priceSubtotalIncl),
    scale,
  )
  const tax = total - untaxed
  const payments = await ctx.db.select('pos.Payment', { orderId }),
    captured = payments.filter((payment) => (payment.state ?? 'captured') === 'captured'),
    paid = sumMoneyMinor(
      captured.map((payment) => payment.appliedAmount ?? payment.amount),
      scale,
    ),
    returned = captured.reduce(
      (sum, payment) =>
        sum +
        moneyMinor(payment.tenderedAmount ?? payment.amount, scale) -
        moneyMinor(payment.appliedAmount ?? payment.amount, scale),
      0n,
    )
  await ctx.db.update(
    'pos.Order',
    { id: orderId },
    {
      amountUntaxed: minorText(untaxed, scale),
      amountTax: minorText(tax, scale),
      amountExact: minorText(total, scale),
      amountRounding: minorText(0n, scale),
      amountTotal: minorText(total, scale),
      amountPaid: minorText(paid, scale),
      amountReturn: minorText(returned, scale),
    },
  )
}

export const accountEffects = [
  ...(accountFunctions.postMove!.effects ?? []),
  ...(accountFunctions.registerPayment!.effects ?? []),
]

export const createOrderEffects = [
  'read:pos.Sequence',
  'write:pos.Sequence',
  'read:pos.Session',
  'read:pos.Config',
  'read:pos.Order',
  'write:pos.Order',
  'read:partner.Partner',
  'read:company.Company',
] as const
