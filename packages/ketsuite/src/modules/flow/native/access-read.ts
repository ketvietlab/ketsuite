import { and, asc, eq, from, inArray, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { hash, revision } from './command.ts'
import { authority, owned, rank, refuse, requireCapability, string } from './policy.ts'
import { limitOf } from './queries.ts'

export type AccessSource = {
  role: string
  scope: 'project' | 'workspace' | 'internal'
  grantId: string | null
  teamId: string | null
  teamTitle: string | null
  teamMemberCount: number | null
  /** A direct project grant a move would add to keep someone's access. */
  retained?: boolean
}
export type Access = { role: string | null; sources: AccessSource[] }
type Person = Row & { name: string; email: string }
const order = { project: 0, workspace: 1, internal: 2 }

/** Effective Core access of every active person on a few targets, with the grants
 * that give it. Only the targets' grants and the Teams they name are read, never the
 * Company's whole graph; past the engine bounds the read refuses as `limit` rather
 * than answer from part of it. Roles follow `scopeRoles`; a Workspace source shows
 * `member` as `editor`, as the shared client access model does. */
export async function accessGraph(
  ctx: Ctx,
  companyId: string,
  targets: { projectIds: string[]; workspaceIds: string[]; extra?: Row[] },
) {
  const M = ctx.table('flow.Member'),
    U = ctx.table('user.User'),
    PM = ctx.table('user.Membership'),
    G = ctx.table('flow.ScopedGrant'),
    T = ctx.table('flow.Team'),
    TM = ctx.table('flow.TeamMember')
  const members = await ctx.db.all(
    from(M).where(eq(M.companyId, companyId), eq(M.status, 'active')).limit(1001),
  )
  if (members.length > 1000) return refuse('limit')
  const ids = members.map((m) => string(m.userId))
  const live = new Set(
    (
      await ctx.db.all(
        from(PM).where(eq(PM.companyId, companyId), inArray(PM.userId, ids)).select(PM.userId).limit(1001),
      )
    ).map((m) => string(m.userId)),
  )
  const people = new Map(
    (
      await ctx.db.all(
        from(U).where(inArray(U.id, ids), eq(U.active, true)).select(U.id, U.name, U.email).limit(1001),
      )
    ).map((u) => [string(u.id), u]),
  )
  const scoped = [
    ...(targets.projectIds.length
      ? [and(eq(G.scope, 'project'), inArray(G.targetId, targets.projectIds))]
      : []),
    ...(targets.workspaceIds.length
      ? [and(eq(G.scope, 'workspace'), inArray(G.targetId, targets.workspaceIds))]
      : []),
  ]
  const grants = scoped.length
    ? await ctx.db.all(
        from(G)
          .where(eq(G.companyId, companyId), or(...scoped))
          .orderBy(asc(G.id))
          .limit(10001),
      )
    : []
  if (grants.length > 10000) return refuse('limit')
  // Grants a command would add, so a preview reads them like stored ones.
  grants.push(...(targets.extra ?? []))
  const named = [...new Set(grants.filter((g) => g.subjectType === 'team').map((g) => string(g.subjectId)))]
  const teams = named.length
    ? await ctx.db.all(
        from(T)
          .where(eq(T.companyId, companyId), eq(T.archived, false), inArray(T.id, named))
          .select(T.id, T.title)
          .limit(1001),
      )
    : []
  const joins = teams.length
    ? await ctx.db.all(
        from(TM)
          .where(
            eq(TM.companyId, companyId),
            inArray(
              TM.teamId,
              teams.map((t) => t.id),
            ),
          )
          .select(TM.teamId, TM.memberId)
          .limit(100001),
      )
    : []
  if (joins.length > 100000) return refuse('limit')
  const titles = new Map(teams.map((t) => [string(t.id), string(t.title)])),
    sizes = new Map<string, number>(),
    memberTeams = new Map<string, Set<string>>()
  for (const j of joins) {
    const team = string(j.teamId),
      member = string(j.memberId)
    sizes.set(team, (sizes.get(team) ?? 0) + 1)
    memberTeams.set(member, (memberTeams.get(member) ?? new Set()).add(team))
  }
  const effective = (member: Row, project: Row | null, workspace: Row): Access => {
    if (
      member.status !== 'active' ||
      workspace.archived ||
      workspace.companyId !== companyId ||
      (project && (project.companyId !== companyId || project.workspaceId !== workspace.id))
    )
      return { role: null, sources: [] }
    const guest = member.role === 'guest',
      mine = memberTeams.get(string(member.userId)),
      inherits = !guest && (!project || project.access === 'workspace')
    const sources: AccessSource[] = []
    for (const g of grants) {
      const team = g.subjectType === 'team' ? string(g.subjectId) : null
      const own = team
        ? !guest && titles.has(team) && Boolean(mine?.has(team))
        : g.subjectType === 'user' && g.subjectId === member.userId
      if (!own) continue
      const via = {
        grantId: string(g.id),
        teamId: team,
        teamTitle: team ? (titles.get(team) ?? null) : null,
        teamMemberCount: team ? (sizes.get(team) ?? 0) : null,
      }
      if (project && g.scope === 'project' && g.targetId === project.id)
        sources.push({ role: string(g.role), scope: 'project', ...via })
      if (inherits && g.scope === 'workspace' && g.targetId === workspace.id)
        sources.push({ role: g.role === 'member' ? 'editor' : string(g.role), scope: 'workspace', ...via })
    }
    if (inherits && workspace.access === 'internal')
      sources.push({
        role: 'editor',
        scope: 'internal',
        grantId: null,
        teamId: null,
        teamTitle: null,
        teamMemberCount: null,
      })
    sources.sort((x, y) => order[x.scope] - order[y.scope])
    return {
      role: sources.reduce<string | null>(
        (best, s) => ((rank[s.role] ?? 0) > (rank[best ?? ''] ?? 0) ? s.role : best),
        null,
      ),
      sources,
    }
  }
  const listed = members
    .filter((m) => live.has(string(m.userId)) && people.has(string(m.userId)))
    .map(
      (m): Person => ({
        ...m,
        name: string(people.get(string(m.userId))?.name),
        email: string(people.get(string(m.userId))?.email),
      }),
    )
  return { members: listed, effective, grants }
}

const byName = (x: Row & { name: string }, y: Row & { name: string }) => {
  const a = string(x.userId),
    b = string(y.userId)
  return x.name < y.name ? -1 : x.name > y.name ? 1 : a < b ? -1 : a > b ? 1 : 0
}

/** Who can open one project or Workspace, and through which grants. Any internal
 * person who can read the target sees the same list; only active people count. */
export async function readAccess(ctx: Ctx, input: Row) {
  const a = await authority(ctx)
  if (!a.member || a.member.role === 'guest') return refuse('forbidden')
  const scope = string(input.scope)
  if (scope !== 'project' && scope !== 'workspace') return refuse('validation', { scope: 'invalid' })
  const limit = limitOf(input.limit, 50),
    memberId = input.memberId === undefined || input.memberId === null ? '' : string(input.memberId)
  if (memberId.length > 200) return refuse('validation', { memberId: 'invalid' })
  const queryText = string(input.query).toLocaleLowerCase()
  if (queryText.length > 200) return refuse('validation', { query: 'too_long' })
  let project: Row | null = null,
    workspace: Row
  if (scope === 'project') {
    project = await owned(ctx, 'flow.ProjectRecord', input.targetId)
    if (project.deletionId) return refuse('not_found')
    workspace = await owned(ctx, 'flow.Workspace', project.workspaceId)
    if (!a.manageOrganization && !a.projectRole(project, workspace)) return refuse('forbidden')
  } else {
    workspace = await owned(ctx, 'flow.Workspace', input.targetId)
    if (!a.manageOrganization && !a.workspaceRole(workspace)) return refuse('forbidden')
  }
  const graph = await accessGraph(ctx, a.companyId, {
    projectIds: project ? [string(project.id)] : [],
    workspaceIds: [string(workspace.id)],
  })
  const rows = graph.members.map((m): Person & { access: Access } => ({
    ...m,
    access: graph.effective(m, project, workspace),
  }))
  const granted = rows.filter((r) => r.access.role)
  // Search narrows the people with access before paging and counting, as the directory does.
  const found = queryText
    ? granted.filter((r) => `${r.name} ${r.email}`.toLocaleLowerCase().includes(queryText))
    : granted
  const listed = (memberId ? rows.filter((r) => r.userId === memberId) : found).sort(byName)
  const fence = hash(
    JSON.stringify([
      a.companyId,
      a.actorId,
      'access',
      scope,
      workspace.id,
      project?.id ?? '',
      memberId,
      queryText,
      await revision(ctx, 'collection-change'),
    ]),
  )
  let start = 0
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
      typeof c.name !== 'string' ||
      c.name.length > 1000 ||
      typeof c.id !== 'string' ||
      !c.id ||
      c.id.length > 200
    )
      return refuse('validation', { cursor: 'invalid' })
    if (c.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
    start = listed.findIndex((r) => byName(r, { name: string(c.name), userId: c.id }) > 0)
    if (start < 0) start = listed.length
  }
  const page = listed.slice(start, start + limit),
    last = page.at(-1)
  const TM = ctx.table('flow.TeamMember'),
    T = ctx.table('flow.Team')
  const joins = page.length
    ? await ctx.db.all(
        from(TM)
          .where(
            eq(TM.companyId, a.companyId),
            inArray(
              TM.memberId,
              page.map((r) => r.userId),
            ),
          )
          .select(TM.teamId, TM.memberId)
          .limit(10001),
      )
    : []
  if (joins.length > 10000) return refuse('limit')
  const teams = joins.length
    ? await ctx.db.all(
        from(T)
          .where(
            eq(T.companyId, a.companyId),
            eq(T.archived, false),
            inArray(T.id, [...new Set(joins.map((j) => j.teamId))]),
          )
          .select(T.id, T.title)
          .orderBy(asc(T.title), asc(T.id))
          .limit(10001),
      )
    : []
  return {
    items: page.map((r) => ({
      id: r.userId,
      name: r.name,
      email: r.email,
      role: r.role,
      status: r.status,
      version: r.version,
      access: r.access,
      teams: teams
        .filter((t) => joins.some((j) => j.memberId === r.userId && j.teamId === t.id))
        .map((t) => ({ id: t.id, title: t.title })),
    })),
    total: memberId ? listed.length : found.length,
    without: rows.length - granted.length,
    cursor:
      start + limit < listed.length && last
        ? Buffer.from(JSON.stringify({ id: last.userId, name: last.name, fence })).toString('base64url')
        : null,
  }
}

