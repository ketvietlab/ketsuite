import {
  and,
  defineFn,
  desc,
  eq,
  from,
  gte,
  inArray,
  isNull,
  localDateTimeToUtc,
  lt,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCivilDays } from '../../account/date.ts'
import { ledgerOf } from '../../account/functions.ts'
import { minorText, moneyMinor, scaleOf, sumMoneyMinor } from '../../account/money.ts'
import { invalid, n, traceHash } from './helpers.ts'

const projectedAudit = (event: Row) => ({
  id: traceHash('audit-event', event.id),
  subjectType: String(event.subjectType ?? 'unknown'),
  subjectHash: event.subjectHash ?? traceHash(String(event.subjectType ?? 'unknown'), event.subjectId),
  action: String(event.action ?? ''),
  actorHash: event.actorHash ?? traceHash('actor', event.actorId),
  correlationHash: event.correlationHash ?? null,
  relatedHash: event.relatedHash ?? traceHash('related', event.relatedId),
  sessionHash: event.sessionHash ?? traceHash('session', event.sessionId),
  deviceHash: event.deviceHash ?? traceHash('device', event.deviceId),
  reason: event.reason ?? null,
  occurredAt: String(event.occurredAt),
})

const POS_OPERATIONS_MAX_DAYS = 31

const DAY_MS = 86_400_000

const operationsWindow = (dateFrom: unknown, dateTo: unknown, timezone: string) => {
  const startDay = String(dateFrom)
  const endDay = String(dateTo)
  const start = Date.parse(`${startDay}T00:00:00.000Z`)
  const end = Date.parse(`${endDay}T00:00:00.000Z`) + DAY_MS
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return invalid('dateTo', 'operations report end date must not precede its start date')
  if (end - start > POS_OPERATIONS_MAX_DAYS * DAY_MS)
    return invalid('dateTo', `operations report is limited to ${POS_OPERATIONS_MAX_DAYS} days`)
  return {
    ok: true as const,
    from: localDateTimeToUtc(`${startDay}T00:00`, timezone),
    to: localDateTimeToUtc(`${addCivilDays(endDay, 1)}T00:00`, timezone),
  }
}

const aggregateDecimal = (value: unknown): string => String(value ?? '0')

