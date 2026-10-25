import { INBOX_READ_EFFECTS, visibleInbox } from '../inbox-access.ts'
import type { InboxTargetPolicy } from '../inbox-access.ts'
import { defineFn, eq, from, isNull, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { NOTIFICATION_STATES } from '../types.ts'
import { actor } from './shared.ts'

export async function countUnreadHandler(ctx: Ctx) {
  return { count: (await visibleInbox(ctx, actor(ctx), true, [])).length }
}
export async function countInboxHandler(
  ctx: Ctx,
  args: Record<string, unknown>,
  policies: readonly InboxTargetPolicy[] = [],
) {
  return { count: (await visibleInbox(ctx, actor(ctx), args.unreadOnly !== false, policies)).length }
}
export async function listInboxHandler(
  ctx: Ctx,
  args: Record<string, unknown>,
  policies: readonly InboxTargetPolicy[] = [],
) {
  const rows = await visibleInbox(ctx, actor(ctx), args.unreadOnly !== false, policies)
  const offset = Math.max(0, Number(args.offset ?? 0))
  return rows.slice(offset, offset + Math.max(1, Math.min(100, Number(args.limit ?? 50))))
}
export async function markInboxReadHandler(ctx: Ctx, args: Record<string, unknown>) {
  const N = ctx.table('mail.Notification')
  const notification = await ctx.db.one(from(N).where(eq(N.id, args.id), eq(N.recipientUserId, actor(ctx))))
  if (!notification)
    throw new KetError({
      code: 'E_MAIL_NOTIFICATION_NOT_FOUND',
      module: 'mail',
      message: 'notification does not belong to the signed-in user',
    })
  if (!NOTIFICATION_STATES.includes(notification.state as never))
    throw new KetError({
      code: 'E_MAIL_NOTIFICATION_STATE',
      module: 'mail',
      message: `notification has unknown state "${String(notification.state)}"`,
    })
  if (notification.readAt == null)
    await ctx.db.update('mail.Notification', { id: args.id }, { readAt: args.readAt })
  return { ok: true, id: args.id }
}

export function markAllInboxReadHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (tx) => {
    const N = tx.table('mail.Notification')
    const rows = await tx.db.all(from(N).where(eq(N.recipientUserId, actor(tx)), isNull(N.readAt)))
    await tx.db.update(
      'mail.Notification',
      { recipientUserId: actor(tx), readAt: null },
      { readAt: args.readAt },
    )
    return { ok: true, count: rows.length, readAt: args.readAt }
  })
}

export const inboxFunctions: Record<string, FnSpec> = {
  countUnread: defineFn({
    output: { count: 'int' },
    effects: INBOX_READ_EFFECTS,
    handler: countUnreadHandler,
  }),
  countInbox: defineFn({
    input: { unreadOnly: 'bool?' },
    output: { count: 'int' },
    effects: INBOX_READ_EFFECTS,
    handler: countInboxHandler,
  }),
  listInbox: defineFn({
    input: { unreadOnly: 'bool?', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      messageId: 'id',
      threadId: 'id',
      kind: 'text',
      subject: 'text?',
      body: 'text',
      authorPartnerId: 'id?',
      authorUserId: 'id?',
      state: 'text',
      readAt: 'datetime?',
      createdAt: 'datetime',
      targetModel: 'text?',
      targetId: 'text?',
      targetName: 'text?',
      targetHref: 'text?',
    },
    effects: INBOX_READ_EFFECTS,
    handler: listInboxHandler,
  }),
  markInboxRead: defineFn({
    input: { id: 'id', readAt: 'datetime' },
    output: { ok: 'bool', id: 'id' },
    effects: ['read:mail.Notification', 'write:mail.Notification'],
    idempotent: true,
    handler: markInboxReadHandler,
  }),
  markAllInboxRead: defineFn({
    input: { readAt: 'datetime' },
    output: { ok: 'bool', count: 'int', readAt: 'datetime' },
    effects: ['read:mail.Notification', 'write:mail.Notification'],
    idempotent: true,
    handler: markAllInboxReadHandler,
  }),
}

export function scopedInboxFunctions(policies: readonly InboxTargetPolicy[]): Record<string, FnSpec> {
  const readEffects = [...new Set([...INBOX_READ_EFFECTS, ...policies.flatMap((policy) => policy.effects)])]
  return {
    ...inboxFunctions,
    searchInbox: defineFn({
      input: { unreadOnly: 'bool?', page: 'int?', pageSize: 'int?' },
      output: {
        query: 'json',
        total: 'int',
        page: 'int',
        pages: 'int',
        rows: 'json',
        counts: 'json',
        isEmpty: 'bool',
      },
      effects: readEffects,
      handler: async function searchInboxHandler(ctx: Ctx, args) {
        const all = await visibleInbox(ctx, actor(ctx), false, policies)
        const unreadOnly = args.unreadOnly !== false
        const visible = unreadOnly ? all.filter((row) => row.readAt == null) : all
        const pageSize = Math.max(1, Math.min(100, Number(args.pageSize ?? 25)))
        const pages = Math.max(1, Math.ceil(visible.length / pageSize))
        const page = Math.max(1, Math.min(pages, Number(args.page ?? 1)))
        return {
          query: { unreadOnly, pageSize, page },
          total: visible.length,
          page,
          pages,
          rows: visible.slice((page - 1) * pageSize, page * pageSize),
          counts: { unread: all.filter((row) => row.readAt == null).length },
          isEmpty: all.length === 0,
        }
      },
    }),
    countUnread: {
      ...inboxFunctions.countUnread,
      effects: readEffects,
      handler: function countVisibleUnread(ctx: Ctx) {
        return visibleInbox(ctx, actor(ctx), true, policies).then((rows) => ({ count: rows.length }))
      },
    },
    countInbox: {
      ...inboxFunctions.countInbox,
      effects: readEffects,
      handler: function countVisibleInbox(ctx: Ctx, args) {
        return visibleInbox(ctx, actor(ctx), args.unreadOnly !== false, policies).then((rows) => ({
          count: rows.length,
        }))
      },
    },
    listInbox: {
      ...inboxFunctions.listInbox,
      effects: readEffects,
      handler: function listVisibleInbox(ctx: Ctx, args) {
        return visibleInbox(ctx, actor(ctx), args.unreadOnly !== false, policies).then((rows) => {
          const offset = Math.max(0, Number(args.offset ?? 0))
          return rows.slice(offset, offset + Math.max(1, Math.min(100, Number(args.limit ?? 50))))
        })
      },
    },
  }
}
