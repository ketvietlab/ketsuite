import { taskTags, taskColumns } from '@ketvietlab/flow-client/project-catalogs.mjs'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
const read = (s, args = {}) => s.call('flow.workspace.bootstrap', { companyId: 'demo', ...args }).value
// Grants as the server stores them; the bootstrap carries only the actor's own.
const stored = (s) => structuredClone(s.sessions.get('demo').data.grants)
const command = (s, action, args = {}) =>
  s.call('flow.organization.command', {
    companyId: 'demo',
    action,
    expectedRevision: read(s).organizationRevision,
    idempotencyKey: crypto.randomUUID(),
    ...args,
  }).value
test('Company datasets and direct links stay isolated; Workspace is inside Company', () => {
  const s = createOrganizationSession(),
    a = read(s),
    b = read(s, { companyId: 'north' })
  assert.equal(a.company.id, 'demo')
  assert.equal(b.company.id, 'north')
  assert.ok(b.projects.every((p) => p.companyId === 'north' && p.workspaceId.startsWith('north-')))
  assert.ok(b.tasks.every((t) => t.id.startsWith('north-')))
  assert.equal(read(s, { companyId: 'north', projectId: 'core' }).errors[0].code, 'forbidden')
  const link = read(s, { recordId: 'KV-129', route: 'issue', workspaceId: 'product' })
  assert.equal(link.context.projectId, 'ops')
  assert.equal(link.context.workspaceId, 'operations')
})
test('guest sees only its explicitly granted project; member cannot read private or unrelated projects', () => {
  const guest = createOrganizationSession('guest'),
    g = read(guest)
  assert.deepEqual(
    g.projects.map((p) => p.id),
    ['docs'],
  )
  assert.ok(g.tasks.every((t) => t.projectId === 'docs'))
  assert.ok(g.pages.every((p) => p.projectId === 'docs'))
  assert.equal(g.capabilities.write, false)
  assert.equal(g.sprints.length, 0)
  assert.equal(g.epics.length, 0)
  assert.equal(g.goals, undefined)
  assert.equal(g.github, undefined)
  assert.equal(read(guest, { recordId: 'KV-142' }).errors[0].code, 'forbidden')
  assert.equal(read(guest, { companyId: 'north' }).errors[0].code, 'forbidden')
  const member = read(createOrganizationSession('member'))
  assert.deepEqual(
    member.projects.map((p) => p.id),
    ['core'],
  )
  assert.equal(read(createOrganizationSession('revoked')).errors[0].code, 'revoked')
})
test('project move previews lost and gained inherited rights, rejects stale and cross-company targets, supports retaining access', () => {
  const s = createOrganizationSession(),
    args = { companyId: 'demo', projectId: 'core', targetWorkspaceId: 'operations' }
  const preview = s.call('flow.project.move.preview', args).value
  assert.equal(preview.people.find((x) => x.id === 'bao').change, 'loss')
  assert.equal(preview.people.find((x) => x.id === 'ha').change, 'gain')
  assert.equal(preview.people[0].change, 'loss', 'people who lose access come first')
  assert.equal(preview.total, preview.people.length)
  assert.equal(preview.summary.loss, preview.people.filter((x) => x.change === 'loss').length)
  const kept = s
    .call('flow.project.move.preview', { ...args, preserve: true })
    .value.people.find((x) => x.id === 'bao')
  assert.equal(kept.change, 'same', 'keeping access keeps the old role')
  assert.ok(kept.after.sources.some((x) => x.retained && x.scope === 'project'))
  assert.equal(
    s.call('flow.project.move.preview', { ...args, targetWorkspaceId: 'north-operations' }).value.errors[0]
      .code,
    'validation',
  )
  command(s, 'team.save', { title: 'QA' })
  assert.equal(
    command(s, 'project.move', { ...args, id: 'core', expectedRevision: preview.revision }).errors[0].code,
    'conflict',
  )
  assert.notEqual(command(s, 'project.move', { ...args, id: 'core', preserve: true }).ok, false)
  const d = read(s)
  assert.equal(d.projects.find((p) => p.id === 'core').workspaceId, 'operations')
  assert.ok(stored(s).some((g) => g.targetId === 'core' && g.subjectId === 'bao' && g.subjectType === 'user'))
  assert.equal(d.tasks.find((t) => t.id === 'KV-142').projectId, 'core')
})
test('access change previews list only changed people, losses first, and page on the server', () => {
  const s = createOrganizationSession(),
    d = s.sessions.get('demo').data,
    core = d.projects.find((p) => p.id === 'core'),
    workspace = d.workspaces.find((w) => w.id === core.workspaceId),
    template = d.members.find((m) => m.role === 'member' && m.status === 'active')
  const preview = (args) => s.call('flow.access.preview', { companyId: 'demo', ...args }).value
  const flipped = preview({
    change: 'project-access',
    projectId: 'core',
    access: core.access === 'workspace' ? 'private' : 'workspace',
  })
  assert.ok(flipped.total > 0)
  for (const row of flipped.items) assert.notEqual(row.before.role, row.after.role)
  // An internal Workspace with many people: closing it is a long list of losses.
  workspace.access = 'internal'
  core.access = 'workspace'
  for (let n = 0; n < 70; n++)
    d.members.push({
      ...structuredClone(template),
      id: `bulk-${n}`,
      name: `Bulk ${String(n).padStart(2, '0')}`,
      email: `bulk-${n}@example.test`,
    })
  const args = { change: 'workspace-access', workspaceId: workspace.id, access: 'restricted' }
  const first = preview(args)
  assert.ok(first.total > 70)
  assert.equal(first.items.length, 50)
  assert.equal(first.counts.loss, first.total)
  const next = preview({ ...args, cursor: first.cursor })
  assert.equal(
    new Set([...first.items, ...next.items].map((r) => r.id + r.projectId)).size,
    Math.min(100, first.total),
  )
  d.members.push({
    ...structuredClone(template),
    id: 'bulk-late',
    name: 'Bulk late',
    email: 'late@example.test',
  })
  assert.equal(preview({ ...args, cursor: first.cursor }).errors[0].code, 'conflict')
  assert.equal(
    preview({ change: 'project-access', projectId: 'core', access: 'internal' }).errors[0].code,
    'validation',
  )
})
test('short creation forms, invitations, revocation and archive enforce prototype boundaries', () => {
  const s = createOrganizationSession()
  const ws = command(s, 'workspace.save', { title: 'Nội dung', access: 'restricted' })
  // The native server knows only internal and restricted Workspaces; the prototype refuses the rest.
  const refused = command(s, 'workspace.save', { title: 'Cũ', access: 'private' })
  assert.equal(refused.ok, false)
  assert.ok(refused.fields.access)
  assert.ok(ws.id)
  const created = s.call('flow.entity.save', {
    companyId: 'demo',
    workspaceId: ws.id,
    collection: 'projects',
    title: 'Tạp chí',
    code: 'MAG',
    idempotencyKey: 'create-mag',
  }).value
  assert.equal(read(s).projects.find((p) => p.id === created.id).workspaceId, ws.id)
  assert.equal(command(s, 'workspace.archive', { id: ws.id }).errors[0].code, 'activeProjects')
  assert.equal(
    command(s, 'member.invite', { email: 'a@example.test', role: 'guest' }).errors[0].code,
    'validation',
  )
  command(s, 'member.invite', { email: 'a@example.test', role: 'guest', projectId: 'docs' })
  assert.equal(read(s).invitations.at(-1).status, 'pending')
  const guest = createOrganizationSession('guest')
  assert.equal(command(guest, 'workspace.save', { title: 'No' }).errors[0].code, 'forbidden')
  const viewer = createOrganizationSession('readonly')
  assert.equal(command(viewer, 'workspace.save', { title: 'No' }).errors[0].code, 'forbidden')
})
test('removing one grant retains other sources; guest grants cannot target Workspace', () => {
  const s = createOrganizationSession()
  command(s, 'access.grant', {
    scope: 'project',
    targetId: 'core',
    subjectType: 'user',
    subjectId: 'bao',
    role: 'viewer',
  })
  command(s, 'access.revoke', { id: 'g1' })
  const preview = s.call('flow.project.move.preview', {
    companyId: 'demo',
    projectId: 'core',
    targetWorkspaceId: 'operations',
  }).value
  assert.equal(preview.people.find((x) => x.id === 'bao').before.role, 'viewer')
  assert.equal(
    command(s, 'access.grant', {
      scope: 'workspace',
      targetId: 'product',
      subjectType: 'user',
      subjectId: 'guest',
      role: 'viewer',
    }).errors[0].code,
    'validation',
  )
})

