import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as accountFunctions, insertDraftMove } from '../../account/functions.ts'
import { minorText, moneyMinor, scaleOf } from '../../account/money.ts'
import {
  absoluteMinor,
  accountEffects,
  appendAudit,
  claimSessionRevision,
  currencyOf,
  invalid,
  n,
  now,
} from './helpers.ts'

async function sessionCashMinor(ctx: Ctx, session: Row, scale: number): Promise<bigint> {
  let expected = moneyMinor(session.cashRegisterBalanceStart, scale)
  const orders = await ctx.db.select('pos.Order', { sessionId: session.id })
  for (const order of orders)
    for (const payment of await ctx.db.select('pos.Payment', { orderId: order.id })) {
      if ((payment.state ?? 'captured') !== 'captured') continue
      const method = (await ctx.db.select('pos.PaymentMethod', { id: payment.paymentMethodId }))[0]
      if (method?.isCash) expected += moneyMinor(payment.appliedAmount ?? payment.amount, scale)
    }
  for (const movement of await ctx.db.select('pos.CashMovement', { sessionId: session.id })) {
    const amount = moneyMinor(movement.amount, scale)
    expected += movement.direction === 'in' ? amount : -amount
  }
  return expected
}

async function createCashAdjustmentAccounting(
  ctx: Ctx,
  session: Row,
  config: Row,
  adjustmentId: string,
  difference: unknown,
) {
  if (!config.cashOverShortAccountId)
    throw new Error('a cash over/short clearing account is required before approving variance')
  const links = await ctx.db.select('pos.ConfigPaymentMethod', { configId: config.id })
  let method: Row | undefined
  for (const link of links) {
    const held = (await ctx.db.select('pos.PaymentMethod', { id: link.paymentMethodId }))[0]
    if (held?.isCash) {
      method = held
      break
    }
  }
  if (!method) throw new Error('the POS configuration needs a cash payment method')
  const journal = (await ctx.db.select('account.Journal', { id: method.journalId }))[0]
  if (!journal?.defaultAccountId) throw new Error('the cash journal needs a default account')
  const moveId = `${adjustmentId}:account`
  if (!(await ctx.db.select('account.Move', { id: moveId }))[0]) {
    const currency = await currencyOf(ctx)
    const scale = scaleOf(currency)
    const signed = moneyMinor(difference, scale)
    const amount = signed < 0n ? -signed : signed
    const zero = minorText(0n, scale)
    const amountText = minorText(amount, scale)
    await ctx.tx(async (tx) => {
      const move: Row = {
        id: moveId,
        name: moveId,
        ref: `POS cash variance ${String(session.name)}`,
        date: now(),
        moveType: 'entry',
        state: 'draft',
        journalId: method.journalId,
        partnerId: null,
        invoiceDate: null,
        invoiceDateDue: null,
        paymentTermId: null,
        paymentState: 'paid',
        currency,
        amountUntaxed: amountText,
        amountTax: zero,
        amountTotal: amountText,
        postedAt: null,
        revision: 0,
      }
      const lines: Row[] = [
        {
          id: `${moveId}:cash`,
          moveId,
          name: method.name,
          accountId: journal.defaultAccountId,
          partnerId: null,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: amountText,
          discount: '0',
          taxId: null,
          debit: signed > 0n ? amountText : zero,
          credit: signed < 0n ? amountText : zero,
          balance: minorText(signed, scale),
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: zero,
          sequence: 10,
        },
        {
          id: `${moveId}:clearing`,
          moveId,
          name: 'Cash over/short',
          accountId: config.cashOverShortAccountId,
          partnerId: null,
          productId: null,
          productUomId: null,
          quantity: '1',
          priceUnit: amountText,
          discount: '0',
          taxId: null,
          debit: signed < 0n ? amountText : zero,
          credit: signed > 0n ? amountText : zero,
          balance: minorText(-signed, scale),
          dateMaturity: null,
          displayType: null,
          reconciled: false,
          amountResidual: zero,
          sequence: 20,
        },
      ]
      await insertDraftMove(tx, { move, lines })
    })
  }
  const posted = (await accountFunctions.postMove!.handler(ctx, { id: moveId })) as Row
  if (posted.ok !== true) throw new Error('cash variance accounting move could not be posted')
  return moveId
}

