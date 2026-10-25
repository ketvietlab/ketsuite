import assert from 'node:assert/strict'
import test from 'node:test'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { operationsCommand } from '../atlas/operations-store.mjs'
import { mutationFeedback } from '../dist/mutation-feedback.mjs'
import { prepareFlowCommand } from '../dist/command-contract.mjs'

const read = (s) => s.call('flow.workspace.bootstrap', { companyId: 'demo', workspaceId: 'product' }).value
let sequence = 0
const run = (s, action, args = {}) =>
  s.call('flow.operations.command', {
    companyId: 'demo',
    workspaceId: 'product',
    projectId: 'core',
    expectedRevision: read(s).operationsRevision,
    idempotencyKey: 'integrity-' + ++sequence,
    action,
    ...args,
  }).value
const form = {
  title: 'Tiếp nhận',
  access: 'project',
  assigneeId: 'mai',
  publish: true,
  fields: [{ label: 'Số lượng', type: 'number', required: true }],
  priority: 'normal',
}
const unchanged = (s, action, args) => {
  const before = structuredClone(s.sessions.get('demo').data)
  assert.equal(run(s, action, args).ok, false)
  assert.deepEqual(s.sessions.get('demo').data, before)
}

test('malformed form definitions and inactive recipients are refused atomically before creation', () => {
  const s = createOrganizationSession()
  read(s)
  for (const patch of [
    { title: 1 },
    { title: '  ' },
    { description: [] },
    { fields: [null] },
    { fields: [{ label: 7, type: 'text' }] },
    { fields: [{ label: 'A', type: 'text', required: 'false' }] },
    { priority: 'invalid' },
    { publish: 'false' },
    { assigneeId: 'missing' },
  ])
    unchanged(s, 'form.save', { ...form, ...patch })
  s.sessions.get('demo').data.members.find((m) => m.id === 'bao').status = 'revoked'
  unchanged(s, 'form.save', { ...form, assigneeId: 'bao' })
  const result = run(s, 'form.save', { ...form, title: '  Tiếp nhận  ' })
  assert.ok(result.id)
  assert.equal(read(s).forms.find((f) => f.id === result.id).title, 'Tiếp nhận')
  const held = s.sessions.get('demo').data.forms.find((f) => f.id === result.id)
  Object.assign(held, { description: 'Preserved', priority: 'high' })
  const partial = { ...form }
  delete partial.publish
  delete partial.priority
  assert.notEqual(run(s, 'form.save', { ...partial, id: result.id, title: 'Updated' }).ok, false)
  assert.equal(held.status, 'published')
  assert.equal(held.description, 'Preserved')
  assert.equal(held.priority, 'high')
})

test('form refusal maps errors to native controls; accepted retries and replays create one task/response', () => {
  const s = createOrganizationSession()
  const id = run(s, 'form.save', form).id
  for (const title of [7, '   ']) {
    unchanged(s, 'form.submit', { id, title, answers: { 'field-0': '3' } })
    assert.ok(run(s, 'form.submit', { id, title }).fields['request-title'])
  }
  for (const answer of [null, true, {}, [], 'infinity', ' ', Infinity]) {
    unchanged(s, 'form.submit', { id, title: 'Yêu cầu', answers: { 'field-0': answer } })
    assert.ok(
      run(s, 'form.submit', { id, title: 'Yêu cầu', answers: { 'field-0': answer } }).fields[
        'answer-field-0'
      ],
    )
  }
  unchanged(s, 'form.submit', { id, title: 'Yêu cầu', answers: [] })
  const before = read(s),
    key = 'accepted-response'
  const accepted = run(s, 'form.submit', {
    id,
    title: 'Yêu cầu',
    answers: { 'field-0': '3', extra: 'ignored' },
    idempotencyKey: key,
  })
  const replay = run(s, 'form.submit', {
    id,
    title: 'Duplicate',
    answers: { 'field-0': '4' },
    idempotencyKey: key,
  })
  assert.deepEqual(replay, accepted)
  const after = read(s)
  assert.equal(after.tasks.length, before.tasks.length + 1)
  assert.equal(after.formResponses.length, 1)
  assert.deepEqual(after.formResponses[0].answers, { 'field-0': '3' })
  assert.equal(after.forms.find((f) => f.id === id).responses, 1)
})

test('task transport refusal or missing task result never commits a form response', () => {
  const s = createOrganizationSession()
  const id = run(s, 'form.save', form).id,
    d = s.sessions.get('demo').data
  const before = structuredClone(d)
  for (const failure of [
    { ok: false, error: { code: 'unavailable', message: 'Retry' } },
    { ok: true, value: {} },
  ]) {
    const result = operationsCommand(
      d,
      {
        action: 'form.submit',
        id,
        projectId: 'core',
        title: 'Request',
        answers: { 'field-0': '3' },
        expectedRevision: d.operationsRevision,
        idempotencyKey: 'transport-refusal',
      },
      'baseline',
      new Map(),
      () => failure,
    )
    assert.ok(result.ok === false || result.value.ok === false)
    assert.deepEqual(d, before)
  }
})

