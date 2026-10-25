import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskOptions } from '../client/task-options.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { createTaskComposer, taskCreatePayload } from '@ketvietlab/flow-client/task-composer.mjs'
import { taskFieldControl } from '../dist/task-field-control.mjs'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const catalogs = (projectId) => ({
  projectId,
  columns: [{ id: 'todo', label: 'Todo', kind: 'todo' }],
  types: [{ id: 'type', code: 'task', title: 'Scoped type' }],
  tags: [],
  fields: [{ id: 'required', title: 'Exact required field', kind: 'text', required: true }],
})

test('composer catalog reads fence project, Company and close, retaining no stale choices', async () => {
  let company = 'one'
  const calls = [],
    accepted = []
  const options = createTaskOptions({
    companyId: () => company,
    accept: (value) => accepted.push(value),
    call: (name, input, config) => new Promise((resolve) => calls.push({ name, input, config, resolve })),
  })
  void options.prepare('first')
  void options.prepare('second')
  assert.equal(calls[0].config.signal.aborted, true)
  calls[0].resolve(catalogs('first'))
  await tick()
  assert.equal(options.state().value, null)
  calls[1].resolve(catalogs('second'))
  await tick()
  assert.equal(options.state().value.projectId, 'second')
  void options.prepare('second')
  assert.equal(calls.length, 2)
  void options.prepare('third')
  company = 'two'
  calls[2].resolve(catalogs('third'))
  await tick()
  assert.equal(options.state().value, null)
  void options.prepare('fourth')
  options.close()
  calls[3].resolve(catalogs('fourth'))
  await tick()
  assert.equal(options.state().value, null)
  assert.deepEqual(
    accepted.map((value) => value.projectId),
    ['second'],
  )
})

test('catalog failures clear choices, retry succeeds, refusal reaches the authority boundary', async () => {
  let failure = Object.assign(new Error('No network'), { code: 'offline' })
  const refused = []
  const options = createTaskOptions({
    companyId: () => 'one',
    refused: (error) => refused.push(error.code),
    call: async () => {
      if (failure) throw failure
      return catalogs('project')
    },
  })
  await options.prepare('project')
  assert.equal(options.state().error, 'No network')
  assert.equal(options.state().value, null)
  failure = null
  await options.retry()
  assert.equal(options.state().value.fields[0].id, 'required')
  failure = Object.assign(new Error('Denied'), { code: 'forbidden' })
  await options.retry()
  assert.equal(options.state().value, null)
  assert.deepEqual(refused, ['forbidden'])
})

test('task creation waits for exact fields instead of using an unrelated bootstrap catalog', async () => {
  const session = createOrganizationSession(),
    data = session.call('flow.workspace.bootstrap', { companyId: 'demo' }).value
  let release
  const composer = createTaskComposer({
    data: () => data,
    project: () => data.projects[0].id,
    companyId: () => 'demo',
    route: () => 'issue-new',
    record: () => '',
    canWrite: () => true,
    errors: () => ({}),
    create: () => {},
    call: () =>
      new Promise((resolve) => {
        release = resolve
      }),
  })
  const pending = composer.prepare()
  assert.equal(composer.ready(), false)
  assert.doesNotMatch(renderToStaticString(composer.view()), /name="title"[^>]*disabled/)
  assert.doesNotMatch(renderToStaticString(composer.view()), /Exact required field/)
  release(catalogs(data.projects[0].id))
  await pending
  assert.equal(composer.ready(), true)
  const html = renderToStaticString(composer.view())
  assert.match(html, /Exact required field/)
  assert.match(html, /name="custom-required"/)
  assert.match(html, /Scoped type/)
  assert.match(html, /value="type"[^>]*selected/)
  const fields = { text: 'Draft', number: 3, bool: false, multi: ['a'] }
  assert.deepEqual(taskCreatePayload({ title: 'New', customFields: fields }).customFields, fields)
  composer.dispose()
  assert.equal(composer.ready(), false)
})

test('Atlas exposes the same project catalog and refuses another Company project', () => {
  const session = createOrganizationSession(),
    data = session.call('flow.workspace.bootstrap', { companyId: 'demo' }).value
  const projectId = data.projects[0].id
  const result = session.call('flow.project.taskOptions', { companyId: 'demo', projectId }).value
  assert.equal(result.projectId, projectId)
  assert.ok(result.fields.every((field) => !field.projectId || field.projectId === projectId))
  const denied = session.call('flow.project.taskOptions', { companyId: 'north', projectId }).value
  assert.equal(denied.ok, false)
})

test('task fields preserve typed compatibility options and checkbox controls', () => {
  const choice = renderToStaticString(
    taskFieldControl(
      {
        id: 'choice',
        title: 'Choice',
        kind: 'single-select',
        options: [{ id: 'id', title: 'Named choice' }],
      },
      'id',
      { change() {} },
    ),
  )
  assert.match(choice, /value="id"[^>]*selected/)
  assert.match(choice, /Named choice/)
  assert.doesNotMatch(choice, /\[object Object\]/)
  const checkbox = renderToStaticString(
    taskFieldControl({ id: 'flag', title: 'Flag', kind: 'checkbox' }, false, { change() {} }),
  )
  assert.match(checkbox, /value="false"[^>]*selected/)
})