export function listSessionsHandler(ctx: Ctx, args: Row) {
  return args.state ? ctx.db.select('pos.Session', { state: args.state }) : ctx.db.select('pos.Session')
}

export async function getSessionHandler(ctx: Ctx, args: Row) {
  const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
  if (!session) return null
  const orders = await ctx.db.select('pos.Order', { sessionId: args.id })
  const scale = scaleOf(await currencyOf(ctx))
  const expectedCash = await sessionCashMinor(ctx, session, scale)
  const cashMovements = await ctx.db.select('pos.CashMovement', { sessionId: args.id })
  return { ...session, cashRegisterBalanceEnd: minorText(expectedCash, scale), orders, cashMovements }
}

export async function createSessionHandler(ctx: Ctx, args: Row) {
  const scale = scaleOf(await currencyOf(ctx))
  const openingCash = moneyMinor(args.openingCash ?? '0', scale)
  const existing = (await ctx.db.select('pos.Session', { id: args.id }))[0]
  if (existing) {
    const same =
      existing.configId === args.configId &&
      existing.userId === args.userId &&
      (args.deviceId === undefined || existing.deviceId === args.deviceId) &&
      (args.openingCash === undefined ||
        moneyMinor(existing.cashRegisterBalanceStart, scale) === openingCash) &&
      (args.openingNotes === undefined || existing.openingNotes === args.openingNotes)
    return same
      ? { ok: true, id: args.id, revision: n(existing.revision) }
      : invalid('id', 'session id is already used by a different command')
  }
  if (!(await ctx.db.select('pos.Config', { id: args.configId }))[0])
    return invalid('configId', 'point of sale does not exist')
  if (!(await ctx.db.select('user.User', { id: args.userId }))[0])
    return invalid('userId', 'operator does not exist')
  let lock = (await ctx.db.select('pos.SessionLock', { id: args.configId }))[0]
  if (!lock) {
    await ctx.db.insertIfAbsent('pos.SessionLock', { id: args.configId, sessionId: args.id })
    lock = (await ctx.db.select('pos.SessionLock', { id: args.configId }))[0]
  }
  if (lock?.sessionId !== args.id) {
    const active = (await ctx.db.select('pos.Session', { id: lock?.sessionId }))[0]
    if (active && !['closed', 'pending_approval'].includes(String(active.state)))
      return invalid('configId', 'this point of sale already has an active session')
    const changed = await ctx.db.compareAndSet(
      'pos.SessionLock',
      { id: args.configId },
      { sessionId: lock?.sessionId },
      { sessionId: args.id },
    )
    if (!('dryRun' in changed) && !changed.matched)
      return invalid('configId', 'this point of sale already has an active session')
  }
  await ctx.db.insert('pos.Session', {
    id: args.id,
    name: `POS/${String(args.id)}`,
    configId: args.configId,
    userId: args.userId,
    deviceId: args.deviceId ?? null,
    state: 'opening_control',
    startAt: null,
    stopAt: null,
    openingNotes: args.openingNotes ?? null,
    closingNotes: null,
    cashRegisterBalanceStart: minorText(openingCash, scale),
    cashRegisterBalanceEnd: minorText(openingCash, scale),
    cashRegisterBalanceEndReal: minorText(openingCash, scale),
    cashRegisterDifference: minorText(0n, scale),
    varianceStatus: 'none',
    varianceReason: null,
    varianceNote: null,
    varianceApprovedBy: null,
    varianceApprovedAt: null,
    cashAdjustmentId: null,
    revision: 0,
  })
  await appendAudit(ctx, {
    id: `session:${String(args.id)}:created`,
    subjectType: 'session',
    subjectId: String(args.id),
    configId: args.configId,
    sessionId: args.id,
    action: 'session.created',
    actorId: args.userId,
    deviceId: args.deviceId,
    details: { configId: args.configId, openingCash: minorText(openingCash, scale) },
  })
  return { ok: true, id: args.id, revision: 0 }
}