export type Impact = {
  id: string
  name: string
  email: string
  projectId: string | null
  projectTitle: string | null
  before: Access
  after: Access
  change: 'loss' | 'gain' | 'same'
}
const severity = { loss: 0, gain: 1, same: 2 }
const text = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
export const changeOf = (before: Access, after: Access): Impact['change'] => {
  const was = rank[before.role ?? ''] ?? 0,
    will = rank[after.role ?? ''] ?? 0
  return will > was ? 'gain' : will < was ? 'loss' : 'same'
}

/** One page of a computed impact list, people who lose access first. A preview is
 * recomputed on every read, so its cursor is an offset fenced by every committed
 * command: a page never mixes two states. */
export async function impactPage(ctx: Ctx, a: Row, rows: Impact[], input: Row, parts: unknown[]) {
  const limit = limitOf(input.limit, 50)
  rows.sort(
    (x, y) =>
      severity[x.change] - severity[y.change] ||
      text(x.name, y.name) ||
      text(x.projectTitle ?? '', y.projectTitle ?? '') ||
      text(x.id, y.id) ||
      text(x.projectId ?? '', y.projectId ?? ''),
  )
  const fence = hash(
    JSON.stringify([a.companyId, a.actorId, ...parts, await revision(ctx, 'collection-change')]),
  )
  let start = 0
  if (input.cursor) {
    if (typeof input.cursor !== 'string' || input.cursor.length > 2048)
      return refuse('validation', { cursor: 'invalid' })
    let c: Row
    try {
      c = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as Row
    } catch {
      return refuse('validation', { cursor: 'invalid' })
    }
    if (!c || Array.isArray(c) || !Number.isInteger(c.offset) || Number(c.offset) < 1)
      return refuse('validation', { cursor: 'invalid' })
    if (c.fence !== fence || Number(c.offset) > rows.length)
      return refuse('conflict', { cursor: 'scope_changed' })
    start = Number(c.offset)
  }
  return {
    items: rows.slice(start, start + limit),
    total: rows.length,
    counts: Object.fromEntries(
      (['loss', 'gain', 'same'] as const).map((key) => [key, rows.filter((r) => r.change === key).length]),
    ),
    cursor:
      start + limit < rows.length
        ? Buffer.from(JSON.stringify({ offset: start + limit, fence })).toString('base64url')
        : null,
  }
}

