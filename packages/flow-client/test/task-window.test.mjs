import { prepareFlowCommand } from '@ketvietlab/flow-client/command-contract.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { sortedListTasks } from '@ketvietlab/flow-client/task-order.mjs'
setFlowLocale('en')
test('record command dates clear explicitly without changing omitted or malformed values', () => {
  for (const collection of ['projects', 'sprints', 'epics']) {
    const original = { collection, start: '', end: '' }
    const value = prepareFlowCommand('flow.entity.save', original, { organizationRevision: 1 })
    assert.equal(value.start, null)
    assert.equal(value.end, null)
    assert.equal(original.start, '', 'preparing does not mutate the form draft')
    const omitted = prepareFlowCommand('flow.entity.save', { collection }, {})
    assert.equal(Object.hasOwn(omitted, 'start'), false)
  }
  for (const name of ['flow.project.save', 'flow.sprint.save', 'flow.epic.save']) {
    const value = prepareFlowCommand(name, { start: '', end: 'bad-date' }, {})
    assert.equal(value.start, null)
    assert.equal(value.end, 'bad-date')
  }
})

test('risk reads page full scope, dedupe blocked/overdue and fence mode changes', () => {
  const session = createOrganizationSession(),
    source = session.sessions.get('demo').data
  const project = source.projects.find((p) => !p.archived)
  const todo = source.columns.find((c) => c.kind === 'todo' && (!c.projectId || c.projectId === project.id))
  const existing = source.tasks.find((t) => t.projectId === project.id)
  source.tasks = Array.from({ length: 13 }, (_, i) => ({
    ...structuredClone(existing),
    id: 'RISK-' + String(i).padStart(2, '0'),
    key: 'RISK-' + i,
    title: 'Risk task ' + i,
    status: todo.id,
    archived: false,
    dueDate: '2000-01-01',
    blockedBy: i === 12 ? ['RISK-00', 'RISK-01'] : [],
  }))
  const read = (input = {}) =>
    session.call('flow.risk.list', {
      companyId: 'demo',
      workspaceId: project.workspaceId,
      projectId: project.id,
      ...input,
    }).value
  const blocked = read({ risk: 'blocked' })
  assert.equal(blocked.total, 1, JSON.stringify(blocked))
  assert.equal(blocked.tasks[0].id, 'RISK-12')
  const all = read({ risk: 'all', limit: 100 })
  assert.equal(all.total, 13)
  assert.equal(all.metrics.overdue, 13)
  let cursor,
    tasks = []
  do {
    const page = read({ limit: 3, cursor })
    assert.equal(page.total, 13)
    tasks.push(...page.tasks)
    cursor = page.cursor
  } while (cursor)
  assert.deepEqual(
    tasks.map((t) => t.id),
    all.tasks.map((t) => t.id),
  )
  cursor = read({ limit: 3 }).cursor
  assert.ok(cursor.length < 2048)
  assert.equal(read({ risk: 'blocked', cursor }).errors[0].code, 'conflict')
  assert.equal(read({ cursor: 'x'.repeat(2049) }).errors[0].code, 'validation')
  assert.equal(read({ risk: 'review' }).total, 0)
  source.tasks[12].archived = true
  assert.equal(read({ risk: 'blocked' }).total, 0)
  assert.equal(read({ cursor }).errors[0].code, 'conflict')
})
test('Atlas typed task windows preserve full collection sort, filter counts and cursor fence', () => {
  const session = createOrganizationSession()
  const read = (input) => session.call('flow.issue.list', { companyId: 'demo', ...input }).value
  for (const sort of ['due', 'priority', 'manual']) {
    const all = read({ sort, limit: 100 })
    let cursor,
      rows = []
    do {
      const page = read({ sort, limit: 3, cursor })
      assert.equal(page.total, all.total)
      assert.deepEqual(page.metrics, all.metrics)
      rows.push(...page.tasks)
      cursor = page.cursor
    } while (cursor)
    assert.deepEqual(
      rows.map((t) => t.id),
      sortedListTasks(all.tasks, sort).map((t) => t.id),
    )
    assert.equal(new Set(rows.map((t) => t.id)).size, rows.length)
  }
  const cursor = read({ sort: 'due', limit: 1 }).cursor
  assert.ok(cursor)
  assert.equal(read({ sort: 'priority', cursor }).errors[0].code, 'conflict')
  assert.equal(read({ sort: 'invalid' }).errors[0].code, 'validation')
  assert.equal(read({ query: 'no-such-task' }).total, 0)
})

test('calendar windows include grid dates and undated tasks, with scoped counts and cursor fences', () => {
  const session = createOrganizationSession()
  const tasks = session.sessions.get('demo').data.tasks
  for (let i = 0; i < tasks.length; i++)
    tasks[i].dueDate = i % 3 === 0 ? null : i % 3 === 1 ? '2026-10-13' : '2027-01-01'
  const input = {
    companyId: 'demo',
    route: 'calendar',
    sort: 'due',
    dueFrom: '2026-10-01',
    dueTo: '2026-11-01',
    includeUndated: true,
  }
  const read = (extra = {}) => session.call('flow.issue.list', { ...input, ...extra }).value
  const all = read({ limit: 100 })
  assert.ok(all.tasks.length > 2)
  assert.ok(all.tasks.some((t) => !t.dueDate))
  assert.ok(all.tasks.every((t) => !t.dueDate || t.dueDate === '2026-10-13'))
  let cursor,
    rows = []
  do {
    const page = read({ limit: 2, cursor })
    assert.equal(page.total, all.total)
    rows.push(...page.tasks)
    cursor = page.cursor
  } while (cursor)
  assert.deepEqual(
    rows.map((t) => t.id),
    all.tasks.map((t) => t.id),
  )
  cursor = read({ limit: 2 }).cursor
  assert.equal(read({ cursor, dueTo: '2026-11-02' }).errors[0].code, 'conflict')
  assert.equal(read({ cursor, includeUndated: false }).errors[0].code, 'conflict')
  assert.equal(read({ dueFrom: '2026-02-30' }).errors[0].code, 'validation')
  assert.equal(read({ dueTo: '2027-01-01' }).errors[0].code, 'validation')
  const bootstrap = session.call('flow.workspace.bootstrap', input).value
  assert.deepEqual(
    bootstrap.tasks.map((t) => t.id),
    all.tasks.slice(0, 50).map((t) => t.id),
  )
  assert.equal(bootstrap.collectionPage.total, all.total)
})