export async function openSessionHandler(ctx: Ctx, args: Row) {
  const held = (await ctx.db.select('pos.Session', { id: args.id }))[0]
  if (held?.state === 'opened') return { ok: true, id: args.id, revision: n(held.revision) }
  if (held?.state !== 'opening_control') return invalid('state', 'only opening control can be opened')
  const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.update('pos.Session', { id: args.id }, { state: 'opened', startAt: held.startAt ?? now() })
  await appendAudit(ctx, {
    id: `session:${String(args.id)}:opened`,
    subjectType: 'session',
    subjectId: String(args.id),
    configId: held.configId,
    sessionId: args.id,
    action: 'session.opened',
    actorId: held.userId,
    deviceId: held.deviceId,
    details: { revision: claim.revision },
  })
  return { ok: true, id: args.id, revision: claim.revision }
}

export async function startClosingHandler(ctx: Ctx, args: Row) {
  const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
  if (session?.state === 'closing_control') return { ok: true, id: args.id, revision: n(session.revision) }
  if (session?.state !== 'opened') return invalid('state', 'only an open session can enter closing control')
  if ((await ctx.db.select('pos.Order', { sessionId: args.id })).some((order) => order.state === 'draft'))
    return invalid('orders', 'pay or cancel every draft order before closing')
  const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.update('pos.Session', { id: args.id }, { state: 'closing_control' })
  await appendAudit(ctx, {
    id: `session:${String(args.id)}:closing`,
    subjectType: 'session',
    subjectId: String(args.id),
    configId: session.configId,
    sessionId: args.id,
    action: 'session.closing_started',
    actorId: session.userId,
    deviceId: session.deviceId,
    details: { revision: claim.revision },
  })
  return { ok: true, id: args.id, revision: claim.revision }
}

export async function closeSessionHandler(ctx: Ctx, args: Row) {
  const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
  if (!session) return invalid('id', 'session does not exist')
  if (['closed', 'pending_approval'].includes(String(session.state)))
    return {
      ok: true,
      id: args.id,
      revision: n(session.revision),
      difference: session.cashRegisterDifference,
      pendingApproval: session.state === 'pending_approval',
    }
  if (session.state !== 'closing_control') return invalid('state', 'session must be in closing control')
  const config = (await ctx.db.select('pos.Config', { id: session.configId }))[0]!,
    orders = await ctx.db.select('pos.Order', { sessionId: args.id })
  const scale = scaleOf(await currencyOf(ctx))
  const cash = await sessionCashMinor(ctx, session, scale)
  const closingCash = moneyMinor(args.closingCash, scale)
  const difference = closingCash - cash
  const maximumDifference = moneyMinor(config.maximumDifference ?? '0', scale)
  const pendingApproval = absoluteMinor(difference) > maximumDifference
  if (pendingApproval && !String(args.varianceReason ?? '').trim())
    return invalid('varianceReason', 'cash difference requires a reason before sealing the shift')
  const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
  if (claim.ok !== true) return claim
  for (const order of orders)
    if (order.state === 'paid') await ctx.db.update('pos.Order', { id: order.id }, { state: 'done' })
  await ctx.db.update(
    'pos.Session',
    { id: args.id },
    {
      state: pendingApproval ? 'pending_approval' : 'closed',
      stopAt: now(),
      closingNotes: args.closingNotes ?? null,
      cashRegisterBalanceEnd: minorText(cash, scale),
      cashRegisterBalanceEndReal: minorText(closingCash, scale),
      cashRegisterDifference: minorText(difference, scale),
      varianceStatus: pendingApproval ? 'pending' : 'none',
      varianceReason: pendingApproval ? String(args.varianceReason) : null,
      varianceNote: pendingApproval ? (args.varianceNote ?? null) : null,
    },
  )
  await appendAudit(ctx, {
    id: `session:${String(args.id)}:sealed`,
    subjectType: 'session',
    subjectId: String(args.id),
    configId: session.configId,
    sessionId: args.id,
    action: pendingApproval ? 'session.variance_pending' : 'session.closed',
    actorId: session.userId,
    deviceId: session.deviceId,
    reason: pendingApproval ? args.varianceReason : undefined,
    details: {
      expectedCash: minorText(cash, scale),
      countedCash: minorText(closingCash, scale),
      difference: minorText(difference, scale),
      revision: claim.revision,
    },
  })
  return {
    ok: true,
    id: args.id,
    revision: claim.revision,
    difference: minorText(difference, scale),
    pendingApproval,
  }
}

