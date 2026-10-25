import { and, defineFn, desc, eq, from, gte, lt } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { n } from './helpers.ts'

export async function listAuditEventsHandler(ctx: Ctx, args: Row) {
  const event = ctx.table('pos.AuditEvent')
  const filters = [
    ...(args.subjectType ? [eq(event.subjectType, args.subjectType)] : []),
    ...(args.subjectId ? [eq(event.subjectId, args.subjectId)] : []),
    ...(args.configId ? [eq(event.configId, args.configId)] : []),
    ...(args.sessionId ? [eq(event.sessionId, args.sessionId)] : []),
    ...(args.action ? [eq(event.action, args.action)] : []),
    ...(args.from ? [gte(event.occurredAt, args.from)] : []),
    ...(args.to ? [lt(event.occurredAt, args.to)] : []),
  ]
  const base = from(event)
    .orderBy(desc(event.occurredAt), desc(event.id))
    .limit(Math.max(1, Math.min(200, Math.trunc(n(args.limit ?? 100)) || 100)))
  return ctx.db.all(filters.length ? base.where(and(...filters)) : base)
}

export const auditFunctions: Record<string, FnSpec> = {
  listAuditEvents: defineFn({
    input: {
      subjectType: 'text?',
      subjectId: 'text?',
      configId: 'id?',
      sessionId: 'id?',
      action: 'text?',
      from: 'datetime?',
      to: 'datetime?',
      limit: 'int?',
    },
    effects: ['read:pos.AuditEvent'],
    agent: true,
    handler: listAuditEventsHandler,
  }),
}
