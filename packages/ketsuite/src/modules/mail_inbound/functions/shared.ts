import { KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

export const inboundMutationEffects = [
  'read:mail_inbound.InboundEvent',
  'write:mail_inbound.InboundEvent',
  'read:mail_inbound.ReplyToken',
  'read:mail_inbound.Alias',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'read:mail_transport.DeliveryNotification',
  'read:mail.Thread',
  'read:mail.Message',
  'write:mail.Message',
  'read:mail.Subtype',
  'read:mail.Follower',
  'read:mail.FollowerSubtype',
  'read:user.User',
  'read:partner.Partner',
  'read:storage.Attachment',
  'write:storage.Attachment',
  'write:mail.Mention',
  'write:mail.MessageAttachment',
  'write:mail.TrackingValue',
  'write:mail.Notification',
]

export const inboundInput = {
  provider: 'text',
  providerEventId: 'text',
  kind: 'text',
  fromAddress: 'text?',
  recipients: 'json',
  subject: 'text?',
  text: 'text?',
  html: 'text?',
  references: 'json?',
  replyToken: 'text?',
  alias: 'text?',
  attachments: 'json?',
  receivedAt: 'datetime',
} as const

export const inboundOutput = {
  id: 'id',
  duplicate: 'bool',
  state: 'text',
  threadId: 'id?',
  messageId: 'id?',
  targetId: 'id?',
} as const

export const actor = (ctx: Ctx): string => {
  if (!ctx.actor)
    throw new KetError({
      code: 'E_INBOUND_ACTOR_REQUIRED',
      module: 'mail_inbound',
      message: 'inbound administration requires a signed-in user',
    })
  return ctx.actor
}