export async function recountSessionHandler(ctx: Ctx, args: Row) {
  const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
  if (session?.state !== 'pending_approval')
    return invalid('state', 'only a sealed variance can be recounted')
  const config = (await ctx.db.select('pos.Config', { id: session.configId }))[0]!
  const scale = scaleOf(await currencyOf(ctx))
  const countedCash = moneyMinor(args.countedCash, scale)
  const difference = countedCash - moneyMinor(session.cashRegisterBalanceEnd, scale)
  const maximumDifference = moneyMinor(config.maximumDifference ?? '0', scale)
  const pendingApproval = absoluteMinor(difference) > maximumDifference
  const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
  if (claim.ok !== true) return claim
  await ctx.db.update(
    'pos.Session',
    { id: args.id },
    {
      state: pendingApproval ? 'pending_approval' : 'closed',
      cashRegisterBalanceEndReal: minorText(countedCash, scale),
      cashRegisterDifference: minorText(difference, scale),
      varianceStatus: pendingApproval ? 'pending' : 'corrected',
      varianceNote: args.note ?? session.varianceNote ?? null,
      varianceApprovedBy: pendingApproval ? null : args.reviewedBy,
      varianceApprovedAt: pendingApproval ? null : now(),
    },
  )
  await appendAudit(ctx, {
    id: `session:${String(args.id)}:recount:${String(claim.revision)}`,
    subjectType: 'session',
    subjectId: String(args.id),
    configId: session.configId,
    sessionId: args.id,
    action: pendingApproval ? 'session.recount_pending' : 'session.recount_accepted',
    actorId: args.reviewedBy,
    deviceId: session.deviceId,
    reason: args.note,
    details: {
      countedCash: minorText(countedCash, scale),
      difference: minorText(difference, scale),
      revision: claim.revision,
    },
  })
  return {
    ok: true,
    id: args.id,
    revision: claim.revision,
    difference: minorText(difference, scale),
    pendingApproval,
  }
}

export async function approveSessionVarianceHandler(ctx: Ctx, args: Row) {
  const session = (await ctx.db.select('pos.Session', { id: args.id }))[0]
  if (!session) return invalid('id', 'session does not exist')
  if (session.varianceStatus === 'approved') {
    const adjustment = (await ctx.db.select('pos.CashAdjustment', { sessionId: args.id }))[0]
    return {
      ok: true,
      id: args.id,
      revision: n(session.revision),
      adjustmentId: adjustment?.id,
      accountMoveId: adjustment?.accountMoveId,
    }
  }
  if (session.state !== 'pending_approval') return invalid('state', 'only a sealed variance can be approved')
  const config = (await ctx.db.select('pos.Config', { id: session.configId }))[0]!
  const claim = await claimSessionRevision(ctx, args.id, args.expectedRevision)
  if (claim.ok !== true) return claim
  const adjustmentId = `${String(args.id)}:variance`
  let accountMoveId: string
  try {
    accountMoveId = await createCashAdjustmentAccounting(
      ctx,
      session,
      config,
      adjustmentId,
      session.cashRegisterDifference,
    )
  } catch (error) {
    return invalid('accounting', (error as Error).message)
  }
  await ctx.db.insertIfAbsent('pos.CashAdjustment', {
    id: adjustmentId,
    sessionId: args.id,
    amount: session.cashRegisterDifference,
    reason: session.varianceReason,
    note: args.note ?? session.varianceNote ?? null,
    approvedBy: args.approvedBy,
    approvedAt: now(),
    accountMoveId,
  })
  await ctx.db.update(
    'pos.Session',
    { id: args.id },
    {
      state: 'closed',
      varianceStatus: 'approved',
      varianceNote: args.note ?? session.varianceNote ?? null,
      varianceApprovedBy: args.approvedBy,
      varianceApprovedAt: now(),
      cashAdjustmentId: adjustmentId,
    },
  )
  await appendAudit(ctx, {
    id: `session:${String(args.id)}:variance-approved`,
    subjectType: 'session',
    subjectId: String(args.id),
    configId: session.configId,
    sessionId: args.id,
    action: 'session.variance_approved',
    actorId: args.approvedBy,
    deviceId: session.deviceId,
    reason: args.note ?? session.varianceReason,
    relatedId: adjustmentId,
    details: {
      difference: session.cashRegisterDifference,
      accountMoveId,
      revision: claim.revision,
    },
  })
  return { ok: true, id: args.id, revision: claim.revision, adjustmentId, accountMoveId }
}

