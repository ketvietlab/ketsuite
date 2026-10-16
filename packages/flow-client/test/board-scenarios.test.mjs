import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

test('board demo outcomes identify one task, a real blocker and a versioned successful move', () => {
  const read = (state) =>
    createOrganizationSession(state, 'board').call('flow.workspace.bootstrap', { companyId: 'demo' }).value
  const before = read('board-demo'),
    blocked = read('board-blocked'),
    success = read('board-success')
  const task = (data) => data.tasks.find((item) => item.id === 'KV-131')
  assert.equal(task(before).status, 'todo')
  assert.deepEqual(task(before).blockedBy, ['KV-151'])
  assert.deepEqual(task(blocked).blockedBy, ['KV-151'])
  assert.equal(blocked.tasks.find((item) => item.id === 'KV-151').status, 'progress')
  assert.equal(task(success).status, 'progress')
  assert.equal(task(success).version, task(before).version + 1)
  // History comes with the record, not with the board.
  const record = createOrganizationSession('board-success', 'board').call('flow.issue.detail', {
    companyId: 'demo',
    id: 'KV-131',
  }).value
  assert.ok(
    record.history.some(
      (entry) =>
        entry.taskId === 'KV-131' &&
        entry.changes?.some((change) => change.field === 'status' && change.after === 'progress'),
    ),
  )
})
