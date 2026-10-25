import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeadlinePreview } from '../client/deadline-preview.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

test('deadline previews replace days, retry and reject stale reads after context/reset', async () => {
  let data = { deadlineCounts: { today: '2026-10-13' } },
    scope = 'one',
    refused = 0
  const pending = []
  const preview = createDeadlinePreview({
    data: () => data,
    scope: () => scope,
    workspaceId: () => 'w',
    read: (input, signal) =>
      new Promise((resolve, reject) => pending.push({ input, signal, resolve, reject })),
    refused: () => refused++,
  })
  const first = preview.load('overdue')
  assert.deepEqual(pending[0].input, {
    workspaceId: 'w',
    unfinishedOnly: true,
    sort: 'due',
    limit: 8,
    dueBefore: '2026-10-13',
  })
  const next = preview.load('2026-10-14')
  assert.equal(pending[0].signal.aborted, true)
  pending[0].resolve({ tasks: [{ id: 'old' }], total: 9 })
  await first
  assert.equal(preview.state().id, '2026-10-14')
  assert.equal(preview.state().loading, true)
  pending[1].reject(new Error('offline'))
  await next
  assert.ok(preview.state().error)
  const retry = preview.load('2026-10-14')
  pending[2].resolve({ tasks: [{ id: 'today' }], total: 99 })
  await retry
  assert.equal(preview.state().total, 99)
  const changed = preview.load('overdue')
  scope = 'two'
  data = { ...data }
  pending[3].resolve({ tasks: [{ id: 'wrong-company' }], total: 1 })
  await changed
  assert.deepEqual(preview.state().tasks, [])
  const denied = preview.load('overdue')
  pending[4].reject({ code: 'forbidden' })
  await denied
  assert.equal(refused, 1)
  const late = preview.load('overdue')
  preview.dispose()
  pending[5].resolve({ tasks: [{ id: 'late' }], total: 1 })
  await late
  assert.equal(preview.state(), null)
})

test('Atlas deadlines share native count/window semantics including cursor and validation', () => {
  const session = createOrganizationSession(),
    data = session.sessions.get('demo').data
  const template = data.tasks.find((t) => t.projectId === 'core')
  data.tasks = Array.from({ length: 70 }, (_, i) => ({
    ...structuredClone(template),
    id: 'DUE-' + i,
    key: 'DUE-' + i,
    archived: false,
    status: 'todo',
    dueDate: '2020-01-01',
    order: i,
  }))
  const call = (name, input) => session.call(name, { companyId: 'demo', ...input }).value
  const page = call('flow.issue.list', {
    workspaceId: 'product',
    unfinishedOnly: true,
    dueBefore: '2026-10-13',
    limit: 8,
  })
  assert.equal(page.tasks.length, 8)
  assert.equal(page.total, 70)
  assert.equal(call('flow.issue.list', { unfinishedOnly: true, mine: true }).ok, false)
  assert.equal(
    call('flow.issue.list', {
      workspaceId: 'product',
      unfinishedOnly: true,
      dueBefore: '2026-10-12',
      limit: 8,
      cursor: page.cursor,
    }).ok,
    false,
  )
  assert.equal(call('flow.issue.list', { dueBefore: '2026-02-30' }).ok, false)
  assert.equal(call('flow.issue.list', { dueBefore: '2026-10-13', includeUndated: true }).ok, false)
  const overview = call('flow.workspace.bootstrap', { route: 'workspace-overview', workspaceId: 'product' })
  assert.equal(overview.deadlineCounts.overdue, 70)
  assert.equal(Object.keys(overview.deadlineCounts.days).length, 14)
})