test('revoked membership overrides every source and archived Workspace falls back safely', () => {
  const s = createOrganizationSession()
  command(s, 'member.update', { id: 'bao', role: 'member', revoke: true })
  s.sessions.get('demo').data.user = { id: 'bao', name: 'Bảo' }
  assert.equal(read(s).errors[0].code, 'revoked')
  const fresh = createOrganizationSession()
  command(fresh, 'workspace.archive', { id: 'lab' })
  assert.equal(read(fresh, { workspaceId: 'lab' }).context.workspaceId, 'product')
  assert.equal(read(fresh, { workspaceId: 'foreign' }).errors[0].code, 'forbidden')
})

test('global task lists exclude inactive project statuses but preserve scoped overrides', () => {
  const session = createOrganizationSession('baseline', 'all-issues')
  const raw = session.sessions.get('demo').data
  raw.columns.push({ id: 'unused-project-state', label: 'Unused', projectId: 'core', kind: 'todo' })
  const before = read(session, { route: 'all-issues' })
  assert.equal(
    before.columns.some((column) => column.id === 'unused-project-state'),
    false,
  )
  raw.projects.find((project) => project.id === 'core').taskStatusIds = ['unused-project-state']
  const active = read(session, { route: 'all-issues' })
  assert.equal(
    active.columns.some((column) => column.id === 'unused-project-state'),
    true,
  )
  const other = read(session, { route: 'all-issues', workspaceId: 'operations' })
  assert.equal(
    other.columns.some((column) => column.id === 'unused-project-state'),
    false,
  )
  const catalog = read(session, { route: 'settings', projectId: 'core' })
  assert.equal(
    catalog.columns.some((column) => column.id === 'unused-project-state'),
    true,
  )
})