export const sessionsFunctions: Record<string, FnSpec> = {
  listSessions: defineFn({
    input: { state: 'text?' },
    effects: ['read:pos.Session'],
    agent: true,
    handler: listSessionsHandler,
  }),
  getSession: defineFn({
    input: { id: 'id' },
    effects: [
      'read:pos.Session',
      'read:pos.Order',
      'read:pos.Payment',
      'read:pos.PaymentMethod',
      'read:pos.CashMovement',
      'read:company.Company',
    ],
    agent: true,
    handler: getSessionHandler,
  }),
  createSession: defineFn({
    input: {
      id: 'id',
      configId: 'id',
      userId: 'id',
      deviceId: 'text?',
      openingCash: 'decimal?',
      openingNotes: 'text?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.SessionLock',
      'write:pos.SessionLock',
      'read:pos.Config',
      'read:user.User',
      'read:company.Company',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    // Two tills opening one point of sale race between reading its lock and inserting the
    // session the lock names; one transaction makes that a single step.
    handler: (ctx, args) => ctx.tx((tx) => createSessionHandler(tx, args)),
  }),
  openSession: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Session', 'write:pos.Session', 'write:pos.AuditEvent'],
    idempotent: true,
    agent: true,
    handler: openSessionHandler,
  }),
  startClosing: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: ['read:pos.Session', 'read:pos.Order', 'write:pos.Session', 'write:pos.AuditEvent'],
    idempotent: true,
    agent: true,
    handler: startClosingHandler,
  }),
  closeSession: defineFn({
    input: {
      id: 'id',
      closingCash: 'decimal',
      closingNotes: 'text?',
      varianceReason: 'text?',
      varianceNote: 'text?',
      expectedRevision: 'int?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      difference: 'decimal?',
      pendingApproval: 'bool?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.Config',
      'read:pos.Order',
      'read:pos.Payment',
      'read:pos.PaymentMethod',
      'read:pos.CashMovement',
      'write:pos.Order',
      'read:company.Company',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: closeSessionHandler,
  }),
  recountSession: defineFn({
    input: { id: 'id', countedCash: 'decimal', expectedRevision: 'int', reviewedBy: 'text', note: 'text?' },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      difference: 'decimal?',
      pendingApproval: 'bool?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.Config',
      'read:company.Company',
      'write:pos.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: recountSessionHandler,
  }),
  approveSessionVariance: defineFn({
    input: { id: 'id', expectedRevision: 'int', approvedBy: 'text', note: 'text?' },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      adjustmentId: 'id?',
      accountMoveId: 'id?',
      errors: 'json?',
    },
    effects: [
      'read:pos.Session',
      'write:pos.Session',
      'read:pos.Config',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pos.CashAdjustment',
      'write:pos.CashAdjustment',
      'read:account.Journal',
      'read:account.Move',
      'write:account.Move',
      'write:account.MoveLine',
      'read:company.Company',
      'write:pos.AuditEvent',
      ...accountEffects,
    ],
    idempotent: true,
    agent: true,
    handler: approveSessionVarianceHandler,
  }),
}
