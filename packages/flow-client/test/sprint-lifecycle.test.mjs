import assert from 'node:assert/strict'
import test from 'node:test'
import { createFixtureSession } from '../atlas/store.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { projectRecord, taskEpic } from '../client/project-record.mjs'

const act = (session, id, action, extra = {}, key = crypto.randomUUID()) =>
  session.call('flow.entity.action', {
    companyId: 'demo',
    collection: 'sprints',
    entityId: id,
    action,
    idempotencyKey: key,
    ...extra,
  }).value

test('sprint lifecycle refuses planned closure, closed restart, archived actions and a second active sprint', () => {
  const f = createFixtureSession()
  for (const [id, action] of [
    ['s13', 'close'],
    ['s13', 'start'],
  ]) {
    const before = structuredClone(f.data)
    assert.equal(act(f, id, action).ok, false)
    assert.deepEqual(f.data, before)
  }
  act(f, 's12', 'close')
  const closed = structuredClone(f.data.sprints.find((sprint) => sprint.id === 's12'))
  assert.equal(act(f, 's12', 'start').ok, false)
  assert.deepEqual(
    f.data.sprints.find((sprint) => sprint.id === 's12'),
    closed,
  )
  f.data.sprints.find((sprint) => sprint.id === 's13').archived = true
  assert.equal(act(f, 's13', 'start').ok, false)
})

test('carry destination must be an unfinished, unarchived sprint in the same project or Backlog', () => {
  const f = createFixtureSession()
  const active = f.data.sprints.find((sprint) => sprint.id === 's12')
  f.data.sprints.push(
    { id: 'foreign', projectId: 'ops', title: 'Foreign', state: 'planned' },
    { id: 'past', projectId: active.projectId, title: 'Past', state: 'closed' },
    { id: 'archive', projectId: active.projectId, title: 'Archive', state: 'planned', archived: true },
    { id: 'bad-state', projectId: active.projectId, title: 'Invalid', state: 'unknown' },
  )
  for (const carryTo of ['Missing', 'Foreign', 'Past', 'Archive', 'Invalid', active.title, {}]) {
    const before = structuredClone(f.data)
    const result = act(f, active.id, 'close', { carryTo })
    assert.equal(result.ok, false)
    assert.ok(result.fields.carryTo)
    assert.deepEqual(f.data, before)
  }
  assert.equal(act(f, active.id, 'close', { projectId: 'ops' }).ok, false)
  assert.equal(active.state, 'active')
})

test('closure snapshots current work, retains completed work and excludes archived tasks from carryover', () => {
  const f = createFixtureSession()
  const active = f.data.sprints.find((sprint) => sprint.id === 's12')
  const base = { ...f.data.tasks[0], projectId: active.projectId }
  f.data.tasks = [
    { ...base, id: 'completed', status: 'done', points: 3, sprint: active.title },
    { ...base, id: 'pending', status: 'progress', points: 5, sprint: active.title },
    { ...base, id: 'archived', status: 'progress', points: 8, sprint: active.title, archived: true },
  ]
  active.commitment = f.data.tasks.map(({ id, points }) => ({ id, points }))
  act(f, active.id, 'close', { carryTo: 'Sprint 13' }, 'close-once')
  assert.equal(active.state, 'closed')
  assert.equal(active.report.completedPoints, 3)
  assert.equal(active.report.committedPoints, 16)
  assert.equal(active.report.removed, 1)
  assert.equal(active.report.carried, 1)
  assert.deepEqual(active.report.taskIds, ['completed', 'pending'])
  assert.deepEqual(
    f.data.tasks.map((task) => task.sprint),
    ['Sprint 12', 'Sprint 13', 'Sprint 12'],
  )
  const frozen = structuredClone(active.report),
    tasks = structuredClone(f.data.tasks)
  act(f, active.id, 'close', { carryTo: 'Backlog' }, 'close-once')
  act(f, active.id, 'close', { carryTo: 'Backlog' }, 'close-again')
  assert.deepEqual(active.report, frozen)
  assert.deepEqual(f.data.tasks, tasks)
})

test('start records only unarchived work in the initial commitment', () => {
  const f = createFixtureSession()
  const active = f.data.sprints.find((sprint) => sprint.id === 's12')
  active.archived = true
  const base = { ...f.data.tasks[0], projectId: active.projectId }
  f.data.tasks = [
    { ...base, id: 'planned-work', sprint: 'Sprint 13', points: 5 },
    { ...base, id: 'archived-work', sprint: 'Sprint 13', points: 8, archived: true },
  ]
  act(f, 's13', 'start')
  assert.deepEqual(f.data.sprints.find((sprint) => sprint.id === 's13').commitment, [
    { id: 'planned-work', points: 5 },
  ])
})

test('organization fixture checks the authoritative sprint owner even when the caller omits or spoofs project', () => {
  const f = createOrganizationSession('member')
  const d = f.sessions.get('demo').data
  d.sprints.push({ id: 'ops-active', projectId: 'ops', title: 'Ops sprint', state: 'active' })
  const before = structuredClone(d.sprints)
  for (const extra of [{}, { projectId: 'core' }])
    assert.equal(act(f, 'ops-active', 'close', extra).errors[0].code, 'forbidden')
  assert.deepEqual(d.sprints, before)
  d.grants = [
    {
      id: 'view-core',
      scope: 'project',
      targetId: 'core',
      subjectType: 'user',
      subjectId: 'bao',
      role: 'viewer',
    },
  ]
  d.projects.find((project) => project.id === 'core').access = 'private'
  assert.equal(act(f, 's12', 'close').errors[0].code, 'forbidden')
})

