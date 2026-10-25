import { eq, from, inArray, isNull, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { refuse, string } from './policy.ts'

/** Projects and labels have already passed the bootstrap capability/scope filter. */
export async function labelUsage(ctx: Ctx, projects: Row[], labels: Row[]) {
  const L = ctx.table('flow.TaskLabel')
  const base = from(L).where(eq(L.companyId, ctx.scope.company))
  if (
    await ctx.db.one(
      base
        .where(or(isNull(L.projectId), isNull(L.archived)))
        .select(L.id)
        .limit(1),
    )
  )
    return refuse('unavailable')
  const active = projects.filter((p) => !p.archived)
  const counts = await ctx.db.group(
    base
      .where(
        inArray(
          L.projectId,
          active.map((p) => p.id),
        ),
        eq(L.archived, false),
        inArray(
          L.labelId,
          labels.map((l) => l.id),
        ),
      )
      .groupBy({ col: L.labelId }),
  )
  const byId = new Map(counts.map((g) => [string(g.key[0]), Number(g.count)]))
  return Object.fromEntries(
    labels.map((l) => [
      string(l.id),
      {
        tasks: byId.get(string(l.id)) ?? 0,
        projects: active.filter((p) => Array.isArray(p.tags) && p.tags.includes(l.id)).length,
      },
    ]),
  )
}
