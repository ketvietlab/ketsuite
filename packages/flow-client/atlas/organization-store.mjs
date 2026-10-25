import { createHash, randomUUID } from 'node:crypto'
import { atlasTaskExchange } from './task-exchange.mjs'
import { sortedListTasks } from '@ketvietlab/flow-client/task-order.mjs'
import { taskAssigneeIds } from '@ketvietlab/flow-client/task-assignees.mjs'
import { atlasExtensions } from './extensions.mjs'
import { atlasFlowCommand } from '@ketvietlab/flow-client/command-contract.mjs'
import { commandResults } from '@ketvietlab/flow-client/command-search.mjs'
import { expandRealisticFixtures } from './realistic-fixtures.mjs'
import { FIXTURE_ANCHOR, fixturePhase, rebaseFixtureDates } from './fixture-clock.mjs'
import { documentAccess } from '@ketvietlab/flow-client/document-access.mjs'
import { captureProduct, recordProductChanges } from './product-audit.mjs'
import {
  validateCatalog,
  projectStatuses,
  projectTags,
  taskColumns,
  taskTags,
  statusKind,
} from '@ketvietlab/flow-client/project-catalogs.mjs'
import { seedOperations, operationsCommand } from './operations-store.mjs'
import { createFixtureSession } from './store.mjs'
import { createAtlasTaskRelocation } from './task-relocation.mjs'
import {
  clearOrganization,
  createAccount,
  seedFirstWorkspace,
  blankStages,
  BLANK_COMPANY,
} from './blank-organization.mjs'
import { accessFor, canManageScope, moveImpact } from '@ketvietlab/flow-client/access-model.mjs'
import {
  sprintCadence,
  validCadence,
  overlappingSprint,
  activeSprint,
  DEFAULT_CADENCE,
} from '@ketvietlab/flow-client/sprint-cadence.mjs'
const fail = (code, message, fields = {}) => ({
  ok: true,
  value: { ok: false, errors: [{ code, message }], fields },
})
const ok = (value) => ({ ok: true, value })
// Internal reads (search) index the authorized view before any route projection; a
// symbol cannot arrive in a JSON request.
const unprojected = Symbol('unprojected')
const accessOrder = { project: 0, workspace: 1, internal: 2 },
  accessRank = { viewer: 1, member: 2, editor: 2, admin: 3, owner: 4 },
  impactOrder = { loss: 0, gain: 1, same: 2 }
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
// The server's access shape, read from the shared access model the prototype uses.
const serverAccess = (view, target, memberId, workspaceId = target.workspaceId) => {
  const sources = accessFor(view, target, memberId, workspaceId)
    .sources.map((x) => {
      const grant = view.grants.find((g) => g.id === x.grantId),
        team = grant?.subjectType === 'team' ? view.teams.find((t) => t.id === grant.subjectId) : null
      return {
        role: x.role,
        scope: grant ? grant.scope : 'internal',
        grantId: grant?.id ?? null,
        teamId: team?.id ?? null,
        teamTitle: team?.title ?? null,
        teamMemberCount: team ? team.memberIds.length : null,
      }
    })
    .sort((a, b) => accessOrder[a.scope] - accessOrder[b.scope])
  return {
    role: sources.reduce(
      (best, x) => ((accessRank[x.role] ?? 0) > (accessRank[best] ?? 0) ? x.role : best),
      null,
    ),
    sources,
  }
}
const changeOf = (before, after) =>
  (accessRank[after.role] ?? 0) > (accessRank[before.role] ?? 0)
    ? 'gain'
    : (accessRank[after.role] ?? 0) < (accessRank[before.role] ?? 0)
      ? 'loss'
      : 'same'
// A Team as the server returns it: its size and visible scopes, never its membership.
const teamSummary = (view, t) => ({
  id: t.id,
  title: t.title,
  description: t.description ?? '',
  version: t.version ?? 1,
  archived: false,
  memberCount: t.memberIds.length,
  grantCount: visibleTeamGrants(view, t.id).length,
})
const visibleTeamGrants = (view, teamId) =>
  view.grants.flatMap((g) => {
    if (g.subjectType !== 'team' || g.subjectId !== teamId) return []
    const target = (g.scope === 'workspace' ? view.workspaces : view.projects).find(
      (x) => x.id === g.targetId,
    )
    return target
      ? [
          {
            id: g.id,
            teamId,
            scope: g.scope,
            targetId: g.targetId,
            targetTitle: target.title,
            role: g.role,
            version: g.version ?? 1,
          },
        ]
      : []
  })
const teamIdsIn = (view, memberId) =>
  view.teams.filter((t) => !t.archived && t.memberIds.includes(memberId)).map((t) => t.id)
// One page of an impact list, losses first, with an offset cursor fenced by its content.
const impactPage = (rows, args, label) => {
  const limit = args.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    return fail('validation', 'Invalid preview window')
  rows.sort(
    (a, b) =>
      impactOrder[a.change] - impactOrder[b.change] ||
      byText(a.name, b.name) ||
      byText(a.projectTitle ?? '', b.projectTitle ?? '') ||
      byText(a.id, b.id),
  )
  const fence = JSON.stringify([
    label,
    rows.map((r) => [r.id, r.projectId, r.change, r.before.role, r.after.role]),
  ])
  let start = 0
  if (args.cursor) {
    let cursor
    try {
      cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
    } catch {
      return fail('validation', 'Invalid cursor')
    }
    if (cursor?.fence !== fence || !Number.isInteger(cursor.offset)) return fail('conflict', 'Access changed')
    start = cursor.offset
  }
  return ok({
    items: rows.slice(start, start + limit),
    total: rows.length,
    counts: Object.fromEntries(
      ['loss', 'gain', 'same'].map((k) => [k, rows.filter((r) => r.change === k).length]),
    ),
    cursor:
      start + limit < rows.length
        ? Buffer.from(JSON.stringify({ offset: start + limit, fence })).toString('base64url')
        : null,
  })
}
const ACTIVITY = 6
/** A screen reads what it shows. The record a route opens (`recordId`) keeps its body,
 * discussion and history; every other task is a summary that `flow.issue.detail` fills in.
 * A summary names only the assignees the reader cannot find in `members`.
 * The Workspace overview keeps the latest activity of each Workspace. */
function taskCatalogSnapshot(view, task, detail = false) {
  const owned = (item) => !item.projectId || item.projectId === task.projectId
  const type = view.types.find(
    (item) => owned(item) && (item.id === (task.typeId ?? task.type) || item.code === task.type),
  )
  const status = view.columns.find((item) => owned(item) && item.id === task.status)
  return {
    ...task,
    ...(status
      ? {
          statusDefinition: {
            id: status.id,
            label: status.label ?? status.title,
            kind: status.kind,
            color: status.color,
          },
        }
      : {}),
    ...(type
      ? {
          typeId: type.id,
          typeDefinition: { id: type.id, code: type.code, title: type.title, icon: type.icon },
        }
      : {}),
    tagDefinitions: view.tags
      .filter((tag) => owned(tag) && (task.tags ?? []).includes(tag.id))
      .map(({ id, title, color, archived }) => ({ id, title, color, archived: !!archived })),
    ...(detail
      ? {
          catalogs: {
            projectId: task.projectId,
            columns: taskColumns(view, task.projectId).filter((item) => !item.archived),
            types: view.types.filter((item) => owned(item) && !item.archived),
            tags: taskTags(view, task.projectId).filter((item) => !item.archived),
            fields: view.fields.filter(
              (item) =>
                owned(item) &&
                !item.archived &&
                (!item.appliesTo || item.appliesTo === 'all' || item.appliesTo === task.projectId),
            ),
          },
        }
      : {}),
  }
}
function activityWindow(view, task, kind, args = {}) {
  const limit = args.limit ?? 50
  if (!['comments', 'history'].includes(kind) || !Number.isInteger(limit) || limit < 1 || limit > 100)
    return { error: 'validation' }
  const rows = view[kind]
    .filter((item) => item.taskId === task.id)
    .sort(
      (a, b) =>
        String(b.createdAt ?? b.time).localeCompare(String(a.createdAt ?? a.time)) ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
  const fence = createHash('sha256')
    .update(JSON.stringify([view.company.id, view.user.id, task.id, task.projectId, kind, view]))
    .digest('hex')
  let start = 0
  if (args.cursor) {
    let cursor
    if (typeof args.cursor !== 'string' || args.cursor.length > 2048) return { error: 'validation' }
    try {
      cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString('utf8'))
    } catch {
      return { error: 'validation' }
    }
    if (!cursor || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 200)
      return { error: 'validation' }
    if (cursor.fence !== fence) return { error: 'conflict' }
    const index = rows.findIndex((item) => item.id === cursor.id)
    if (index < 0) return { error: 'conflict' }
    start = index + 1
  }
  const items = rows.slice(start, start + limit)
  return {
    items,
    total: rows.length,
    cursor:
      start + items.length < rows.length
        ? Buffer.from(JSON.stringify({ id: items.at(-1).id, fence })).toString('base64url')
        : null,
  }
}
function activityDetail(view, task) {
  const comments = activityWindow(view, task, 'comments'),
    history = activityWindow(view, task, 'history')
  return {
    task: {
      ...taskCatalogSnapshot(view, task, true),
      activityPages: {
        comments: { total: comments.total, cursor: comments.cursor },
        history: { total: history.total, cursor: history.cursor },
      },
    },
    comments: [...comments.items].reverse(),
    history: history.items,
  }
}
function projectForRoute(result, args) {
  for (const sprint of result.sprints) {
    delete sprint.report
    delete sprint.closeReport
  }
  const record = args.recordId,
    members = new Set(result.members.map((m) => m.id))
  result.tasks = result.tasks.map((original) => {
    const t = taskCatalogSnapshot(result, original, original.id === record)
    if (t.id === record) return t
    const { description, descriptionDoc, assignees, ...summary } = t,
      unlisted = assignees?.filter((u) => !members.has(u.id))
    return { ...summary, ...(unlisted?.length ? { assignees: unlisted } : {}), summary: true }
  })
  result.comments = result.comments.filter((c) => c.taskId === record)
  if (args.route !== 'workspace-overview') {
    result.history = result.history.filter((h) => h.taskId === record)
    return
  }
  const workspaceOf = new Map(result.projects.map((p) => [p.id, p.workspaceId])),
    taskWorkspace = new Map(
      result.tasks.filter((t) => !t.archived).map((t) => [t.id, workspaceOf.get(t.projectId)]),
    ),
    kept = new Map()
  for (const h of [...result.history].sort((a, b) => b.time.localeCompare(a.time))) {
    const workspace = taskWorkspace.get(h.taskId),
      list = kept.get(workspace) ?? []
    if (workspace === undefined || list.length === ACTIVITY) continue
    list.push(h)
    kept.set(workspace, list)
  }
  result.history = [...kept.values()].flat()
}
// Saving an existing task, moving, following or planning it changes that task alone. Creating
// one (no `id`) may add subtasks and files, and other writes touch other records.
const changesOneTask = (name, args) =>
  args.id != null &&
  ['flow.issue.save', 'flow.issue.move', 'flow.issue.follow', 'flow.issue.assignSprint'].includes(name)
