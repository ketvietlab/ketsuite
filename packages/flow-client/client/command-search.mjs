import { tr, flowMessageManifest } from './i18n.mjs'
import { extensionCommands } from './extensions.mjs'
const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim()
export function commandResults(data, query, { workspaceId, recent = [], extra = [] } = {}) {
  const needle = normalize(query),
    words = needle.split(/\s+/).filter(Boolean)
  const projectById = new Map(data.projects.map((p) => [p.id, p]))
  const taskById = new Map(data.tasks.map((t) => [t.id, t]))
  const memberById = new Map((data.members ?? []).map((m) => [m.id, m]))
  const workspaceById = new Map((data.workspaces ?? []).map((w) => [w.id, w]))
  const contextByTask = new Map()
  for (const entry of [...(data.comments ?? []), ...(data.history ?? []), ...(data.inbox ?? [])]) {
    const entries = contextByTask.get(entry.taskId) ?? []
    entries.push(`${entry.text ?? entry.title ?? ''} ${entry.description ?? ''}`)
    contextByTask.set(entry.taskId, entries)
  }
  const project = (id) => projectById.get(id)
  const workspace = (id) => workspaceById.get(id)?.title ?? ''
  const result = (id, title, description, icon, route, params = {}, keywords = '') => ({
    id,
    title,
    description,
    icon,
    route,
    params,
    keywords,
  })
  const guest = data.members?.find((m) => m.id === data.user.id)?.role === 'guest'
  const navigation = [
    result('nav:mine', tr('flow.ui.my.tasks'), tr('flow.ui.personal'), 'inbox', 'my-work'),
    result('nav:inbox', tr('flow.ui.inbox'), tr('flow.ui.personal'), 'inbox', 'inbox'),
    ...extensionCommands(data).map((c) =>
      result(c.id, c.title, c.description, c.icon, c.route, c.params, c.keywords),
    ),
    ...(!guest
      ? [
          result(
            'nav:workspace',
            tr('flow.ui.manage.workspace'),
            workspace(workspaceId),
            'layers',
            'workspace-overview',
          ),
          result('nav:tasks', tr('flow.ui.all.tasks'), workspace(workspaceId), 'list', 'all-issues'),
          result('nav:pages', tr('flow.ui.document.library'), workspace(workspaceId), 'book', 'all-pages'),
          result('nav:organization', tr('flow.ui.organization'), data.company.name, 'grid', 'organization'),
        ]
      : []),
    result(
      'nav:settings',
      tr('flow.ui.personal.settings'),
      tr('flow.ui.your.preferences'),
      'settings',
      'personal-settings',
    ),
  ]
  const navigationKeys = {
    'my-work': 'ui.my.tasks',
    inbox: 'ui.inbox',
    'workspace-overview': 'ui.manage.workspace',
    'all-issues': 'ui.all.tasks',
    'all-pages': 'ui.document.library',
    organization: 'ui.organization',
    'personal-settings': 'ui.personal.settings',
  }
  for (const item of navigation) {
    const key = navigationKeys[item.route]
    if (key)
      item.keywords = Object.values(flowMessageManifest.messages ?? {})
        .map((messages) => messages[`flow.${key}`] ?? '')
        .join(' ')
  }
  const tasks = data.tasks
    .filter((t) => !t.archived)
    .map((t) =>
      result(
        'task:' + t.id,
        t.title,
        `${t.id} · ${project(t.projectId)?.title ?? ''}`,
        'list',
        'issue',
        { id: t.id, project: t.projectId },
        `${t.id} ${t.description ?? ''} ${(t.comments ?? []).map((c) => c.text ?? c.body ?? '').join(' ')} ${(contextByTask.get(t.id) ?? []).join(' ')} ${t.assignee ?? ''} ${(t.assigneeIds ?? []).map((id) => memberById.get(id)?.name ?? '').join(' ')} ${(t.tags ?? []).map((id) => data.tags?.find((tag) => tag.id === id)?.label ?? id).join(' ')} ${data.columns?.find((c) => c.id === t.status)?.label ?? t.status}`,
      ),
    )
  const projects = data.projects
    .filter((p) => !p.archived)
    .map((p) =>
      result(
        'project:' + p.id,
        p.title,
        workspace(p.workspaceId),
        'folder',
        // A project opens on its default view, as from the sidebar.
        p.defaultView === 'project-issues' ? 'project-issues' : 'board',
        { project: p.id, workspace: p.workspaceId },
        `${p.code ?? ''} ${p.description ?? ''} ${p.outcome ?? ''}`,
      ),
    )
  const pages = data.pages
    .filter((p) => !p.archived)
    .map((p) =>
      result(
        'page:' + p.id,
        p.title,
        project(p.projectId)?.title || workspace(p.workspaceId) || tr('flow.ui.workspace.documents'),
        'book',
        'page',
        {
          id: p.id,
          project: p.projectId ?? '',
          workspace: project(p.projectId)?.workspaceId ?? p.workspaceId,
          scope: p.projectId ? 'project' : 'workspace',
        },
        (p.blocks ?? [])
          .map(
            (b) =>
              b.text ??
              (b.delta ?? []).map((op) => (typeof op.insert === 'string' ? op.insert : '')).join(''),
          )
          .join(' '),
      ),
    )
  const collections = [
    [
      'workspaces',
      tr('flow.ui.search.workspaces'),
      (guest ? [] : (data.workspaces ?? []))
        .filter((w) => !w.archived)
        .map((w) =>
          result(`workspace:${w.id}`, w.title, data.company.name, 'layers', 'workspace-overview', {
            workspace: w.id,
          }),
        ),
    ],
    [
      'epics',
      tr('flow.ui.search.epics'),
      (data.epics ?? [])
        .filter((e) => !e.archived)
        .map((e) =>
          result(
            `epic:${e.id}`,
            e.title,
            project(e.projectId)?.title,
            'layers',
            'epic',
            { id: e.id, project: e.projectId },
            e.description,
          ),
        ),
    ],
    [
      'sprints',
      tr('flow.ui.search.sprints'),
      (data.sprints ?? []).map((s) =>
        result(
          `sprint:${s.id}`,
          s.title,
          project(s.projectId)?.title,
          'calendar',
          'sprints',
          { project: s.projectId },
          `${s.goal ?? ''} ${s.description ?? ''}`,
        ),
      ),
    ],
    ...(!guest
      ? [
          [
            'people',
            tr('flow.ui.search.group.people'),
            (data.members ?? [])
              .filter((m) => m.status !== 'removed')
              .map((m) => result(`member:${m.id}`, m.name, m.email, 'user', 'organization-members')),
          ],
          [
            'teams',
            'Team',
            (data.teams ?? [])
              .filter((t) => !t.archived)
              .map((t) =>
                result(`team:${t.id}`, t.title ?? t.name, t.description, 'user', 'team', { id: t.id }),
              ),
          ],
          [
            'forms',
            tr('flow.ui.forms'),
            (data.forms ?? [])
              .filter((f) => !f.archived)
              .map((f) =>
                result(
                  `form:${f.id}`,
                  f.title,
                  project(f.projectId)?.title,
                  'list',
                  'forms',
                  { project: f.projectId },
                  f.description,
                ),
              ),
          ],
        ]
      : []),
    // A saved view opens as the saved views screen opens it: the project list with its filter.
    [
      'views',
      tr('flow.ui.saved.views'),
      (data.views ?? [])
        .filter((v) => !v.archived)
        .map((v) =>
          result(`view:${v.id}`, v.title, project(v.projectId)?.title, 'list', 'project-issues', {
            project: v.projectId,
            view: v.id,
            q: v.query ?? '',
            status: v.status ?? 'all',
          }),
        ),
    ],
    [
      'files',
      tr('flow.ui.attachments'),
      (data.files ?? [])
        .filter((f) => f.taskId && taskById.has(f.taskId))
        .map((f) =>
          result(`file:${f.id}`, f.name ?? f.title ?? f.filename, f.taskId, 'link', 'issue', {
            id: f.taskId,
            project: taskById.get(f.taskId)?.projectId,
          }),
        ),
    ],
    [
      'inbox',
      tr('flow.ui.inbox'),
      (data.inbox ?? []).map((n) =>
        result(
          `notification:${n.id}`,
          n.title,
          n.description,
          'inbox',
          taskById.has(n.taskId) ? 'issue' : 'inbox',
          taskById.has(n.taskId) ? { id: n.taskId, project: taskById.get(n.taskId).projectId } : { id: n.id },
        ),
      ),
    ],
    ...(!guest
      ? [
          [
            'catalog',
            tr('flow.ui.setup'),
            [
              ...(data.tags ?? []).map((tag) =>
                result(`tag:${tag.id}`, tag.label ?? tag.title, tag.description, 'tag', 'tags', {
                  id: tag.id,
                  project: tag.projectId ?? '',
                }),
              ),
              ...(data.capabilities?.manageOrganization
                ? ['columns', 'types', 'fields'].flatMap((collection) =>
                    (data[collection] ?? []).map((record) =>
                      result(
                        `catalog:${collection}:${record.id}`,
                        record.label ?? record.title ?? record.name,
                        record.description,
                        'settings',
                        { columns: 'column-edit', types: 'type-edit', fields: 'field-edit' }[collection],
                        { id: record.id, project: record.projectId ?? '' },
                      ),
                    ),
                  )
                : []),
            ],
          ],
        ]
      : []),
    ...extra.map((g) => [g.id, g.label, g.items]),
  ]
  const rank = (item) =>
    normalize(item.keywords) === needle || normalize(item.title) === needle
      ? 0
      : normalize(item.title).startsWith(needle)
        ? 1
        : 2
  const select = (items, initialLimit) =>
    items
      .filter((item) =>
        words.every((word) => normalize(`${item.title} ${item.description} ${item.keywords}`).includes(word)),
      )
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, needle ? 6 : initialLimit)
  const groups = [
    { id: 'tasks', label: tr('flow.ui.tasks'), items: select(tasks, 4) },
    { id: 'projects', label: tr('flow.ui.projects'), items: select(projects, 3) },
    { id: 'pages', label: tr('flow.ui.documents'), items: select(pages, 3) },
    ...collections.map(([id, label, items]) => ({ id, label, items: select(items, 2) })),
    {
      id: 'navigation',
      label: needle ? tr('flow.ui.navigation') : tr('flow.ui.quick.access'),
      items: select(navigation, 3),
    },
  ]
  if (!needle) {
    groups.unshift(groups.pop())
    const all = [...tasks, ...projects, ...pages, ...collections.flatMap((c) => c[2]), ...navigation],
      items = recent
        .map((id) => all.find((x) => x.id === id))
        .filter(Boolean)
        .slice(0, 4)
    if (items.length) {
      for (const group of groups) group.items = group.items.filter((x) => !items.some((y) => y.id === x.id))
      groups.unshift({ id: 'recent', label: tr('flow.ui.recent'), items })
    }
  }
  const destinations = new Set()
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const key = JSON.stringify([
          item.route,
          Object.entries(item.params ?? {}).sort(([a], [b]) => a.localeCompare(b)),
        ])
        if (destinations.has(key)) return false
        destinations.add(key)
        return true
      }),
    }))
    .filter((group) => group.items.length)
}
