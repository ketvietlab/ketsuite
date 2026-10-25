import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { calendarPeriod } from '@ketvietlab/flow-client/operations-model.mjs'
const read = (s) => s.call('flow.workspace.bootstrap', { companyId: 'demo', workspaceId: 'product' }).value
// Grants as the server stores them; the bootstrap carries only the actor's own.
const stored = (s) => structuredClone(s.sessions.get('demo').data.grants)
const readReport = (session, sprint) => {
  let cursor,
    tasks = [],
    report
  do {
    const page = session.call('flow.sprint.report', {
      companyId: 'demo',
      projectId: sprint.projectId,
      id: sprint.id,
      cursor,
    }).value
    assert.notEqual(page.ok, false, JSON.stringify(page))
    assert.equal(page.report.taskIds, undefined)
    report = page.report
    tasks.push(...page.tasks)
    cursor = page.cursor
  } while (cursor)
  return { ...report, tasks }
}
let n = 0
const run = (s, action, args = {}) =>
  s.call('flow.operations.command', {
    companyId: 'demo',
    workspaceId: 'product',
    projectId: 'core',
    expectedRevision: read(s).operationsRevision,
    idempotencyKey: 'op-' + ++n,
    action,
    ...args,
  }).value
test('published form validates answers, creates mapped task and records response', () => {
  const s = createOrganizationSession(),
    form = {
      title: 'Tiếp nhận',
      access: 'project',
      priority: 'high',
      publish: true,
      fields: [{ label: 'Số lượng', type: 'number', required: true }],
    }
  // The recipient is posted by id, as the native command takes it; a name or a guest is refused.
  for (const recipient of [{ assignee: 'Mai Anh' }, { assigneeId: 'guest' }, { assigneeId: 'missing' }])
    assert.equal(run(s, 'form.save', { ...form, ...recipient }).ok, false, JSON.stringify(recipient))
  const result = run(s, 'form.save', { ...form, assigneeId: 'mai' })
  assert.ok(result.id, JSON.stringify(result))
  assert.equal(read(s).forms.find((f) => f.id === result.id).assigneeId, 'mai')
  const before = read(s).tasks.length
  assert.equal(
    run(s, 'form.submit', { id: result.id, title: 'Yêu cầu', answers: { 'field-0': 'abc' } }).ok,
    false,
  )
  assert.equal(read(s).tasks.length, before)
  const response = run(s, 'form.submit', {
    id: result.id,
    title: 'Yêu cầu hợp lệ',
    answers: { 'field-0': '3' },
  })
  assert.ok(response.id, JSON.stringify(response))
  const d = read(s),
    t = d.tasks.find((t) => t.id === response.id)
  assert.equal(t.assignee, 'Mai Anh')
  assert.equal(t.priority, 'high')
  assert.equal(d.formResponses[0].taskId, t.id)
  assert.equal(d.quality, undefined)
})

