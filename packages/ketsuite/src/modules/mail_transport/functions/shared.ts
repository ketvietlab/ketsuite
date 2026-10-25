import { KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

export const actor = (ctx: Ctx): string => {
  if (!ctx.actor)
    throw new KetError({
      code: 'E_MAIL_ACTOR_REQUIRED',
      module: 'mail_transport',
      message: 'outbox operations require a signed-in user',
    })
  return ctx.actor
}

export const saveEffects = ['read:mail_transport.Template', 'write:mail_transport.Template']

export const queueEffects = [
  'read:mail_transport.Template',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'read:mail.Message',
  'read:mail.Notification',
  'write:mail_transport.DeliveryNotification',
  'enqueue:mail_transport.deliver',
]
