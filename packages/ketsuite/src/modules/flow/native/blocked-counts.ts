import { eq, from, inArray, isNull, not, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { refuse, string } from './policy.ts'

export const relationProjection = (source: Row, target: Row) => ({
  projectId: source.projectId,
  sourceStatusId: source.columnId,
  targetStatusId: target.columnId,
  sourceArchived: source.archived,
  targetArchived: target.archived,
  ready: true,
  targetDue: target.due ?? null,
  riskReady: true,
})

/** Project IDs must be authorized before calling; group distinct targets in SQL. */
export async function blockedCounts(ctx: Ctx, projectIds: unknown[]) {
  const R = ctx.table('flow.TaskRelation'),
    S = ctx.table('flow.TaskStatus')
  const base = from(R).where(eq(R.companyId, ctx.scope.company), eq(R.kind, 'blocks'))
  if (
    await ctx.db.one(
      base
        .where(or(isNull(R.ready), eq(R.ready, false)))
        .select(R.id)
        .limit(1),
    )
  )
    return refuse('unavailable')
  const terminal = await ctx.db.all(
    from(S)
      .where(
        eq(S.companyId, ctx.scope.company),
        inArray(S.kind, ['done', 'cancelled']),
        or(isNull(S.projectId), inArray(S.projectId, projectIds)),
      )
      .select(S.id),
  )
  const ids = terminal.map((s) => s.id)
  const groups = await ctx.db.group(
    base
      .where(
        inArray(R.projectId, projectIds),
        eq(R.ready, true),
        eq(R.sourceArchived, false),
        eq(R.targetArchived, false),
        ...(ids.length ? [not(inArray(R.sourceStatusId, ids)), not(inArray(R.targetStatusId, ids))] : []),
      )
      .groupBy({ col: R.projectId })
      .aggregate({ fn: 'countDistinct', col: R.targetId, as: 'blocked' }),
  )
  const projects: Record<string, number> = {}
  for (const group of groups) projects[string(group.key[0])] = Number(group.aggregates.blocked)
  return { total: Object.values(projects).reduce((sum, n) => sum + n, 0), projects }
}