/** Who would gain or lose access if a project's or Workspace's access setting
 * changed, computed with the same engine as the change itself. Only people whose
 * role would change are listed. */
export async function previewAccess(ctx: Ctx, input: Row) {
  const change = string(input.change),
    access = string(input.access),
    P = ctx.table('flow.ProjectRecord')
  let a: Row,
    workspace: Row,
    projects: Row[],
    next: (p: Row) => Row,
    nextWorkspace: Row,
    extra: Row[] = [],
    created = false
  if (change === 'project-access') {
    if (!['workspace', 'private'].includes(access)) return refuse('validation', { access: 'invalid' })
    a = await requireCapability(ctx, 'project.manage', { projectId: input.projectId })
    const project = await owned(ctx, 'flow.ProjectRecord', input.projectId)
    workspace = await owned(ctx, 'flow.Workspace', project.workspaceId)
    projects = [project]
    next = (p) => ({ ...p, access })
    nextWorkspace = workspace
  } else if (change === 'workspace-access') {
    if (!['internal', 'restricted'].includes(access)) return refuse('validation', { access: 'invalid' })
    a = await requireCapability(ctx, 'workspace.manage', { workspaceId: input.workspaceId })
    workspace = await owned(ctx, 'flow.Workspace', input.workspaceId)
    projects = await ctx.db.all(
      from(P)
        .where(
          eq(P.companyId, a.companyId),
          eq(P.workspaceId, workspace.id),
          eq(P.archived, false),
          eq(P.access, 'workspace'),
        )
        .limit(1001),
    )
    if (projects.length > 1000) return refuse('limit')
    projects = projects.filter((p) => !p.deletionId)
    next = (p) => p
    nextWorkspace = { ...workspace, access }
  } else if (change === 'project-create') {
    // Who a new project opens to: the grants project.save writes, plus its Workspace.
    if (!['workspace', 'private'].includes(access)) return refuse('validation', { access: 'invalid' })
    a = await requireCapability(ctx, 'workspace.manage', { workspaceId: input.workspaceId })
    workspace = await owned(ctx, 'flow.Workspace', input.workspaceId)
    const ids = (key: string) => {
      const value = input[key] ?? []
      if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== 'string'))
        return refuse('validation', { [key]: 'invalid' })
      return [...new Set(value as string[])]
    }
    const draft = { id: '\u0000new', companyId: a.companyId, workspaceId: workspace.id, access, title: '' }
    const grant = (subjectType: string, subjectId: string, role: string) => ({
      id: '',
      scope: 'project',
      targetId: draft.id,
      subjectType,
      subjectId,
      role,
    })
    extra = [
      grant('user', string(a.actorId), 'admin'),
      grant('user', string(input.ownerId || a.actorId), 'admin'),
      ...ids('memberIds').map((id) => grant('user', id, 'member')),
      ...ids('teamIds').map((id) => grant('team', id, 'member')),
    ]
    projects = [draft]
    next = (p) => p
    nextWorkspace = workspace
    created = true
  } else return refuse('validation', { change: 'invalid' })
  const graph = await accessGraph(ctx, string(a.companyId), {
    projectIds: projects.map((p) => string(p.id)).filter((id) => id !== '\u0000new'),
    workspaceIds: [string(workspace.id)],
    extra,
  })
  const rows: Impact[] = []
  for (const project of projects)
    for (const m of graph.members) {
      const before: Access = created ? { role: null, sources: [] } : graph.effective(m, project, workspace),
        after = graph.effective(m, next(project), nextWorkspace),
        kind = changeOf(before, after)
      if (kind !== 'same')
        rows.push({
          id: string(m.userId),
          name: m.name,
          email: m.email,
          projectId: created ? null : string(project.id),
          projectTitle: created ? null : string(project.title),
          before,
          after,
          change: kind,
        })
    }
  return impactPage(ctx, a, rows, input, [
    'access-preview',
    change,
    string(workspace.id),
    string(input.projectId ?? ''),
    access,
  ])
}
