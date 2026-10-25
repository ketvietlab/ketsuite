import { outboxRows } from '../queries/outbox.ts'
import { DELIVERY_STATES } from '../types.ts'
import { defineFn, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { queueTemplate } from '../delivery-service.ts'
import { queueEffects, actor } from './shared.ts'

export function queueTemplateHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => ({
    delivery: deliveryMetadata(
      await queueTemplate(tx, {
        id: String(args.id),
        templateId: String(args.templateId),
        context: args.context,
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        headers: args.headers,
        messageId: args.messageId ? String(args.messageId) : undefined,
        notificationIds: args.notificationIds,
      }),
    ),
  }))
}

/** Public queue results never include the rendered message or private recipients/headers. */
function deliveryMetadata(row: Row) {
  return {
    id: row.id,
    state: row.state,
    version: row.version,
    attempts: row.attempts,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    queuedAt: row.queuedAt,
  }
}

export function listOutboxHandler(ctx: Ctx, args: Record<string, unknown>) {
  return outboxRows(ctx, args)
}

export async function searchOutboxHandler(ctx: Ctx, args: Record<string, unknown>) {
  actor(ctx)
  const state = DELIVERY_STATES.includes(String(args.state) as never) ? String(args.state) : ''
  const D = ctx.table('mail_transport.Delivery')
  const total = await ctx.db.count(from(D).where(...(state ? [eq(D.state, state)] : [])))
  const pageSize = Math.max(1, Math.min(100, Number(args.pageSize ?? 25)))
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.max(1, Math.min(pages, Number(args.page ?? 1)))
  const result = await outboxRows(ctx, { state, limit: pageSize, offset: (page - 1) * pageSize })
  return {
    query: { state, page, pageSize },
    total,
    page,
    pages,
    rows: result.deliveries,
    counts: {},
    isEmpty: !state ? total === 0 : (await ctx.db.count(from(D))) === 0,
  }
}

export function retryNotificationHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    actor(tx)
    const N = tx.table('mail.Notification')
    const row = await tx.db.one(from(N).where(eq(N.id, args.id), eq(N.channel, 'email')))
    if (!row) throw new Error('email notification is missing')
    const J = tx.table('mail_transport.DeliveryNotification')
    if (await tx.db.one(from(J).where(eq(J.notificationId, row.id))))
      throw new Error('retry the bound delivery instead')
    await tx.db.update('mail.Notification', { id: row.id }, { state: 'ready', failureReason: null })
    await tx.jobs.enqueue('mail_transport.dispatchNotification', { notificationId: row.id })
    return { id: row.id, state: 'ready' }
  })
}

export function retryHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    actor(tx)
    const D = tx.table('mail_transport.Delivery')
    const row = await tx.db.one(from(D).where(eq(D.id, args.id)))
    if (!row) throw new Error(`delivery "${String(args.id)}" does not exist`)
    if (row.state === 'sent') return { id: row.id, state: row.state }
    if (row.state === 'queued') return { id: row.id, state: row.state }
    if (row.state === 'sending')
      throw new KetError({
        code: 'E_MAIL_DELIVERY_SENDING',
        module: 'mail_transport',
        message: 'a sending delivery cannot be retried',
      })
    if (row.state === 'cancelled') throw new Error('cancelled delivery cannot be retried')
    const version = Number(row.version) + 1
    const result = await tx.db.compareAndSet(
      'mail_transport.Delivery',
      { id: row.id },
      { state: row.state, version: row.version },
      { state: 'queued', version, attempts: 0, lastError: null, updatedAt: new Date().toISOString() },
    )
    if ('dryRun' in result || !result.matched)
      throw new KetError({
        code: 'E_MAIL_DELIVERY_CONFLICT',
        module: 'mail_transport',
        message: 'delivery was claimed or changed; reload before retrying',
      })
    const J = tx.table('mail_transport.DeliveryNotification')
    for (const join of await tx.db.all(from(J).where(eq(J.deliveryId, row.id))))
      await tx.db.update(
        'mail.Notification',
        { id: join.notificationId },
        { state: 'ready', failureReason: null },
      )
    await tx.jobs.enqueue(
      'mail_transport.deliver',
      { deliveryId: row.id, version },
      { uniqueKey: `delivery:${String(row.id)}:v${version}` },
    )
    return { id: row.id, state: 'queued' }
  })
}

