import { asc, eq, from, inArray, isNull } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { owned, refuse, requireCapability } from './policy.ts'

export async function statusOptions(ctx: Ctx, input: Row) {
  await requireCapability(ctx, 'project.read', { projectId: input.projectId })
  const project = await owned(ctx, 'flow.ProjectRecord', input.projectId)
  const ids = (project.catalogOverrides as Row).taskStatusIds
  const T = ctx.table('flow.TaskStatus')
  const items = await ctx.db.all(
    from(T)
      .where(
        eq(T.companyId, ctx.scope.company),
        eq(T.archived, false),
        Array.isArray(ids) ? inArray(T.id, ids) : isNull(T.projectId),
      )
      .orderBy(asc(T.sequence), asc(T.id))
      .select(T.id, T.title, T.kind, T.color, T.projectId)
      .limit(201),
  )
  if (items.length > 200) return refuse('limit')
  // Reject corrupt/foreign override references even if historical data predates
  // the write guard. Do not expose another project's catalog through this read.
  if (items.some((item) => item.projectId && item.projectId !== project.id)) return refuse('unavailable')
  if (Array.isArray(ids)) items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
  return {
    items: items.map((item) => ({
      id: item.id,
      label: item.title,
      kind: item.kind,
      color: item.color,
      projectId: item.projectId ?? null,
    })),
  }
}