test('calendar uses real month boundaries', () => {
  assert.equal(calendarPeriod('2028-02-17', 'month').end, '2028-02-29')
  assert.equal(calendarPeriod('2026-09-23', 'week').start, '2026-09-21')
})
test('operations reject stale revisions and unprivileged configuration changes', () => {
  const s = createOrganizationSession()
  const d = read(s)
  // A shared operation: personal ones (preferences, read notifications) hold no revision.
  const stale = s.call('flow.operations.command', {
    companyId: 'demo',
    action: 'view.save',
    projectId: 'core',
    title: 'Stale view',
    expectedRevision: 0,
    idempotencyKey: 'stale',
  }).value
  assert.equal(stale.ok, false)
  assert.equal(stale.errors[0].code, 'conflict')
  assert.equal(read(s).operationsRevision, d.operationsRevision)
  const ro = createOrganizationSession('readonly')
  assert.equal(run(ro, 'form.save', { title: 'Unauthorized' }).ok, false)
})
test('batch grants validate every subject before changing sources', () => {
  const s = createOrganizationSession(),
    before = read(s),
    held = stored(s),
    base = {
      companyId: 'demo',
      action: 'access.grant',
      scope: 'project',
      targetId: 'core',
      subjectType: 'user',
      role: 'viewer',
      expectedRevision: before.organizationRevision,
    }
  const invalid = s.call('flow.organization.command', {
    ...base,
    subjectIds: ['bao', 'missing'],
    idempotencyKey: 'invalid-batch',
  }).value
  assert.equal(invalid.ok, false)
  assert.deepEqual(stored(s), held)
  const valid = s.call('flow.organization.command', {
    ...base,
    subjectIds: ['bao', 'ha'],
    idempotencyKey: 'valid-batch',
  }).value
  assert.notEqual(valid.ok, false)
  assert.equal(
    stored(s).filter(
      (g) => g.targetId === 'core' && g.subjectType === 'user' && ['bao', 'ha'].includes(g.subjectId),
    ).length,
    2,
  )
})
test('closing sprint records commitment and carries work only within its project', () => {
  const s = createOrganizationSession(),
    d = read(s),
    sprint = d.sprints.find((s) => s.state === 'active')
  assert.ok(sprint)
  const result = s.call('flow.entity.action', {
    companyId: 'demo',
    projectId: sprint.projectId,
    collection: 'sprints',
    entityId: sprint.id,
    action: 'close',
    carryTo: 'Backlog',
    idempotencyKey: 'sprint-close-preview',
  }).value
  assert.notEqual(result.ok, false)
  const report = readReport(s, sprint)
  assert.ok(report)
  assert.equal(report.taskIds, undefined)
  assert.equal(report.carryTo, 'Backlog')
  assert.ok(report.tasks.length)
  const frozen = structuredClone(report.tasks)
  const task = report.tasks[0]
  s.call('flow.issue.save', {
    companyId: 'demo',
    id: task.id,
    projectId: sprint.projectId,
    title: 'Changed after close',
    idempotencyKey: 'after-close',
  })
  assert.deepEqual(readReport(s, sprint).tasks, frozen)
  const frozenReport = structuredClone(readReport(s, sprint))
  s.call('flow.entity.action', {
    companyId: 'demo',
    collection: 'sprints',
    entityId: sprint.id,
    action: 'close',
    carryTo: 'Sprint 13',
    idempotencyKey: 'close-again-after-edit',
  })
  assert.deepEqual(readReport(s, sprint), frozenReport)
})
test('realistic Core fixtures have one active sprint per project and frozen historical reports', () => {
  const session = createOrganizationSession('baseline', 'sprints', { profile: 'realistic' })
  const data = read(session)
  for (const project of data.projects)
    assert.ok(
      data.sprints.filter((sprint) => sprint.projectId === project.id && sprint.state === 'active').length <=
        1,
    )
  const past = data.sprints.find((sprint) => sprint.state === 'closed')
  past.report = readReport(session, past)
  assert.ok(past.report.tasks.length)
  assert.equal(past.report.carried, 0)
  assert.equal(past.report.completed, past.report.tasks.length)
  assert.equal(past.report.closedAt, past.end + 'T17:00:00.000Z')
  const frozen = structuredClone(past.report)
  session.call('flow.entity.action', {
    companyId: 'demo',
    collection: 'sprints',
    entityId: past.id,
    action: 'close',
    carryTo: 'Backlog',
    idempotencyKey: 'retry-history',
  })
  assert.deepEqual(readReport(session, past), frozen)
})
test('configured task fields survive save and validate required completion values', () => {
  const s = createOrganizationSession(),
    result = s.call('flow.entity.save', {
      companyId: 'demo',
      collection: 'fields',
      title: 'Kênh yêu cầu',
      kind: 'select',
      options: 'Email\nChat',
      required: 'true',
      appliesTo: 'core',
      idempotencyKey: 'field-config',
    }).value
  assert.ok(result.id, JSON.stringify(result))
  const task = read(s).tasks.find((t) => t.projectId === 'core' && !t.blockedBy.length && t.status !== 'done')
  assert.ok(task)
  const base = { companyId: 'demo', id: task.id, projectId: 'core', status: 'done' }
  assert.equal(s.call('flow.issue.save', { ...base, idempotencyKey: 'field-required' }).value.ok, false)
  assert.equal(
    s.call('flow.issue.save', {
      ...base,
      customFields: { [result.id]: 'Unknown' },
      idempotencyKey: 'field-invalid',
    }).value.ok,
    false,
  )
  assert.notEqual(
    s.call('flow.issue.save', {
      ...base,
      status: task.status,
      customFields: { [result.id]: 'Email' },
      idempotencyKey: 'field-valid',
    }).value.ok,
    false,
  )
  assert.equal(read(s).tasks.find((t) => t.id === task.id).customFields[result.id], 'Email')
})

test('standalone personal routes do not preload task collections or catalogs', () => {
  const session = createOrganizationSession()
  for (const route of ['inbox', 'personal-settings']) {
    const result = session.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      workspaceId: 'product',
      route,
    }).value
    assert.notEqual(result.ok, false)
    for (const key of ['tasks', 'columns', 'taskTypes', 'types', 'tags', 'fields', 'sprints', 'epics'])
      assert.deepEqual(result[key], [], route + ':' + key)
    assert.ok(result.context)
    assert.deepEqual(result.personalPreferences, read(session).personalPreferences)
  }
  const taskRead = session.call('flow.workspace.bootstrap', {
    companyId: 'demo',
    workspaceId: 'product',
    route: 'my-work',
  }).value
  assert.ok(taskRead.tasks.length)
})