export function cancelHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    actor(tx)
    const D = tx.table('mail_transport.Delivery')
    const row = await tx.db.one(from(D).where(eq(D.id, args.id)))
    if (!row) throw new Error(`delivery "${String(args.id)}" does not exist`)
    if (row.state === 'cancelled') return { id: row.id, state: row.state }
    if (row.state === 'sending')
      throw new KetError({
        code: 'E_MAIL_DELIVERY_SENDING',
        module: 'mail_transport',
        message: 'a sending delivery cannot be cancelled',
      })
    if (row.state === 'sent') throw new Error('sent delivery cannot be cancelled')
    const result = await tx.db.compareAndSet(
      'mail_transport.Delivery',
      { id: row.id },
      { state: row.state, version: row.version },
      { state: 'cancelled', version: Number(row.version) + 1, updatedAt: new Date().toISOString() },
    )
    if ('dryRun' in result || !result.matched)
      throw new KetError({
        code: 'E_MAIL_DELIVERY_CONFLICT',
        module: 'mail_transport',
        message: 'delivery was claimed or changed; reload before cancelling',
      })
    const J = tx.table('mail_transport.DeliveryNotification')
    for (const join of await tx.db.all(from(J).where(eq(J.deliveryId, row.id))))
      await tx.db.update(
        'mail.Notification',
        { id: join.notificationId },
        { state: 'cancelled', failureReason: null },
      )
    return { id: row.id, state: 'cancelled' }
  })
}

export const outboxFunctions: Record<string, FnSpec> = {
  searchOutbox: defineFn({
    input: { state: 'text?', page: 'int?', pageSize: 'int?' },
    output: {
      query: 'json',
      total: 'int',
      page: 'int',
      pages: 'int',
      rows: 'json',
      counts: 'json',
      isEmpty: 'bool',
    },
    effects: [
      'read:mail_transport.Delivery',
      'read:mail_transport.Template',
      'read:mail.Message',
      'read:mail.Thread',
    ],
    handler: searchOutboxHandler,
  }),
  retryNotification: defineFn({
    input: { id: 'id' },
    output: { id: 'id', state: 'text' },
    effects: [
      'read:mail.Notification',
      'write:mail.Notification',
      'read:mail_transport.DeliveryNotification',
      'enqueue:mail_transport.dispatchNotification',
    ],
    idempotent: true,
    handler: retryNotificationHandler,
  }),
  queueTemplate: defineFn({
    input: {
      id: 'id',
      templateId: 'id',
      context: 'json',
      to: 'json',
      cc: 'json?',
      bcc: 'json?',
      headers: 'json?',
      messageId: 'id?',
      notificationIds: 'json?',
    },
    output: { delivery: 'json' },
    effects: queueEffects,
    idempotent: true,
    handler: queueTemplateHandler,
  }),
  listOutbox: defineFn({
    input: { state: 'text?', limit: 'int?' },
    output: { deliveries: 'json' },
    effects: [
      'read:mail_transport.Delivery',
      'read:mail_transport.Template',
      'read:mail_transport.DeliveryNotification',
      'read:mail.Notification',
      'read:mail.Message',
      'read:mail.Thread',
    ],
    handler: listOutboxHandler,
  }),
  retry: defineFn({
    input: { id: 'id' },
    output: { id: 'id', state: 'text' },
    effects: [
      'read:mail_transport.Delivery',
      'write:mail_transport.Delivery',
      'read:mail_transport.DeliveryNotification',
      'write:mail.Notification',
      'enqueue:mail_transport.deliver',
    ],
    idempotent: true,
    handler: retryHandler,
  }),
  cancel: defineFn({
    input: { id: 'id' },
    output: { id: 'id', state: 'text' },
    effects: [
      'read:mail_transport.Delivery',
      'write:mail_transport.Delivery',
      'read:mail_transport.DeliveryNotification',
      'write:mail.Notification',
    ],
    idempotent: true,
    handler: cancelHandler,
  }),
}
