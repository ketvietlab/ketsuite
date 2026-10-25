import { dispatchNotification, NOTIFICATION_DELIVERY_EFFECTS } from './notification-delivery.ts'
import { asc, eq, from, gt } from '@ketvietlab/ketjs'
import type { JobContext, JobSpec, Row } from '@ketvietlab/ketjs'
import { deliveryEnvelope } from './delivery-service.ts'

const notificationIds = async (ctx: JobContext, deliveryId: string): Promise<string[]> => {
  const J = ctx.table('mail_transport.DeliveryNotification')
  return (await ctx.db.all(from(J).where(eq(J.deliveryId, deliveryId)))).map((row) =>
    String(row.notificationId),
  )
}

const updateNotifications = async (
  ctx: JobContext,
  ids: string[],
  patch: Row,
  expectedState?: string,
): Promise<void> => {
  for (const id of ids)
    await ctx.db.update(
      'mail.Notification',
      { id, ...(expectedState ? { state: expectedState } : {}) },
      patch,
    )
}

export type MailDeliveryGuard = {
  name: string
  effects: string[]
  authorize: (ctx: JobContext, delivery: Row) => Promise<boolean>
}

export function createMailTransportJobs(guards: MailDeliveryGuard[] = []): Record<string, JobSpec> {
  if (new Set(guards.map((guard) => guard.name)).size !== guards.length)
    throw new Error('Duplicate mail delivery guard')
  return {
    notificationSweep: {
      queue: 'mail',
      input: { afterId: 'text?' },
      idempotent: true,
      crossCompany: true,
      schedule: { every: '1m' },
      effects: [
        'read:mail.Notification',
        'enqueue:mail_transport.dispatchNotification',
        'enqueue:mail_transport.notificationSweep',
      ],
      handler: async (ctx, args) => {
        const N = ctx.table('mail.Notification')
        const rows = await ctx.db.all(
          from(N)
            .where(
              eq(N.channel, 'email'),
              eq(N.state, 'ready'),
              ...(args.afterId ? [gt(N.id, args.afterId)] : []),
            )
            .orderBy(asc(N.id))
            .limit(100),
        )
        const minute = Math.floor(Date.now() / 60_000)
        for (const row of rows)
          await ctx.jobs.enqueue(
            'mail_transport.dispatchNotification',
            { notificationId: row.id },
            { company: String(row.companyId), uniqueKey: `mail-notification:${String(row.id)}:${minute}` },
          )
        if (rows.length === 100)
          await ctx.jobs.enqueue(
            'mail_transport.notificationSweep',
            { afterId: rows[99].id },
            { uniqueKey: `mail-notification-sweep:${minute}:${String(rows[99].id)}` },
          )
      },
    },
    dispatchNotification: {
      queue: 'mail',
      input: { notificationId: 'id' },
      idempotent: true,
      effects: NOTIFICATION_DELIVERY_EFFECTS,
      handler: async (ctx, args) => {
        await dispatchNotification(ctx, String(args.notificationId))
      },
    },
    deliver: {
      queue: 'mail',
      input: { deliveryId: 'id', version: 'int' },
      effects: [
        'read:mail_transport.Delivery',
        'write:mail_transport.Delivery',
        'read:mail_transport.DeliveryNotification',
        'write:mail.Notification',
        'transport:send',
        ...guards.flatMap((guard) => guard.effects),
      ],
      idempotent: true,
      maxAttempts: 5,
      timeoutMs: 30_000,
      handler: async (ctx: JobContext, args) => {
        const D = ctx.table('mail_transport.Delivery')
        let delivery = await ctx.db.one(from(D).where(eq(D.id, args.deliveryId)))
        if (!delivery || delivery.version !== args.version || delivery.state === 'cancelled') return
        if (delivery.state === 'sent') {
          await updateNotifications(
            ctx,
            await notificationIds(ctx, String(delivery.id)),
            { state: 'sent', failureReason: null },
            'ready',
          )
          return
        }
        if (!['queued', 'retryable', 'sending', 'failed'].includes(String(delivery.state)))
          throw new Error(`delivery has invalid state "${String(delivery.state)}"`)

        const attempts = Math.max(Number(delivery.attempts ?? 0), ctx.job.attempt)
        const claimed = await ctx.db.compareAndSet(
          'mail_transport.Delivery',
          { id: delivery.id },
          { state: delivery.state, version: delivery.version },
          { state: 'sending', attempts, updatedAt: new Date().toISOString() },
        )
        if ('dryRun' in claimed || !claimed.matched) {
          delivery = await ctx.db.one(from(D).where(eq(D.id, args.deliveryId)))
          if (!delivery || delivery.state === 'sent' || delivery.state === 'cancelled') return
          throw new Error('delivery claim was lost to another worker')
        }
        delivery = { ...delivery, state: 'sending', attempts }
        const boundNotifications = await notificationIds(ctx, String(delivery.id))
        try {
          // Recheck application-owned access immediately before the external send,
          // including every retry. A cancelled domain event sends no cached body.
          for (const guard of guards) {
            if (await guard.authorize(ctx, delivery)) continue
            await ctx.db.compareAndSet(
              'mail_transport.Delivery',
              { id: delivery.id },
              { state: 'sending', version: delivery.version },
              { state: 'cancelled', updatedAt: new Date().toISOString() },
            )
            await updateNotifications(ctx, boundNotifications, { state: 'cancelled', failureReason: null })
            return
          }
          const receipt = await ctx.transport.send(deliveryEnvelope(delivery), { signal: ctx.signal })
          const sentAt = receipt.acceptedAt || new Date().toISOString()
          const completed = await ctx.db.compareAndSet(
            'mail_transport.Delivery',
            { id: delivery.id },
            { state: 'sending', version: delivery.version },
            {
              state: 'sent',
              providerMessageId: receipt.providerMessageId,
              acceptedAt: receipt.acceptedAt,
              sentAt,
              lastError: null,
              updatedAt: new Date().toISOString(),
            },
          )
          if ('dryRun' in completed || !completed.matched)
            throw new Error('delivery changed while provider receipt was being persisted')
          await updateNotifications(ctx, boundNotifications, {
            state: 'sent',
            failureReason: null,
          })
        } catch (error) {
          const reason = String(error instanceof Error ? error.message : error).slice(0, 4_000)
          const terminal = ctx.job.attempt >= ctx.job.maxAttempts
          await ctx.db.compareAndSet(
            'mail_transport.Delivery',
            { id: delivery.id },
            { state: 'sending', version: delivery.version },
            {
              state: terminal ? 'failed' : 'retryable',
              lastError: reason,
              updatedAt: new Date().toISOString(),
            },
          )
          await updateNotifications(ctx, boundNotifications, {
            state: terminal ? 'failed' : 'ready',
            failureReason: reason,
          })
          throw error
        }
      },
    },
  }
}

export const jobs = createMailTransportJobs()
