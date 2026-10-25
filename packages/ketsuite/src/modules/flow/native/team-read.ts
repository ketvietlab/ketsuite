import { and, asc, eq, from, gt, ilike, inArray, likeLiteral, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { hash, revision } from './command.ts'
import { authority, owned, refuse, string } from './policy.ts'
import { limitOf } from './queries.ts'

type Authority = Awaited<ReturnType<typeof authority>>

/** Grants of these Teams on targets the actor can read, with the target's title.
 * Organization managers see every grant; others never learn of a hidden project. */
async function teamGrants(ctx: Ctx, a: Authority, teamIds: string[]) {
  if (!teamIds.length) return []
  const G = ctx.table('flow.ScopedGrant'),
    P = ctx.table('flow.ProjectRecord'),
    W = ctx.table('flow.Workspace')
  const grants = await ctx.db.all(
    from(G)
      .where(eq(G.companyId, a.companyId), eq(G.subjectType, 'team'), inArray(G.subjectId, teamIds))
      .orderBy(asc(G.id))
      .limit(10001),
  )
  if (grants.length > 10000) return refuse('limit')
  const ids = (scope: string) => [
    ...new Set(grants.filter((g) => g.scope === scope).map((g) => string(g.targetId))),
  ]
  const projects = ids('project').length
    ? await ctx.db.all(
        from(P)
          .where(eq(P.companyId, a.companyId), inArray(P.id, ids('project')))
          .limit(10001),
      )
    : []
  const workspaceIds = [...new Set([...ids('workspace'), ...projects.map((p) => string(p.workspaceId))])]
  const workspaces = workspaceIds.length
    ? await ctx.db.all(from(W).where(eq(W.companyId, a.companyId), inArray(W.id, workspaceIds)).limit(10001))
    : []
  const project = new Map(projects.map((p) => [string(p.id), p])),
    workspace = new Map(workspaces.map((w) => [string(w.id), w]))
  return grants.flatMap((g) => {
    const p = g.scope === 'project' ? project.get(string(g.targetId)) : undefined,
      w = workspace.get(string(p ? p.workspaceId : g.targetId))
    if (!w || (g.scope === 'project' && (!p || p.deletionId))) return []
    if (!a.manageOrganization && !(p ? a.projectRole(p, w) : a.workspaceRole(w))) return []
    return [
      {
        id: g.id,
        teamId: g.subjectId,
        scope: g.scope,
        targetId: g.targetId,
        targetTitle: string((p ?? w).title),
        role: g.role,
        version: g.version,
      },
    ]
  })
}

/** Member and visible grant counts for a page of Teams, in two grouped reads. */
export async function teamCounts(ctx: Ctx, a: Authority, teamIds: string[]) {
  const TM = ctx.table('flow.TeamMember')
  const members = teamIds.length
    ? await ctx.db.group(
        from(TM)
          .where(eq(TM.companyId, a.companyId), inArray(TM.teamId, teamIds))
          .groupBy({ col: TM.teamId }),
      )
    : []
  const grants = await teamGrants(ctx, a, teamIds)
  const counts = (id: unknown) => ({
    memberCount: Number(members.find((m) => m.key[0] === id)?.count ?? 0),
    grantCount: grants.filter((g) => g.teamId === id).length,
  })
  return { counts, grants }
}

/** The Company's active Teams by title, with their sizes. Any internal person may read it. */
export async function readTeams(ctx: Ctx, input: Row) {
  const a = await authority(ctx)
  if (!a.member || a.member.role === 'guest') return refuse('forbidden')
  const T = ctx.table('flow.Team'),
    limit = limitOf(input.limit, 50),
    queryText = string(input.query)
  if (queryText.length > 200) return refuse('validation', { query: 'too_long' })
  let base = from(T).where(eq(T.companyId, a.companyId), eq(T.archived, false))
  if (queryText) base = base.where(ilike(T.title, '%' + likeLiteral(queryText) + '%'))
  const fence = hash(
    JSON.stringify([a.companyId, a.actorId, 'teams', queryText, await revision(ctx, 'collection-change')]),
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
      typeof c.title !== 'string' ||
      c.title.length > 1000 ||
      typeof c.id !== 'string' ||
      !c.id ||
      c.id.length > 200
    )
      return refuse('validation', { cursor: 'invalid' })
    if (c.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
    query = query.where(or(gt(T.title, c.title), and(eq(T.title, c.title), gt(T.id, c.id))))
  }
  const rows = await ctx.db.all(
    query
      .select(T.id, T.title, T.description, T.version)
      .orderBy(asc(T.title), asc(T.id))
      .limit(limit + 1),
  )
  const page = rows.slice(0, limit),
    last = page.at(-1),
    { counts } = await teamCounts(
      ctx,
      a,
      page.map((t) => string(t.id)),
    )
  return {
    items: page.map((t): Row => ({ ...t, archived: false, ...counts(t.id) })),
    total: Number(await ctx.db.count(base)),
    cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ id: last.id, title: last.title, fence })).toString('base64url')
        : null,
  }
}

/** One active Team with its size and the scopes it is granted that the actor can see. */
export async function readTeam(ctx: Ctx, input: Row) {
  const a = await authority(ctx)
  if (!a.member || a.member.role === 'guest') return refuse('forbidden')
  const team = await owned(ctx, 'flow.Team', input.id)
  if (team.archived) return refuse('not_found')
  const { counts, grants } = await teamCounts(ctx, a, [string(team.id)])
  if (grants.length > 1000) return refuse('limit')
  return {
    team: {
      id: team.id,
      title: team.title,
      description: team.description,
      version: team.version,
      archived: false,
      ...counts(team.id),
    },
    grants: grants.sort((x, y) =>
      x.targetTitle < y.targetTitle
        ? -1
        : x.targetTitle > y.targetTitle
          ? 1
          : string(x.id) < string(y.id)
            ? -1
            : 1,
    ),
  }
}