test('editing a missing entity never creates a replacement record', () => {
  const f = createFixtureSession()
  for (const collection of ['sprints', 'epics', 'pages']) {
    const before = structuredClone(f.data[collection])
    const result = f.call('flow.entity.save', {
      collection,
      entityId: 'missing',
      projectId: 'core',
      title: 'Replacement',
      idempotencyKey: `missing-${collection}`,
    }).value
    assert.equal(result.ok, false)
    assert.deepEqual(f.data[collection], before)
  }
})

test('task assignment and save reject foreign, archived and closed sprint changes without losing historical context', () => {
  const f = createFixtureSession()
  const task = f.data.tasks.find((task) => task.projectId === 'core')
  f.data.sprints.push(
    { id: 'foreign', projectId: 'ops', title: 'Foreign sprint', state: 'planned' },
    { id: 'archived', projectId: 'core', title: 'Archived sprint', state: 'planned', archived: true },
    { id: 'closed', projectId: 'core', title: 'Closed sprint', state: 'closed' },
  )
  for (const sprint of ['Foreign sprint', 'Archived sprint', 'Closed sprint']) {
    for (const name of ['flow.issue.assignSprint', 'flow.issue.save']) {
      const before = structuredClone(task)
      const result = f.call(name, { id: task.id, sprint, idempotencyKey: crypto.randomUUID() }).value
      assert.equal(result.ok, false)
      assert.ok(result.fields.sprint)
      assert.deepEqual(task, before)
    }
  }
  task.sprint = 'Closed sprint'
  assert.notEqual(
    f.call('flow.issue.save', {
      id: task.id,
      sprint: task.sprint,
      title: 'Historical task',
      idempotencyKey: 'keep-history',
    }).value.ok,
    false,
  )
  assert.equal(task.sprint, 'Closed sprint')
  assert.notEqual(
    f.call('flow.issue.assignSprint', { id: task.id, sprint: 'Sprint 13', idempotencyKey: 'assign-valid' })
      .value.ok,
    false,
  )
  assert.equal(task.sprint, 'Sprint 13')
})

test('project record lookup uses exact explicit identity and only falls back for an implicit entry', () => {
  const records = [
    { id: 'foreign', projectId: 'ops', state: 'active' },
    { id: 'archived', projectId: 'core', state: 'active', archived: true },
    { id: 'planned', projectId: 'core', state: 'planned' },
    { id: 'active', projectId: 'core', state: 'active' },
  ]
  for (const id of ['foreign', 'archived', 'missing'])
    assert.equal(projectRecord(records, 'core', id, true), null)
  assert.equal(projectRecord(records, 'core', 'planned', true).id, 'planned')
  assert.equal(
    projectRecord(records, 'core', 'ignored', false, (record) => record.state === 'active').id,
    'active',
  )
})

test('cross-sprint reorder rejects closed or archived destinations atomically and accepts a planned destination', () => {
  const f = createFixtureSession()
  const task = f.data.tasks.find((task) => task.projectId === 'core')
  f.data.sprints.push(
    { id: 'past', projectId: 'core', title: 'Past sprint', state: 'closed' },
    { id: 'archive', projectId: 'core', title: 'Archived sprint', state: 'planned', archived: true },
  )
  const reorder = (groupValue) =>
    f.call('flow.issue.reorder', {
      id: task.id,
      targetId: null,
      groupBy: 'sprint',
      groupValue,
      position: 'after',
      expectedVersion: task.version,
      expectedOrderRevision: f.data.taskOrderRevision,
      idempotencyKey: crypto.randomUUID(),
    }).value
  for (const sprint of ['Past sprint', 'Archived sprint']) {
    const before = structuredClone(f.data)
    assert.equal(reorder(sprint).ok, false)
    assert.deepEqual(f.data, before)
  }
  assert.equal(reorder('Sprint 13').ok, true)
  assert.equal(task.sprint, 'Sprint 13')
})

test('epic labels resolve exact project identity or legacy titles and changes cannot attach foreign or archived epics', () => {
  const f = createFixtureSession(),
    task = f.data.tasks.find((task) => task.projectId === 'core')
  assert.equal(taskEpic(f.data.epics, { ...task, epic: 'channels' }).title, 'Kết nối kênh bán')
  assert.equal(taskEpic(f.data.epics, { ...task, epic: 'Kết nối kênh bán' }).id, 'channels')
  assert.equal(taskEpic(f.data.epics, { ...task, projectId: 'ops', epic: 'channels' }), null)
  f.data.epics.push(
    { id: 'foreign', projectId: 'ops', title: 'Foreign epic' },
    { id: 'archived', projectId: 'core', title: 'Archived epic', archived: true },
  )
  for (const epic of ['foreign', 'Foreign epic', 'archived', 'missing']) {
    const before = structuredClone(task)
    const result = f.call('flow.issue.save', { id: task.id, epic, idempotencyKey: crypto.randomUUID() }).value
    assert.equal(result.ok, false)
    assert.ok(result.fields.epic)
    assert.deepEqual(task, before)
  }
})
