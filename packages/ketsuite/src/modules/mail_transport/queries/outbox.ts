import { desc, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { actor } from '../functions/shared.ts'

export async function outboxRows(ctx: Ctx, args: Record<string, unknown>) {
  actor(ctx)
  const D = ctx.table('mail_transport.Delivery')
  const rows = await ctx.db.all(
    from(D)
      .select(
        D.id,
        D.to,
        D.state,
        D.version,
        D.attempts,
        D.queuedAt,
        D.updatedAt,
        D.sentAt,
        D.acceptedAt,
        D.providerMessageId,
        D.templateId,
        D.templateVersion,
        D.messageId,
        D.lastError,
      )
      .where(...(args.state ? [eq(D.state, args.state)] : []))
      .orderBy(desc(D.queuedAt), desc(D.id))
      .offset(Math.max(0, Number(args.offset ?? 0)))
      .limit(Math.max(1, Math.min(200, Number(args.limit ?? 100)))),
  )
  const templateIds = [...new Set(rows.flatMap((row) => (row.templateId ? [row.templateId] : [])))]
  const T = ctx.table('mail_transport.Template')
  const templates = templateIds.length
    ? await ctx.db.all(from(T).select(T.id, T.name).where(inArray(T.id, templateIds)))
    : []
  const templateById = new Map(templates.map((row) => [String(row.id), row]))
  const messageIds = [...new Set(rows.flatMap((row) => (row.messageId ? [row.messageId] : [])))]
  const M = ctx.table('mail.Message')
  const messages = messageIds.length
    ? await ctx.db.all(from(M).select(M.id, M.threadId).where(inArray(M.id, messageIds)))
    : []
  const threadIds = [...new Set(messages.map((row) => row.threadId))]
  const H = ctx.table('mail.Thread')
  const threads = threadIds.length
    ? await ctx.db.all(from(H).select(H.id, H.displayName).where(inArray(H.id, threadIds)))
    : []
  const threadById = new Map(threads.map((row) => [String(row.id), row]))
  const messageById = new Map(messages.map((row) => [String(row.id), row]))
  return {
    deliveries: rows.map((row) => {
      const message = messageById.get(String(row.messageId ?? ''))
      return {
        id: row.id,
        to: row.to,
        state: row.state,
        version: row.version,
        attempts: row.attempts,
        queuedAt: row.queuedAt,
        updatedAt: row.updatedAt,
        sentAt: row.sentAt ?? null,
        acceptedAt: row.acceptedAt ?? null,
        providerMessageId: row.providerMessageId ?? null,
        templateId: row.templateId ?? null,
        templateVersion: row.templateVersion ?? null,
        // A template may put reset links in the subject too. Never expose its snapshot.
        failureCode: row.lastError ? 'E_MAIL_DELIVERY_FAILED' : null,
        templateName: templateById.get(String(row.templateId ?? ''))?.name ?? null,
        targetName: message ? (threadById.get(String(message.threadId))?.displayName ?? null) : null,
      }
    }),
  }
}
