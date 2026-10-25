import { defineFn, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { jsonValue } from '../template.ts'
import { PROVIDER_EVENT_TYPES } from '../types.ts'
import { actor } from './shared.ts'

export function recordProviderEventHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    actor(tx)
    if (!PROVIDER_EVENT_TYPES.includes(String(args.type) as never))
      throw new KetError({
        code: 'E_MAIL_PROVIDER_EVENT',
        module: 'mail_transport',
        message: `unknown provider event "${String(args.type)}"`,
      })
    const P = tx.table('mail_transport.ProviderEvent')
    const existing = await tx.db.one(
      from(P).where(eq(P.provider, args.provider), eq(P.providerEventId, args.providerEventId)),
    )
    if (existing) {
      const D = tx.table('mail_transport.Delivery')
      const delivery = existing.deliveryId
        ? await tx.db.one(from(D).where(eq(D.id, existing.deliveryId)))
        : null
      return {
        id: existing.id,
        duplicate: true,
        ...(delivery ? { deliveryId: delivery.id, state: delivery.state } : {}),
      }
    }
    const D = tx.table('mail_transport.Delivery')
    const delivery = await tx.db.one(from(D).where(eq(D.providerMessageId, args.providerMessageId)))
    await tx.db.insert('mail_transport.ProviderEvent', {
      id: args.id,
      provider: String(args.provider),
      providerEventId: String(args.providerEventId),
      type: String(args.type),
      ...(delivery ? { deliveryId: delivery.id } : {}),
      providerMessageId: String(args.providerMessageId),
      payload: args.payload,
      occurredAt: args.occurredAt,
      createdAt: new Date().toISOString(),
    })
    if (!delivery) return { id: args.id, duplicate: false }
    let state = String(delivery.state)
    if (args.type === 'bounced' || args.type === 'complained') {
      state = 'failed'
      const detail = jsonValue<Record<string, unknown>>(args.payload, {})
      const reason = String(detail.reason ?? `provider reported ${String(args.type)}`).slice(0, 4_000)
      await tx.db.update(
        'mail_transport.Delivery',
        { id: delivery.id },
        { state, lastError: reason, updatedAt: new Date().toISOString() },
      )
      const J = tx.table('mail_transport.DeliveryNotification')
      const joins = await tx.db.all(from(J).where(eq(J.deliveryId, delivery.id)))
      for (const join of joins)
        await tx.db.update(
          'mail.Notification',
          { id: join.notificationId },
          { state: 'failed', failureReason: reason },
        )
    }
    return { id: args.id, duplicate: false, deliveryId: delivery.id, state }
  })
}

export const eventsFunctions: Record<string, FnSpec> = {
  recordProviderEvent: defineFn({
    input: {
      id: 'id',
      provider: 'text',
      providerEventId: 'text',
      type: 'text',
      providerMessageId: 'text',
      payload: 'json',
      occurredAt: 'datetime',
    },
    output: { id: 'id', duplicate: 'bool', deliveryId: 'id?', state: 'text?' },
    effects: [
      'read:mail_transport.ProviderEvent',
      'write:mail_transport.ProviderEvent',
      'read:mail_transport.Delivery',
      'write:mail_transport.Delivery',
      'read:mail_transport.DeliveryNotification',
      'write:mail.Notification',
    ],
    idempotent: true,
    handler: recordProviderEventHandler,
  }),
}
