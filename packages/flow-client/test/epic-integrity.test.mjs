import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'

const valid = (session) => ({
  collection: 'epics',
  projectId: 'core',
  title: 'Release readiness',
  owner: session.data.user.name,
  outcome: 'All release checks accepted',
  start: '2026-10-09',
  end: '2026-10-23',
})

test('epic creation refuses malformed dates, missing outcomes and invalid ownership atomically', () => {
  for (const [patch, field] of [
    [{ start: '2026-02-30' }, 'start'],
    [{ end: '2026-10-01' }, 'end'],
    [{ end: '' }, 'end'],
    [{ outcome: ' ' }, 'outcome'],
    [{ owner: 'unknown-person' }, 'owner'],
    [{ owner: undefined }, 'owner'],
    [{ projectId: 'missing' }, 'projectId'],
  ]) {
    const session = createFixtureSession(),
      before = structuredClone(session.data)
    const result = session.call('flow.entity.save', {
      ...valid(session),
      ...patch,
      idempotencyKey: 'refused',
    })
    assert.equal(result.value.ok, false, field)
    assert.ok(result.value.fields[field], field)
    assert.deepEqual(session.data, before, field)
  }
})

test('epic create replays once and a patch preserves omitted dates and cannot change its project', () => {
  const session = createFixtureSession()
  const input = { ...valid(session), idempotencyKey: 'create' }
  const created = session.call('flow.entity.save', input)
  assert.deepEqual(session.call('flow.entity.save', input), created)
  const epic = session.data.epics.find((item) => item.id === created.value.id)
  assert.ok(epic)
  const saved = session.call('flow.entity.save', {
    collection: 'epics',
    entityId: epic.id,
    title: 'Renamed readiness',
    idempotencyKey: 'rename',
  })
  assert.notEqual(saved.value.ok, false)
  assert.equal(epic.start, input.start)
  assert.equal(epic.end, input.end)
  const before = structuredClone(session.data)
  const refused = session.call('flow.entity.save', {
    ...input,
    entityId: epic.id,
    projectId: 'ops',
    idempotencyKey: 'reparent',
  })
  assert.equal(refused.value.ok, false)
  assert.ok(refused.value.fields.projectId)
  assert.deepEqual(session.data, before)
})
