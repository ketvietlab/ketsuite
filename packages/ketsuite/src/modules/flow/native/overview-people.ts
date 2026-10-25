import { eq, from, inArray, isNull, lt, not, or } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { refuse, string } from './policy.ts'

/** IDs must already be authorized by visibleScope. Aggregate indexed assignments;
 * never load tasks or infer workload from the directory/task preview windows. */
export async function overviewPeople(ctx: Ctx, projectIds: unknown[], today: string) {
  const A = ctx.table('flow.TaskAssignee'),
    S = ctx.table('flow.TaskStatus'),
    M = ctx.table('flow.Member'),
    U = ctx.table('user.User')
  const states = await ctx.db.all(
    from(S)
      .where(
        eq(S.companyId, ctx.scope.company),
        eq(S.kind, 'done'),
        or(isNull(S.projectId), inArray(S.projectId, projectIds)),
      )
      .select(S.id),
  )
  const done = states.map((s) => s.id)
  const query = from(A).where(
    eq(A.companyId, ctx.scope.company),
    eq(A.archived, false),
    inArray(A.projectId, projectIds),
    ...(done.length ? [not(inArray(A.columnId, done))] : []),
  )
  if (await ctx.db.one(query.where(isNull(A.priority)).limit(1))) return refuse('unavailable')
  const [open, overdue] = await Promise.all([
    ctx.db.group(query.groupBy({ col: A.userId })),
    ctx.db.group(query.where(lt(A.due, today)).groupBy({ col: A.userId })),
  ])
  if (!open.length) return []
  const members = await ctx.db.all(
    from(M)
      .where(
        eq(M.companyId, ctx.scope.company),
        eq(M.status, 'active'),
        inArray(
          M.userId,
          open.map((g) => g.key[0]),
        ),
      )
      .select(M.userId),
  )
  const users = members.length
    ? await ctx.db.all(
        from(U)
          .where(
            eq(U.active, true),
            inArray(
              U.id,
              members.map((m) => m.userId),
            ),
          )
          .select(U.id, U.name),
      )
    : []
  const byId = new Map(users.map((u) => [string(u.id), u]))
  const late = new Map(overdue.map((g) => [string(g.key[0]), Number(g.count)]))
  return open
    .flatMap((group) => {
      const id = string(group.key[0]),
        user = byId.get(id)
      return user
        ? [{ member: { id, name: string(user.name) }, open: Number(group.count), overdue: late.get(id) ?? 0 }]
        : []
    })
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.member.id.localeCompare(b.member.id))
    .slice(0, 6)
}
