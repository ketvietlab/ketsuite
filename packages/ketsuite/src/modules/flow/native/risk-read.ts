import { asc, eq, from, gt, inArray, isNull, lt, not, or } from '@ketvietlab/ketjs'
import type { Ctx, Query, Row } from '@ketvietlab/ketjs'
import { hash, revision } from './command.ts'
import { refuse, string } from './policy.ts'
import { limitOf, summaryQuery, taskDTOs, visibleScope } from './queries.ts'

/** Merge two bounded ID windows; grouping keeps multiple blockers from paging
 * one task twice. No organization-sized task or relation array is materialized. */
export async function readRiskTasks(ctx: Ctx, input: Row) {
  const { a, projects, workspaces } = await visibleScope(ctx)
  if (!input.workspaceId || !workspaces.some((w) => w.id === input.workspaceId)) return refuse('forbidden')
  const selected = projects.filter(
    (p) =>
      !p.archived && p.workspaceId === input.workspaceId && (!input.projectId || p.id === input.projectId),
  )
  if (input.projectId && !selected.length) return refuse('forbidden')
  const mode = input.risk ?? 'all',
    limit = limitOf(input.limit, 10)
  if (!['all', 'blocked', 'overdue', 'review'].includes(string(mode)))
    return refuse('validation', { risk: 'invalid' })
  const ids = selected.map((p) => p.id),
    T = ctx.table('flow.Task'),
    R = ctx.table('flow.TaskRelation'),
    S = ctx.table('flow.TaskStatus'),
    C = ctx.table('company.Company')
  const company = await ctx.db.one(from(C).where(eq(C.id, a.companyId)).select(C.accountingTimezone))
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: string(company?.accountingTimezone) || 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const today = ['year', 'month', 'day'].map((key) => parts.find((p) => p.type === key)?.value).join('-')
  const fence = hash(
    JSON.stringify([
      a.companyId,
      a.actorId,
      input.workspaceId,
      input.projectId ?? null,
      ids.map(String).sort(),
      mode,
      today,
      await revision(ctx, 'collection-change'),
    ]),
  )
  let after = ''
  if (input.cursor !== undefined && input.cursor !== null) {
    let cursor: Row
    try {
      if (typeof input.cursor !== 'string' || input.cursor.length > 2048) throw new Error()
      cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString())
      if (
        !cursor ||
        typeof cursor.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(cursor.id) ||
        typeof cursor.fence !== 'string' ||
        !/^[a-f0-9]{64}$/.test(cursor.fence)
      )
        throw new Error()
    } catch {
      return refuse('validation', { cursor: 'invalid' })
    }
    if (cursor.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
    after = string(cursor.id)
  }
  const states = await ctx.db.all(
    from(S)
      .where(eq(S.companyId, a.companyId), or(isNull(S.projectId), inArray(S.projectId, ids)))
      .select(S.id, S.kind),
  )
  const terminal = states.filter((s) => ['done', 'cancelled'].includes(string(s.kind))).map((s) => s.id)
  const review = states.filter((s) => s.kind === 'review').map((s) => s.id)
  const base = summaryQuery(ctx).where(
    eq(T.companyId, a.companyId),
    inArray(T.projectId, ids),
    eq(T.archived, false),
  )
  const open = base.where(...(terminal.length ? [not(inArray(T.columnId, terminal))] : []))
  const taskQuery = mode === 'review' ? base.where(inArray(T.columnId, review)) : open.where(lt(T.due, today))
  const hasBlocked = mode === 'all' || mode === 'blocked'
  const hasTasks = mode !== 'blocked'
  let blocked: Query | undefined
  if (hasBlocked) {
    const relation = from(R).where(eq(R.companyId, a.companyId), eq(R.kind, 'blocks'))
    if (
      await ctx.db.one(
        relation
          .where(or(isNull(R.ready), eq(R.ready, false), isNull(R.riskReady), eq(R.riskReady, false)))
          .select(R.id)
          .limit(1),
      )
    )
      return refuse('unavailable')
    blocked = relation.where(
      inArray(R.projectId, ids),
      eq(R.sourceArchived, false),
      eq(R.targetArchived, false),
      ...(terminal.length
        ? [not(inArray(R.sourceStatusId, terminal)), not(inArray(R.targetStatusId, terminal))]
        : []),
    )
  }
  const projectCounts: Record<string, number> = {}
  if (hasTasks)
    for (const g of await ctx.db.group(taskQuery.groupBy({ col: T.projectId })))
      projectCounts[string(g.key[0])] = Number(g.count)
  if (blocked) {
    for (const g of await ctx.db.group(
      blocked
        .groupBy({ col: R.projectId })
        .aggregate({ fn: 'countDistinct', col: R.targetId, as: 'targets' }),
    ))
      projectCounts[string(g.key[0])] = (projectCounts[string(g.key[0])] ?? 0) + Number(g.aggregates.targets)
    if (mode === 'all')
      for (const g of await ctx.db.group(
        blocked
          .where(lt(R.targetDue, today))
          .groupBy({ col: R.projectId })
          .aggregate({ fn: 'countDistinct', col: R.targetId, as: 'targets' }),
      ))
        projectCounts[string(g.key[0])]! -= Number(g.aggregates.targets)
  }
  const statusCounts: Record<string, number> = {}
  if (hasTasks)
    for (const g of await ctx.db.group(taskQuery.groupBy({ col: T.columnId })))
      statusCounts[string(g.key[0])] = Number(g.count)
  if (blocked) {
    for (const g of await ctx.db.group(
      blocked
        .groupBy({ col: R.targetStatusId })
        .aggregate({ fn: 'countDistinct', col: R.targetId, as: 'targets' }),
    ))
      statusCounts[string(g.key[0])] = (statusCounts[string(g.key[0])] ?? 0) + Number(g.aggregates.targets)
    if (mode === 'all')
      for (const g of await ctx.db.group(
        blocked
          .where(lt(R.targetDue, today))
          .groupBy({ col: R.targetStatusId })
          .aggregate({ fn: 'countDistinct', col: R.targetId, as: 'targets' }),
      ))
        statusCounts[string(g.key[0])]! -= Number(g.aggregates.targets)
  }
  const total = Object.values(projectCounts).reduce((n, v) => n + v, 0)
  const countKind = (kind: string) =>
    states.filter((s) => s.kind === kind).reduce((n, s) => n + (statusCounts[string(s.id)] ?? 0), 0)
  const late =
    blocked && mode === 'blocked'
      ? (
          await ctx.db.group(
            blocked
              .where(lt(R.targetDue, today))
              .groupBy({ col: R.projectId })
              .aggregate({ fn: 'countDistinct', col: R.targetId, as: 'targets' }),
          )
        ).reduce((n, g) => n + Number(g.aggregates.targets), 0)
      : Number(await ctx.db.count(taskQuery.where(lt(T.due, today))))
  const metrics = {
    total,
    progress: countKind('progress'),
    review: countKind('review'),
    done: countKind('done'),
    overdue: late,
  }
  const ordinary = hasTasks
    ? await ctx.db.all(
        (after ? taskQuery.where(gt(T.id, after)) : taskQuery).orderBy(asc(T.id)).limit(limit + 1),
      )
    : []
  const relations = blocked
    ? await ctx.db.group(
        (after ? blocked.where(gt(R.targetId, after)) : blocked)
          .groupBy({ col: R.targetId })
          .orderGroupsBy({ by: 'key', dir: 'asc' })
          .limit(limit + 1),
      )
    : []
  const merged = [
    ...new Set([...ordinary.map((t) => string(t.id)), ...relations.map((g) => string(g.key[0]))]),
  ].sort()
  const page = merged.slice(0, limit)
  const records = page.length
    ? await ctx.db.all(base.where(inArray(T.id, page)).orderBy(asc(T.id)).limit(limit))
    : []
  return {
    tasks: await taskDTOs(ctx, records),
    total,
    metrics,
    projectCounts,
    today,
    projectTotal: selected.length,
    projects: selected
      .filter((p) => projectCounts[string(p.id)])
      .sort(
        (a, b) =>
          projectCounts[string(b.id)]! - projectCounts[string(a.id)]! ||
          string(a.id).localeCompare(string(b.id)),
      )
      .slice(0, 10)
      .map((p) => ({ id: p.id, title: p.title, end: p.end, count: projectCounts[string(p.id)] })),
    cursor:
      merged.length > limit
        ? Buffer.from(JSON.stringify({ id: page.at(-1), fence })).toString('base64url')
        : null,
  }
}
