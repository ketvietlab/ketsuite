import { desc, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { actor } from './shared.ts'

export async function listEventsHandler(ctx: Ctx, args: Record<string, unknown>) {
  actor(ctx)
  const I = ctx.table('mail_inbound.InboundEvent')
  const visible = await ctx.db.all(
    from(I)
      .where(...(args.state ? [eq(I.state, args.state)] : []))
      .orderBy(desc(I.receivedAt), desc(I.id))
      .limit(Math.max(1, Math.min(200, Number(args.limit ?? 100)))),
  )
  const threadIds = [...new Set(visible.flatMap((row) => (row.threadId ? [row.threadId] : [])))]
  const T = ctx.table('mail.Thread')
  const threads = threadIds.length ? await ctx.db.all(from(T).where(inArray(T.id, threadIds))) : []
  const byId = new Map(threads.map((row) => [String(row.id), row]))
  return {
    events: visible.map((row) => ({
      id: row.id,
      provider: row.provider,
      providerEventId: row.providerEventId,
      kind: row.kind,
      state: row.state,
      attempts: row.attempts,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
      threadId: row.threadId,
      messageId: row.messageId,
      aliasId: row.aliasId,
      diagnostic: row.diagnostic ? 'E_INBOUND_PROCESSING' : null,
      targetName: byId.get(String(row.threadId ?? ''))?.displayName ?? null,
    })),
  }
}

export function requestRetentionHandler(ctx: Ctx, args: Record<string, unknown>) {
  actor(ctx)
  return ctx.jobs.enqueue(
    'mail_inbound.retain',
    { cutoff: args.cutoff },
    { uniqueKey: `inbound-retention:${String(args.cutoff).slice(0, 10)}` },
  )
}

export const eventsFunctions: Record<string, FnSpec> = {
  listEvents: defineFn({
    input: { state: 'text?', limit: 'int?' },
    output: { events: 'json' },
    effects: ['read:mail_inbound.InboundEvent', 'read:mail.Thread'],
    handler: listEventsHandler,
  }),
  requestRetention: defineFn({
    input: { cutoff: 'datetime' },
    output: { id: 'id', existing: 'bool' },
    effects: ['enqueue:mail_inbound.retain'],
    idempotent: true,
    handler: requestRetentionHandler,
  }),
}
