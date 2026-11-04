import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { invalid, n, PurchaseRefused, claimRevision } from './shared.ts'
import { approvalConfirmEffects, approve, confirm } from '../fulfillment.ts'
import { clearApprovals } from '../approval.ts'

export async function sendRfqHandler(ctx: Ctx, args: Record<string, unknown>) {
  const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  if (!order || !['draft', 'sent'].includes(String(order.state)))
    return invalid('state', 'only a draft RFQ can be sent')
  await ctx.db.update('purchase.Order', { id: args.id }, { state: 'sent' })
  return { ok: true, id: args.id }
}

export function confirmOrderHandler(ctx: Ctx, args: Record<string, unknown>) {
  return confirm(ctx, args.id, args.requiresApproval === true, args.expectedRevision)
}

export function approveOrderHandler(ctx: Ctx, args: Record<string, unknown>) {
  return approve(ctx, args.id, 'manager', args.expectedRevision)
}

export function finalApproveOrderHandler(ctx: Ctx, args: Record<string, unknown>) {
  return approve(ctx, args.id, 'owner', args.expectedRevision)
}

export async function resetToDraftHandler(ctx: Ctx, args: Record<string, unknown>) {
  const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  if (!order) return invalid('id', 'purchase order does not exist')
  if (order.state === 'draft') return { ok: true, id: args.id, state: 'draft' }
  // An approver who wants the request changed had only one button, and it
  // destroyed the request. Sending it back is the ordinary answer; a
  // confirmed order is past that point because a receipt already exists.
  if (!['sent', 'to approve'].includes(String(order.state)))
    return invalid('state', 'only a request awaiting sending or approval can go back to draft')
  // Approvals belong to the submission they were given to; a resubmitted
  // order is approved again at its new total.
  await ctx.tx(async (tx) => {
    await clearApprovals(tx, args.id)
    await tx.db.update('purchase.Order', { id: args.id }, { state: 'draft', approvalLevels: null })
  })
  return { ok: true, id: args.id, state: 'draft' }
}

export async function lockOrderHandler(ctx: Ctx, args: Record<string, unknown>) {
  const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  if (order?.state !== 'purchase') return invalid('state', 'only a purchase order can be locked')
  await ctx.db.update('purchase.Order', { id: args.id }, { locked: args.locked })
  return { ok: true, id: args.id }
}

export async function cancelOrderHandler(ctx: Ctx, args: Record<string, unknown>) {
  const order = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  if (!order) return invalid('id', 'purchase order does not exist')
  if (args.expectedRevision !== undefined && n(order.revision) !== n(args.expectedRevision))
    return invalid('expectedRevision', 'purchase order changed')
  if (order.state === 'cancel') return { ok: true, id: args.id }
  try {
    await ctx.tx(async (tx) => {
      const current = (await tx.db.select('purchase.Order', { id: args.id }))[0]
      if (!current || !(await claimRevision(tx, current, args.expectedRevision)))
        throw new PurchaseRefused(invalid('expectedRevision', 'purchase order changed'))
      // Locking is the operator saying "no more changes"; cancellation is
      // the largest change there is.
      if (current.locked) throw new PurchaseRefused(invalid('state', 'a locked order cannot be cancelled'))
      const lines = await tx.db.select('purchase.OrderLine', { orderId: args.id })
      const moves: Row[] = []
      for (const line of lines) moves.push(...(await tx.db.select('stock.Move', { purchaseLineId: line.id })))
      if (moves.some((move) => move.state === 'done'))
        throw new PurchaseRefused(invalid('state', 'a received order cannot be cancelled'))
      for (const line of lines)
        if ((await tx.db.select('account.MoveLine', { purchaseLineId: line.id })).length)
          throw new PurchaseRefused(invalid('state', 'a billed order cannot be cancelled'))
      for (const move of moves) await tx.db.update('stock.Move', { id: move.id }, { state: 'cancel' })
      for (const pickingId of [...new Set(moves.map((move) => move.pickingId).filter(Boolean))])
        await tx.db.update('stock.Picking', { id: pickingId }, { state: 'cancel' })
      await tx.db.update('purchase.Order', { id: args.id }, { state: 'cancel' })
    })
    return { ok: true, id: args.id }
  } catch (error) {
    if (error instanceof PurchaseRefused) return error.result
    throw error
  }
}

export const lifecycleFunctions: Record<string, FnSpec> = {
  sendRfq: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:purchase.Order', 'write:purchase.Order'],
    idempotent: true,
    agent: true,
    handler: sendRfqHandler,
  }),
  confirmOrder: defineFn({
    input: { id: 'id', requiresApproval: 'bool?', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', pickingId: 'id?', errors: 'json?' },
    effects: [...approvalConfirmEffects],
    idempotent: true,
    agent: true,
    handler: confirmOrderHandler,
  }),
  approveOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: {
      ok: 'bool',
      id: 'id?',
      state: 'text?',
      pending: 'json?',
      pickingId: 'id?',
      errors: 'json?',
    },
    effects: [...approvalConfirmEffects],
    idempotent: true,
    agent: true,
    handler: approveOrderHandler,
  }),
  finalApproveOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: {
      ok: 'bool',
      id: 'id?',
      state: 'text?',
      pending: 'json?',
      pickingId: 'id?',
      errors: 'json?',
    },
    effects: [...approvalConfirmEffects],
    idempotent: true,
    agent: true,
    handler: finalApproveOrderHandler,
  }),
  resetToDraft: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: ['read:purchase.Order', 'write:purchase.Order', 'write:purchase.OrderApproval'],
    idempotent: true,
    agent: true,
    handler: resetToDraftHandler,
  }),
  lockOrder: defineFn({
    input: { id: 'id', locked: 'bool' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:purchase.Order', 'write:purchase.Order'],
    idempotent: true,
    agent: true,
    handler: lockOrderHandler,
  }),
  cancelOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:purchase.Order',
      'read:purchase.OrderLine',
      'read:stock.Move',
      'write:stock.Move',
      'read:stock.Picking',
      'write:stock.Picking',
      'read:account.MoveLine',
      'write:purchase.Order',
    ],
    idempotent: true,
    agent: true,
    handler: cancelOrderHandler,
  }),
}
