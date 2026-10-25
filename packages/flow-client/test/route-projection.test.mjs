import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { taskUsers } from '@ketvietlab/flow-client/task-assignees.mjs'

const read = (s, args = {}) => s.call('flow.workspace.bootstrap', { companyId: 'demo', ...args }).value
const detail = (s, id) => s.call('flow.issue.detail', { companyId: 'demo', id })

test('a screen read carries task summaries without bodies, discussion or history', () => {
  const s = createOrganizationSession('baseline', 'my-work', { profile: 'realistic' }),
    raw = s.sessions.get('demo').data
  assert.ok(raw.comments.length && raw.history.length && raw.tasks.some((t) => t.description))
  for (const route of ['my-work', 'all-issues', 'board']) {
    const d = read(s, { route })
    assert.ok(d.tasks.length > 0, route)
    assert.ok(
      d.tasks.every((t) => t.summary === true && !('description' in t) && !('descriptionDoc' in t)),
      route,
    )
    assert.deepEqual(d.comments, [], route)
    assert.deepEqual(d.history, [], route)
  }
})

test('the record a route opens keeps its body, discussion and history, and the detail read agrees', () => {
  const s = createOrganizationSession('baseline', 'issue', { profile: 'realistic' }),
    raw = s.sessions.get('demo').data
  const id = raw.tasks.find(
    (t) =>
      t.description &&
      raw.comments.some((c) => c.taskId === t.id) &&
      raw.history.some((h) => h.taskId === t.id),
  ).id
  const d = read(s, { route: 'issue', recordId: id }),
    task = d.tasks.find((t) => t.id === id)
  assert.equal(task.summary, undefined)
  assert.equal(task.description, raw.tasks.find((t) => t.id === id).description)
  assert.ok(d.tasks.filter((t) => t.id !== id).every((t) => t.summary))
  assert.ok(d.comments.length && d.comments.every((c) => c.taskId === id))
  assert.ok(d.history.length && d.history.every((h) => h.taskId === id))
  const one = detail(s, id)
  assert.notEqual(one.value.ok, false)
  assert.deepEqual(one.value.task, task)
  assert.deepEqual(one.value.comments, d.comments)
  assert.deepEqual(one.value.history, d.history)
})

test('a summary names only the assignees the reader cannot find among members', () => {
  for (const s of [createOrganizationSession(), createOrganizationSession('guest')]) {
    const d = read(s, { route: 'all-issues' }),
      members = new Set(d.members.map((m) => m.id))
    assert.ok(d.tasks.every((t) => (t.assignees ?? []).every((u) => !members.has(u.id))))
    for (const t of d.tasks) assert.deepEqual(taskUsers(d, t), detail(s, t.id).value.task.assignees, t.id)
  }
  // A guest sees only themselves among members, so other assignees must still arrive by name.
  assert.ok(
    read(createOrganizationSession('guest'), { route: 'all-issues' }).tasks.some((t) => t.assignees?.length),
  )
})

test('the overview read keeps the latest activity of each Workspace only', () => {
  const s = createOrganizationSession('baseline', 'workspace-overview', { profile: 'realistic' }),
    raw = s.sessions.get('demo').data,
    d = read(s, { route: 'workspace-overview' })
  const workspaceOf = new Map(raw.projects.map((p) => [p.id, p.workspaceId])),
    taskWorkspace = new Map(
      raw.tasks.filter((t) => !t.archived).map((t) => [t.id, workspaceOf.get(t.projectId)]),
    )
  assert.ok(raw.history.length > d.history.length)
  for (const w of d.workspaces) {
    const latest = raw.history
      .filter((h) => taskWorkspace.get(h.taskId) === w.id)
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, 6)
    assert.deepEqual(
      d.history.filter((h) => taskWorkspace.get(h.taskId) === w.id),
      latest,
      w.id,
    )
  }
})

test('the detail read follows the same access as the screen read', () => {
  const guest = createOrganizationSession('guest')
  const visible = read(guest).tasks[0].id
  assert.equal(detail(guest, visible).value.task.id, visible)
  assert.equal(detail(guest, 'KV-142').value.ok, false)
  assert.equal(detail(guest, 'KV-142').value.errors[0].code, 'forbidden')
  const s = createOrganizationSession()
  assert.equal(detail(s, 'KV-nope').value.errors[0].code, 'not_found')
  const revision = s.sessions.get('demo').data.organizationRevision
  detail(s, 'KV-142')
  assert.equal(s.sessions.get('demo').data.organizationRevision, revision, 'a read records no change')
})

test('search still matches a body and a comment that screen reads no longer carry', () => {
  const s = createOrganizationSession(),
    raw = s.sessions.get('demo').data
  raw.tasks.find((t) => t.id === 'KV-129').description = 'Chỉ có trong mô tả: quỳnh-lam-độc-nhất'
  raw.comments.find((c) => c.taskId === 'KV-142').text = 'Chỉ có trong bình luận: thạch-anh-độc-nhất'
  const found = (query) =>
    s
      .call('flow.search', { companyId: 'demo', query })
      .value.groups.flatMap((g) => g.items)
      .map((x) => x.id)
  assert.ok(found('quynh-lam-doc-nhat').includes('task:KV-129'))
  assert.ok(found('thach-anh-doc-nhat').includes('task:KV-142'))
})
