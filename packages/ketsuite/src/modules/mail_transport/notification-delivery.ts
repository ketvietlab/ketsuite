import { eq, from } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { queueTemplate } from './delivery-service.ts'

export const NOTIFICATION_TEMPLATE_NAME = 'mail.notification'
export const NOTIFICATION_DELIVERY_EFFECTS = [
  'read:mail.Notification',
  'write:mail.Notification',
  'read:mail.Message',
  'read:mail.Thread',
  'read:partner.Partner',
  'read:user.User',
  'read:mail_transport.Template',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'read:mail_transport.DeliveryNotification',
  'write:mail_transport.DeliveryNotification',
  'enqueue:mail_transport.deliver',
]

/** Snapshot one recipient in the same transaction as its notification binding. */
export async function dispatchNotification(ctx: Ctx, notificationId: string): Promise<void> {
  await ctx.tx(async (tx) => {
    const N = tx.table('mail.Notification')
    const notification = await tx.db.one(
      from(N).where(eq(N.id, notificationId), eq(N.channel, 'email'), eq(N.state, 'ready')),
    )
    if (!notification) return
    const J = tx.table('mail_transport.DeliveryNotification')
    if (await tx.db.one(from(J).where(eq(J.notificationId, notificationId)))) return
    const fail = async (reason: string) => {
      await tx.db.update(
        'mail.Notification',
        { id: notificationId },
        { state: 'failed', failureReason: reason },
      )
    }
    const P = tx.table('partner.Partner')
    const recipient = await tx.db.one(
      from(P).where(eq(P.id, notification.recipientPartnerId), eq(P.active, true)),
    )
    const U = tx.table('user.User')
    // Deactivated staff identities must never fall back to external email.
    if (await tx.db.one(from(U).where(eq(U.partnerId, notification.recipientPartnerId))))
      return fail('E_MAIL_INTERNAL_RECIPIENT')
    const address = String(recipient?.email ?? '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return fail('E_MAIL_RECIPIENT_ADDRESS')
    const M = tx.table('mail.Message')
    const message = await tx.db.one(from(M).where(eq(M.id, notification.messageId)))
    if (message?.externalVisible !== true) return fail('E_MAIL_EXTERNAL_VISIBILITY')
    const T = tx.table('mail_transport.Template')
    const template = await tx.db.one(
      from(T).where(eq(T.name, NOTIFICATION_TEMPLATE_NAME), eq(T.active, true)),
    )
    if (!template) return fail('E_MAIL_NOTIFICATION_TEMPLATE')
    const H = tx.table('mail.Thread')
    const thread = await tx.db.one(from(H).where(eq(H.id, message.threadId), eq(H.active, true)))
    if (!thread) return fail('E_MAIL_THREAD_NOT_FOUND')
    await queueTemplate(tx, {
      id: `notification:${notificationId}`,
      templateId: String(template.id),
      messageId: String(message.id),
      notificationIds: [notificationId],
      to: [{ address, name: String(recipient?.name ?? address) }],
      context: {
        recipientName: String(recipient?.name ?? address),
        targetName: String(thread.displayName),
        subject: String(message.subject ?? thread.displayName),
        body: String(message.body),
      },
    })
  })
}