test('company catalog paging isolates definitions, pins deep links and rejects stale cursors', () => {
  const session = createOrganizationSession('baseline', 'organization-settings')
  const raw = session.sessions.get('demo').data
  const prior = raw.types.filter((item) => !item.projectId && !item.archived).length
  for (let i = 0; i < 205; i++)
    raw.types.push({
      id: `library-${String(i).padStart(3, '0')}`,
      title: `Library ${i}`,
      sequence: 2000 + i,
      version: 1,
    })
  raw.types.push({
    id: 'private-project-type',
    title: 'Private',
    projectId: 'unreadable-project',
    sequence: -1,
  })
  assert.equal(session.call('flow.catalog.list', { kind: '__proto__' }).value.errors[0].code, 'validation')
  const first = session.call('flow.catalog.list', { kind: 'type' }).value
  assert.equal(first.items.length, 50)
  assert.equal(first.total, prior + 205)
  assert.ok(first.cursor.length < 2048)
  assert.equal(
    first.items.some((item) => item.projectId),
    false,
  )
  const all = [...first.items]
  let cursor = first.cursor
  while (cursor) {
    const page = session.call('flow.catalog.list', { kind: 'type', cursor }).value
    all.push(...page.items)
    cursor = page.cursor
  }
  assert.equal(new Set(all.map((item) => item.id)).size, first.total)
  const screen = read(session, { route: 'organization-settings' })
  assert.equal(screen.types.length, 50)
  assert.equal(screen.catalogPages.types.total, first.total)
  const edit = read(session, { route: 'type-edit', recordId: 'library-204' })
  assert.equal(edit.types.find((item) => item.id === 'library-204').title, 'Library 204')
  assert.equal(
    read(session, { route: 'type-edit', recordId: 'private-project-type' }).types.some(
      (item) => item.id === 'private-project-type',
    ),
    false,
  )
  assert.equal(
    session.call('flow.catalog.list', { kind: 'tag', cursor: first.cursor }).value.errors[0].code,
    'conflict',
  )
  assert.equal(
    session.call('flow.catalog.list', { kind: 'type', cursor: 'x'.repeat(2049) }).value.errors[0].code,
    'validation',
  )
  raw.tasks[0].version++
  assert.equal(
    session.call('flow.catalog.list', { kind: 'type', cursor: first.cursor }).value.errors[0].code,
    'conflict',
  )
  assert.equal(
    createOrganizationSession('guest').call('flow.catalog.list', { kind: 'type' }).value.errors[0].code,
    'forbidden',
  )
})

