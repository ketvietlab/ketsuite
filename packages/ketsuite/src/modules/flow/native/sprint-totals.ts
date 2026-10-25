import { eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

/** Call only with the already authorized, bounded sprint records. No task rows
 * are materialized, and foreign-project links cannot contribute to a total. */
export async function sprintTaskTotals(ctx: Ctx, sprints: Row[]) {
  const totals = Object.fromEntries(
    sprints.map((s) => [
      String(s.id),
      {
        total: 0,
        done: 0,
        points: 0,
        pending: 0,
        pendingPoints: 0,
      },
    ]),
  )
  if (!sprints.length) return totals
  const T = ctx.table('flow.Task'),
    S = ctx.table('flow.TaskStatus')
  const projects = new Map(sprints.map((s) => [String(s.id), String(s.projectId)]))
  const groups = await ctx.db.group(
    from(T)
      .where(
        eq(T.companyId, ctx.scope.company),
        eq(T.archived, false),
        inArray(T.projectId, [...new Set(projects.values())]),
        inArray(
          T.sprintId,
          sprints.map((s) => s.id),
        ),
      )
      .groupBy({ col: T.sprintId }, { col: T.projectId }, { col: T.columnId })
      .aggregate({ fn: 'sum', col: T.points, as: 'points' }),
  )
  const states = groups.length
    ? await ctx.db.all(
        from(S)
          .where(eq(S.companyId, ctx.scope.company), inArray(S.id, [...new Set(groups.map((g) => g.key[2]))]))
          .select(S.id, S.kind),
      )
    : []
  const done = new Set(states.filter((s) => s.kind === 'done').map((s) => String(s.id)))
  for (const group of groups) {
    const id = String(group.key[0]),
      current = totals[id]
    if (!current || projects.get(id) !== String(group.key[1])) continue
    const count = Number(group.count),
      points = Number(group.aggregates.points ?? 0)
    current.total += count
    current.points += points
    if (done.has(String(group.key[2]))) current.done += count
    else {
      current.pending += count
      current.pendingPoints += points
    }
  }
  return totals
}
