import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createTaskRelocation } from '@ketvietlab/flow-client/task-relocation.mjs'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const pending = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const destination = { id: 'target', title: 'Destination', workspaceId: 'work' }
const catalogs = {
  columns: [{ id: 'todo', title: 'Pending', kind: 'todo' }],
  types: [],
  fields: [{ id: 'field-new', title: 'New count', kind: 'number' }],
}
function controller(call, extra = {}) {
  const task = { id: 'A-1', title: 'Task', projectId: 'source', version: 1, customFields: { old: 0 } }
  const ctx = {
    task: () => task,
    route: () => 'issue-transfer',
    company: () => 'company',
    data: () => ({ fields: [{ id: 'old', title: 'Count', kind: 'number' }], types: [] }),
    busy: () => false,
    failure: () => null,
    call,
    mutate: async () => true,
    completed: () => {},
    ...extra,
  }
  return { control: createTaskRelocation(ctx), ctx, task }
}
test('destination changes and disposal discard late reads without restoring an old preview', async () => {
  const a = pending(),
    b = pending()
  const { control } = controller((_name, input) => (input.targetProjectId === 'a' ? a.promise : b.promise))
  const first = control.choose('a'),
    second = control.choose('b')
  b.resolve({ projects: [destination], catalogs })
  await second
  a.resolve({ projects: [destination], catalogs: { ...catalogs, columns: [] } })
  await first
  assert.equal(control.state().target, 'b')
  assert.deepEqual(control.state().catalogs, catalogs)
  const late = pending(),
    next = controller(() => late.promise).control
  const read = next.choose('old')
  next.dispose()
  late.resolve({ catalogs, projects: [] })
  await read
  assert.equal(next.state().catalogs, null)
})
test('review captures server authority and explicit zero-value mapping; confirmation cannot precede it', async () => {
  const commands = []
  let completed
  const { control } = controller(
    async (name) =>
      name.endsWith('.options')
        ? { projects: [destination], catalogs, nextCursor: null }
        : {
            sourceVersion: 9,
            sourceProjectId: 'source',
            impactDigest: 'server-digest',
            impact: { fieldsCarried: 1, fieldsDropped: 0 },
          },
    {
      mutate: async (name, input, success) => {
        commands.push({ name, input })
        success({ id: 'A-1' })
        return true
      },
      completed: (value, target) => {
        completed = { value, target }
      },
    },
  )
  control.sync()
  await tick()
  await control.choose('target')
  assert.equal(await control.confirm(), false)
  control.change({ fieldMap: { old: 'field-new' } })
  await control.preview()
  await control.confirm()
  assert.equal(commands[0].name, 'flow.issue.transfer')
  assert.deepEqual(commands[0].input, {
    id: 'A-1',
    targetProjectId: 'target',
    columnId: 'todo',
    typeId: null,
    fieldMap: { old: 'field-new' },
    sourceProjectId: 'source',
    expectedVersion: 9,
    impactDigest: 'server-digest',
  })
  assert.equal(completed.target.workspaceId, 'work')
  control.change({ column: 'review' })
  assert.equal(control.state().preview, null)
  control.dispose()
})
test('failed preview retains choices, definitive refusal requires fresh review, uncertain retry retains authority', async () => {
  let failRead = false,
    code = 'conflict'
  const { control } = controller(
    async (name) => {
      if (name.endsWith('.options')) return { projects: [destination], catalogs, nextCursor: null }
      if (failRead) throw new Error('network')
      return { sourceVersion: 1, sourceProjectId: 'source', impactDigest: 'digest', impact: {} }
    },
    { mutate: async () => false, failure: () => ({ code }) },
  )
  control.sync()
  await tick()
  await control.choose('target')
  control.change({ fieldMap: { old: 'field-new' } })
  failRead = true
  await control.preview()
  assert.deepEqual(control.state().fieldMap, { old: 'field-new' })
  assert.equal(control.state().preview, null)
  failRead = false
  await control.preview()
  await control.confirm()
  assert.equal(control.state().preview, null)
  await control.preview()
  code = 'network'
  await control.confirm()
  assert.equal(control.state().preview.impactDigest, 'digest')
  control.dispose()
})
test('sparse authorized windows remain loadable and copy can be initiated with source read access', async () => {
  const calls = []
  let copied
  const { control } = controller(
    async (name, input) => {
      calls.push(input)
      if (name.endsWith('.preview'))
        return {
          sourceVersion: 1,
          sourceProjectId: 'source',
          impactDigest: 'digest',
          impact: { contentExcluded: true },
        }
      return input.targetProjectId
        ? { catalogs, projects: [destination] }
        : input.cursor
          ? { projects: [destination], nextCursor: null }
          : { projects: [], nextCursor: 'window-1' }
    },
    {
      route: () => 'issue-copy',
      mutate: async (name, input, _success, opts) => {
        copied = { name, input, opts }
        return true
      },
    },
  )
  control.sync()
  await tick()
  assert.equal(control.state().cursor, 'window-1')
  assert.match(renderToStaticString(control.view()), /relocation-target/)
  await control.options(true)
  assert.equal(calls[1].cursor, 'window-1')
  assert.equal(control.state().projects.length, 1)
  await control.choose('target')
  control.change({ title: 'Copy' })
  await control.preview()
  await control.confirm()
  assert.equal(copied.name, 'flow.issue.copyTo')
  assert.equal(copied.input.title, 'Copy')
  assert.equal(copied.opts.allowReadOnly, true)
  control.dispose()
})
test('Atlas options and commands match the native relocation contract, including replay and scope loss', () => {
  const fixture = createOrganizationSession(),
    data = fixture.sessions.get('demo').data,
    task = data.tasks.find((t) => t.id === 'KV-142')
  const options = fixture.call('flow.issue.relocation.options', {
    id: task.id,
    mode: 'transfer',
    companyId: 'demo',
  }).value
  assert.equal(options.ok, true)
  assert.ok(!options.projects.some((p) => p.id === task.projectId))
  const target = options.projects[0]
  assert.ok(target)
  const args = { id: task.id, targetProjectId: target.id, mode: 'copy', companyId: 'demo' }
  const preview = fixture.call('flow.issue.relocation.preview', args).value
  assert.equal(preview.ok, true)
  const input = {
    ...args,
    sourceProjectId: preview.sourceProjectId,
    expectedVersion: preview.sourceVersion,
    impactDigest: preview.impactDigest,
    idempotencyKey: 'copy-once',
  }
  const copied = fixture.call('flow.issue.copyTo', input).value
  assert.equal(copied.ok, true)
  assert.equal(copied.record.task.description, '')
  assert.equal(copied.record.task.projectId, target.id)
  assert.equal(fixture.call('flow.issue.copyTo', input).value.id, copied.id)
  assert.equal(data.tasks.filter((t) => t.id === copied.id).length, 1)
  const fresh = fixture.call('flow.issue.relocation.preview', { ...args, mode: 'transfer' }).value
  task.version++
  assert.equal(
    fixture.call('flow.issue.transfer', {
      ...input,
      mode: 'transfer',
      sourceProjectId: fresh.sourceProjectId,
      expectedVersion: fresh.sourceVersion,
      impactDigest: fresh.impactDigest,
      idempotencyKey: 'stale',
    }).value.ok,
    false,
  )
})
test('relocation presenters render translated impact and mapped fields in all product languages', async () => {
  for (const lang of ['en', 'ja', 'vi']) {
    setFlowLocale(lang)
    const { control } = controller(async (name) =>
      name.endsWith('.options')
        ? { projects: [destination], catalogs, nextCursor: null }
        : {
            impact: { fieldsCarried: 1, contentExcluded: true },
            sourceVersion: 1,
            sourceProjectId: 'source',
            impactDigest: 'd',
          },
    )
    control.sync()
    await tick()
    await control.choose('target')
    await control.preview()
    const view = renderToStaticString(control.view())
    assert.match(view, /relocation-field-old/)
    assert.match(view, /data-flow="properties"/)
    assert.doesNotMatch(view, /flow\.relocation\./)
    control.dispose()
  }
})
test('actor, owner and access-revision boundaries discard cached private options; denied reads refresh authority', async () => {
  let actor = 'a',
    revision = 1,
    refused = false,
    refreshed = 0,
    reads = 0
  const { control, task } = controller(
    async () => {
      reads++
      if (refused) throw Object.assign(new Error('refused'), { code: 'forbidden' })
      return { projects: [destination], catalogs, nextCursor: null }
    },
    {
      data: () => ({ user: { id: actor }, organizationRevision: revision, fields: [], types: [] }),
      refresh: () => {
        refreshed++
      },
    },
  )
  control.sync()
  await tick()
  await control.choose('target')
  revision++
  control.sync()
  assert.equal(control.state().target, '')
  await tick()
  actor = 'b'
  control.sync()
  assert.equal(control.state().catalogs, null)
  await tick()
  task.projectId = 'other'
  control.sync()
  assert.equal(control.state().preview, null)
  await tick()
  assert.ok(reads >= 4)
  await control.choose('target')
  refused = true
  await control.preview()
  assert.deepEqual(control.state().projects, [])
  assert.equal(control.state().catalogs, null)
  assert.equal(refreshed, 1)
  control.dispose()
})
test('blocked transfer explains children and incompatible mapping instead of raw field codes', async () => {
  setFlowLocale('en')
  const { control } = controller(async (name) => {
    if (name.endsWith('.options')) return { projects: [destination], catalogs, nextCursor: null }
    throw Object.assign(new Error('validation'), { code: 'validation', fields: { id: 'has_children' } })
  })
  control.sync()
  await tick()
  await control.choose('target')
  await control.preview()
  assert.match(control.state().error, /has children/)
  assert.doesNotMatch(control.state().error, /has_children/)
  control.dispose()
})