test('task activity pages include older entries and fence cursors', () => {
  const session = createOrganizationSession(),
    d = session.sessions.get('demo').data,
    task = d.tasks[0]
  for (const kind of ['comments', 'history'])
    d[kind] = Array.from({ length: 121 }, (_, i) => ({
      id: `activity-${String(i).padStart(3, '0')}`,
      taskId: task.id,
      person: 'Test actor',
      text: `Entry ${i}`,
      time: '2026-10-14T00:00:00.000Z',
    }))
  const call = (name, input) => session.call(name, { companyId: 'demo', id: task.id, ...input }).value
  const detail = call('flow.issue.detail', {}),
    bootstrap = read(session, { route: 'issue', recordId: task.id })
  assert.deepEqual(bootstrap.comments, detail.comments)
  assert.deepEqual(
    bootstrap.tasks.find((item) => item.id === task.id).activityPages,
    detail.task.activityPages,
  )
  for (const kind of ['comments', 'history']) {
    const page = detail.task.activityPages[kind],
      ids = detail[kind].map((item) => item.id)
    assert.equal(ids.length, 50)
    assert.equal(page.total, 121)
    let cursor = page.cursor
    while (cursor) {
      const next = call('flow.issue.activity', { kind, cursor, limit: 23 })
      assert.ok(next.items, JSON.stringify(next))
      ids.push(...next.items.map((item) => item.id))
      cursor = next.cursor
    }
    assert.equal(new Set(ids).size, 121)
    assert.equal(ids.length, 121)
    assert.equal(
      call('flow.issue.activity', { kind: kind === 'history' ? 'comments' : 'history', cursor: page.cursor })
        .errors[0].code,
      'conflict',
    )
  }
  d.comments.push({ id: 'new', taskId: task.id, time: '2026-10-15T00:00:00.000Z', text: 'New' })
  assert.equal(
    call('flow.issue.activity', { kind: 'comments', cursor: detail.task.activityPages.comments.cursor })
      .errors[0].code,
    'conflict',
  )
  assert.equal(
    call('flow.issue.activity', { kind: 'comments', cursor: 'x'.repeat(2049) }).errors[0].code,
    'validation',
  )
  assert.equal(
    createOrganizationSession('guest').call('flow.issue.activity', {
      companyId: 'demo',
      id: 'KV-142',
      kind: 'history',
    }).value.errors[0].code,
    'forbidden',
  )
})

test('project label remap audits task version and before/after exactly once', () => {
  const s = createOrganizationSession(),
    d = s.sessions.get('demo').data
  const task = d.tasks.find((item) => item.tags?.length && item.projectId === 'core'),
    project = d.projects.find((item) => item.id === task.projectId)
  const before = [...task.tags],
    version = task.version
  const taskLabels = taskTags(d, project.id).map((item, i) => ({
    id: `audit-label-${i}`,
    sourceId: item.id,
    title: item.title,
    color: item.color,
  }))
  const input = {
    companyId: 'demo',
    id: project.id,
    title: project.title,
    code: project.code,
    workspaceId: project.workspaceId,
    expectedVersion: project.version,
    expectedRevision: read(s).organizationRevision,
    idempotencyKey: 'audit-project-remap',
    taskLabels,
  }
  const result = s.call('flow.project.save', input).value
  assert.notEqual(result.ok, false, JSON.stringify(result))
  const detail = s.call('flow.issue.detail', { companyId: 'demo', id: task.id }).value
  const entry = detail.history.find((item) => item.kind === 'catalog_remapped')
  assert.equal(entry.version, version + 1)
  assert.deepEqual(entry.changes, [
    { field: 'tags', before, after: before.map((id) => taskLabels.find((item) => item.sourceId === id).id) },
  ])
  assert.deepEqual(s.call('flow.project.save', input).value, result)
  assert.equal(
    s
      .call('flow.issue.detail', { companyId: 'demo', id: task.id })
      .value.history.filter((item) => item.kind === 'catalog_remapped').length,
    1,
  )
  const restore = {
    ...input,
    taskLabels: null,
    expectedVersion: project.version,
    expectedRevision: read(s).organizationRevision,
    idempotencyKey: 'audit-project-reset',
  }
  const source = d.tags.find((label) => label.id === before[0])
  source.archived = true
  assert.equal(s.call('flow.project.save', restore).value.errors[0].code, 'in_use')
  source.archived = false
  const reset = s.call('flow.project.save', restore).value
  assert.notEqual(reset.ok, false, JSON.stringify(reset))
  const restored = s.call('flow.issue.detail', { companyId: 'demo', id: task.id }).value
  assert.deepEqual(restored.task.tags, before)
  assert.equal(restored.task.version, version + 2)
  assert.ok(restored.history.some((item) => item.kind === 'catalog_remapped' && item.version === version + 2))
  assert.deepEqual(s.call('flow.project.save', restore).value, reset)
})

