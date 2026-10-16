import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createTaskComposer } from '@ketvietlab/flow-client/task-composer.mjs'
import { createFixtureSession } from '../atlas/store.mjs'

test('task updates never create a replacement for a missing ID and titles require a nonempty string', () => {
  for (const patch of [
    { id: 'missing', title: 'Replacement' },
    ...[null, [], 42, ' '].map((title) => ({ id: 'KV-142', title })),
  ]) {
    const session = createFixtureSession(),
      before = structuredClone(session.data)
    const result = session.call('flow.issue.save', { ...patch, idempotencyKey: 'bad' })
    assert.equal(result.value.ok, false)
    assert.equal(result.value.errors[0].code, patch.id === 'missing' ? 'notFound' : 'validation')
    assert.deepEqual(session.data, before)
  }
})

test('subtask creation refuses a missing, archived or foreign-project parent before any write', () => {
  for (const [parentId, projectId, archived] of [
    ['missing', 'core', false],
    ['KV-142', 'core', true],
    ['KV-142', 'ops', false],
  ]) {
    const session = createFixtureSession()
    if (archived) session.data.tasks.find((task) => task.id === parentId).archived = true
    const before = structuredClone(session.data)
    const result = session.call('flow.issue.save', {
      title: 'Child',
      parentId,
      projectId,
      idempotencyKey: 'bad',
    })
    assert.equal(result.value.ok, false)
    assert.ok(result.value.fields[projectId === 'ops' ? 'projectId' : 'parentId'])
    assert.deepEqual(session.data, before)
  }
})

test('malformed creation bundles are refused before inserting the task, children or attachment metadata', () => {
  const patches = [
    { subtasks: {} },
    { subtasks: ['Valid child', null] },
    { attachments: null },
    { attachments: [{ title: 'brief.txt', size: '10' }] },
    { attachments: [{ title: 'brief.txt', size: -1 }] },
    { attachments: [{ title: 'brief.txt', size: 26 * 1024 * 1024 }] },
  ]
  for (const patch of patches) {
    const session = createFixtureSession(),
      before = structuredClone(session.data)
    const result = session.call('flow.issue.save', {
      title: 'Task bundle',
      projectId: 'core',
      ...patch,
      idempotencyKey: 'bad',
    })
    assert.equal(result.value.ok, false)
    assert.deepEqual(session.data, before)
  }
})

test('composer binds advanced field errors and freezes native controls/editor during a pending write', () => {
  const data = createFixtureSession().data
  let busy = false
  const ctx = {
    data: () => data,
    project: () => 'core',
    route: () => 'issue-new',
    record: () => 'KV-142',
    canWrite: () => true,
    busy: () => busy,
    errors: () => ({ priority: 'Choose a priority', subtasks: 'Invalid child', attachments: 'Too large' }),
    create: () => {},
  }
  const composer = createTaskComposer(ctx)
  const normal = renderToStaticString(composer.view())
  for (const id of ['priority', 'subtasks', 'attachments'])
    assert.match(normal, new RegExp(`(?:id|name)="${id}"[^>]*aria-invalid="true"`), id)
  busy = true
  const pending = renderToStaticString(composer.view())
  assert.match(pending, /name="title"[^>]*disabled/)
  assert.match(pending, /name="subtasks"[^>]*disabled/)
  assert.match(pending, /name="attachments"[^>]*disabled/)
  assert.doesNotMatch(pending, /contenteditable="true"/)
})
