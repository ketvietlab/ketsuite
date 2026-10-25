import { and, asc, eq, from, gt, inArray, isNull, not, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { hash, revision } from './command.ts'
import { authority, owned, refuse, requireCapability, scopeRoles, string } from './policy.ts'
import { limitOf } from './queries.ts'

/** Grants on one target, or of one person or Team, a page at a time by id. A target's
 * grants are read by the internal people who can open it, as its access list is; a
 * subject's by organization managers (people may read their own). Each row names its
 * target and subject, and a Team row carries its size, so no reader assembles grants
 * from a shipped Company graph. */
export async function readGrants(ctx: Ctx, input: Row) {
  const a = await authority(ctx)
  if (!a.member || a.member.role === 'guest') return refuse('forbidden')
  const G = ctx.table('flow.ScopedGrant'),
    limit = limitOf(input.limit, 50)
  const byTarget = input.targetId !== undefined && input.targetId !== null,
    bySubject = input.subjectId !== undefined && input.subjectId !== null
  if (byTarget === bySubject) return refuse('validation', { targetId: 'invalid' })
  const scope = input.scope === undefined || input.scope === null ? '' : string(input.scope)
  if (scope && scope !== 'project' && scope !== 'workspace') return refuse('validation', { scope: 'invalid' })
  let base = from(G).where(eq(G.companyId, a.companyId))
  if (byTarget) {
    if (!scope) return refuse('validation', { scope: 'invalid' })
    if (scope === 'project') {
      const p = await owned(ctx, 'flow.ProjectRecord', input.targetId)
      if (p.deletionId) return refuse('not_found')
      const w = await owned(ctx, 'flow.Workspace', p.workspaceId)
      if (!a.manageOrganization && !a.projectRole(p, w)) return refuse('forbidden')
    } else {
      const w = await owned(ctx, 'flow.Workspace', input.targetId)
      if (!a.manageOrganization && !a.workspaceRole(w)) return refuse('forbidden')
    }
    base = base.where(eq(G.scope, scope), eq(G.targetId, string(input.targetId)))
  } else {
    const subjectType = string(input.subjectType)
    if (subjectType !== 'user' && subjectType !== 'team')
      return refuse('validation', { subjectType: 'invalid' })
    const self = subjectType === 'user' && string(input.subjectId) === string(a.actorId)
    if (!a.manageOrganization && !self) return refuse('forbidden')
    base = base.where(eq(G.subjectType, subjectType), eq(G.subjectId, string(input.subjectId)))
    if (scope) base = base.where(eq(G.scope, scope))
  }
  const fence = hash(
    JSON.stringify([
      a.companyId,
      a.actorId,
      'grants',
      scope,
      byTarget ? string(input.targetId) : '',
      bySubject ? [string(input.subjectType), string(input.subjectId)] : '',
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
    if (!c || Array.isArray(c) || typeof c.id !== 'string' || !c.id || c.id.length > 200)
      return refuse('validation', { cursor: 'invalid' })
    if (c.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
    query = query.where(gt(G.id, c.id))
  }
  const rows = await ctx.db.all(query.orderBy(asc(G.id)).limit(limit + 1)),
    page = rows.slice(0, limit),
    last = page.at(-1)
  const ids = (key: string, value: string) => [
    ...new Set(
      page.filter((g) => g[key] === value).map((g) => string(key === 'scope' ? g.targetId : g.subjectId)),
    ),
  ]
  const P = ctx.table('flow.ProjectRecord'),
    W = ctx.table('flow.Workspace'),
    U = ctx.table('user.User'),
    M = ctx.table('flow.Member'),
    T = ctx.table('flow.Team'),
    TM = ctx.table('flow.TeamMember')
  const read = async (table: typeof P, list: string[]) =>
    list.length
      ? await ctx.db.all(from(table).where(eq(table.companyId, a.companyId), inArray(table.id, list)))
      : []
  const projects = await read(P, ids('scope', 'project')),
    workspaces = await read(W, ids('scope', 'workspace')),
    teams = await read(T, ids('subjectType', 'team'))
  const userIds = ids('subjectType', 'user')
  const users = userIds.length
    ? await ctx.db.all(from(U).where(inArray(U.id, userIds)).select(U.id, U.name, U.email))
    : []
  const members = userIds.length
    ? await ctx.db.all(from(M).where(eq(M.companyId, a.companyId), inArray(M.userId, userIds)))
    : []
  const sizes = teams.length
    ? await ctx.db.group(
        from(TM)
          .where(
            eq(TM.companyId, a.companyId),
            inArray(
              TM.teamId,
              teams.map((t) => t.id),
            ),
          )
          .groupBy({ col: TM.teamId }),
      )
    : []
  return {
    items: page.map((g) => {
      const target = (g.scope === 'project' ? projects : workspaces).find((x) => x.id === g.targetId),
        team = g.subjectType === 'team' ? teams.find((t) => t.id === g.subjectId) : null,
        person = g.subjectType === 'user' ? users.find((u) => u.id === g.subjectId) : null,
        member = g.subjectType === 'user' ? members.find((m) => m.userId === g.subjectId) : null
      return {
        id: g.id,
        scope: g.scope,
        targetId: g.targetId,
        targetTitle: target ? string(target.title) : null,
        targetArchived: Boolean(target?.archived),
        subjectType: g.subjectType,
        subjectId: g.subjectId,
        subjectTitle: team ? string(team.title) : person ? string(person.name) : null,
        subjectEmail: person ? string(person.email) : null,
        subjectRole: member ? member.role : null,
        subjectStatus: member ? member.status : team ? (team.archived ? 'archived' : 'active') : null,
        memberCount: team ? Number(sizes.find((s) => s.key[0] === team.id)?.count ?? 0) : null,
        role: g.role,
        version: g.version,
      }
    }),
    total: Number(await ctx.db.count(base)),
    cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ id: last.id, fence })).toString('base64url')
        : null,
  }
}

/** What revoking a person removes: the projects their live grants and Teams open, and
 * their unfinished assigned tasks (the first 20 named). Both are counted on the server,
 * past any loaded window; the project engine is the one the actor's own access uses. */
export async function readMemberImpact(ctx: Ctx, input: Row) {
  const a = await requireCapability(ctx, 'organization.manage', input)
  const M = ctx.table('flow.Member'),
    TM = ctx.table('flow.TeamMember'),
    T = ctx.table('flow.Team'),
    G = ctx.table('flow.ScopedGrant'),
    W = ctx.table('flow.Workspace'),
    P = ctx.table('flow.ProjectRecord'),
    S = ctx.table('flow.TaskStatus'),
    A = ctx.table('flow.TaskAssignee')
  const memberId = string(input.memberId)
  const member = await ctx.db.one(from(M).where(eq(M.companyId, a.companyId), eq(M.userId, memberId)))
  if (!member) return refuse('not_found')
  const joins =
    member.role === 'guest'
      ? []
      : await ctx.db.all(
          from(TM)
            .where(eq(TM.companyId, a.companyId), eq(TM.memberId, memberId))
            .select(TM.teamId)
            .limit(1001),
        )
  if (joins.length > 1000) return refuse('limit')
  const teams = joins.length
    ? await ctx.db.all(
        from(T)
          .where(
            eq(T.companyId, a.companyId),
            eq(T.archived, false),
            inArray(
              T.id,
              joins.map((j) => j.teamId),
            ),
          )
          .select(T.id),
      )
    : []
  const grants = await ctx.db.all(
    from(G)
      .where(
        eq(G.companyId, a.companyId),
        or(
          and(eq(G.subjectType, 'user'), eq(G.subjectId, memberId)),
          ...(teams.length
            ? [
                and(
                  eq(G.subjectType, 'team'),
                  inArray(
                    G.subjectId,
                    teams.map((t) => t.id),
                  ),
                ),
              ]
            : []),
        ),
      )
      .limit(10001),
  )
  if (grants.length > 10000) return refuse('limit')
  const workspaces = await ctx.db.all(from(W).where(eq(W.companyId, a.companyId)).limit(1001))
  if (workspaces.length > 1000) return refuse('limit')
  const projects = await ctx.db.all(
    from(P)
      .where(eq(P.companyId, a.companyId), eq(P.archived, false), isNull(P.deletionId))
      .select(P.id, P.companyId, P.workspaceId, P.access)
      .limit(10001),
  )
  if (projects.length > 10000) return refuse('limit')
  // Counted as if the person were active, so a revoked person shows what they would regain.
  const { projectRole } = scopeRoles(a.companyId, { ...member, status: 'active' }, grants)
  const byId = new Map(workspaces.map((w) => [string(w.id), w]))
  const reachable = projects.filter((p) => {
    const w = byId.get(string(p.workspaceId))
    return w ? Boolean(projectRole(p, w)) : false
  }).length
  const done = (
    await ctx.db.all(from(S).where(eq(S.companyId, a.companyId), eq(S.kind, 'done')).select(S.id))
  ).map((s) => s.id)
  const open = from(A).where(
    eq(A.companyId, a.companyId),
    eq(A.userId, memberId),
    eq(A.archived, false),
    ...(done.length ? [not(inArray(A.columnId, done))] : []),
  )
  const tasks = await ctx.db.all(
    open.select(A.key, A.title, A.projectId).orderBy(asc(A.sequence), asc(A.taskId)).limit(20),
  )
  return {
    projects: reachable,
    tasks: {
      total: Number(await ctx.db.count(open)),
      // Tasks are named by their key, as every task the client opens is.
      items: tasks.map((t) => ({ id: t.key, title: t.title, projectId: t.projectId })),
    },
  }
}