test('resetting status overrides preserves tasks and saved views; missing source refuses atomically', () => {
  const s = createOrganizationSession(),
    d = s.sessions.get('demo').data
  const project = d.projects.find((item) => item.id === 'core'),
    task = d.tasks.find((item) => item.projectId === project.id)
  const original = task.status,
    version = task.version
  d.views.push({ id: 'audit-view', projectId: project.id, status: original, version: 1 })
  const statuses = taskColumns(d, project.id).map((item, i) => ({
    id: `audit-state-${i}`,
    sourceId: item.id,
    title: item.title ?? item.label,
    kind: item.kind,
    color: item.color ?? 'neutral',
  }))
  const input = {
    companyId: 'demo',
    id: project.id,
    title: project.title,
    code: project.code,
    workspaceId: project.workspaceId,
    expectedVersion: project.version,
    expectedRevision: read(s).organizationRevision,
    taskStatuses: statuses,
    idempotencyKey: 'audit-state-clone',
  }
  const saved = s.call('flow.project.save', input).value
  assert.notEqual(saved.ok, false, JSON.stringify({ saved, statuses }))
  const clone = statuses.find((item) => item.sourceId === original).id
  assert.equal(task.status, clone)
  assert.equal(d.views.find((item) => item.id === 'audit-view').status, clone)
  const restore = {
    ...input,
    expectedVersion: project.version,
    expectedRevision: read(s).organizationRevision,
    taskStatuses: null,
    idempotencyKey: 'audit-state-reset',
  }
  const source = d.columns.find((item) => item.id === original)
  source.archived = true
  assert.equal(s.call('flow.project.save', restore).value.errors[0].code, 'in_use')
  assert.equal(task.status, clone)
  assert.equal(task.version, version + 1)
  source.archived = false
  assert.notEqual(s.call('flow.project.save', restore).value.ok, false)
  assert.equal(task.status, original)
  assert.equal(task.version, version + 2)
  assert.equal(d.views.find((item) => item.id === 'audit-view').status, original)
})

test('project label inheritance reset retains selected project labels', () => {
  const s = createOrganizationSession(),
    d = s.sessions.get('demo').data,
    p = d.projects.find((item) => item.id === 'core')
  d.tags.push({ id: 'audit-project-source', title: 'Project marker', domain: 'project', color: 'blue' })
  const base = { companyId: 'demo', id: p.id, title: p.title, code: p.code, workspaceId: p.workspaceId }
  const cloned = s.call('flow.project.save', {
    ...base,
    expectedVersion: p.version,
    expectedRevision: read(s).organizationRevision,
    idempotencyKey: 'project-label-clone',
    projectLabels: [
      { id: 'audit-project-local', sourceId: 'audit-project-source', title: 'Project marker', color: 'blue' },
    ],
    tags: ['audit-project-local'],
  }).value
  assert.notEqual(cloned.ok, false, JSON.stringify(cloned))
  assert.deepEqual(p.tags, ['audit-project-local'])
  const reset = s.call('flow.project.save', {
    ...base,
    expectedVersion: p.version,
    expectedRevision: read(s).organizationRevision,
    idempotencyKey: 'project-label-reset',
    projectLabels: null,
  }).value
  assert.notEqual(reset.ok, false, JSON.stringify(reset))
  assert.deepEqual(p.tags, ['audit-project-source'])
  assert.equal(p.projectLabelIds, null)
})
