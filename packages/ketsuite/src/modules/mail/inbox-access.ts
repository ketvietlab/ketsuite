import { desc, eq, from, inArray, isNull } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_READ_EFFECTS, effectiveFunctionKeys } from '../user/authorization.ts'

/** A deployment supplies target owners; mail never guesses another domain's record policy. */
export type InboxTargetPolicy = {
  resModel: string
  readFunction: string
  effects: string[]
  visible(ctx: Ctx, ids: string[]): Promise<Set<string>>
  href?(id: string): string
}
export const INBOX_READ_EFFECTS = [
  'read:mail.Notification',
  'read:mail.Message',
  'read:mail.Thread',
  ...AUTHORIZATION_READ_EFFECTS,
]

export async function visibleInbox(
  ctx: Ctx,
  actor: string,
  unreadOnly: boolean,
  policies: readonly InboxTargetPolicy[],
): Promise<Row[]> {
  const N = ctx.table('mail.Notification')
  const notifications = await ctx.db.all(
    from(N)
      .where(eq(N.recipientUserId, actor), eq(N.channel, 'inbox'), ...(unreadOnly ? [isNull(N.readAt)] : []))
      .orderBy(desc(N.createdAt), desc(N.id)),
  )
  if (!notifications.length || !policies.length) return []
  const M = ctx.table('mail.Message')
  const messages = await ctx.db.all(
    from(M).where(
      inArray(
        M.id,
        notifications.map((row) => row.messageId),
      ),
    ),
  )
  const byId = new Map(messages.map((row) => [String(row.id), row]))
  const T = ctx.table('mail.Thread')
  const threads = await ctx.db.all(
    from(T).where(inArray(T.id, [...new Set(messages.map((row) => row.threadId))]), eq(T.active, true)),
  )
  const keys = ctx.manifest.permissions.coverageRequired ? await effectiveFunctionKeys(ctx, actor) : null
  const allowed = new Map<string, InboxTargetPolicy>()
  for (const policy of policies) {
    if (keys && !keys.includes(policy.readFunction)) continue
    const candidates = threads.filter((row) => row.resModel === policy.resModel)
    if (!candidates.length) continue
    const ids = await policy.visible(ctx, [...new Set(candidates.map((row) => String(row.resId)))])
    for (const thread of candidates) if (ids.has(String(thread.resId))) allowed.set(String(thread.id), policy)
  }
  const threadById = new Map(threads.map((row) => [String(row.id), row]))
  return notifications.flatMap((notification) => {
    const message = byId.get(String(notification.messageId))
    const thread = message && threadById.get(String(message.threadId))
    const policy = thread && allowed.get(String(thread.id))
    if (!message || !thread || !policy) return []
    return [
      {
        id: notification.id,
        messageId: message.id,
        threadId: message.threadId,
        kind: message.kind,
        subject: message.subject,
        body: message.body,
        authorPartnerId: message.authorPartnerId,
        authorUserId: message.authorUserId,
        state: notification.state,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        targetModel: thread.resModel,
        targetId: thread.resId,
        targetName: thread.displayName,
        targetHref: policy.href?.(String(thread.resId)) ?? null,
      },
    ]
  })
}
