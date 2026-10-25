import { and, asc, eq, from, ilike, inArray, isNull, likeLiteral, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { refuse, string } from './policy.ts'
import { visibleScope } from './queries.ts'
import { projectDefaultView } from './project-view.ts'
import type { NativeServerExtension } from './command.ts'

export async function search(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const query = string(input.query)
  if (
    query.length > 240 ||
    (input.recent !== undefined &&
      (!Array.isArray(input.recent) ||
        input.recent.length > 30 ||
        input.recent.some((id) => typeof id !== 'string')))
  )
    return refuse('validation')
  const { a, projects, workspaces } = await visibleScope(ctx)
  if (!a.member) return { groups: [] }
  // A guest is offered only what a guest may open: no Workspace, form, person or team.
  const guest = a.member.role === 'guest'
  const projectIds = projects.filter((p) => !p.archived).map((p) => p.id),
    workspaceIds = workspaces.filter((w) => !w.archived && a.workspaceRole(w)).map((w) => w.id)
  const pattern = '%' + likeLiteral(query) + '%',
    groups: Row[] = []
  const add = (id: string, items: Row[]) => {
    if (items.length) groups.push({ id, items })
  }
  const item = (
    prefix: string,
    row: Row,
    route: string,
    icon: string,
    params: Row = {},
    description = '',
  ) => ({ id: prefix + ':' + row.id, title: row.title, description, icon, route, params })
  add(
    'workspaces',
    (guest ? [] : workspaces)
      .filter((w) => !w.archived && string(w.title).toLowerCase().includes(query.toLowerCase()))
      .slice(0, query ? 6 : 2)
      .map((w) => item('workspace', w, 'workspace-overview', 'layers', { workspace: w.id })),
  )
  add(
    'projects',
    projects
      .filter(
        (p) =>
          !p.archived &&
          [p.title, p.code, p.outcome].some((v) => string(v).toLowerCase().includes(query.toLowerCase())),
      )
      .slice(0, query ? 6 : 3)
      .map((p) =>
        item(
          'project',
          p,
          projectDefaultView(p.defaultView),
          'folder',
          { project: p.id, workspace: p.workspaceId },
          string(p.code),
        ),
      ),
  )
  const T = ctx.table('flow.Task')
  const tasks = projectIds.length
    ? await ctx.db.all(
        from(T)
          .where(
            eq(T.companyId, a.companyId),
            inArray(T.projectId, projectIds),
            eq(T.archived, false),
            or(ilike(T.title, pattern), ilike(T.key, pattern), ilike(T.description, pattern)),
          )
          .select(T.id, T.key, T.title, T.projectId)
          .orderBy(asc(T.sequence), asc(T.id))
          .limit(query ? 6 : 4),
      )
    : []
  add(
    'tasks',
    tasks.map((t) => ({
      ...item('task', { ...t, id: t.key }, 'issue', 'list', { id: t.key, project: t.projectId }),
      description: t.key,
    })),
  )
  const D = ctx.table('flow.Document'),
    G = ctx.table('flow.DocumentGrant')
  const grants = await ctx.db.all(
    from(G).where(eq(G.companyId, a.companyId), eq(G.userId, a.actorId)).select(G.documentId).limit(1001),
  )
  if (grants.length > 1000) return refuse('limit')
  const pages = await ctx.db.all(
    from(D)
      .where(
        eq(D.companyId, a.companyId),
        eq(D.archived, false),
        or(inArray(D.projectId, projectIds), and(isNull(D.projectId), inArray(D.workspaceId, workspaceIds))),
        guest
          ? inArray(
              D.id,
              grants.map((g) => g.documentId),
            )
          : or(
              eq(D.visibility, 'shared'),
              eq(D.authorId, a.actorId),
              inArray(
                D.id,
                grants.map((g) => g.documentId),
              ),
            ),
        or(ilike(D.title, pattern), ilike(D.body, pattern)),
      )
      .select(D.id, D.title, D.projectId, D.workspaceId)
      .orderBy(asc(D.title), asc(D.id))
      .limit(query ? 6 : 3),
  )
  add(
    'pages',
    pages.map((p) =>
      item('page', p, 'page', 'book', {
        id: p.id,
        project: p.projectId ?? '',
        workspace: p.workspaceId,
        scope: p.projectId ? 'project' : 'workspace',
      }),
    ),
  )
  for (const [group, model, route, icon] of [
    ['sprints', 'flow.SprintRecord', 'sprints', 'clock'],
    ['epics', 'flow.EpicRecord', 'epic', 'layers'],
    ...(guest ? [] : [['forms', 'flow.InternalForm', 'forms', 'file'] as const]),
  ] as const) {
    const C = ctx.table(model)
    const rows = projectIds.length
      ? await ctx.db.all(
          from(C)
            .where(
              eq(C.companyId, a.companyId),
              inArray(C.projectId, projectIds),
              eq(C.archived, false),
              ilike(C.title, pattern),
            )
            .select(C.id, C.title, C.projectId)
            .orderBy(asc(C.title), asc(C.id))
            .limit(query ? 6 : 2),
        )
      : []
    add(
      group,
      // The sprint screen lists a project's sprints; it opens none by id.
      rows.map((r) =>
        item(
          group,
          r,
          route,
          icon,
          group === 'sprints' ? { project: r.projectId } : { id: r.id, project: r.projectId },
        ),
      ),
    )
  }
  const V = ctx.table('flow.SavedView'),
    I = ctx.table('flow.Inbox')
  const [views, inbox] = await Promise.all([
    // The views one may open: of a project one reads, one's own or shared with it; one's own of none.
    ctx.db.all(
      from(V)
        .where(
          eq(V.companyId, a.companyId),
          eq(V.archived, false),
          or(
            and(isNull(V.projectId), eq(V.ownerId, a.actorId)),
            ...(projectIds.length ? [inArray(V.projectId, projectIds)] : []),
          ),
          ilike(V.title, pattern),
        )
        .select(V.id, V.title, V.projectId, V.ownerId, V.query, V.status)
        .orderBy(asc(V.title), asc(V.id))
        .limit(30),
    ),
    ctx.db.all(
      from(I)
        .where(
          eq(I.companyId, a.companyId),
          eq(I.recipientId, a.actorId),
          ilike(I.title, pattern),
          or(isNull(I.taskId), ...(projectIds.length ? [inArray(I.projectId, projectIds)] : [])),
        )
        .select(I.id, I.title)
        .orderBy(asc(I.id))
        .limit(6),
    ),
  ])
  // Opened as the saved views screen opens them: the project list with the view's filter.
  add(
    'views',
    views
      .filter((v) => v.ownerId === a.actorId || (v.query as Row | null)?.visibility === 'project')
      .slice(0, 6)
      .map((v) =>
        item('view', v, 'project-issues', 'list', {
          project: v.projectId ?? '',
          view: v.id,
          q: string((v.query as Row | null)?.text),
          status: string(v.status) || 'all',
        }),
      ),
  )
  add(
    'inbox',
    inbox.map((i) => item('inbox', i, 'inbox', 'inbox')),
  )
  if (!guest) {
    const M = ctx.table('flow.Member'),
      U = ctx.table('user.User'),
      Team = ctx.table('flow.Team')
    const members = await ctx.db.all(
      from(M).where(eq(M.companyId, a.companyId), eq(M.status, 'active')).select(M.userId).limit(1001),
    )
    if (members.length > 1000) return refuse('limit')
    const [users, teams] = await Promise.all([
      ctx.db.all(
        from(U)
          .where(
            inArray(
              U.id,
              members.map((m) => m.userId),
            ),
            eq(U.active, true),
            or(ilike(U.name, pattern), ilike(U.email, pattern)),
          )
          .select(U.id, U.name)
          .orderBy(asc(U.name), asc(U.id))
          .limit(6),
      ),
      ctx.db.all(
        from(Team)
          .where(eq(Team.companyId, a.companyId), eq(Team.archived, false), ilike(Team.title, pattern))
          .select(Team.id, Team.title)
          .orderBy(asc(Team.title), asc(Team.id))
          .limit(6),
      ),
    ])
    add(
      'people',
      users.map((u) => item('person', { ...u, title: u.name }, 'organization-members', 'user', { id: u.id })),
    )
    add(
      'teams',
      teams.map((t) => item('team', t, 'team', 'users', { id: t.id })),
    )
  }
  for (const extension of extensions)
    for (const group of (await extension.search?.(ctx, query)) ?? []) {
      if (groups.some((g) => g.id === group.id) || !Array.isArray(group.items) || group.items.length > 6)
        throw new Error('Invalid Flow search extension')
      groups.push(group)
    }
  const recent = new Set((input.recent as string[]) ?? [])
  const all = groups.flatMap((g) => g.items as Row[])
  if (!query) add('recent', all.filter((i) => recent.has(string(i.id))).slice(0, 6))
  const navigation = guest
    ? ['my-work', 'inbox', 'personal-settings']
    : ['my-work', 'inbox', 'all-issues', 'all-pages', 'organization', 'personal-settings']
  add(
    'navigation',
    navigation
      .filter((route) => !query || route.includes(query.toLowerCase()))
      .slice(0, query ? 6 : 3)
      .map((route) => ({
        id: 'nav:' + route,
        title: route,
        description: '',
        icon: 'grid',
        route,
        params: {},
      })),
  )
  return { groups }
}
