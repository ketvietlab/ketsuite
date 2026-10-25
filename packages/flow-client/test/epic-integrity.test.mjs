import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'
import {
  atlasFlowCommand,
  prepareFlowCommand,
  resolveFlowCommand,
} from '@ketvietlab/flow-client/command-contract.mjs'

const valid = (session) => ({
  collection: 'epics',
  projectId: 'core',
  title: 'Release readiness',
  owner: session.data.user.name,
  outcome: 'All release checks accepted',
  start: '2026-10-09',
  end: '2026-10-23',
})

test('epic form resolves one stable owner ID and Atlas preserves its display contract', () => {
  const session = createFixtureSession()
  const prepared = prepareFlowCommand('flow.entity.save', valid(session), session.data)
  const typed = resolveFlowCommand('flow.entity.save', prepared)
  assert.equal(typed.name, 'flow.epic.save')
  assert.equal(typed.input.ownerId, session.data.user.id)
  assert.ok(!Object.hasOwn(typed.input, 'owner'))
  const fixture = atlasFlowCommand(typed.name, typed.input, session.data)
  const response = session.call(fixture.name, { ...fixture.input, idempotencyKey: 'stable-owner' })
  assert.ok(response.value.id, JSON.stringify(response.value))
  assert.equal(session.data.epics.find((e) => e.id === response.value.id).owner, session.data.user.name)
  const duplicate = {
    ...session.data,
    members: [
      ...session.data.members,
      { ...session.data.members.find((m) => m.id === session.data.user.id), id: 'duplicate' },
    ],
  }
  assert.throws(() => prepareFlowCommand('flow.entity.save', valid(session), duplicate), /Ambiguous/)
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
