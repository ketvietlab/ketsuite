import assert from 'node:assert/strict'
import test from 'node:test'
import { createFixtureSession } from '../atlas/store.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { fixtureResponse } from '../atlas/fixture-response.mjs'
import { normalizeBulkOutcome, selectionAfterBulk, bulkReasonKey } from '../client/bulk.mjs'

const seed = (data) => {
  const base = data.tasks.find((t) => t.projectId === 'core')
  data.fields = []
  data.tasks = ['ready', 'blocked', 'dependency'].map((id) => ({
    ...structuredClone(base),
    id,
    status: 'todo',
    version: 1,
    blockedBy: id === 'blocked' ? ['dependency'] : [],
  }))
  return data.tasks
}
const input = {
  ids: ['ready', 'blocked', 'missing', 'ready'],
  action: 'move',
  value: 'done',
  idempotencyKey: 'batch-1',
}

test('registered extension refusal messages remain readable without coupling core to a paid feature', () => {
  assert.equal(
    bulkReasonKey('approval_needed', { approval_needed: 'flow.example.approval' }),
    'flow.example.approval',
  )
  assert.equal(bulkReasonKey('flow.error.blocked'), 'flow.bulk.reason.blocked')
  assert.equal(bulkReasonKey('unknown'), 'flow.bulk.reason.other')
})

test('a valid move survives neighboring refusals; replay never applies it twice', () => {
  const session = createFixtureSession()
  seed(session.data)
  const result = session.call('flow.issue.bulk', input).value
  assert.deepEqual(result, {
    ok: true,
    applied: 1,
    refused: [
      { id: 'blocked', code: 'blocked' },
      { id: 'missing', code: 'notFound' },
    ],
  })
  assert.equal(session.data.tasks[0].status, 'done')
  assert.equal(session.data.tasks[1].status, 'todo')
  const saved = structuredClone(session.data)
  assert.deepEqual(session.call('flow.issue.bulk', input).value, result)
  assert.deepEqual(session.data, saved)
})

test('an unknown result after commit is recovered by replay without repeating the writes', () => {
  const session = createOrganizationSession('bulk-unknown')
  const data = session.sessions.get('demo').data
  seed(data)
  const args = { ...input, companyId: 'demo', workspaceId: 'product' }
  const unknown = fixtureResponse(session, 'flow.issue.bulk', session.call('flow.issue.bulk', args)).value
  assert.equal(normalizeBulkOutcome(unknown, input.ids), null)
  const committed = structuredClone(data)
  const known = fixtureResponse(session, 'flow.issue.bulk', session.call('flow.issue.bulk', args)).value
  assert.equal(known.applied, 1)
  assert.equal(known.refused.length, 2)
  assert.deepEqual(data, committed)
})

test('every organization bulk item goes through the single-task permission gate', () => {
  const session = createOrganizationSession('member')
  const data = session.sessions.get('demo').data
  seed(data)
  data.grants.push({
    id: 'bulk-editor',
    scope: 'project',
    targetId: 'core',
    subjectType: 'user',
    subjectId: data.user.id,
    role: 'editor',
  })
  const project = data.projects.find((p) => p.id === 'core')
  data.projects.push({ ...project, id: 'restricted-project', access: 'private', memberIds: [], teamIds: [] })
  data.tasks.push({ ...data.tasks[0], id: 'restricted', projectId: 'restricted-project', status: 'todo' })
  const value = session.call('flow.issue.bulk', {
    ...input,
    ids: ['ready', 'restricted'],
    companyId: 'demo',
  }).value
  assert.equal(value.ok, true)
  assert.equal(value.applied, 1)
  assert.equal(value.refused.length, 1)
  assert.equal(value.refused[0].id, 'restricted')
  assert.equal(data.tasks.find((t) => t.id === 'restricted').status, 'todo')
  assert.deepEqual(Object.keys(value.refused[0]).sort(), ['code', 'id'])
})

test('invalid and oversized batches change nothing', () => {
  const session = createFixtureSession()
  seed(session.data)
  const before = structuredClone(session.data)
  for (const ids of [[], 'ready', ['ready', 1], Array.from({ length: 201 }, (_, i) => 'item-' + i)]) {
    assert.equal(
      session.call('flow.issue.bulk', { ...input, ids, idempotencyKey: crypto.randomUUID() }).value.ok,
      false,
    )
    assert.deepEqual(session.data, before)
  }
})

test('selection preserves refusals and unattempted rows, and never trusts an incomplete outcome', () => {
  const value = { ok: true, applied: 1, refused: [{ id: 'blocked', code: 'blocked' }] }
  const outcome = normalizeBulkOutcome(value, ['ready', 'blocked'])
  assert.deepEqual(selectionAfterBulk(['ready', 'blocked', 'outside'], ['ready', 'blocked'], outcome), [
    'blocked',
    'outside',
  ])
  for (const bad of [
    undefined,
    { ok: true },
    { ...value, applied: 2 },
    { ...value, refused: [{ id: 'other', code: 'forbidden' }] },
    { ok: true, applied: 0, refused: [value.refused[0], value.refused[0]] },
  ]) {
    assert.equal(normalizeBulkOutcome(bad, ['ready', 'blocked']), null)
    assert.deepEqual(selectionAfterBulk(['ready', 'blocked'], ['ready', 'blocked'], null), [
      'ready',
      'blocked',
    ])
  }
})