test('saved views enforce project/owner identity and strict input without overwriting omitted settings', () => {
  const s = createOrganizationSession(),
    d = read(s),
    id = d.views.find((v) => v.projectId === 'core').id
  const held = s.sessions.get('demo').data.views.find((v) => v.id === id)
  Object.assign(held, {
    ownerId: 'mai',
    description: 'Keep notes',
    query: 'Keep query',
    visibility: 'project',
    status: 'all',
  })
  for (const patch of [
    { title: 4 },
    { description: {} },
    { query: [] },
    { visibility: 'public' },
    { status: 'not-in-project' },
    { archive: 'false' },
    { projectId: 'ops' },
    { id: 'missing' },
  ])
    unchanged(s, 'view.save', { id, title: 'Valid', ...patch })
  assert.notEqual(run(s, 'view.save', { id, title: ' Renamed ' }).ok, false)
  assert.equal(held.title, 'Renamed')
  assert.equal(held.description, 'Keep notes')
  assert.equal(held.query, 'Keep query')
  assert.equal(held.visibility, 'project')
  const tasks = structuredClone(s.sessions.get('demo').data.tasks)
  const archived = run(s, 'view.save', { id, archive: true, idempotencyKey: 'view-archive' })
  assert.deepEqual(run(s, 'view.save', { id, archive: true, idempotencyKey: 'view-archive' }), archived)
  assert.equal(held.archived, true)
  assert.deepEqual(s.sessions.get('demo').data.tasks, tasks)
  unchanged(s, 'view.save', { id, title: 'Recreate' })
  const other = createOrganizationSession('member')
  read(other)
  const view = other.sessions.get('demo').data.views.find((v) => v.projectId === 'core')
  view.ownerId = 'mai'
  unchanged(other, 'view.save', { id: view.id, title: 'Not mine' })
})

test('archived-view feedback names the removed view and never offers an unusable saved-filter target', () => {
  const input = {
    action: 'view.save',
    id: 'removed',
    title: 'Saved filter',
    projectId: 'core',
    archive: true,
  }
  const archived = mutationFeedback('flow.operations.command', input, {}, { views: [] })
  assert.equal(archived.target, null)
  assert.ok(archived.message.includes('Saved filter'))
  const saved = mutationFeedback('flow.operations.command', { ...input, archive: false }, {}, { views: [] })
  assert.equal(saved.target.route, 'project-issues')
  assert.equal(saved.target.params.view, 'removed')
})

test('personal preference validation is atomic and partial saves preserve notification choices', () => {
  const s = createOrganizationSession()
  read(s)
  assert.notEqual(run(s, 'preferences.save', { notifications: 'none' }).ok, false)
  for (const patch of [
    { timezone: [] },
    { timezone: '' },
    { timezone: 'Invalid/Zone' },
    { notifications: 'invalid' },
    { notifications: null },
    { timezone: 'UTC', notifications: 'invalid' },
  ])
    unchanged(s, 'preferences.save', patch)
  assert.notEqual(run(s, 'preferences.save', { timezone: 'Asia/Tokyo' }).ok, false)
  assert.deepEqual(read(s).personalPreferences, {
    theme: 'light',
    timezone: 'Asia/Tokyo',
    notifications: 'none',
  })
})

test('inbox batches refuse foreign/missing targets before changing any read flags; revoked users cannot write', () => {
  const s = createOrganizationSession()
  read(s)
  const d = s.sessions.get('demo').data,
    own = d.inbox[0]
  own.recipientId = d.user.id
  own.read = false
  d.inbox.push({ id: 'other-notification', recipientId: 'bao', read: false })
  for (const ids of [
    [own.id, 'other-notification'],
    [own.id, 'missing'],
    [own.id, 2],
  ])
    unchanged(s, 'inbox.read', { ids })
  assert.notEqual(run(s, 'inbox.read', { ids: [own.id] }).ok, false)
  assert.equal(own.read, true)
  assert.equal(d.inbox.at(-1).read, false)
  d.members.find((m) => m.id === d.user.id).status = 'revoked'
  const before = structuredClone(d)
  const result = s.call('flow.operations.command', {
    companyId: 'demo',
    action: 'preferences.save',
    notifications: 'all',
    expectedRevision: d.operationsRevision,
    idempotencyKey: 'revoked-preferences',
  })
  assert.equal(result.value.ok, false)
  assert.deepEqual(d, before)
})

test('a favourite, preferences and read notifications are personal: they hold no shared revision', () => {
  const s = createOrganizationSession()
  const held = read(s),
    d = s.sessions.get('demo').data
  const own = d.inbox.find((n) => !n.read && (n.recipientId ?? d.user.id) === d.user.id)
  const personal = (name, input) =>
    s.call(name, { companyId: 'demo', idempotencyKey: 'personal-' + ++sequence, ...input }).value
  // No revision is sent, and none is moved for anyone else.
  for (const [name, input] of [
    ['flow.operations.command', { action: 'preferences.save', notifications: 'none' }],
    ['flow.operations.command', { action: 'inbox.read', ids: [own.id] }],
    ['flow.organization.command', { action: 'project.favorite', id: 'core' }],
  ]) {
    const prepared = prepareFlowCommand(name, input, held)
    assert.equal('expectedRevision' in prepared, false, input.action)
    assert.notEqual(personal(name, prepared).ok, false, input.action)
  }
  assert.equal(read(s).operationsRevision, held.operationsRevision)
  assert.equal(read(s).organizationRevision, held.organizationRevision)
  // A command prepared before them still applies.
  const shared = prepareFlowCommand(
    'flow.operations.command',
    { action: 'form.save', projectId: 'core', ...form },
    held,
  )
  assert.equal(shared.expectedRevision, held.operationsRevision)
  assert.notEqual(personal('flow.operations.command', shared).ok, false)
})
