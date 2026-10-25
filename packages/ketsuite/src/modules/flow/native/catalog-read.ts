import { and, asc, eq, from, gt, isNull, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { authority, refuse, string } from './policy.ts'
import { hash, revision } from './command.ts'
import { limitOf, visibleScope } from './queries.ts'
import { labelUsage } from './label-usage.ts'

const models: Record<string, string> = {
  column: 'flow.TaskStatus',
  type: 'flow.TaskType',
  tag: 'flow.Label',
  field: 'flow.CustomField',
}
export async function readCatalog(ctx: Ctx, input: Row) {
  const a = await authority(ctx),
    kind = string(input.kind)
  if (!a.member || a.member.role === 'guest') return refuse('forbidden')
  if (!Object.hasOwn(models, kind)) return refuse('validation', { kind: 'invalid' })
  const T = ctx.table(models[kind]!),
    limit = limitOf(input.limit)
  const base = from(T).where(
    eq(T.companyId, a.companyId),
    isNull(T.projectId),
    ...(kind === 'tag' ? [] : [eq(T.archived, false)]),
  )
  const fence = hash(JSON.stringify([a.companyId, a.actorId, kind, await revision(ctx, 'collection-change')]))
  let query = base
  if (input.cursor) {
    if (typeof input.cursor !== 'string' || input.cursor.length > 2048)
      return refuse('validation', { cursor: 'invalid' })
    let c: Row
    try {
      c = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as Row
    } catch {
      return refuse('validation', { cursor: 'invalid' })
    }
    if (
      !c ||
      Array.isArray(c) ||
      !Number.isInteger(c.sequence) ||
      Number(c.sequence) < -2147483648 ||
      Number(c.sequence) > 2147483647 ||
      typeof c.id !== 'string' ||
      !c.id ||
      c.id.length > 200
    )
      return refuse('validation', { cursor: 'invalid' })
    if (c.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
    query = query.where(or(gt(T.sequence, c.sequence), and(eq(T.sequence, c.sequence), gt(T.id, c.id))))
  }
  const metadata = [
    T.id,
    T.companyId,
    T.projectId,
    T.title,
    T.sequence,
    T.version,
    T.archived,
    ...(kind === 'column'
      ? [T.kind, T.color, T.icon]
      : kind === 'type'
        ? [T.icon]
        : kind === 'tag'
          ? [T.domain, T.color]
          : [T.kind, T.required]),
  ]
  const rows = await ctx.db.all(
    query
      .select(...metadata)
      .orderBy(asc(T.sequence), asc(T.id))
      .limit(limit + 1),
  )
  const items = rows.slice(0, limit).map((row) => (kind === 'column' ? { ...row, label: row.title } : row)),
    last = items.at(-1)
  return {
    items,
    total: Number(await ctx.db.count(base)),
    cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ sequence: last.sequence, id: last.id, fence })).toString('base64url')
        : null,
    ...(kind === 'tag'
      ? { labelUsage: await labelUsage(ctx, (await visibleScope(ctx)).projects, items) }
      : {}),
  }
}
