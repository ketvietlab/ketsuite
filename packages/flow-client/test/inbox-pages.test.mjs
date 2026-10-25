import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

test('Atlas Inbox filters precede pagination and cursors stay in the recipient and filter scope', () => {
  const fixture = createOrganizationSession('baseline', 'inbox')
  const raw = fixture.sessions.get('demo').data,
    task = raw.tasks[0]
  task.status = raw.columns.find((column) => column.kind === 'todo').id
  raw.inbox = Array.from({ length: 61 }, (_, index) => ({
    id: 'notification-' + String(index).padStart(3, '0'),
    taskId: task.id,
    recipientId: raw.user.id,
    kind: index % 2 ? 'mention' : 'assignment',
    read: index % 3 === 0,
    actionNeeded: index % 2 === 0,
    createdAt: '2026-10-13T00:00:00.000Z',
  }))
  const call = (args) => fixture.call('flow.inbox.list', { companyId: 'demo', ...args }).value
  const first = call({ filter: 'mentions', limit: 10 })
  assert.equal(first.total, 30)
  assert.equal(first.items.length, 10)
  assert.ok(first.cursor)
  assert.equal(call({ filter: 'all', cursor: first.cursor }).errors[0].code, 'conflict')
  const ids = new Set(first.items.map((note) => note.id))
  let cursor = first.cursor
  while (cursor) {
    const next = call({ filter: 'mentions', limit: 10, cursor })
    for (const note of next.items) {
      assert.equal(ids.has(note.id), false)
      ids.add(note.id)
    }
    cursor = next.cursor
  }
  assert.equal(ids.size, 30)
  assert.equal(call({ filter: 'action' }).total, 31)
  assert.equal(call({ filter: 'unread' }).total, 40)
  assert.equal(call({ limit: 51 }).errors[0].code, 'validation')
})
