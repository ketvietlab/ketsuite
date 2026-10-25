import { and, asc, eq, from, gt, ilike, inArray, likeLiteral, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { authority, owned, rank, refuse, requireCapability, scopeRoles, string } from './policy.ts'
import { hash, revision } from './command.ts'
import { limitOf } from './queries.ts'

export async function readMembers(ctx: Ctx, input: Row, options = false) {
  const a = options ? await requireCapability(ctx, 'project.read', input) : await authority(ctx)
  if (!a.member || (!options && a.member.role === 'guest')) return refuse('forbidden')
  const M = ctx.table('flow.Member'),
    U = ctx.table('user.User'),
    PM = ctx.table('user.Membership')
  const limit = limitOf(input.limit, 25),
    queryText = string(input.query)
  if (queryText.length > 200) return refuse('validation', { query: 'too_long' })
  const members = await ctx.db.all(
    from(M)
      .where(eq(M.companyId, a.companyId), ...(options ? [eq(M.status, 'active')] : []))
      .limit(1001),
  )
  if (members.length > 1000) return refuse('limit')
  const platform = await ctx.db.all(
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
  const live = new Set(platform.map((m) => m.userId))
  let eligible = members.filter((m) => live.has(m.userId))
  // A Team's members, or the internal people who could join it; membership is read whole.
  const teamFilter = options ? '' : string(input.teamId ?? input.candidateForTeamId)
  if (teamFilter) {
    const team = await owned(ctx, 'flow.Team', teamFilter),
      Joins = ctx.table('flow.TeamMember')
    if (team.archived) return refuse('not_found')
    const joined = await ctx.db.all(
      from(Joins)
        .where(eq(Joins.companyId, a.companyId), eq(Joins.teamId, team.id))
        .select(Joins.memberId)
        .limit(10001),
    )
    if (joined.length > 10000) return refuse('limit')
    const inTeam = new Set(joined.map((j) => j.memberId))
    eligible =
      input.teamId !== undefined && input.teamId !== null
        ? eligible.filter((m) => inTeam.has(m.userId))
        : eligible.filter((m) => !inTeam.has(m.userId) && m.status === 'active' && m.role !== 'guest')
  }
  // Both reads narrow before paging: `internal` keeps active internal people, `active` every
  // active person, guests too (whom a project may be granted to), and `ids` names a selection
  // to recheck. Options may also leave some out (`exclude`); 100 ids each.
  const idList = (key: string) => {
    const value = input[key]
    if (value === undefined || value === null) return null
    if (
      (!options && key !== 'ids') ||
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some((id) => typeof id !== 'string')
    )
      return refuse('validation', { [key]: 'invalid' })
    return value as string[]
  }
  const only = idList('ids'),
    except = idList('exclude')
  // Options may keep only some project roles (a reviewer must edit, say).
  const roles =
    input.roles === undefined || input.roles === null
      ? null
      : options &&
          Array.isArray(input.roles) &&
          input.roles.length > 0 &&
          input.roles.length <= 5 &&
          input.roles.every((role) => typeof role === 'string' && Object.hasOwn(rank, role))
        ? (input.roles as string[])
        : refuse('validation', { roles: 'invalid' })
  if (only) eligible = eligible.filter((m) => only.includes(string(m.userId)))
  if (except) eligible = eligible.filter((m) => !except.includes(string(m.userId)))
  if (input.internal) eligible = eligible.filter((m) => m.role !== 'guest' && m.status === 'active')
  if (input.active) eligible = eligible.filter((m) => m.status === 'active')
  if (options) {
    const project = await owned(ctx, 'flow.ProjectRecord', input.projectId),
      workspace = await owned(ctx, 'flow.Workspace', project.workspaceId)
    if (project.archived || project.deletionId) return refuse('forbidden')
    const TM = ctx.table('flow.TeamMember'),
      T = ctx.table('flow.Team'),
      G = ctx.table('flow.ScopedGrant')
    const joins = await ctx.db.all(
      from(TM)
        .where(
          eq(TM.companyId, a.companyId),
          inArray(
            TM.memberId,
            eligible.map((m) => m.userId),
          ),
        )
        .limit(20001),
    )
    if (joins.length > 20000) return refuse('limit')
    const teams = await ctx.db.all(
      from(T)
        .where(
          eq(T.companyId, a.companyId),
          eq(T.archived, false),
          inArray(T.id, [...new Set(joins.map((j) => j.teamId))]),
        )
        .select(T.id)
        .limit(1001),
    )
    if (teams.length > 1000) return refuse('limit')
    const teamIds = new Set(teams.map((t) => t.id))
    const grants = await ctx.db.all(
      from(G)
        .where(
          eq(G.companyId, a.companyId),
          or(
            and(eq(G.scope, 'project'), eq(G.targetId, project.id)),
            and(eq(G.scope, 'workspace'), eq(G.targetId, workspace.id)),
          ),
        )
        .limit(20001),
    )
    if (grants.length > 20000) return refuse('limit')
    eligible = eligible.filter((m) => {
      const ids = new Set(
        joins.filter((j) => j.memberId === m.userId && teamIds.has(j.teamId)).map((j) => j.teamId),
      )
      const own = grants.filter((g) =>
        g.subjectType === 'user'
          ? g.subjectId === m.userId
          : m.role !== 'guest' && g.subjectType === 'team' && ids.has(g.subjectId),
      )
      const role = scopeRoles(a.companyId, m, own).projectRole(project, workspace)
      return Boolean(role) && (!roles || roles.includes(role ?? ''))
    })
  }
  const fence = hash(
    JSON.stringify([
      a.companyId,
      a.actorId,
      options,
      input.projectId ?? '',
      queryText,
      input.teamId ?? '',
      input.candidateForTeamId ?? '',
      Boolean(input.internal),
      Boolean(input.active),
      roles ?? '',
      only ?? '',
      except ?? '',
      await revision(ctx, 'collection-change'),
      eligible.map((m) => [m.userId, m.version]).sort(),
    ]),
  )
  let query = from(U)
    .where(
      inArray(
        U.id,
        eligible.map((m) => m.userId),
      ),
      eq(U.active, true),
    )
    .select(U.id, U.name, U.email)
  if (queryText) {
    const pattern = '%' + likeLiteral(queryText) + '%'
    query = query.where(or(ilike(U.name, pattern), ilike(U.email, pattern)))
  }
  const total = Number(await ctx.db.count(query))
  if (input.cursor) {
    if (typeof input.cursor !== 'string' || input.cursor.length > 2048)
      return refuse('validation', { cursor: 'invalid' })
    let cursor: Row
    try {
      cursor = JSON.parse(Buffer.from(string(input.cursor), 'base64url').toString('utf8')) as Row
    } catch {
      return refuse('validation', { cursor: 'invalid' })
    }
    if (
      !cursor ||
      typeof cursor !== 'object' ||
      Array.isArray(cursor) ||
      typeof cursor.name !== 'string' ||
      cursor.name.length > 1000 ||
      typeof cursor.id !== 'string' ||
      !cursor.id ||
      cursor.id.length > 200
    )
      return refuse('validation', { cursor: 'invalid' })
    if (cursor.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
    query = query.where(or(gt(U.name, cursor.name), and(eq(U.name, cursor.name), gt(U.id, cursor.id))))
  }
  const rows = await ctx.db.all(query.orderBy(asc(U.name), asc(U.id)).limit(limit + 1)),
    page = rows.slice(0, limit),
    last = page.at(-1)
  const byUser = new Map(eligible.map((m) => [m.userId, m]))
  // Each directory row carries its person's active Teams, so access is never read from a Team window.
  const Joined = ctx.table('flow.TeamMember'),
    Teams = ctx.table('flow.Team')
  const joined =
    options || !page.length
      ? []
      : await ctx.db.all(
          from(Joined)
            .where(
              eq(Joined.companyId, a.companyId),
              inArray(
                Joined.memberId,
                page.map((u) => u.id),
              ),
            )
            .select(Joined.teamId, Joined.memberId)
            .limit(10001),
        )
  if (joined.length > 10000) return refuse('limit')
  const activeTeams = new Set(
    joined.length
      ? (
          await ctx.db.all(
            from(Teams)
              .where(
                eq(Teams.companyId, a.companyId),
                eq(Teams.archived, false),
                inArray(Teams.id, [...new Set(joined.map((j) => j.teamId))]),
              )
              .select(Teams.id)
              .limit(10001),
          )
        ).map((t) => t.id)
      : [],
  )
  const teamIds = (id: unknown) =>
    joined.filter((j) => j.memberId === id && activeTeams.has(j.teamId)).map((j) => j.teamId)
  return {
    items: page.map(
      (u): Row => ({
        ...(options
          ? { role: byUser.get(u.id)?.role, status: byUser.get(u.id)?.status }
          : { ...byUser.get(u.id), teamIds: teamIds(u.id) }),
        ...u,
      }),
    ),
    total,
    cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ id: last.id, name: last.name, fence })).toString('base64url')
        : null,
  }
}
