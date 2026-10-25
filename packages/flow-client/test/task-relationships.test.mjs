import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'

const relation = (session) => {
  const parent = session.data.tasks.find((t) => t.id === 'KV-151'),
    child = session.data.tasks.find((t) => t.id === 'KV-153')
  parent.archived = false
  child.archived = false
  child.projectId = parent.projectId
  return { parent, child }
}

test('child linking refuses missing, self, archived and foreign-project records atomically', () => {
  for (const scenario of ['missing', 'self', 'archived-child', 'archived-parent', 'foreign']) {
    const s = createFixtureSession(),
      { parent, child } = relation(s)
    if (scenario === 'archived-child') child.archived = true
    if (scenario === 'archived-parent') parent.archived = true
    if (scenario === 'foreign') child.projectId = 'ops'
    const before = structuredClone(s.data)
    const r = s.call('flow.issue.linkChild', {
      id: parent.id,
      target: scenario === 'missing' ? 'missing' : scenario === 'self' ? parent.id : child.id,
      idempotencyKey: 'refused',
    })
    assert.equal(r.value.ok, false, scenario)
    assert.deepEqual(s.data, before, scenario)
  }
})

test('parent linking refuses descendant and already-corrupt ancestor cycles', () => {
  for (const corrupt of [false, true]) {
    const s = createFixtureSession(),
      { parent, child } = relation(s),
      middle = s.data.tasks.find((t) => t.id === 'KV-155')
    parent.parentId = middle.id
    middle.parentId = corrupt ? parent.id : child.id
    const before = structuredClone(s.data)
    const r = s.call('flow.issue.linkChild', { id: parent.id, target: child.id, idempotencyKey: 'refused' })
    assert.equal(r.value.ok, false)
    assert.equal(r.value.errors[0].code, 'cycle')
    assert.deepEqual(s.data, before)
  }
})

test('reparenting checks both record versions and preserves child status/assignees; replay writes once', () => {
  const s = createFixtureSession(),
    { parent, child } = relation(s)
  const before = structuredClone(s.data)
  const args = {
    id: parent.id,
    target: child.id,
    expectedVersion: parent.version,
    expectedChildVersion: child.version,
    idempotencyKey: 'reparent',
  }
  const stale = s.call('flow.issue.linkChild', { ...args, expectedChildVersion: child.version - 1 })
  assert.equal(stale.value.ok, false)
  assert.equal(stale.value.errors[0].code, 'conflict')
  assert.deepEqual(s.data, before)
  const result = s.call('flow.issue.linkChild', args)
  assert.notEqual(result.value.ok, false)
  const oldChild = before.tasks.find((t) => t.id === child.id)
  assert.equal(child.parentId, parent.id)
  assert.equal(child.version, oldChild.version + 1)
  assert.equal(child.status, oldChild.status)
  assert.deepEqual(child.assigneeIds, oldChild.assigneeIds)
  assert.equal(parent.version, args.expectedVersion + 1)
  const committed = structuredClone(s.data)
  assert.deepEqual(s.call('flow.issue.linkChild', args), result)
  assert.deepEqual(s.data, committed)
})

test('dependency addition rejects archived endpoints, cycles and missing targets without writing', () => {
  for (const scenario of ['archived-source', 'archived-target', 'cycle', 'missing']) {
    const s = createFixtureSession(),
      source = s.data.tasks.find((t) => t.id === 'KV-151'),
      target = s.data.tasks.find((t) => t.id === 'KV-153')
    if (scenario === 'archived-source') source.archived = true
    if (scenario === 'archived-target') target.archived = true
    if (scenario === 'cycle') target.blockedBy = [source.id]
    const before = structuredClone(s.data)
    const r = s.call('flow.issue.dependency', {
      id: source.id,
      target: scenario === 'missing' ? 'missing' : target.id,
      idempotencyKey: 'refused',
    })
    assert.equal(r.value.ok, false, scenario)
    assert.deepEqual(s.data, before)
  }
})
