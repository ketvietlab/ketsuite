import { and, desc, eq, from, inArray, lt, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { authority, owned, refuse, requireCapability, string } from './policy.ts'
import { hash, revision } from './command.ts'
import { limitOf, taskByKey } from './queries.ts'

/** One mapper for detail and older pages, including transfer privacy. */
export async function taskActivity(ctx: Ctx, input: Row) {
  const task = await taskByKey(ctx, input.id)
  await requireCapability(ctx, 'project.read', { projectId: task.projectId })
  const a = await authority(ctx),
    kind = string(input.kind),
    limit = limitOf(input.limit)
  if (kind !== 'comments' && kind !== 'history') return refuse('validation', { kind: 'invalid' })
  const T = ctx.table(kind === 'comments' ? 'flow.TaskComment' : 'flow.TaskHistory')
  const base = from(T).where(eq(T.companyId, a.companyId), eq(T.taskId, task.id))
  const fence = hash(
    JSON.stringify([
      a.companyId,
      a.actorId,
      task.id,
      task.projectId,
      kind,
      await revision(ctx, 'collection-change'),
    ]),
  )
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
      typeof c.id !== 'string' ||
      !c.id ||
      c.id.length > 200 ||
      typeof c.time !== 'string' ||
      !Number.isFinite(Date.parse(c.time)) ||
      new Date(c.time).toISOString() !== c.time
    )
      return refuse('validation', { cursor: 'invalid' })
    if (c.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
    query = query.where(or(lt(T.createdAt, c.time), and(eq(T.createdAt, c.time), lt(T.id, c.id))))
  }
  const rows = await ctx.db.all(query.orderBy(desc(T.createdAt), desc(T.id)).limit(limit + 1))
  const page = rows.slice(0, limit),
    last = page.at(-1),
    U = ctx.table('user.User')
  const ids = [...new Set(page.map((r) => (kind === 'comments' ? r.authorId : r.actorId)).filter(Boolean))]
  const authors = ids.length
    ? await ctx.db.all(from(U).where(inArray(U.id, ids)).select(U.id, U.name).limit(ids.length))
    : []
  const nameOf = (id: unknown) => authors.find((u) => u.id === id)?.name ?? string(id)
  const items = page.map((row) => {
    if (kind === 'comments')
      return { ...row, taskId: task.key, body: row.text, person: nameOf(row.authorId), time: row.createdAt }
    const metadata: Row =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? { ...(row.metadata as Row) }
        : {}
    delete metadata.sourceProjectId
    return {
      ...row,
      taskId: task.key,
      projectId: task.projectId,
      workspaceId: null,
      metadata,
      person: nameOf(row.actorId),
      text: row.description,
      time: row.createdAt,
      ...(['created', 'updated', 'transferred', 'attachment'].includes(string(row.kind))
        ? { messageKey: 'flow.history.' + string(row.kind) }
        : {}),
      ...(Array.isArray(metadata.changes) ? { changes: metadata.changes, version: metadata.version } : {}),
    }
  })
  const total = Number(await ctx.db.count(base))
  const current = await owned(ctx, 'flow.Task', task.id)
  await requireCapability(ctx, 'project.read', { projectId: current.projectId })
  if (
    current.projectId !== task.projectId ||
    fence !==
      hash(
        JSON.stringify([
          a.companyId,
          a.actorId,
          task.id,
          task.projectId,
          kind,
          await revision(ctx, 'collection-change'),
        ]),
      )
  )
    return refuse('conflict')
  return {
    items,
    total,
    cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ id: last.id, time: last.createdAt, fence })).toString('base64url')
        : null,
  }
}