export function createOrganizationSession(
  scenario = 'baseline',
  route = 'my-work',
  { profile = 'compact', extensions = [], today = '' } = {},
) {
  const hooks = atlasExtensions(extensions)
  const relocate = createAtlasTaskRelocation()
  let searchFailed = false
  const blank = blankStages.includes(scenario),
    account = blank ? createAccount(scenario) : null
  const companies = blank
    ? [BLANK_COMPANY]
    : [
        { id: 'demo', name: 'Két Việt' },
        { id: 'north', name: 'Northstar Studio' },
      ]
  const sessions = new Map(),
    replay = new Map()
  for (const company of companies) {
    const session = createFixtureSession(
        ['guest', 'revoked', 'member'].includes(scenario) || blank ? 'baseline' : scenario,
        route,
        { extensions, dispatchItem: (name, args) => dispatch(name, args) },
      ),
      d = session.data
    d.company = company
    d.companies = companies
    d.organizationRevision = 1
    const prefix = company.id === 'demo' ? '' : `${company.id}-`
    if (prefix) {
      for (const collection of [
        'projects',
        'tasks',
        'pages',
        'epics',
        'sprints',
        'views',
        ...hooks.values('collections'),
        'forms',
        'inbox',
        'files',
        'history',
      ])
        for (const item of d[collection] ?? []) {
          item.id = prefix + item.id
          for (const key of ['projectId', 'taskId', 'parentId']) if (item[key]) item[key] = prefix + item[key]
          if (item.blockedBy) item.blockedBy = item.blockedBy.map((x) => prefix + x)
        }
      d.projects[0].title = 'Website Northstar'
      if (d.tasks[0]) d.tasks[0].title = 'Ra mắt website Northstar'
    }
    d.members = [
      { id: 'mai', name: 'Mai Anh', email: 'mai@example.test', role: 'owner', status: 'active' },
      { id: 'bao', name: 'Trần Quốc Bảo', email: 'bao@example.test', role: 'member', status: 'active' },
      { id: 'ha', name: 'Lê Thu Hà', email: 'ha@example.test', role: 'member', status: 'active' },
      {
        id: 'guest',
        name: 'An · Khách hàng',
        email: 'an@example.test',
        role: 'guest',
        status: scenario === 'revoked' ? 'revoked' : 'active',
      },
    ]
    d.user =
      scenario === 'guest' || scenario === 'revoked'
        ? { id: 'guest', name: 'An · Khách hàng' }
        : scenario === 'member'
          ? { id: 'bao', name: 'Trần Quốc Bảo' }
          : d.user
    d.workspaces = [
      {
        id: prefix + 'product',
        companyId: company.id,
        title: 'Sản phẩm',
        description: 'Phát triển sản phẩm và cộng tác với khách hàng.',
        access: 'restricted',
        archived: false,
      },
      {
        id: prefix + 'operations',
        companyId: company.id,
        title: 'Vận hành',
        description: 'Quy trình và vận hành đội ngũ.',
        access: 'restricted',
        archived: false,
      },
      {
        id: prefix + 'lab',
        companyId: company.id,
        title: 'Thử nghiệm',
        description: 'Không gian cho ý tưởng mới.',
        access: 'internal',
        archived: false,
      },
    ]
    d.teams = [
      {
        id: 'engineering',
        companyId: company.id,
        title: 'Engineering',
        description: 'Nhóm kỹ thuật, tham gia nhiều Workspace.',
        memberIds: ['mai', 'bao'],
      },
      {
        id: 'success',
        companyId: company.id,
        title: 'Customer Success',
        description: 'Nhóm phụ trách khách hàng và vận hành.',
        memberIds: ['mai', 'ha'],
      },
    ]
    for (const key of ['sprints', 'epics'])
      for (const item of d[key]) if (!item.projectId) item.projectId = prefix + 'core'
    d.projects.forEach((p, i) => {
      p.companyId = company.id
      p.workspaceId = prefix + (i === 1 ? 'operations' : 'product')
      p.access = i === 2 ? 'private' : 'workspace'
    })
    d.grants = [
      {
        id: 'g1',
        scope: 'workspace',
        targetId: prefix + 'product',
        subjectType: 'team',
        subjectId: 'engineering',
        role: 'member',
      },
      {
        id: 'g2',
        scope: 'workspace',
        targetId: prefix + 'operations',
        subjectType: 'team',
        subjectId: 'success',
        role: 'member',
      },
      {
        id: 'g3',
        scope: 'workspace',
        targetId: prefix + 'lab',
        subjectType: 'team',
        subjectId: 'engineering',
        role: 'member',
      },
      ...d.projects.map((p, i) => ({
        id: 'owner-' + i,
        scope: 'project',
        targetId: p.id,
        subjectType: 'user',
        subjectId: 'mai',
        role: 'admin',
      })),
      {
        id: 'g4',
        scope: 'project',
        targetId: prefix + 'docs',
        subjectType: 'user',
        subjectId: 'guest',
        role: 'viewer',
      },
      {
        id: 'g5',
        scope: 'project',
        targetId: prefix + 'docs',
        subjectType: 'team',
        subjectId: 'success',
        role: 'editor',
      },
    ]
    d.tags.forEach((t) => {
      t.domain ??= 'task'
    })
    d.tags.push(
      { id: 'project-strategic', title: 'Strategic', color: 'blue', domain: 'project' },
      { id: 'project-customer', title: 'Customer', color: 'green', domain: 'project' },
    )
    d.projects.forEach((p) => {
      p.tags = []
    })
    for (const p of d.pages) {
      p.ownerId = 'mai'
      p.readerIds = []
      p.history = []
      if (!p.projectId) p.workspaceId = prefix + 'product'
    }
    for (const f of d.fields) if (f.title === 'Phiên bản') f.title = f.label = 'Phiên bản phát hành'
    d.invitations = [
      { id: 'invite-1', email: 'linh@example.test', role: 'member', status: 'pending', projectId: null },
    ]
    d.projectFavorites = [d.projects[0].id]
    d.recentProjects = d.projects.map((p) => p.id)
    if (
      scenario === 'empty' &&
      ['workspaces', 'workspace-overview', 'workspace-settings', 'workspace-members'].includes(route)
    ) {
      d.projects = []
      d.tasks = []
      d.pages = []
    }
    seedOperations(d)
    hooks.notify('seedOrganization', d, scenario, { prefix, company })
    if (profile === 'realistic' && !blank)
      expandRealisticFixtures(d, scenario, hooks, { phase: fixturePhase(today) })
    hooks.notify('linkSeed', d)
    if (['today', 'today-success'].includes(scenario)) {
      const task = d.tasks.find((t) => t.id === prefix + 'KV-131'),
        dependent = d.tasks.find((t) => t.id === prefix + 'KV-151')
      task.status = 'todo'
      task.blockedBy = []
      dependent.blockedBy = [task.id]
      dependent.assignee = 'Mai Anh'
      dependent.assigneeIds = ['mai']
      d.inbox.unshift({
        id: prefix + 'today-assignment',
        taskId: task.id,
        actorId: 'bao',
        recipientId: 'mai',
        kind: 'assignment',
        titleKey: 'flow.today.assigned',
        description: task.title,
        read: false,
        actionNeeded: true,
        route: 'issue',
        createdAt: '2026-09-22T08:00:00Z',
      })
      if (scenario === 'today-success') {
        const before = captureProduct(d)
        task.status = 'progress'
        task.version++
        recordProductChanges(d, before)
        d.inbox.find((n) => n.id === prefix + 'today-assignment').read = true
      }
    }

    for (const t of d.tasks) {
      const epic = d.epics.find((e) => e.projectId === t.projectId && e.title === t.epic)
      if (epic) t.epic = epic.id
    }
    if (['board-demo', 'board-blocked', 'board-success'].includes(scenario)) {
      const task = d.tasks.find((item) => item.id === prefix + 'KV-131')
      const blocker = d.tasks.find((item) => item.id === prefix + 'KV-151')
      task.status = 'todo'
      task.blockedBy = [blocker.id]
      blocker.status = 'progress'
      if (scenario === 'board-success') {
        const before = captureProduct(d)
        task.status = 'progress'
        task.version++
        recordProductChanges(d, before)
      }
    }
    // Fixtures are authored for one day; a live renderer moves them next to `today`.
    // Seeds that run later (finishSeed) already compute from the real date.
    if (today && !blank) rebaseFixtureDates(d, today, { skip: hooks.values('fixtureClockSkip') })
    hooks.notify('finishSeed', d, scenario, { profile, blank, prefix })
    if (blank) {
      clearOrganization(d)
      hooks.notify('clearOrganization', d)
    }
    if (scenario === 'blank-workspace') seedFirstWorkspace(d)
    sessions.set(company.id, session)
  }
  function call(name, args = {}) {
    ;({ name, input: args } = atlasFlowCommand(name, args, sessions.get(args.companyId ?? 'demo')?.data))
    const d = sessions.get(args.companyId ?? 'demo')?.data,
      before =
        d &&
        ![
          'flow.workspace.bootstrap',
          'flow.issue.detail',
          'flow.search',
          'flow.issue.relocation.options',
          'flow.issue.relocation.preview',
        ].includes(name)
          ? captureProduct(d)
          : null
    const result = dispatch(name, args)
    if (before && result.ok && result.value?.ok !== false) {
      hooks.notify('afterOrganizationCommand', d, before)
      recordProductChanges(d, before)
      // A write that changed one task alone returns that task's detail read after it, so the
      // client can patch the task instead of reading the whole screen before it continues.
      if (changesOneTask(name, args)) {
        const record = dispatch('flow.issue.detail', { companyId: args.companyId, id: args.id }).value
        if (record?.ok !== false) return { ...result, value: { ...result.value, record } }
      }
    }
    return result
  }
  function dispatch(name, args = {}) {
    if (account) {
      const refused = account.gate(name)
      if (refused) return refused
      const result = account.command(name, args)
      if (result) return result
    }
    if (['guest', 'revoked'].includes(scenario) && args.companyId && args.companyId !== 'demo')
      return fail('forbidden', 'Bạn không có quyền vào tổ chức này.')
    const session = sessions.get(args.companyId ?? 'demo')
    if (!session) return fail('forbidden', 'Tổ chức không tồn tại hoặc bạn không có quyền truy cập.')
    const d = session.data,
      user = d.members.find((m) => m.id === d.user.id)
    if (scenario === 'revoked' || !user || user.status !== 'active')
      return fail('revoked', 'Quyền truy cập đã được thu hồi. Nội dung tổ chức không còn khả dụng.')
    if (scenario === 'forbidden') return fail('forbidden', 'Bạn không có quyền xem phạm vi này.')
    if (name === 'flow.search') {
      if (
        scenario === 'search-error' &&
        !searchFailed &&
        typeof args.query === 'string' &&
        args.query.trim()
      ) {
        searchFailed = true
        return fail('unavailable', 'Tìm kiếm tạm thời gián đoạn. Thử lại để tiếp tục.')
      }
      if (typeof args.query !== 'string' || args.query.length > 200)
        return fail('validation', 'Từ khóa tìm kiếm không hợp lệ.')
      // The same tenant/project/document/extension authorization projection as
      // bootstrap, evaluated on every read. Never index raw session.data.
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        route: 'my-work',
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const scoped = response.value
      const groups = commandResults(scoped, args.query, {
        recent: Array.isArray(args.recent) ? args.recent.slice(0, 8) : [],
        extra: hooks.values('searchGroups', { data: scoped, args }),
      })
      let remaining = 60
      return ok({
        groups: groups
          .map((g) => {
            const items = g.items.slice(0, remaining)
            remaining -= items.length
            return { ...g, items: items.map(({ keywords, ...item }) => item) }
          })
          .filter((g) => g.items.length),
      })
    }
    const projects = d.projects.filter((p) => accessFor(d, p, d.user.id).role)
    const projectIds = new Set(projects.map((p) => p.id))
    const exchanged = atlasTaskExchange({ d, name, args, scenario, replay, dispatch, ok, fail })
    if (exchanged) return exchanged
    const memberTeams = d.teams.filter((t) => !t.archived && t.memberIds.includes(d.user.id)).map((t) => t.id)
    const workspaces = d.workspaces.filter(
      (w) =>
        !w.archived &&
        (canManageScope(d, 'workspace', w.id) ||
          (user.role !== 'guest' &&
            (w.access === 'internal' ||
              d.grants.some(
                (g) =>
                  g.scope === 'workspace' &&
                  g.targetId === w.id &&
                  (g.subjectType === 'user' ? g.subjectId === d.user.id : memberTeams.includes(g.subjectId)),
              ))) ||
          projects.some((p) => p.workspaceId === w.id)),
    )
    const targetTask = d.tasks.find((t) => t.id === (args.recordId ?? args.id ?? args.taskId))
    const targetPage = d.pages.find((p) => p.id === (args.recordId ?? args.id ?? args.entityId))
    const targetProjectRecord = ['sprints', 'epics'].includes(args.collection)
      ? d[args.collection].find((record) => record.id === args.entityId)
      : null
    const requestedProject =
      targetTask?.projectId ?? targetPage?.projectId ?? targetProjectRecord?.projectId ?? args.projectId
    if (requestedProject && !projectIds.has(requestedProject))
      return fail('forbidden', 'Dự án không tồn tại hoặc bạn chưa được cấp quyền.')
    const relocation = relocate(d, name, args, {
      fail,
      readonly: scenario === 'readonly',
      guard: (task) =>
        hooks.first('beforeOrganizationCommand', { d, name, args, fail }) ??
        hooks.first('beforeCommand', { data: d, name, args, task, failure: fail }),
    })
    if (relocation !== undefined) return relocation
    if (targetPage && !documentAccess(d, targetPage).read)
      return fail('forbidden', 'Tài liệu không tồn tại hoặc bạn chưa được cấp quyền.')
    if (
      name === 'flow.page.reorder' &&
      !documentAccess(
        d,
        d.pages.find((p) => p.id === args.targetId),
      ).write
    )
      return fail('forbidden', 'Không có quyền sửa tài liệu đích.')
    if (targetPage && name !== 'flow.workspace.bootstrap' && !documentAccess(d, targetPage).write)
      return fail('forbidden', 'Bạn chỉ có quyền xem tài liệu.')
    if (
      args.parentId &&
      args.collection === 'pages' &&
      !documentAccess(
        d,
        d.pages.find((p) => p.id === args.parentId),
      ).write
    )
      return fail('forbidden', 'Không có quyền sửa tài liệu cha.')
    if (name === 'flow.document.command') {
      if (scenario === 'readonly' || !targetPage || !documentAccess(d, targetPage).manage)
        return fail('forbidden', 'Chỉ chủ tài liệu được đổi phạm vi chia sẻ.')
      const key = d.company.id + ':doc:' + user.id + ':' + args.idempotencyKey
      if (!args.idempotencyKey) return fail('validation', 'Thiếu khóa thao tác.')
      if (replay.has(key)) return structuredClone(replay.get(key))
      if (args.expectedVersion !== targetPage.version)
        return fail('conflict', 'Tài liệu đã đổi. Tải lại trước khi lưu.')
      if (
        !['shared', 'private'].includes(args.visibility) ||
        !Array.isArray(args.readerIds) ||
        args.readerIds.some(
          (id) => !documentAccess(d, { ...targetPage, visibility: 'shared', readerIds: [id] }, id).read,
        )
      )
        return fail('validation', 'Chọn người đang có quyền trong phạm vi tài liệu.')
      targetPage.visibility = args.visibility
      targetPage.readerIds = [...new Set(args.readerIds)]
      const result = ok({ id: targetPage.id })
      replay.set(key, result)
      return result
    }
    if (name === 'flow.issue.detail' || name === 'flow.issue.activity') {
      // Same project check as bootstrap (requestedProject above). The record is picked from the
      // authorized view a screen read projects, so the two cannot disagree on access.
      if (!targetTask) return fail('not_found', 'Công việc không tồn tại hoặc đã bị chuyển đi.')
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        route: 'issue',
        recordId: targetTask.id,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value,
        own = (x) => x.taskId === targetTask.id
      const task = view.tasks.find((t) => t.id === targetTask.id)
      if (!task) return fail('forbidden', 'Bạn không có quyền xem công việc này.')
      if (name === 'flow.issue.activity') {
        const page = activityWindow(view, task, args.kind, args)
        return page.error ? fail(page.error, 'Activity window is unavailable') : ok(page)
      }
      const result = activityDetail(view, task)
      hooks.notify('detail', { view, result, args })
      return ok(result)
    }
    if (name === 'flow.project.taskOptions') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        projectId: args.projectId,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value
      if (!view.projects.some((p) => p.id === args.projectId))
        return fail('forbidden', 'Bạn không có quyền đọc dự án.')
      const catalogs = taskCatalogSnapshot(view, { projectId: args.projectId }, true).catalogs
      if (
        catalogs.fields.length > 200 ||
        ['columns', 'types', 'tags'].some((key) =>
          [true, false].some(
            (local) => catalogs[key].filter((item) => !!item.projectId === local).length > 200,
          ),
        )
      )
        return fail('limit', 'Bộ lựa chọn vượt giới hạn.')
      const project = view.projects.find((p) => p.id === args.projectId)
      const sprints = view.sprints
        .filter(
          (s) =>
            s.projectId === project.id && !s.archived && ['planned', 'draft', 'active'].includes(s.state),
        )
        .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
        .map(({ id, title, projectId, state }) => ({ id, title, projectId, state }))
      if (sprints.length > 200) return fail('limit', 'Bộ lựa chọn vượt giới hạn.')
      return {
        value: {
          ...catalogs,
          project: {
            id: project.id,
            title: project.title,
            code: project.code,
            workspaceId: project.workspaceId,
            canWrite:
              !project.archived &&
              ['owner', 'admin', 'editor', 'member'].includes(accessFor(view, project, view.user.id).role),
            sprintCadence: project.sprintCadence,
          },
          sprints,
        },
      }
    }
    if (name === 'flow.project.statusOptions') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        projectId: args.projectId,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value
      if (!view.projects.some((p) => p.id === args.projectId))
        return fail('forbidden', 'Bạn không có quyền đọc dự án.')
      const items = taskColumns(view, args.projectId).filter((item) => !item.archived)
      if (items.length > 200) return fail('limit', 'Bộ trạng thái vượt giới hạn.')
      return {
        value: {
          items: items.map((item) => ({
            id: item.id,
            label: item.label ?? item.title,
            kind: item.kind,
            color: item.color,
            projectId: item.projectId ?? null,
          })),
        },
      }
    }
    if (name === 'flow.catalog.list') {
      if (user.role === 'guest') return fail('forbidden', 'Organization library is unavailable')
      const collections = { column: 'columns', type: 'types', tag: 'tags', field: 'fields' }
      const collection = Object.hasOwn(collections, args.kind) ? collections[args.kind] : null
      const limit = args.limit ?? 50
      if (!collection || !Number.isInteger(limit) || limit < 1 || limit > 100)
        return fail('validation', 'Invalid catalog window')
      const rows = d[collection]
        .filter((item) => !item.projectId && (args.kind === 'tag' || !item.archived))
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const fence = JSON.stringify([d.company.id, d.user.id, args.kind, d])
      // A digest keeps cursor size independent of catalog size.
      const digest = createHash('sha256').update(fence).digest('hex')
      let start = 0
      if (args.cursor) {
        let cursor
        if (typeof args.cursor !== 'string' || args.cursor.length > 2048)
          return fail('validation', 'Invalid cursor')
        try {
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
        } catch {
          return fail('validation', 'Invalid cursor')
        }
        if (
          !cursor ||
          Array.isArray(cursor) ||
          !Number.isInteger(cursor.sequence) ||
          cursor.sequence < -2147483648 ||
          cursor.sequence > 2147483647 ||
          typeof cursor.id !== 'string' ||
          !cursor.id ||
          cursor.id.length > 200
        )
          return fail('validation', 'Invalid cursor')
        if (cursor.fence !== digest) return fail('conflict', 'Catalog changed')
        start = rows.findIndex((item) => item.id === cursor.id) + 1
        if (!start) return fail('conflict', 'Catalog changed')
      }
      const keys = [
        'id',
        'companyId',
        'projectId',
        'title',
        'titleKey',
        'label',
        'labelKey',
        'sequence',
        'version',
        'archived',
        'kind',
        'color',
        'icon',
        'domain',
        'required',
      ]
      const items = rows
        .slice(start, start + limit)
        .map((item) =>
          Object.fromEntries(keys.filter((key) => Object.hasOwn(item, key)).map((key) => [key, item[key]])),
        )
      const result = {
        items,
        total: rows.length,
        cursor:
          start + items.length < rows.length
            ? Buffer.from(
                JSON.stringify({ id: items.at(-1).id, sequence: items.at(-1).sequence ?? 0, fence: digest }),
              ).toString('base64url')
            : null,
      }
      if (args.kind === 'tag') {
        const response = dispatch('flow.workspace.bootstrap', {
          companyId: args.companyId,
          [unprojected]: true,
        })
        if (response.value?.ok === false) return response
        const visible = response.value.projects.filter((project) => !project.archived),
          ids = new Set(visible.map((project) => project.id))
        result.labelUsage = Object.fromEntries(
          items.map((item) => [
            item.id,
            {
              tasks: d.tasks.filter(
                (task) =>
                  !task.archived &&
                  ids.has(task.projectId) &&
                  (task.tags ?? task.tagIds ?? []).includes(item.id),
              ).length,
              projects: visible.filter((project) => project.tags?.includes(item.id)).length,
            },
          ]),
        )
      }
      return ok(result)
    }
    if (name === 'flow.member.options' || name === 'flow.member.list') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value,
        options = name === 'flow.member.options',
        project = view.projects.find((p) => p.id === args.projectId)
      if (
        (options && !project) ||
        (!options && view.members.find((m) => m.id === view.user.id)?.role === 'guest')
      )
        return fail('forbidden', 'People scope is unavailable')
      const query = String(args.query ?? '').trim(),
        limit = args.limit ?? 25
      if (query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100)
        return fail('validation', 'Invalid people window')
      // A Team's members, or the internal people who could join it.
      const teamFilter = options ? '' : (args.teamId ?? args.candidateForTeamId ?? '')
      const team = teamFilter ? view.teams.find((t) => t.id === teamFilter) : null
      if (teamFilter && (!team || team.archived)) return fail('not_found', 'Không tìm thấy Team.')
      const inTeam = (m) =>
        !team ||
        (args.teamId
          ? team.memberIds.includes(m.id)
          : !team.memberIds.includes(m.id) && m.status === 'active' && m.role !== 'guest')
      // `ids` rechecks a selection on either read; `exclude` leaves people out of options.
      const idList = (key) => {
        const value = args[key]
        if (value === undefined || value === null) return null
        if (
          (!options && key !== 'ids') ||
          !Array.isArray(value) ||
          value.length > 100 ||
          value.some((id) => typeof id !== 'string')
        )
          return false
        return value
      }
      const only = idList('ids'),
        except = idList('exclude')
      if (only === false || except === false) return fail('validation', 'Invalid people window')
      // Options may keep only some project roles (a reviewer must edit, say).
      const roles = args.roles ?? null
      if (
        roles !== null &&
        (!options ||
          !Array.isArray(roles) ||
          !roles.length ||
          roles.length > 5 ||
          roles.some((role) => typeof role !== 'string' || !Object.hasOwn(accessRank, role)))
      )
        return fail('validation', 'Invalid people window')
      const rows = view.members
        .filter(
          (m) =>
            (!options || m.status === 'active') &&
            (!options || accessFor(view, project, m.id).role) &&
            (!roles || roles.includes(accessFor(view, project, m.id).role)) &&
            (!args.internal || (m.role !== 'guest' && m.status === 'active')) &&
            (!args.active || m.status === 'active') &&
            (!only || only.includes(m.id)) &&
            !except?.includes(m.id) &&
            inTeam(m) &&
            `${m.name} ${m.email ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      const fence = JSON.stringify([
        view.company.id,
        view.user.id,
        name,
        args.projectId ?? '',
        query,
        args.teamId ?? '',
        args.candidateForTeamId ?? '',
        Boolean(args.internal),
        Boolean(args.active),
        roles ?? '',
        only ?? '',
        except ?? '',
        rows.map((m) => [m.id, m.version]),
      ])
      let start = 0
      if (args.cursor) {
        let cursor
        try {
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
        } catch {
          return fail('validation', 'Invalid cursor')
        }
        if (cursor?.fence !== fence) return fail('conflict', 'People scope changed')
        start = rows.findIndex((m) => m.id === cursor.id) + 1
        if (!start) return fail('conflict', 'People scope changed')
      }
      const items = rows
        .slice(start, start + limit)
        .map((m) => (options ? m : { ...m, teamIds: teamIdsIn(view, m.id) }))
      return ok({
        items,
        total: rows.length,
        cursor:
          start + items.length < rows.length
            ? Buffer.from(JSON.stringify({ id: items.at(-1).id, fence })).toString('base64url')
            : null,
      })
    }
    if (name === 'flow.team.list' || name === 'flow.team.read') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value,
        actor = view.members.find((m) => m.id === view.user.id)
      if (!actor || actor.role === 'guest') return fail('forbidden', 'Teams are unavailable')
      if (name === 'flow.team.read') {
        const team = view.teams.find((t) => t.id === args.id && !t.archived)
        if (!team) return fail('not_found', 'Không tìm thấy Team.')
        return ok({
          team: teamSummary(view, team),
          grants: visibleTeamGrants(view, team.id).sort(
            (a, b) => byText(a.targetTitle, b.targetTitle) || byText(a.id, b.id),
          ),
        })
      }
      const query = String(args.query ?? '').trim(),
        limit = args.limit ?? 50
      if (query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100)
        return fail('validation', 'Invalid team window')
      const rows = view.teams
        .filter((t) => !t.archived && t.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .sort((a, b) => byText(a.title, b.title) || byText(a.id, b.id))
      const fence = JSON.stringify([
        view.company.id,
        view.user.id,
        'teams',
        query,
        rows.map((t) => [t.id, t.version ?? 1]),
      ])
      let start = 0
      if (args.cursor) {
        let cursor
        try {
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
        } catch {
          return fail('validation', 'Invalid cursor')
        }
        if (cursor?.fence !== fence) return fail('conflict', 'Teams changed')
        start = rows.findIndex((t) => t.id === cursor.id) + 1
        if (!start) return fail('conflict', 'Teams changed')
      }
      const items = rows.slice(start, start + limit).map((t) => teamSummary(view, t))
      return ok({
        items,
        total: rows.length,
        cursor:
          start + items.length < rows.length
            ? Buffer.from(JSON.stringify({ id: items.at(-1).id, title: items.at(-1).title, fence })).toString(
                'base64url',
              )
            : null,
      })
    }
    if (name === 'flow.invitation.list') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value
      if (
        view.members.find((m) => m.id === view.user.id)?.role === 'guest' ||
        !view.capabilities?.manageOrganization
      )
        return fail('forbidden', 'Invitations are unavailable')
      const limit = args.limit ?? 50
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        return fail('validation', 'Invalid invitation window')
      // Pending only, newest first: accepted, revoked and expired invitations need no action.
      const at = new Date().toISOString()
      const rows = (view.invitations ?? [])
        .filter((i) => i.status === 'pending' && (!i.expiresAt || i.expiresAt > at))
        .sort(
          (a, b) => String(b.sentAt ?? '').localeCompare(String(a.sentAt ?? '')) || b.id.localeCompare(a.id),
        )
      const fence = JSON.stringify([
        view.company.id,
        view.user.id,
        'invitations',
        rows.map((i) => [i.id, i.sentAt ?? '']),
      ])
      let start = 0
      if (args.cursor) {
        let cursor
        try {
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
        } catch {
          return fail('validation', 'Invalid cursor')
        }
        if (cursor?.fence !== fence) return fail('conflict', 'Invitations changed')
        start = rows.findIndex((i) => i.id === cursor.id) + 1
        if (!start) return fail('conflict', 'Invitations changed')
      }
      const items = rows.slice(start, start + limit)
      return ok({
        items,
        total: rows.length,
        cursor:
          start + items.length < rows.length
            ? Buffer.from(JSON.stringify({ id: items.at(-1).id, fence })).toString('base64url')
            : null,
      })
    }
    // Grants on one target, or of one person or Team, a page at a time by id.
    if (name === 'flow.grant.list') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value,
        actor = view.members.find((m) => m.id === view.user.id),
        manager = Boolean(view.capabilities?.manageOrganization),
        limit = args.limit ?? 50,
        scope = args.scope ?? ''
      if (!actor || actor.role === 'guest') return fail('forbidden', 'Grants are unavailable')
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        return fail('validation', 'Invalid grant window')
      const byTarget = args.targetId !== undefined && args.targetId !== null,
        bySubject = args.subjectId !== undefined && args.subjectId !== null
      if (byTarget === bySubject) return fail('validation', 'Invalid grant window')
      if (scope && !['project', 'workspace'].includes(scope)) return fail('validation', 'Invalid grant scope')
      let rows
      if (byTarget) {
        if (!scope) return fail('validation', 'Invalid grant scope')
        const project = scope === 'project' ? view.projects.find((p) => p.id === args.targetId) : null,
          workspace = view.workspaces.find((w) => w.id === (project ? project.workspaceId : args.targetId))
        if ((scope === 'project' && !project) || !workspace)
          return fail('not_found', 'Access target not found')
        const target = project ?? {
          id: 'workspace-preview',
          companyId: view.company.id,
          workspaceId: workspace.id,
          access: 'workspace',
        }
        if (!manager && !accessFor(view, target, actor.id).role)
          return fail('forbidden', 'Grants are unavailable')
        rows = d.grants.filter((g) => g.scope === scope && g.targetId === args.targetId)
      } else {
        if (!['user', 'team'].includes(args.subjectType)) return fail('validation', 'Invalid grant subject')
        if (!manager && !(args.subjectType === 'user' && args.subjectId === actor.id))
          return fail('forbidden', 'Grants are unavailable')
        rows = d.grants.filter(
          (g) =>
            g.subjectType === args.subjectType &&
            g.subjectId === args.subjectId &&
            (!scope || g.scope === scope),
        )
      }
      rows = [...rows].sort((a, b) => byText(a.id, b.id))
      const fence = JSON.stringify([
        view.company.id,
        view.user.id,
        'grants',
        scope,
        args.targetId ?? '',
        [args.subjectType ?? '', args.subjectId ?? ''],
        d.organizationRevision,
      ])
      let after = ''
      if (args.cursor) {
        let cursor
        try {
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
        } catch {
          return fail('validation', 'Invalid cursor')
        }
        if (!cursor || typeof cursor.id !== 'string' || !cursor.id)
          return fail('validation', 'Invalid cursor')
        if (cursor.fence !== fence) return fail('conflict', 'Grants changed')
        after = cursor.id
      }
      const rest = rows.filter((g) => !after || g.id > after),
        page = rest.slice(0, limit)
      const items = page.map((g) => {
        const target = (g.scope === 'project' ? d.projects : d.workspaces).find((x) => x.id === g.targetId),
          team = g.subjectType === 'team' ? d.teams.find((t) => t.id === g.subjectId) : null,
          member = g.subjectType === 'user' ? d.members.find((m) => m.id === g.subjectId) : null
        return {
          id: g.id,
          scope: g.scope,
          targetId: g.targetId,
          targetTitle: target?.title ?? null,
          targetArchived: Boolean(target?.archived),
          subjectType: g.subjectType,
          subjectId: g.subjectId,
          subjectTitle: team?.title ?? member?.name ?? null,
          subjectEmail: member?.email ?? null,
          subjectRole: member?.role ?? null,
          subjectStatus: member ? member.status : team ? (team.archived ? 'archived' : 'active') : null,
          memberCount: team ? team.memberIds.length : null,
          role: g.role,
          version: g.version ?? 1,
        }
      })
      return ok({
        items,
        total: rows.length,
        cursor:
          rest.length > limit
            ? Buffer.from(JSON.stringify({ id: page.at(-1).id, fence })).toString('base64url')
            : null,
      })
    }
    // What revoking a person removes: the projects they reach and their unfinished tasks.
    if (name === 'flow.member.impact') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value
      if (!view.capabilities?.manageOrganization)
        return fail('forbidden', 'Bạn chưa có quyền thực hiện thao tác này.')
      const member = d.members.find((m) => m.id === args.memberId)
      if (!member) return fail('not_found', 'Không tìm thấy thành viên.')
      // Counted as if the person were active, so a revoked person shows what they would regain.
      const active = {
        ...view,
        members: view.members.map((m) => (m.id === member.id ? { ...m, status: 'active' } : m)),
      }
      const projects = d.projects.filter(
        (p) => !p.archived && !p.deletionId && accessFor(active, p, member.id).role,
      ).length
      const open = d.tasks.filter(
        (t) => !t.archived && taskAssigneeIds(d, t).includes(member.id) && statusKind(d, t) !== 'done',
      )
      return ok({
        projects,
        tasks: {
          total: open.length,
          items: open.slice(0, 20).map((t) => ({ id: t.id, title: t.title, projectId: t.projectId })),
        },
      })
    }
    if (name === 'flow.access.list') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value,
        actor = view.members.find((m) => m.id === view.user.id),
        limit = args.limit ?? 50,
        memberId = args.memberId ?? ''
      if (!actor || actor.role === 'guest') return fail('forbidden', 'Access lists are unavailable')
      if (!['project', 'workspace'].includes(args.scope)) return fail('validation', 'Invalid access scope')
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        return fail('validation', 'Invalid access window')
      const project = args.scope === 'project' ? view.projects.find((p) => p.id === args.targetId) : null,
        workspace = view.workspaces.find((w) => w.id === (project ? project.workspaceId : args.targetId))
      if ((args.scope === 'project' && !project) || !workspace)
        return fail('not_found', 'Access target not found')
      // The same target the shared access model reads for a Workspace: an inheriting project in it.
      const target = project ?? {
        id: 'workspace-preview',
        companyId: view.company.id,
        workspaceId: workspace.id,
        access: 'workspace',
      }
      if (!view.capabilities?.manageOrganization && !accessFor(view, target, actor.id).role)
        return fail('forbidden', 'Access lists are unavailable')
      const effective = (m) => serverAccess(view, target, m.id)
      const rows = view.members
        .filter((m) => m.status === 'active')
        .map((m) => ({ ...m, access: effective(m) }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const query = String(args.query ?? '')
        .trim()
        .toLocaleLowerCase()
      if (query.length > 200) return fail('validation', 'Invalid access window')
      const granted = rows.filter((m) => m.access.role),
        found = granted.filter((m) => `${m.name} ${m.email ?? ''}`.toLocaleLowerCase().includes(query)),
        listed = memberId ? rows.filter((m) => m.id === memberId) : found
      const fence = JSON.stringify([
        view.company.id,
        view.user.id,
        'access',
        args.scope,
        args.targetId,
        memberId,
        query,
        rows.map((m) => [m.id, m.version, m.access]),
      ])
      let start = 0
      if (args.cursor) {
        let cursor
        try {
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
        } catch {
          return fail('validation', 'Invalid cursor')
        }
        if (cursor?.fence !== fence) return fail('conflict', 'Access changed')
        start = listed.findIndex((m) => m.id === cursor.id) + 1
        if (!start) return fail('conflict', 'Access changed')
      }
      const items = listed.slice(start, start + limit).map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        status: m.status,
        version: m.version,
        access: m.access,
        teams: view.teams
          .filter((t) => !t.archived && t.memberIds.includes(m.id))
          .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
          .map((t) => ({ id: t.id, title: t.title })),
      }))
      return ok({
        items,
        total: listed.length,
        without: rows.length - granted.length,
        cursor:
          start + items.length < listed.length
            ? Buffer.from(JSON.stringify({ id: items.at(-1).id, fence })).toString('base64url')
            : null,
      })
    }
    if (name === 'flow.access.preview') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value,
        active = view.members.filter((m) => m.status === 'active'),
        rows = []
      const impact = (m, project, before, after) => {
        const change = changeOf(before, after)
        if (change !== 'same')
          rows.push({
            id: m.id,
            name: m.name,
            email: m.email,
            projectId: project.id,
            projectTitle: project.title,
            before,
            after,
            change,
          })
      }
      if (args.change === 'project-access') {
        if (!['workspace', 'private'].includes(args.access))
          return fail('validation', 'Chọn chế độ truy cập.')
        const project = view.projects.find((p) => p.id === args.projectId)
        if (!project) return fail('not_found', 'Không tìm thấy dự án.')
        if (!canManageScope(view, 'project', project.id))
          return fail('forbidden', 'Cần quyền quản trị dự án.')
        const next = { ...project, access: args.access }
        for (const m of active)
          impact(m, project, serverAccess(view, project, m.id), serverAccess(view, next, m.id))
      } else if (args.change === 'workspace-access') {
        if (!['internal', 'restricted'].includes(args.access))
          return fail('validation', 'Phạm vi truy cập không hợp lệ.')
        const ws = view.workspaces.find((w) => w.id === args.workspaceId && !w.archived)
        if (!ws) return fail('not_found', 'Không tìm thấy Workspace.')
        if (!canManageScope(view, 'workspace', ws.id))
          return fail('forbidden', 'Cần quyền quản trị Workspace.')
        const changed = {
          ...view,
          workspaces: view.workspaces.map((w) => (w.id === ws.id ? { ...w, access: args.access } : w)),
        }
        for (const project of view.projects.filter(
          (p) => p.workspaceId === ws.id && !p.archived && p.access === 'workspace',
        ))
          for (const m of active)
            impact(m, project, serverAccess(view, project, m.id), serverAccess(changed, project, m.id))
      } else if (args.change === 'project-create') {
        // Who a new project opens to: the grants project creation writes, plus its Workspace.
        if (!['workspace', 'private'].includes(args.access))
          return fail('validation', 'Chọn chế độ truy cập.')
        const ws = view.workspaces.find((w) => w.id === args.workspaceId && !w.archived)
        if (!ws) return fail('not_found', 'Không tìm thấy Workspace.')
        if (!canManageScope(view, 'workspace', ws.id))
          return fail('forbidden', 'Cần quyền quản trị Workspace.')
        for (const key of ['memberIds', 'teamIds'])
          if (
            args[key] !== undefined &&
            (!Array.isArray(args[key]) ||
              args[key].length > 100 ||
              args[key].some((id) => typeof id !== 'string'))
          )
            return fail('validation', 'Danh sách không hợp lệ.', { [key]: 'invalid' })
        const draft = {
            id: '\u0000new',
            companyId: view.company.id,
            workspaceId: ws.id,
            access: args.access,
          },
          grant = (subjectType, subjectId, role) => ({
            id: `draft:${subjectType}:${subjectId}`,
            scope: 'project',
            targetId: draft.id,
            subjectType,
            subjectId,
            role,
          })
        const changed = {
          ...view,
          projects: [...view.projects, draft],
          grants: [
            ...view.grants,
            grant('user', view.user.id, 'admin'),
            grant('user', args.ownerId || view.user.id, 'admin'),
            ...[...new Set(args.memberIds ?? [])].map((id) => grant('user', id, 'editor')),
            ...[...new Set(args.teamIds ?? [])].map((id) => grant('team', id, 'editor')),
          ],
        }
        for (const m of active) {
          const after = serverAccess(changed, draft, m.id)
          if (after.role)
            rows.push({
              id: m.id,
              name: m.name,
              email: m.email,
              projectId: null,
              projectTitle: null,
              before: { role: null, sources: [] },
              after,
              change: 'gain',
            })
        }
      } else return fail('validation', 'Invalid access change')
      return impactPage(rows, args, [
        'access-preview',
        args.change,
        args.projectId ?? args.workspaceId,
        args.access,
      ])
    }
    if (name === 'flow.sprint.report') {
      const response = dispatch('flow.workspace.bootstrap', { ...args, [unprojected]: true })
      if (response.value?.ok === false) return response
      const view = response.value,
        sprint = view.sprints.find(
          (s) => s.id === args.id && !s.archived && (!args.projectId || s.projectId === args.projectId),
        )
      if (!sprint) return fail('not_found', 'Sprint not found')
      if (!sprint.report) return fail('sprint_state', 'Sprint is not closed')
      const { tasks = [], taskIds: _ids, ...report } = sprint.report,
        limit = args.limit ?? 10
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        return fail('validation', 'Invalid report window')
      const fence = JSON.stringify([
        view.company.id,
        view.user.id,
        sprint.projectId,
        sprint.id,
        sprint.version,
        report.closedAt,
      ])
      let offset = 0
      if (args.cursor !== undefined) {
        let cursor
        try {
          if (typeof args.cursor !== 'string' || args.cursor.length > 2048) throw new Error()
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
          if (
            !cursor ||
            Array.isArray(cursor) ||
            !Number.isInteger(cursor.offset) ||
            cursor.offset < 1 ||
            cursor.offset > tasks.length ||
            typeof cursor.fence !== 'string'
          )
            throw new Error()
        } catch {
          return fail('validation', 'Invalid report cursor')
        }
        if (cursor.fence !== fence) return fail('conflict', 'Report scope changed')
        offset = cursor.offset
      }
      const page = tasks.slice(offset, offset + limit),
        next = offset + page.length
      return ok({
        report,
        tasks: page,
        total: tasks.length,
        cursor:
          next < tasks.length
            ? Buffer.from(JSON.stringify({ offset: next, fence })).toString('base64url')
            : null,
      })
    }
    if (name === 'flow.risk.list') {
      const risk = args.risk ?? 'all',
        limit = args.limit ?? 10
      if (
        !['all', 'blocked', 'overdue', 'review'].includes(risk) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        return fail('validation', 'Invalid risk window')
      const response = dispatch('flow.workspace.bootstrap', {
        ...args,
        route: 'dashboard',
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const view = response.value,
        currentDay = today || FIXTURE_ANCHOR
      if (!args.workspaceId || !view.workspaces.some((w) => w.id === args.workspaceId))
        return fail('forbidden', 'Workspace unavailable')
      const projects = view.projects.filter(
        (p) =>
          !p.archived && p.workspaceId === args.workspaceId && (!args.projectId || p.id === args.projectId),
      )
      if (args.projectId && !projects.length) return fail('forbidden', 'Project unavailable')
      const all = view.tasks.filter((t) => !t.archived && projects.some((p) => p.id === t.projectId))
      const byId = new Map(all.map((t) => [t.id, t]))
      const open = (t) => t && !['done', 'cancelled'].includes(statusKind(view, t))
      const blocked = (t) =>
        open(t) &&
        t.blockedBy?.some((id) => {
          const source = byId.get(id)
          return source?.projectId === t.projectId && open(source)
        })
      const overdue = (t) => open(t) && t.dueDate && t.dueDate < currentDay
      const tasks = all
        .filter((t) =>
          risk === 'review'
            ? statusKind(view, t) === 'review'
            : risk === 'blocked'
              ? blocked(t)
              : risk === 'overdue'
                ? overdue(t)
                : blocked(t) || overdue(t),
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const fence = createHash('sha256')
        .update(
          JSON.stringify([
            view.company.id,
            view.user.id,
            args.workspaceId,
            args.projectId ?? null,
            projects.map((p) => p.id).sort(),
            risk,
            currentDay,
            tasks.map((t) => [t.id, t.version, t.dueDate, t.status, t.blockedBy]),
          ]),
        )
        .digest('hex')
      let after = 0
      if (args.cursor !== undefined && args.cursor !== null) {
        let cursor
        try {
          if (typeof args.cursor !== 'string' || args.cursor.length > 2048) throw new Error()
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
          if (!cursor || typeof cursor.id !== 'string' || typeof cursor.fence !== 'string') throw new Error()
        } catch {
          return fail('validation', 'Invalid cursor')
        }
        if (cursor.fence !== fence) return fail('conflict', 'Risk scope changed')
        after = tasks.findIndex((t) => t.id === cursor.id) + 1
        if (!after) return fail('conflict', 'Risk scope changed')
      }
      const page = tasks.slice(after, after + limit),
        projectCounts = {}
      for (const t of tasks) projectCounts[t.projectId] = (projectCounts[t.projectId] ?? 0) + 1
      return ok({
        tasks: page,
        total: tasks.length,
        today: currentDay,
        projectCounts,
        projectTotal: projects.length,
        projects: projects
          .filter((p) => projectCounts[p.id])
          .sort((a, b) => projectCounts[b.id] - projectCounts[a.id] || a.id.localeCompare(b.id))
          .slice(0, 10)
          .map((p) => ({ id: p.id, title: p.title, end: p.end, count: projectCounts[p.id] })),
        metrics: {
          total: tasks.length,
          progress: tasks.filter((t) => statusKind(view, t) === 'progress').length,
          review: tasks.filter((t) => statusKind(view, t) === 'review').length,
          done: 0,
          overdue: tasks.filter(overdue).length,
        },
        cursor:
          after + page.length < tasks.length
            ? Buffer.from(JSON.stringify({ id: page.at(-1).id, fence })).toString('base64url')
            : null,
      })
    }
    if (name === 'flow.issue.list') {
      const sort = args.sort ?? 'manual',
        limit = args.limit ?? 50
      const planning =
        args.sprintId !== undefined ||
        args.backlog === true ||
        args.epicId !== undefined ||
        args.milestonesOnly === true
      if (
        (args.unfinishedOnly === true && (args.mine || args.route === 'my-work')) ||
        (planning &&
          (!args.projectId ||
            args.mine ||
            args.route === 'my-work' ||
            (args.sprintId && args.backlog) ||
            (args.milestonesOnly && !args.epicId)))
      )
        return fail('validation', 'Invalid planning scope')
      const hasDateWindow = args.dueFrom !== undefined || args.dueTo !== undefined
      const valid = (value) =>
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value
      if (
        args.dueBefore !== undefined &&
        (!valid(args.dueBefore) || hasDateWindow || args.includeUndated !== undefined)
      )
        return fail('validation', 'Invalid deadline window')
      if (hasDateWindow) {
        const span = Date.parse(args.dueTo) - Date.parse(args.dueFrom)
        if (!valid(args.dueFrom) || !valid(args.dueTo) || span < 0 || span > 41 * 86400000)
          return fail('validation', 'Invalid date window')
      } else if (args.includeUndated !== undefined) return fail('validation', 'Missing date window')
      if (
        !['manual', 'due', 'priority'].includes(sort) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        return fail('validation', 'Invalid task window')
      const response = dispatch('flow.workspace.bootstrap', { ...args, [unprojected]: true })
      if (response.value?.ok === false) return response
      const view = response.value,
        archive = args.archived === true || ['archive', 'issues-archived'].includes(args.route)
      const tasks = sortedListTasks(
        view.tasks.filter(
          (t) =>
            Boolean(t.archived) === archive &&
            (!args.dueBefore || (t.dueDate && t.dueDate < args.dueBefore)) &&
            (!hasDateWindow ||
              (t.dueDate
                ? t.dueDate >= args.dueFrom && t.dueDate <= args.dueTo
                : args.includeUndated === true)) &&
            (!args.projectId || t.projectId === args.projectId) &&
            (!args.workspaceId ||
              view.projects.some((p) => p.id === t.projectId && p.workspaceId === args.workspaceId)) &&
            (!args.sprintId ||
              (t.sprintId
                ? t.sprintId === args.sprintId
                : view.sprints.some(
                    (s) => s.id === args.sprintId && s.projectId === t.projectId && s.title === t.sprint,
                  ))) &&
            (!args.epicId ||
              (t.epicId
                ? t.epicId === args.epicId
                : t.epic === args.epicId ||
                  view.epics.some(
                    (e) => e.id === args.epicId && e.projectId === t.projectId && e.title === t.epic,
                  ))) &&
            (!args.milestonesOnly || t.type === 'milestone') &&
            (!args.backlog || (!t.sprintId && (!t.sprint || t.sprint === 'Backlog'))) &&
            (!args.unfinishedOnly || statusKind(view, t) !== 'done') &&
            (!(args.route === 'my-work' || args.mine) || taskAssigneeIds(view, t).includes(view.user.id)) &&
            (!args.columnId || t.status === args.columnId) &&
            (!args.status || args.status === 'all' || t.status === args.status) &&
            (!args.query ||
              `${t.key} ${t.title}`.toLocaleLowerCase().includes(args.query.toLocaleLowerCase())),
        ),
        sort,
      )
      const fence = JSON.stringify([
        view.company.id,
        view.user.id,
        args.projectId ?? '',
        args.workspaceId ?? '',
        args.route ?? '',
        args.status ?? '',
        args.columnId ?? '',
        args.query ?? '',
        sort,
        args.dueFrom ?? '',
        args.dueTo ?? '',
        args.includeUndated === true,
        args.dueBefore ?? '',
        args.sprintId ?? '',
        args.backlog === true,
        args.unfinishedOnly === true,
        args.epicId ?? '',
        args.milestonesOnly === true,
        tasks.map((t) => [t.id, t.version, t.order]),
      ])
      let start = 0
      if (args.cursor) {
        let cursor
        try {
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
        } catch {
          return fail('validation', 'Invalid cursor')
        }
        if (cursor?.fence !== fence) return fail('conflict', 'Task scope changed')
        start = tasks.findIndex((t) => t.id === cursor.id) + 1
        if (!start) return fail('conflict', 'Task scope changed')
      }
      const page = tasks.slice(start, start + limit),
        statusCounts = {}
      for (const t of tasks) statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1
      const kind = (t) => statusKind(view, t)
      return ok({
        tasks: page,
        total: tasks.length,
        statusCounts,
        metrics: {
          total: tasks.length,
          progress: tasks.filter((t) => kind(t) === 'progress').length,
          review: tasks.filter((t) => kind(t) === 'review').length,
          done: tasks.filter((t) => kind(t) === 'done').length,
          overdue: tasks.filter((t) => kind(t) !== 'done' && t.dueDate && t.dueDate < view.today).length,
        },
        cursor:
          start + page.length < tasks.length
            ? Buffer.from(JSON.stringify({ id: page.at(-1).id, fence })).toString('base64url')
            : null,
      })
    }
    if (name === 'flow.inbox.list') {
      const response = dispatch('flow.workspace.bootstrap', {
        ...args,
        route: 'inbox',
        inboxFilter: args.filter,
        inboxCursor: args.cursor,
        inboxLimit: args.limit,
      })
      if (response.value?.ok === false) return response
      return ok({ ...response.value.inboxPage, items: response.value.inbox })
    }
    if (name === 'flow.project.options' || name === 'flow.project.list') {
      const response = dispatch('flow.workspace.bootstrap', {
        companyId: args.companyId,
        route: 'projects',
        [unprojected]: true,
      })
      if (response.value?.ok === false) return response
      const query = String(args.query ?? '')
        .trim()
        .toLocaleLowerCase('en-US')
      const limit = args.limit ?? 25
      if (!Number.isInteger(limit) || limit < 1 || limit > 50 || query.length > 1000)
        return fail('validation', 'Invalid project options')
      const access = args.access ?? ''
      if (access && !['workspace', 'private'].includes(access))
        return fail('validation', 'Invalid project options')
      const view = response.value
      // `manage` keeps the projects whose access the actor may change, as access.grant checks.
      const manages = (p) =>
        view.capabilities?.manageOrganization || (accessRank[accessFor(view, p, view.user.id).role] ?? 0) >= 3
      const records = view.projects
        .filter(
          (p) =>
            !p.archived &&
            (!args.workspaceId || p.workspaceId === args.workspaceId) &&
            (!access || p.access === access) &&
            (!args.manage || manages(p)) &&
            (!query || (p.title + ' ' + p.code).toLocaleLowerCase('en-US').includes(query)),
        )
        .sort((a, b) => a.title.localeCompare(b.title, 'en-US') || a.id.localeCompare(b.id))
      const fence = JSON.stringify([
        d.user.id,
        args.companyId,
        query,
        args.workspaceId ?? '',
        access,
        Boolean(args.manage),
        name,
        response.value.organizationRevision,
        records.map((p) => [p.id, p.title, p.code, p.workspaceId, p.archived, p.version, p.accessInfo?.role]),
      ])
      let start = 0
      if (args.cursor) {
        let cursor
        try {
          cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString())
        } catch {
          return fail('validation', 'Invalid cursor')
        }
        if (!cursor || typeof cursor.id !== 'string' || typeof cursor.fence !== 'string')
          return fail('validation', 'Invalid cursor')
        if (cursor.fence !== fence) return fail('conflict', 'Project options changed')
        start = records.findIndex((p) => p.id === cursor.id) + 1
        if (!start) return fail('conflict', 'Project options changed')
      }
      const items = records
        .slice(start, start + limit)
        .map((p) =>
          name === 'flow.project.list'
            ? p
            : { id: p.id, code: p.code, title: p.title, workspaceId: p.workspaceId },
        )
      return ok({
        items,
        total: records.length,
        cursor:
          start + items.length < records.length
            ? Buffer.from(JSON.stringify({ id: items.at(-1).id, fence })).toString('base64url')
            : null,
      })
    }
    if (name === 'flow.invitation.accept') {
      const invitation = d.invitations.find(
        (i) =>
          (i.token ?? i.id) === args.token &&
          i.status === 'pending' &&
          i.email.toLowerCase() === d.user.email?.toLowerCase(),
      )
      if (!invitation) return fail('invitation_invalid', 'Invitation unavailable')
      invitation.status = 'accepted'
      return { ok: true, id: invitation.id }
    }
    if (name === 'flow.workspace.bootstrap') {
      if (
        user.role === 'guest' &&
        [
          'settings',
          'project-profile',
          'project-members',
          'project-move',
          ...hooks.values('adminRoutes'),
          'forms',
          'workspace-settings',
          'workspace-members',
          'organization',
          'organization-members',
          'permissions',
          'teams',
        ].includes(args.route)
      )
        return fail('forbidden', 'Bạn không có quyền vào công cụ quản trị.')
      const response = session.call(name, args)
      if (response.value?.ok === false) return response
      const result = response.value
      result.projects = structuredClone(projects).map((p) => ({
        ...p,
        accessInfo: accessFor(d, p, d.user.id),
      }))
      result.workspaces = structuredClone(workspaces)
      for (const collection of ['tasks', 'epics', 'sprints', 'views', 'forms'])
        result[collection] = result[collection].filter((x) => projectIds.has(x.projectId ?? projects[0]?.id))
      result.columns = result.columns.filter((c) => !c.projectId || projectIds.has(c.projectId))
      if (!args.projectId && ['my-work', 'all-issues'].includes(args.route)) {
        const scoped = projects.filter((p) => !args.workspaceId || p.workspaceId === args.workspaceId)
        const ids = new Set(scoped.flatMap((p) => p.taskStatusIds ?? []))
        const scopes = new Set(scoped.map((p) => p.id))
        result.columns = result.columns.filter(
          (c) => !c.projectId || (scopes.has(c.projectId) && ids.has(c.id)),
        )
      }
      result.tags = result.tags.filter((t) => !t.projectId || projectIds.has(t.projectId))
      result.pages = result.pages
        .filter((p) => documentAccess(d, p).read)
        .map((p) => ({ ...p, access: documentAccess(d, p) }))
      for (const p of result.pages)
        if (p.parentId && !result.pages.some((x) => x.id === p.parentId)) p.parentId = null
      result.grants = result.grants.filter((g) =>
        g.scope === 'project' ? projectIds.has(g.targetId) : workspaces.some((w) => w.id === g.targetId),
      )
      const taskIds = new Set(result.tasks.map((t) => t.id))
      for (const collection of ['inbox', 'files', 'history', 'comments'])
        result[collection] = result[collection].filter(
          (x) => (!x.taskId || taskIds.has(x.taskId)) && (!x.recipientId || x.recipientId === d.user.id),
        )
      const target = projects.find((p) => p.id === requestedProject)
      if (
        args.workspaceId &&
        !workspaces.some((w) => w.id === args.workspaceId) &&
        !d.workspaces.some((w) => w.id === args.workspaceId && w.archived) &&
        !target &&
        !targetPage
      )
        return fail('forbidden', 'Bạn không có quyền vào Workspace này.')
      const workspaceId =
        target?.workspaceId ??
        targetPage?.workspaceId ??
        (workspaces.some((w) => w.id === args.workspaceId) ? args.workspaceId : (workspaces[0]?.id ?? ''))
      result.context = { companyId: d.company.id, workspaceId, projectId: target?.id ?? null }
      if (args.route === 'invitation-accept') {
        const invitation = d.invitations.find(
          (i) =>
            (i.token ?? i.id) === args.recordId &&
            i.status === 'pending' &&
            i.email.toLowerCase() === d.user.email?.toLowerCase(),
        )
        result.invitationOffer = invitation
          ? { available: true, role: invitation.role, expiresAt: invitation.expiresAt }
          : { available: false }
      }
      result.capabilities = {
        write:
          scenario !== 'readonly' &&
          (target ? accessFor(d, target, d.user.id).role !== 'viewer' : user.role !== 'guest'),
        manageOrganization: scenario !== 'readonly' && canManageScope(d, 'company', d.company.id),
      }
      if (user.role === 'guest') {
        result.members = [structuredClone(user)]
        result.teams = []
        result.grants = d.grants.filter((g) => g.subjectType === 'user' && g.subjectId === user.id)
        result.invitations = []
        result.companies = [d.company]
        result.people = [user.name]
        result.forms = []
        result.fields = []
        result.projectFavorites = []
      }
      result.formResponses = (result.formResponses ?? []).filter((r) =>
        result.forms.some((f) => f.id === r.formId),
      )
      result.views = result.views.filter(
        (v) => !v.archived && (!v.ownerId || v.ownerId === d.user.id || v.visibility === 'project'),
      )
      result.history = result.history.filter((h) => h.taskId && taskIds.has(h.taskId))
      result.inboxUnreadCount = result.inbox.filter((note) => {
        const task = result.tasks.find((task) => task.id === note.taskId)
        const project = projects.find((project) => project.id === task?.projectId)
        return !note.read && (!args.workspaceId || project?.workspaceId === args.workspaceId)
      }).length
      if (args.route === 'inbox') {
        const filter = args.inboxFilter ?? 'unread',
          limit = args.inboxLimit ?? 25
        if (
          !['unread', 'all', 'mentions', 'action'].includes(filter) ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 50
        )
          return fail('validation', 'Invalid Inbox page')
        const fence = JSON.stringify([
          d.company.id,
          d.user.id,
          filter,
          projects.map((project) => project.id).sort(),
          args.workspaceId ?? '',
        ])
        const notes = result.inbox
          .filter((note) => {
            const task = result.tasks.find((task) => task.id === note.taskId),
              project = projects.find((project) => project.id === task?.projectId)
            return (
              (!args.workspaceId || project?.workspaceId === args.workspaceId) &&
              (filter === 'all' ||
                (filter === 'unread' && !note.read) ||
                (filter === 'mentions' && note.kind === 'mention') ||
                (filter === 'action' && note.actionNeeded))
            )
          })
          .sort(
            (a, b) =>
              String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || b.id.localeCompare(a.id),
          )
        let start = 0
        if (args.inboxCursor) {
          let cursor
          try {
            cursor = JSON.parse(Buffer.from(args.inboxCursor, 'base64url').toString())
          } catch {
            return fail('validation', 'Invalid cursor')
          }
          if (!cursor || cursor.fence !== fence) return fail('conflict', 'Inbox scope changed')
          start = notes.findIndex((note) => note.id === cursor.id) + 1
          if (!start) return fail('conflict', 'Inbox scope changed')
        }
        const page = notes.slice(start, start + limit)
        result.inbox = page
        result.inboxPage = {
          total: notes.length,
          unreadCount: result.inboxUnreadCount,
          filter,
          cursor:
            start + page.length < notes.length
              ? Buffer.from(JSON.stringify({ id: page.at(-1).id, fence })).toString('base64url')
              : null,
        }
      }
      hooks.notify('scope', { d, result, scenario, user, projectIds, taskIds, workspaces })
      for (const sprint of ['sprints', 'sprint-close', 'workspace-overview'].includes(args.route)
        ? result.sprints
        : []) {
        const tasks = result.tasks.filter(
          (t) =>
            !t.archived &&
            t.projectId === sprint.projectId &&
            (t.sprintId ? t.sprintId === sprint.id : t.sprint === sprint.title),
        )
        const pending = tasks.filter((t) => statusKind(result, t) !== 'done')
        sprint.taskTotals = {
          total: tasks.length,
          done: tasks.length - pending.length,
          points: tasks.reduce((sum, t) => sum + Number(t.points ?? 0), 0),
          pending: pending.length,
          pendingPoints: pending.reduce((sum, t) => sum + Number(t.points ?? 0), 0),
        }
      }
      hooks.notify('sprintTotals', { result })
      if (['tags', 'tag-edit'].includes(args.route)) {
        const active = new Set(result.projects.filter((p) => !p.archived).map((p) => p.id))
        result.labelUsage = Object.fromEntries(
          result.tags.map((label) => [
            label.id,
            {
              tasks: d.tasks.filter(
                (t) =>
                  !t.archived && active.has(t.projectId) && (t.tags ?? t.tagIds ?? []).includes(label.id),
              ).length,
              projects: result.projects.filter((p) => !p.archived && p.tags?.includes(label.id)).length,
            },
          ]),
        )
      }
      if (!args.shellOnly) {
        const workspaceId =
          args.workspaceId || result.context?.workspaceId || result.workspaces.find((w) => !w.archived)?.id
        result.counts = {
          ...result.counts,
          projects: result.projects.filter((p) => !p.archived && p.workspaceId === workspaceId).length,
        }
      }
      if (!args[unprojected]) {
        if (
          !args.shellOnly &&
          !args.projectId &&
          ['organization-settings', 'tags', 'column-edit', 'type-edit', 'tag-edit', 'field-edit'].includes(
            args.route,
          )
        ) {
          result.catalogPages = {}
          for (const [kind, collection] of Object.entries({
            column: 'columns',
            type: 'types',
            tag: 'tags',
            field: 'fields',
          })) {
            const page = dispatch('flow.catalog.list', { companyId: args.companyId, kind, limit: 50 })
            if (page.value?.ok === false) return page
            result[collection] = [...page.value.items]
            result.catalogPages[collection] = {
              total: page.value.total,
              cursor: page.value.cursor,
              loadedIds: page.value.items.map((item) => item.id),
            }
            if (args.route === `${kind}-edit` && args.recordId) {
              const pinned = d[collection].find(
                (item) =>
                  item.id === args.recordId &&
                  (!item.projectId || result.projects.some((project) => project.id === item.projectId)) &&
                  (kind === 'tag' || !item.archived),
              )
              if (pinned)
                result[collection] = [...result[collection].filter((item) => item.id !== pinned.id), pinned]
            }
            if (page.value.labelUsage) result.labelUsage = page.value.labelUsage
          }
          result.taskTypes = result.types
        }

        if (!args.shellOnly && result.members.find((m) => m.id === result.user.id)?.role !== 'guest') {
          const people = dispatch('flow.member.list', { companyId: args.companyId, limit: 100 })
          if (people.value?.ok === false) return people
          const identities = result.members,
            pinned = [
              result.user.id,
              ...(['member-edit', 'member-access'].includes(args.route) && args.recordId
                ? [args.recordId]
                : []),
            ]
          result.members = [...people.value.items]
          for (const id of pinned)
            if (!result.members.some((m) => m.id === id)) {
              const member = identities.find((m) => m.id === id)
              if (member) result.members.push({ ...member, teamIds: teamIdsIn(result, id) })
            }
          result.memberPage = {
            total: people.value.total,
            cursor: people.value.cursor,
            loadedIds: people.value.items.map((m) => m.id),
          }
          if (result.capabilities?.manageOrganization) {
            const invitations = dispatch('flow.invitation.list', { companyId: args.companyId, limit: 50 })
            if (invitations.value?.ok === false) return invitations
            result.invitations = invitations.value.items
            result.invitationPage = {
              total: invitations.value.total,
              cursor: invitations.value.cursor,
              loadedIds: invitations.value.items.map((i) => i.id),
            }
          } else result.invitations = []
        }
        // Teams arrive as a directory page plus the actor's own and the one a route opens;
        // membership is never shipped, each person carries their Team ids instead.
        const ownTeams = teamIdsIn(result, result.user.id)
        result.user = { ...result.user, teamIds: ownTeams }
        if (!args.shellOnly && result.members.find((m) => m.id === result.user.id)?.role !== 'guest') {
          const directory = dispatch('flow.team.list', { companyId: args.companyId, limit: 100 })
          if (directory.value?.ok === false) return directory
          const teams = [...directory.value.items]
          for (const id of [
            ...ownTeams,
            ...(['team', 'team-edit'].includes(args.route) && args.recordId ? [args.recordId] : []),
          ]) {
            const team = result.teams.find((t) => t.id === id && !t.archived)
            if (team && !teams.some((t) => t.id === id)) teams.push(teamSummary(result, team))
          }
          result.teams = teams
          result.teamPage = {
            total: directory.value.total,
            cursor: directory.value.cursor,
            loadedIds: directory.value.items.map((t) => t.id),
          }
        } else
          result.teams = result.teams
            .filter((t) => ownTeams.includes(t.id))
            .map((t) => teamSummary(result, t))
        // Only the actor's grants and their Teams' ship; others' access is read on demand.
        result.grants = result.grants.filter((g) =>
          g.subjectType === 'user' ? g.subjectId === result.user.id : ownTeams.includes(g.subjectId),
        )
        // The owner of the open document reads its readers, named; elsewhere `readerIds` only
        // says whether the actor is one.
        const openPage = args.recordId ?? result.pages?.find((p) => !p.archived)?.id
        result.pages = result.pages?.map((p) =>
          p.id === openPage && (p.ownerId ?? 'mai') === result.user.id
            ? {
                ...p,
                readers: (p.readerIds ?? []).map((id) => ({
                  id,
                  name: d.members.find((m) => m.id === id)?.name ?? '',
                })),
              }
            : { ...p, readerIds: (p.readerIds ?? []).filter((id) => id === result.user.id) },
        )
        const accessTarget =
          args.route === 'project-members' && result.context?.projectId
            ? { scope: 'project', targetId: result.context.projectId }
            : args.route === 'workspace-members' && result.context?.workspaceId
              ? { scope: 'workspace', targetId: result.context.workspaceId }
              : null
        if (
          !args.shellOnly &&
          accessTarget &&
          result.members.find((m) => m.id === result.user.id)?.role !== 'guest'
        ) {
          const access = dispatch('flow.access.list', {
            companyId: args.companyId,
            ...accessTarget,
            limit: 50,
          })
          if (access.value?.ok === false) return access
          result.accessPage = {
            ...accessTarget,
            ...access.value,
            loadedIds: access.value.items.map((m) => m.id),
          }
        }
        if (!args.shellOnly && args.route === 'projects') {
          const directory = dispatch('flow.project.list', {
            companyId: args.companyId,
            workspaceId: args.workspaceId,
            limit: 50,
          })
          if (directory.value?.ok === false) return directory
          result.projects = directory.value.items
          result.projectPage = { total: directory.value.total, cursor: directory.value.cursor }
        }
        if (args.route === 'workspace-overview') {
          const workspaceId =
            args.workspaceId || result.context?.workspaceId || result.workspaces.find((w) => !w.archived)?.id
          const ids = new Set(
            result.projects.filter((p) => !p.archived && p.workspaceId === workspaceId).map((p) => p.id),
          )
          result.gettingStartedState = {
            workspaceId,
            project: ids.size > 0,
            task: result.tasks.some((t) => !t.archived && ids.has(t.projectId)),
            invite:
              d.members.find((m) => m.id === result.user.id)?.role !== 'guest' &&
              (d.members.some((m) => m.id !== result.user.id && m.status === 'active') ||
                result.invitations.length > 0),
            page: result.pages.some(
              (p) => !p.archived && (ids.has(p.projectId) || (!p.projectId && p.workspaceId === workspaceId)),
            ),
          }
        }
        const activityTask = result.tasks.find((task) => task.id === args.recordId)
        const activity =
          activityTask &&
          dispatch('flow.issue.detail', { companyId: args.companyId, id: activityTask.id }).value
        projectForRoute(result, args)
        if (activity && args.route !== 'workspace-overview') {
          result.tasks = result.tasks.map((task) => (task.id === activity.task.id ? activity.task : task))
          result.comments = activity.comments
          result.history = activity.history
        }
        if (args.route === 'workspace-overview') {
          const currentDay = today || FIXTURE_ANCHOR,
            dayAt = (i) =>
              new Date(Date.parse(currentDay + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10)
          const workspaceId =
            args.workspaceId || result.context?.workspaceId || result.workspaces.find((w) => !w.archived)?.id
          const projectIds = new Set(
            result.projects
              .filter((p) => p.workspaceId === workspaceId && (!args.projectId || p.id === args.projectId))
              .map((p) => p.id),
          )
          const open = result.tasks.filter(
            (t) => !t.archived && projectIds.has(t.projectId) && statusKind(result, t) !== 'done',
          )
          const openById = new Map(open.map((t) => [t.id, t]))
          const blocked = open.filter((t) =>
            t.blockedBy?.some((id) => openById.get(id)?.projectId === t.projectId),
          )
          result.blockedCounts = {
            total: blocked.length,
            projects: Object.fromEntries(
              [...projectIds]
                .map((id) => [id, blocked.filter((t) => t.projectId === id).length])
                .filter(([, count]) => count > 0),
            ),
          }

          const days = Object.fromEntries(
            Array.from({ length: 14 }, (_, i) => [
              dayAt(i),
              open.filter((t) => t.dueDate === dayAt(i)).length,
            ]),
          )
          result.deadlineCounts = {
            today: currentDay,
            days,
            overdue: open.filter((t) => t.dueDate && t.dueDate < currentDay).length,
            dueSoon: Object.entries(days)
              .slice(0, 7)
              .reduce((n, [, count]) => n + count, 0),
          }
          // d.members is the complete authorized fixture directory, before its
          // presentation window; the production projection uses grouped SQL.
          result.peopleMetrics = d.members
            .filter((m) => m.status === 'active')
            .map((member) => {
              const tasks = open.filter((task) => taskAssigneeIds(d, task).includes(member.id))
              return {
                member: { id: member.id, name: member.name },
                open: tasks.length,
                overdue: tasks.filter((task) => task.dueDate && task.dueDate < currentDay).length,
              }
            })
            .filter((person) => person.open)
            .sort(
              (a, b) => b.overdue - a.overdue || b.open - a.open || a.member.id.localeCompare(b.member.id),
            )
            .slice(0, 6)
        }
        if (args.route === 'calendar' && args.dueFrom) {
          const page = dispatch('flow.issue.list', { ...args, sort: 'due', limit: 50 })
          if (page.value?.ok === false) return page
          result.tasks = page.value.tasks
          result.collectionPage = { cursor: page.value.cursor, total: page.value.total, limit: 50 }
        }
        if (args.route === 'issue-new' && !args.projectId) {
          for (const key of ['columns', 'types', 'taskTypes', 'tags', 'fields'])
            if (Array.isArray(result[key])) result[key] = result[key].filter((item) => !item.projectId)
        }
        if (['inbox', 'notifications', 'personal-settings'].includes(args.route)) {
          for (const key of ['tasks', 'columns', 'taskTypes', 'types', 'tags', 'fields', 'sprints', 'epics'])
            result[key] = []
        }
        hooks.notify('routeProjection', { result, args })
      }
      return ok(result)
    }
    const extended = hooks.first('organizationCommand', {
      d,
      name,
      args,
      scenario,
      replay,
      baseCall: session.call,
      fail,
    })
    if (extended !== undefined) return extended
    if (name === 'flow.operations.command') return operationsCommand(d, args, scenario, replay, session.call)
    if (name === 'flow.project.move.preview') {
      const p = d.projects.find((p) => p.id === args.projectId),
        w = d.workspaces.find((w) => w.id === args.targetWorkspaceId && !w.archived)
      if (!p || !w || p.workspaceId === w.id)
        return fail('validation', 'Chọn Workspace đích khác trong cùng tổ chức.')
      if (!canManageScope(d, 'project', p.id) || !canManageScope(d, 'workspace', w.id))
        return fail('forbidden', 'Cần quyền quản trị dự án và Workspace đích.')
      // The same rows as the server: everyone the move touches, losses first; keeping
      // access adds a direct grant at the old role, so that person keeps it.
      const rows = d.members
        .filter((m) => m.status === 'active')
        .map((m) => {
          const before = serverAccess(d, p, m.id),
            after = serverAccess(d, p, m.id, w.id),
            change = changeOf(before, after)
          return args.preserve && change === 'loss'
            ? {
                id: m.id,
                name: m.name,
                email: m.email,
                projectId: p.id,
                projectTitle: p.title,
                before,
                after: {
                  role: before.role,
                  sources: [
                    ...after.sources,
                    {
                      role: before.role,
                      scope: 'project',
                      grantId: null,
                      teamId: null,
                      teamTitle: null,
                      teamMemberCount: null,
                      retained: true,
                    },
                  ],
                },
                change: 'same',
              }
            : {
                id: m.id,
                name: m.name,
                email: m.email,
                projectId: p.id,
                projectTitle: p.title,
                before,
                after,
                change,
              }
        })
        .filter((row) => row.before.role || row.after.role)
      const page = impactPage(rows, args, ['move-preview', p.id, w.id, !!args.preserve])
      if (page.value?.ok === false) return page
      return ok({
        projectId: p.id,
        targetWorkspaceId: w.id,
        revision: d.organizationRevision,
        preserve: !!args.preserve,
        people: page.value.items,
        total: page.value.total,
        summary: page.value.counts,
        cursor: page.value.cursor,
      })
    }
    if (name === 'flow.organization.command') {
      if (scenario === 'readonly') return fail('forbidden', 'Bạn chỉ có quyền xem.')
      if (!args.idempotencyKey) return fail('validation', 'Thiếu khóa thao tác.')
      const key = d.company.id + ':' + args.idempotencyKey
      if (replay.has(key)) return structuredClone(replay.get(key))
      const action = args.action,
        heldGrant = d.grants.find((g) => g.id === args.id),
        scope =
          action === 'access.grant'
            ? args.scope
            : action === 'access.revoke'
              ? heldGrant?.scope
              : action.startsWith('project.')
                ? 'project'
                : action.startsWith('workspace.')
                  ? 'workspace'
                  : 'company'
      if (
        action !== 'project.favorite' &&
        !canManageScope(
          d,
          scope,
          action === 'access.grant'
            ? args.targetId
            : action === 'access.revoke'
              ? heldGrant?.targetId
              : (args.id ?? args.projectId ?? d.company.id),
        )
      )
        return fail('forbidden', 'Bạn chưa có quyền quản lý phạm vi này.')
      // A favourite is the actor's own: it neither checks nor moves the shared revision.
      const personal = action === 'project.favorite'
      if (!personal && args.expectedRevision !== d.organizationRevision)
        return fail('conflict', 'Quyền hoặc cấu trúc đã thay đổi. Tải lại và xem trước lần nữa.')
      let value = {}
      if (['workspace.save', 'team.save', 'company.save'].includes(action)) {
        if (typeof args.title !== 'string' || !args.title.trim())
          return fail('validation', 'Vui lòng nhập tên.', { title: 'Nhập tên có nội dung.' })
        if (args.description !== undefined && typeof args.description !== 'string')
          return fail('validation', 'Mô tả không hợp lệ.', { description: 'Nhập mô tả dạng văn bản.' })
        if (
          action === 'workspace.save' &&
          args.access !== undefined &&
          !['restricted', 'internal'].includes(args.access)
        )
          return fail('validation', 'Phạm vi truy cập không hợp lệ.', {
            access: 'Chọn nội bộ hoặc riêng tư.',
          })
        if (action === 'company.save') d.company.name = args.title.trim()
        else {
          const collection = action.startsWith('team') ? 'teams' : 'workspaces'
          let entity = d[collection].find((x) => x.id === args.id)
          if (args.id != null && (!entity || entity.archived))
            return fail('notFound', 'Hồ sơ không còn khả dụng. Quay lại danh sách để chọn hồ sơ hiện có.')
          if (!entity) {
            entity = {
              id: collection + '-' + crypto.randomUUID(),
              companyId: d.company.id,
              memberIds: [],
              archived: false,
              createdAt: new Date().toISOString(),
            }
            d[collection].push(entity)
          }
          Object.assign(entity, {
            title: args.title.trim(),
            description: args.description ?? entity.description ?? '',
            // Only a Workspace has access; a Team is a group of people.
            ...(collection === 'workspaces' ? { access: args.access ?? entity.access ?? 'restricted' } : {}),
          })
          value = { id: entity.id }
        }
      } else if (action === 'workspace.archive') {
        const w = d.workspaces.find((w) => w.id === args.id)
        if (!w) return fail('notFound', 'Workspace không còn tồn tại.')
        if (d.projects.some((p) => p.workspaceId === w.id && !p.archived))
          return fail('activeProjects', 'Chuyển hoặc lưu trữ các Project trước khi lưu trữ Workspace.')
        w.archived = true
      } else if (action === 'member.invite') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email ?? ''))
          return fail('validation', 'Nhập email hợp lệ.')
        if (!['member', 'admin', 'guest'].includes(args.role))
          return fail('validation', 'Vai trò không hợp lệ.')
        if (args.role === 'guest' && !d.projects.some((p) => p.id === args.projectId))
          return fail('validation', 'Khách mời phải được cấp một Project cụ thể.')
        if (d.invitations.some((i) => i.email === args.email && i.status === 'pending'))
          return fail('validation', 'Email này đã có lời mời đang chờ.')
        d.invitations.push({
          id: crypto.randomUUID(),
          email: args.email,
          role: args.role,
          projectId: args.role === 'guest' ? args.projectId : null,
          status: 'pending',
          sentAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        })
      } else if (action === 'invitation.resend') {
        const i = d.invitations.find((i) => i.id === args.id && i.status === 'pending')
        if (!i) return fail('validation', 'Lời mời không còn hiệu lực.')
        i.sentAt = new Date().toISOString()
        i.expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
        i.resendCount = (i.resendCount ?? 0) + 1
      } else if (action === 'invitation.revoke') {
        const i = d.invitations.find((i) => i.id === args.id)
        if (!i) return fail('notFound', 'Không tìm thấy lời mời.')
        i.status = 'revoked'
      } else if (action === 'member.update') {
        const m = d.members.find((m) => m.id === args.id)
        if (!m || m.role === 'owner')
          return fail('validation', 'Chủ sở hữu được bảo vệ; cần chuyển quyền sở hữu trước.')
        if (!['admin', 'member', 'guest'].includes(args.role))
          return fail('validation', 'Vai trò không hợp lệ.')
        if (args.revoke !== undefined && typeof args.revoke !== 'boolean')
          return fail('validation', 'Thao tác truy cập thành viên không hợp lệ.')
        Object.assign(m, {
          role: args.role,
          ...(args.revoke !== undefined ? { status: args.revoke ? 'revoked' : 'active' } : {}),
        })
      } else if (action === 'team.member') {
        const t = d.teams.find((t) => t.id === args.id),
          m = d.members.find((m) => m.id === args.memberId)
        if (args.remove !== undefined && typeof args.remove !== 'boolean')
          return fail('validation', 'Thao tác thành viên Team không hợp lệ.')
        if (!t || t.archived || !m || (!args.remove && (m.role === 'guest' || m.status !== 'active')))
          return fail('validation', 'Chọn Team hiện có và thành viên nội bộ đang hoạt động để thêm.')
        t.memberIds = args.remove
          ? t.memberIds.filter((x) => x !== m.id)
          : [...new Set([...t.memberIds, m.id])]
      } else if (action === 'access.grant') {
        if (
          !['workspace', 'project'].includes(args.scope) ||
          !['viewer', 'editor', 'admin'].includes(args.role) ||
          !['user', 'team'].includes(args.subjectType)
        )
          return fail('validation', 'Phạm vi hoặc vai trò không hợp lệ.')
        const target = (args.scope === 'project' ? d.projects : d.workspaces).find(
          (x) => x.id === args.targetId,
        )
        const ids = [...new Set(args.subjectIds ?? [args.subjectId])]
        if (!target || target.archived || !ids.length || ids.length > 100)
          return fail('validation', 'Chọn người hoặc Team để cấp quyền.')
        for (const id of ids) {
          const subject = (args.subjectType === 'team' ? d.teams : d.members).find((x) => x.id === id)
          if (
            !subject ||
            subject.archived ||
            subject.status === 'revoked' ||
            (subject.role === 'guest' && args.scope !== 'project')
          )
            return fail('validation', 'Chỉ cấp quyền trong tổ chức; khách mời chỉ được cấp Project.')
        }
        for (const id of ids) {
          d.grants = d.grants.filter(
            (g) =>
              !(
                g.scope === args.scope &&
                g.targetId === args.targetId &&
                g.subjectType === args.subjectType &&
                g.subjectId === id
              ),
          )
          d.grants.push({
            id: crypto.randomUUID(),
            scope: args.scope,
            targetId: args.targetId,
            subjectType: args.subjectType,
            subjectId: id,
            role: args.role,
          })
        }
      } else if (action === 'access.revoke') {
        const g = d.grants.find((g) => g.id === args.id)
        if (!g) return fail('notFound', 'Quyền đã được gỡ.')
        d.grants = d.grants.filter((x) => x.id !== g.id)
      } else if (action === 'project.move') {
        const preview = call('flow.project.move.preview', args)
        if (preview.value?.ok === false) return preview
        const p = d.projects.find((p) => p.id === args.projectId)
        if (args.preserve)
          for (const row of moveImpact(d, p, args.targetWorkspaceId, false).filter(
            (x) => x.change === 'loss',
          ))
            d.grants.push({
              id: crypto.randomUUID(),
              scope: 'project',
              targetId: p.id,
              subjectType: 'user',
              subjectId: row.id,
              role: row.before.role,
            })
        p.workspaceId = args.targetWorkspaceId
        value = { id: p.id, workspaceId: p.workspaceId }
      } else if (action === 'project.access') {
        const p = d.projects.find((p) => p.id === args.id)
        if (!p || !['private', 'workspace'].includes(args.access))
          return fail('validation', 'Dự án hoặc chế độ truy cập không hợp lệ.')
        p.access = args.access
      } else if (action === 'project.favorite') {
        if (!projectIds.has(args.id)) return fail('forbidden', 'Bạn không có quyền xem dự án.')
        d.projectFavorites = d.projectFavorites.includes(args.id)
          ? d.projectFavorites.filter((x) => x !== args.id)
          : [...d.projectFavorites, args.id]
      } else {
        const extra = hooks.first('organizationAction', { d, action, args })
        if (extra === undefined) return fail('unknown', 'Thao tác không được hỗ trợ.')
        value = extra
      }
      if (!personal) d.organizationRevision++
      const result = ok(value)
      replay.set(key, structuredClone(result))
      return result
    }
    if (
      ['columns', 'types', 'fields', 'tags'].includes(args.collection) &&
      !canManageScope(d, 'company', d.company.id)
    )
      return fail('forbidden', 'Cần quyền quản lý thư viện tổ chức.')
    if (targetPage && args.expectedVersion !== undefined && args.expectedVersion !== targetPage.version)
      return fail('conflict', 'Tài liệu đã thay đổi. Tải lại trước khi lưu.')
    if (hooks.values('readNames').includes(name)) {
      const extensionRead = hooks.first('organizationRead', {
        name,
        args,
        fail,
        read: () =>
          dispatch('flow.workspace.bootstrap', {
            companyId: args.companyId,
            route: 'my-work',
            [unprojected]: true,
          }),
      })
      return extensionRead ?? session.call(name, args)
    }
    if (
      requestedProject &&
      accessFor(
        d,
        d.projects.find((p) => p.id === requestedProject),
        d.user.id,
      ).role === 'viewer'
    )
      return fail('forbidden', 'Bạn chỉ có quyền xem dự án này.')
    if (scenario === 'guest' || scenario === 'readonly')
      return fail('forbidden', 'Bạn chỉ có quyền xem trong phạm vi được cấp.')
    if (
      ['flow.issue.bulk', 'flow.issue.reorder'].includes(name) &&
      args.ids !== undefined &&
      !Array.isArray(args.ids)
    )
      return fail('validation', 'Danh sách lựa chọn không hợp lệ.')
    if (
      name === 'flow.issue.reorder' &&
      args.targetId &&
      !d.tasks.some((t) => t.id === args.targetId && projectIds.has(t.projectId))
    )
      return fail('forbidden', 'Không có quyền vào nhóm đích.')
    if (
      name === 'flow.issue.reorder' &&
      (args.ids ?? []).some((id) => {
        const task = d.tasks.find((t) => t.id === id),
          project = d.projects.find((p) => p.id === task?.projectId)
        return (
          !project || !['editor', 'member', 'admin', 'owner'].includes(accessFor(d, project, d.user.id).role)
        )
      })
    )
      return fail('forbidden', 'Lựa chọn có công việc ngoài quyền chỉnh sửa.')
    const extensionRefusal = hooks.first('beforeOrganizationCommand', { d, name, args, fail })
    if (extensionRefusal) return extensionRefusal
    const projectSave = args.collection === 'projects' && name === 'flow.entity.save'
    let heldProject
    if (projectSave) {
      heldProject = d.projects.find((p) => p.id === args.entityId)
      args = { ...args, access: args.access ?? heldProject?.access ?? 'workspace' }
      if (args.entityId && !heldProject) return fail('notFound', 'Dự án không còn tồn tại.')
      if (heldProject && !canManageScope(d, 'project', heldProject.id))
        return fail('forbidden', 'Cần quyền quản trị dự án.')
      if (
        !d.workspaces.some((w) => w.id === args.workspaceId && !w.archived) ||
        (!heldProject && !canManageScope(d, 'workspace', args.workspaceId))
      )
        return fail('validation', 'Chọn Workspace được phép quản lý trong cùng tổ chức.')
      if (heldProject && (heldProject.workspaceId !== args.workspaceId || heldProject.access !== args.access))
        return fail('validation', 'Dùng luồng chuyển Workspace hoặc quản lý quyền để thay đổi phạm vi.')
      if (!args.idempotencyKey) return fail('validation', 'Thiếu khóa thao tác.')
      const key = d.company.id + ':project:' + args.idempotencyKey
      if (replay.has(key)) return structuredClone(replay.get(key))
      const code = String(args.code ?? heldProject?.code ?? '')
        .trim()
        .toUpperCase()
      if (!/^[A-Z][A-Z0-9]{1,11}$/.test(code))
        return fail('validation', 'Kiểm tra mã dự án.', { code: 'Dùng 2–12 chữ/số, bắt đầu bằng chữ.' })
      if (d.projects.some((p) => p.id !== heldProject?.id && p.code.toUpperCase() === code))
        return fail('validation', 'Mã dự án đã được dùng.', { code: 'Chọn mã khác trong tổ chức.' })
      if (!['workspace', 'private'].includes(args.access)) return fail('validation', 'Chọn chế độ truy cập.')
      const ownerId = args.ownerId ?? heldProject?.ownerId ?? d.user.id
      const internal = (id) =>
        d.members.some((m) => m.id === id && m.status === 'active' && m.role !== 'guest')
      if (!internal(ownerId))
        return fail('validation', 'Chọn người phụ trách đang hoạt động.', {
          ownerId: 'Thành viên không hợp lệ.',
        })
      for (const field of ['memberIds', 'teamIds'])
        if (args[field] !== undefined && !Array.isArray(args[field]))
          return fail('validation', 'Danh sách cộng tác không hợp lệ.')
      if (
        (args.memberIds ?? []).some((id) => !internal(id)) ||
        (args.teamIds ?? []).some((id) => !d.teams.some((t) => t.id === id && t.companyId === d.company.id))
      )
        return fail('validation', 'Chỉ chọn người và Team trong tổ chức.')
      if (!['board', 'project-issues'].includes(args.defaultView ?? 'board'))
        return fail('validation', 'Màn hình mặc định không hợp lệ.')
      for (const key of ['projectStatuses', 'projectLabels', 'taskStatuses', 'taskLabels'])
        if (args[key] != null) {
          const error = validateCatalog(args[key], {
            statuses: key.endsWith('Statuses'),
            requireGroups: key === 'taskStatuses',
          })
          if (error) return fail('validation', error, { [key]: error })
          if (
            key !== 'projectStatuses' &&
            args[key].some((x) =>
              (key === 'taskStatuses' ? d.columns : d.tags).some(
                (existing) =>
                  existing.id === x.id &&
                  (existing.projectId !== heldProject?.id ||
                    existing.domain !== (key === 'projectLabels' ? 'project' : 'task') ||
                    !heldProject),
              ),
            )
          )
            return fail('validation', 'Bản tùy chỉnh cần ID riêng, không ghi đè thư viện tổ chức.')
        }
      // Returning to Company definitions is explicit and must retain every used value.
      for (const [key, collection, idsKey, domain] of [
        ['taskStatuses', 'columns', 'taskStatusIds', 'task'],
        ['taskLabels', 'tags', 'taskLabelIds', 'task'],
        ['projectLabels', 'tags', 'projectLabelIds', 'project'],
      ])
        if (args[key] === null && heldProject) {
          const globals = d[collection].filter(
            (item) => !item.projectId && !item.archived && (key === 'taskStatuses' || item.domain === domain),
          )
          const sources = heldProject[idsKey + 'Sources'] ?? {}
          const compatible = (id) => {
            const target = globals.find((item) => item.id === (sources[id] ?? id))
            const old = d[collection].find((item) => item.id === id)
            return target && (key !== 'taskStatuses' || target.kind === old?.kind)
          }
          const used =
            key === 'projectLabels'
              ? (heldProject.tags ?? [])
              : d.tasks
                  .filter((task) => task.projectId === heldProject.id)
                  .flatMap((task) => (key === 'taskStatuses' ? [task.status] : (task.tags ?? [])))
          if (key === 'taskStatuses')
            used.push(
              ...d.views
                .filter((view) => view.projectId === heldProject.id && view.status && view.status !== 'all')
                .map((view) => view.status),
            )
          if (used.some((id) => !compatible(id)))
            return fail('in_use', 'A used definition has no compatible active Company source.', {
              [key]: 'in_use',
            })
        }
      const labelIds = [...(args.projectLabels ?? []), ...(args.taskLabels ?? [])].map((x) => x.id)
      if (new Set(labelIds).size !== labelIds.length)
        return fail('validation', 'Nhãn dự án và nhãn công việc cần ID riêng.')
      for (const [key, oldCatalog] of [
        ['taskStatuses', taskColumns(d, heldProject?.id)],
        ['taskLabels', taskTags(d, heldProject?.id)],
      ])
        if (args[key]) {
          const sources = args[key].filter((x) => x.sourceId).map((x) => x.sourceId)
          if (
            new Set(sources).size !== sources.length ||
            sources.some((id) => !oldCatalog.some((c) => c.id === id))
          )
            return fail('validation', 'Nguồn sao chép không thuộc bộ cấu hình hiện tại.')
          if (heldProject) {
            const used = d.tasks.filter((t) => t.projectId === heldProject.id)
            const replacement = (id) => args[key].find((c) => c.id === id || c.sourceId === id)
            if (key === 'taskStatuses' && used.some((t) => !replacement(t.status)))
              return fail('validation', 'Không xóa trạng thái đang được công việc sử dụng.')
            if (key === 'taskStatuses' && used.some((t) => replacement(t.status).kind !== statusKind(d, t)))
              return fail('validation', 'Không đổi nhóm của trạng thái đang được sử dụng.')
            if (key === 'taskLabels' && used.some((t) => (t.tags ?? []).some((id) => !replacement(id))))
              return fail('validation', 'Không xóa nhãn đang được công việc sử dụng.')
          }
        }
      if (
        !(args.projectStatuses ?? projectStatuses(heldProject)).some(
          (x) => x.id === (args.state ?? 'planned'),
        )
      )
        return fail('validation', 'Trạng thái dự án không hợp lệ.')
      if (
        args.tags !== undefined &&
        (!Array.isArray(args.tags) ||
          args.tags.some(
            (id) =>
              !(args.projectLabels ?? projectTags(d, heldProject)).some(
                (t) => t.id === id && (!t.archived || heldProject?.tags?.includes(id)),
              ),
          ))
      )
        return fail('validation', 'Nhãn không hợp lệ.')
      for (const key of ['start', 'end'])
        if (
          args[key] &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(args[key]) ||
            !Number.isFinite(Date.parse(args[key])) ||
            new Date(args[key]).toISOString().slice(0, 10) !== args[key])
        )
          return fail('validation', 'Ngày không hợp lệ.', { [key]: 'Nhập ngày hợp lệ.' })
      if (args.start && args.end && args.end < args.start)
        return fail('validation', 'Ngày mục tiêu phải từ ngày bắt đầu trở đi.', {
          end: 'Không được trước ngày bắt đầu.',
        })
      if (args.sprintCadence !== undefined && !validCadence(args.sprintCadence))
        return fail('validation', 'Nhịp sprint không hợp lệ.', {
          sprintCadence: 'Chọn 1–4 tuần và một ngày bắt đầu.',
        })
      if (heldProject && args.sprintCadence === null && activeSprint(d, heldProject.id))
        return fail('validation', 'Đóng sprint đang chạy trước khi chuyển dự án sang Kanban.', {
          sprintCadence: 'Còn sprint đang chạy.',
        })
      const cadence =
        args.sprintCadence !== undefined
          ? args.sprintCadence
          : heldProject
            ? sprintCadence(heldProject)
            : DEFAULT_CADENCE
      args = {
        ...args,
        code,
        ownerId,
        defaultView: args.defaultView ?? 'board',
        sprintCadence: cadence && { weeks: cadence.weeks, weekday: cadence.weekday },
      }
    }
    if (
      ['flow.issue.save', 'flow.issue.assignSprint'].includes(name) &&
      args.sprint &&
      args.sprint !== 'Backlog'
    ) {
      const projectId = args.projectId ?? targetTask?.projectId
      if (sprintCadence(d.projects.find((p) => p.id === projectId)) === null)
        return fail('validation', 'Dự án này làm theo Kanban, không gán sprint.')
      if (!d.sprints.some((s) => s.projectId === projectId && s.title === args.sprint))
        return fail('validation', 'Sprint phải thuộc cùng dự án.')
    }
    if (
      name === 'flow.issue.save' &&
      args.epic &&
      !d.epics.some((e) => e.id === args.epic && e.projectId === (targetTask?.projectId ?? args.projectId))
    )
      return fail('validation', 'Epic phải thuộc cùng dự án.')
    if (name === 'flow.entity.save' && args.collection === 'sprints') {
      const project = d.projects.find((p) => p.id === args.projectId),
        held = d.sprints.find((s) => s.id === args.entityId),
        title = String(args.title ?? '').trim()
      if (!project) return fail('validation', 'Chọn dự án cho sprint.')
      if (!held && sprintCadence(project) === null)
        return fail('validation', 'Dự án này làm theo Kanban. Bật sprint trong hồ sơ dự án trước.')
      if (
        d.sprints.some(
          (s) =>
            s.projectId === project.id &&
            s.id !== held?.id &&
            s.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase(),
        )
      )
        return fail('validation', 'Tên sprint đã có trong dự án.', { title: 'Chọn tên khác.' })
      const clash =
        args.start && args.end ? overlappingSprint(d, project.id, args.start, args.end, held?.id) : null
      if (clash)
        return fail('validation', `Trùng lịch với ${clash.title} (${clash.start} → ${clash.end}).`, {
          start: 'Chọn ngày sau khi sprint kia kết thúc.',
        })
    }
    const response = session.call(name, args)
    if (response.value?.ok !== false && projectSave) {
      const p = d.projects.find((p) => p.id === response.value.id)
      if (p) {
        const priorProjectTags = [...(p.tags ?? [])]
        Object.assign(p, {
          companyId: d.company.id,
          workspaceId: args.workspaceId,
          access: args.access,
          ownerId: args.ownerId,
          outcome: args.outcome ?? '',
          defaultView: args.defaultView,
          state: args.state ?? 'planned',
          tags: [...new Set(args.tags ?? [])],
          sprintCadence: args.sprintCadence,
        })
        // Convert inherited definitions only inside this project, preserving semantic state.
        const remap = (key, idsKey) =>
          new Map(
            args[key] === null
              ? (p[idsKey] ?? []).map((id) => [id, p[idsKey + 'Sources']?.[id] ?? id])
              : (args[key] ?? []).filter((item) => item.sourceId).map((item) => [item.sourceId, item.id]),
          )
        const statusMap = remap('taskStatuses', 'taskStatusIds')
        const labelMap = remap('taskLabels', 'taskLabelIds')
        if (args.projectLabels === null) {
          const projectLabelMap = remap('projectLabels', 'projectLabelIds')
          p.tags = (args.tags ?? priorProjectTags).map((id) => projectLabelMap.get(id) ?? id)
        }
        for (const task of d.tasks.filter((t) => t.projectId === p.id)) {
          const status = statusMap.get(task.status) ?? task.status,
            tags = (task.tags ?? []).map((id) => labelMap.get(id) ?? id)
          if (status !== task.status || tags.some((id, i) => id !== task.tags[i])) {
            const changes = [
              ...(status !== task.status ? [{ field: 'status', before: task.status, after: status }] : []),
              ...(tags.some((id, i) => id !== task.tags[i])
                ? [{ field: 'tags', before: [...(task.tags ?? [])], after: tags }]
                : []),
            ]
            task.status = status
            task.tags = tags
            task.version++
            d.history.unshift({
              id: randomUUID(),
              taskId: task.id,
              projectId: task.projectId,
              person: d.user.name,
              text: 'Project catalog remapped',
              kind: 'catalog_remapped',
              changes,
              version: task.version,
              time: (today || FIXTURE_ANCHOR) + 'T00:00:00.000Z',
            })
          }
        }
        for (const view of d.views.filter((v) => v.projectId === p.id))
          view.status = statusMap.get(view.status) ?? view.status
        hooks.notify('remapCatalog', { d, p, statusMap })
        if (args.projectStatuses)
          p.projectStatuses = args.projectStatuses.map((x) => ({
            id: x.id,
            title: x.title.trim(),
            color: x.color,
            kind: x.kind,
          }))
        for (const [key, collection, idsKey, domain] of [
          ['taskStatuses', 'columns', 'taskStatusIds', 'task'],
          ['taskLabels', 'tags', 'taskLabelIds', 'task'],
          ['projectLabels', 'tags', 'projectLabelIds', 'project'],
        ])
          if (args[key] !== undefined) {
            const oldIds = p[idsKey] ?? [],
              sources = p[idsKey + 'Sources'] ?? {}
            const provenance = Object.fromEntries(
              (args[key] ?? []).map((item) => [
                item.id,
                item.sourceId
                  ? (sources[item.sourceId] ??
                    (d[collection].find((source) => source.id === item.sourceId)?.projectId
                      ? null
                      : item.sourceId))
                  : (sources[item.id] ?? null),
              ]),
            )
            d[collection] = d[collection].filter((x) => !oldIds.includes(x.id))
            const entries = (args[key] ?? []).map((x) => ({
              id: x.id,
              title: x.title.trim(),
              label: x.title.trim(),
              color: x.color,
              ...(key === 'taskStatuses' ? { kind: x.kind } : {}),
              projectId: p.id,
              domain,
            }))
            d[collection].push(...entries)
            p[idsKey] = args[key] === null ? null : entries.map((x) => x.id)
            p[idsKey + 'Sources'] = args[key] === null ? {} : provenance
          }
        const grant = (subjectType, subjectId, role) => {
          const held = d.grants.find(
            (g) =>
              g.scope === 'project' &&
              g.targetId === p.id &&
              g.subjectType === subjectType &&
              g.subjectId === subjectId,
          )
          if (held) {
            if (role === 'admin') held.role = role
          } else
            d.grants.push({
              id: crypto.randomUUID(),
              scope: 'project',
              targetId: p.id,
              subjectType,
              subjectId,
              role,
            })
        }
        if (!heldProject) {
          grant('user', d.user.id, 'admin')
          for (const id of args.memberIds ?? []) grant('user', id, 'editor')
          for (const id of args.teamIds ?? []) grant('team', id, 'editor')
        }
        grant('user', args.ownerId, 'admin')
        d.organizationRevision++
        replay.set(d.company.id + ':project:' + args.idempotencyKey, structuredClone(response))
      }
    }
    if (response.value?.ok !== false && args.collection === 'pages' && name === 'flow.entity.save') {
      const p = d.pages.find((p) => p.id === response.value.id)
      if (p) {
        p.ownerId ??= d.user.id
        p.readerIds ??= []
        if (!p.projectId) p.workspaceId ??= args.workspaceId
      }
    }
    return response
  }
  return { call, scenario, sessions }
}