export async function operationsReportHandler(ctx: Ctx, args: Row) {
  const ledger = await ledgerOf(ctx)
  const window = operationsWindow(args.dateFrom, args.dateTo, ledger.timezone)
  if (window.ok !== true) return window
  if (args.configId && !(await ctx.db.select('pos.Config', { id: args.configId }))[0])
    return invalid('configId', 'point of sale configuration does not exist')

  const order = ctx.table('pos.Order')
  const payment = ctx.table('pos.Payment')
  const movement = ctx.table('pos.CashMovement')
  const event = ctx.table('pos.AuditEvent')
  const orderScope = args.configId ? [eq(order.configId, args.configId)] : []
  const financialOrderBase = from(order).where(
    inArray(order.state, ['paid', 'done']),
    or(
      and(gte(order.finalizedAt, window.from), lt(order.finalizedAt, window.to)),
      and(isNull(order.finalizedAt), gte(order.dateOrder, window.from), lt(order.dateOrder, window.to)),
    ),
    ...orderScope,
  )
  const missingFinalizedAt = from(order).where(
    inArray(order.state, ['paid', 'done']),
    isNull(order.finalizedAt),
    ...(args.configId ? [eq(order.configId, args.configId)] : []),
  )
  const paymentWindow = from(payment).where(
    gte(payment.paymentDate, window.from),
    lt(payment.paymentDate, window.to),
  )
  const paymentBase = args.configId ? paymentWindow.where(eq(payment.configId, args.configId)) : paymentWindow
  const movementWindow = from(movement).where(
    gte(movement.occurredAt, window.from),
    lt(movement.occurredAt, window.to),
  )
  const movementBase = args.configId
    ? movementWindow.where(eq(movement.configId, args.configId))
    : movementWindow
  const auditWindow = from(event).where(gte(event.occurredAt, window.from), lt(event.occurredAt, window.to))
  const auditBase = args.configId ? auditWindow.where(eq(event.configId, args.configId)) : auditWindow
  const auditLimit = Math.max(1, Math.min(200, Math.trunc(n(args.auditLimit ?? 100)) || 100))
  const [
    orderGroups,
    paymentGroups,
    movementGroups,
    auditGroups,
    auditRows,
    missingPaymentScope,
    missingPaymentCurrency,
    missingMovementScope,
    missingAuditScope,
    missingOrderFinalizedAt,
    auditTotal,
    auditTraceGaps,
  ] = await Promise.all([
    ctx.db.group(
      financialOrderBase
        .groupBy({ col: order.isRefund }, { col: order.currency })
        .aggregate({ fn: 'sum', col: order.amountTotal, as: 'amount' }),
    ),
    ctx.db.group(
      paymentBase
        .groupBy({ col: payment.state }, { col: payment.kind }, { col: payment.currency })
        .aggregate({ fn: 'sum', col: payment.appliedAmount, as: 'amount' }),
    ),
    ctx.db.group(
      movementBase
        .groupBy({ col: movement.direction })
        .aggregate({ fn: 'sum', col: movement.amount, as: 'amount' }),
    ),
    ctx.db.group(auditBase.groupBy({ col: event.action })),
    ctx.db.all(auditBase.orderBy(desc(event.occurredAt), desc(event.id)).limit(auditLimit + 1)),
    ctx.db.count(paymentWindow.where(isNull(payment.configId))),
    ctx.db.count(paymentWindow.where(isNull(payment.currency))),
    ctx.db.count(movementWindow.where(isNull(movement.configId))),
    ctx.db.count(auditWindow.where(isNull(event.configId))),
    ctx.db.count(missingFinalizedAt),
    ctx.db.count(auditBase),
    ctx.db.count(auditBase.where(isNull(event.correlationHash))),
  ])
  const currency = ledger.currency

  const orderCurrencies = new Map<
    string,
    { currency: string; sales: string[]; refunds: string[]; saleCount: number; returnCount: number }
  >()
  for (const group of orderGroups) {
    const [isRefund, heldCurrency] = group.key
    const code = String(heldCurrency)
    const current = orderCurrencies.get(code) ?? {
      currency: code,
      sales: [],
      refunds: [],
      saleCount: 0,
      returnCount: 0,
    }
    if (isRefund === true) {
      current.refunds.push(aggregateDecimal(group.aggregates.amount))
      current.returnCount += group.count
    } else {
      current.sales.push(aggregateDecimal(group.aggregates.amount))
      current.saleCount += group.count
    }
    orderCurrencies.set(code, current)
  }
  const sales = [...orderCurrencies.values()].map((row) => {
    const scale = scaleOf(row.currency)
    const gross = sumMoneyMinor(row.sales, scale)
    const refunds = sumMoneyMinor(row.refunds, scale)
    return {
      currency: row.currency,
      saleCount: row.saleCount,
      returnCount: row.returnCount,
      grossSales: minorText(gross, scale),
      refunds: minorText(refunds, scale),
      netSales: minorText(gross + refunds, scale),
    }
  })
  const tenderMap = new Map<
    string,
    { state: string; kind: string; currency: string; count: number; amount: bigint }
  >()
  for (const group of paymentGroups) {
    const state = String(group.key[0])
    const kind = String(group.key[1])
    const code = group.key[2] == null ? currency : String(group.key[2])
    const key = `${state}\0${kind}\0${code}`
    const held = tenderMap.get(key) ?? { state, kind, currency: code, count: 0, amount: 0n }
    held.count += group.count
    held.amount += moneyMinor(aggregateDecimal(group.aggregates.amount), scaleOf(code))
    tenderMap.set(key, held)
  }
  const tenders = [...tenderMap.values()].map((row) => ({
    state: row.state,
    kind: row.kind,
    currency: row.currency,
    count: row.count,
    amount: minorText(row.amount, scaleOf(row.currency)),
  }))
  const cashScale = scaleOf(currency)
  let cashIn = 0n
  let cashOut = 0n
  let cashCount = 0
  for (const group of movementGroups) {
    const amount = moneyMinor(aggregateDecimal(group.aggregates.amount), cashScale)
    cashCount += group.count
    if (group.key[0] === 'in') cashIn += amount
    else if (group.key[0] === 'out') cashOut += amount
  }
  const actions = Object.fromEntries(auditGroups.map((group) => [String(group.key[0]), group.count]))
  const unscopedAudit = args.configId ? missingAuditScope : 0
  const coreAuditTotal = auditTotal + unscopedAudit
  const coreTraceGaps = auditTraceGaps + unscopedAudit
  const traceRatio = coreAuditTotal
    ? Number(((coreAuditTotal - coreTraceGaps) / coreAuditTotal).toFixed(6))
    : 1
  return {
    ok: true,
    report: {
      scope: {
        companyId: String(ctx.scope.company ?? ''),
        configId: args.configId ?? null,
        dateFrom: String(args.dateFrom),
        dateTo: String(args.dateTo),
        from: window.from,
        toExclusive: window.to,
        timezone: ledger.timezone,
      },
      scopeCoverage: {
        complete:
          missingPaymentScope === 0 &&
          missingPaymentCurrency === 0 &&
          missingMovementScope === 0 &&
          missingAuditScope === 0 &&
          missingOrderFinalizedAt === 0 &&
          coreTraceGaps === 0,
        missingPaymentScope,
        missingPaymentCurrency,
        missingMovementScope,
        missingAuditScope,
        missingOrderFinalizedAt,
        missingAuditCorrelation: coreTraceGaps,
      },
      orders: { sales, cancelledCount: actions['order.cancelled'] ?? 0 },
      tenders,
      cash: {
        currency,
        count: cashCount,
        cashIn: minorText(cashIn, cashScale),
        cashOut: minorText(cashOut, cashScale),
        net: minorText(cashIn - cashOut, cashScale),
      },
      shifts: {
        opened: actions['session.opened'] ?? 0,
        closed: actions['session.closed'] ?? 0,
        variancePending: actions['session.variance_pending'] ?? 0,
        varianceApproved: actions['session.variance_approved'] ?? 0,
      },
      exceptions: {
        cancelledOrders: actions['order.cancelled'] ?? 0,
        voidedTenders: actions['payment.voided'] ?? 0,
        reversedCashMovements: actions['cash_movement.reversed'] ?? 0,
        pendingVariances: actions['session.variance_pending'] ?? 0,
      },
      observability: {
        metrics: {
          auditEventTotal: coreAuditTotal,
          exceptionTotal:
            (actions['order.cancelled'] ?? 0) +
            (actions['payment.voided'] ?? 0) +
            (actions['cash_movement.reversed'] ?? 0) +
            (actions['session.variance_pending'] ?? 0),
        },
        traceCoverage: { coreAuditTotal, coreTraceGaps, ratio: traceRatio },
        alerts: coreTraceGaps ? [{ code: 'core_trace_gap', severity: 'warning', count: coreTraceGaps }] : [],
      },
      audit: {
        events: auditRows.slice(0, auditLimit).map(projectedAudit),
        limit: auditLimit,
        truncated: auditRows.length > auditLimit,
      },
    },
  }
}

export const reportsFunctions: Record<string, FnSpec> = {
  operationsReport: defineFn({
    input: { dateFrom: 'date', dateTo: 'date', configId: 'id?', auditLimit: 'int?' },
    output: { ok: 'bool', report: 'json?', errors: 'json?' },
    effects: [
      'read:pos.Config',
      'read:pos.Order',
      'read:pos.Payment',
      'read:pos.CashMovement',
      'read:pos.AuditEvent',
      'read:company.Company',
    ],
    agent: true,
    handler: operationsReportHandler,
  }),
}
