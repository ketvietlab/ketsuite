import { eq, from, inArray, ne } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { authority, refuse } from './policy.ts'
import { hasReadableDocument } from './documents.ts'

/** Existence reads are independent of presentation windows and never load bodies. */
export async function gettingStartedState(
  ctx: Ctx,
  projects: Row[],
  workspaces: Row[],
  workspaceId: unknown,
  invitations: Row[],
) {
  const a = await authority(ctx),
    T = ctx.table('flow.Task'),
    M = ctx.table('flow.Member'),
    U = ctx.table('user.User'),
    PM = ctx.table('user.Membership')
  const ids = projects.filter((p) => !p.archived && p.workspaceId === workspaceId).map((p) => p.id)
  let invite = false
  if (a.member?.role !== 'guest') {
    const members = await ctx.db.all(
      from(M)
        .where(eq(M.companyId, a.companyId), eq(M.status, 'active'), ne(M.userId, a.actorId))
        .select(M.userId)
        .limit(1001),
    )
    if (members.length > 1000) return refuse('limit')
    const platform = members.length
      ? await ctx.db.all(
          from(PM)
            .where(
              eq(PM.companyId, a.companyId),
              inArray(
                PM.userId,
                members.map((m) => m.userId),
              ),
            )
            .select(PM.userId)
            .limit(1001),
        )
      : []
    if (platform.length > 1000) return refuse('limit')
    invite =
      invitations.length > 0 ||
      Boolean(
        platform.length &&
          (await ctx.db.one(
            from(U)
              .where(
                eq(U.active, true),
                inArray(
                  U.id,
                  platform.map((m) => m.userId),
                ),
              )
              .select(U.id)
              .limit(1),
          )),
      )
  }
  const [task, page] = await Promise.all([
    ctx.db.one(
      from(T)
        .where(eq(T.companyId, a.companyId), inArray(T.projectId, ids), eq(T.archived, false))
        .select(T.id)
        .limit(1),
    ),
    hasReadableDocument(ctx, projects, workspaces, workspaceId),
  ])
  return { workspaceId, project: ids.length > 0, task: Boolean(task), invite, page }
}
