import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'

test('archive refuses blank and non-scalar reasons without changing task or history', () => {
  for (const reason of ['', '   ', null, ['a reason'], 42, { text: 'a reason' }]) {
    const session = createFixtureSession()
    const task = session.data.tasks.find((item) => item.id === 'KV-142')
    const before = structuredClone(session.data)
    const result = session.call('flow.issue.archive', {
      id: task.id,
      expectedVersion: task.version,
      reason,
      idempotencyKey: 'invalid',
    })
    assert.equal(result.value.ok, false)
    assert.equal(result.value.errors[0].code, 'validation')
    assert.ok(result.value.fields.reason)
    assert.deepEqual(session.data, before)
  }
})

test('archive binds task version, preserves children and dependent links, and replay writes once', () => {
  const session = createFixtureSession()
  const task = session.data.tasks.find((item) => item.id === 'KV-142')
  const args = {
    id: task.id,
    expectedVersion: task.version,
    reason: 'Completed migration',
    idempotencyKey: 'archive-one',
  }
  const neighbors = structuredClone(session.data.tasks.filter((item) => item.id !== task.id))
  const result = session.call('flow.issue.archive', args)
  assert.equal(result.ok, true)
  assert.equal(task.archived, true)
  assert.equal(task.version, args.expectedVersion + 1)
  assert.deepEqual(
    session.data.tasks.filter((item) => item.id !== task.id),
    neighbors,
  )
  const committed = structuredClone(session.data)
  assert.deepEqual(session.call('flow.issue.archive', args), result)
  assert.deepEqual(session.data, committed)
})

test('stale and read-only archive commands are refused atomically', () => {
  for (const scenario of ['baseline', 'readonly']) {
    const session = createFixtureSession(scenario)
    const task = session.data.tasks.find((item) => item.id === 'KV-142')
    const before = structuredClone(session.data)
    const result = session.call('flow.issue.archive', {
      id: task.id,
      expectedVersion: task.version - 1,
      reason: 'Migration',
      idempotencyKey: scenario,
    })
    assert.equal(result.value.ok, false)
    assert.equal(result.value.errors[0].code, scenario === 'readonly' ? 'forbidden' : 'conflict')
    assert.deepEqual(session.data, before)
  }
})
