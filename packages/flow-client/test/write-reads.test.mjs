import test from 'node:test'
import assert from 'node:assert/strict'
import { registerFlowExtension } from '@ketvietlab/flow-client/extensions.mjs'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { FlowApiError } from '@ketvietlab/flow-client/api.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

// The probe reaches the island's own write path and data, as an extension does.
let ctx
registerFlowExtension({
  name: 'write-read-probe',
  create: (context) => {
    ctx = context
    return {}
  },
})
globalThis.window = new EventTarget()
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
const root = () =>
  Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    closest: () => null,
    setAttribute: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  })
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
// Past the pause after which a patched write's screen is read again.
const AFTER_WRITES = 400

function harness(screen = 'all-issues') {
  const fixture = createOrganizationSession('baseline', screen),
    lifetime = new AbortController(),
    calls = []
  let gate = null
  const call = async (name, args) => {
    calls.push(name)
    // The response is what the server holds when the request arrives, whenever it returns.
    const { value } = JSON.parse(JSON.stringify(fixture.call(name, args)))
    if (name === 'flow.workspace.bootstrap' && gate) {
      // Only the next read is held; a later one answers at once.
      const held = gate
      gate = null
      await held
    }
    if (value?.ok === false) throw new FlowApiError(value.errors[0].message, value.errors[0].code)
    return value
  }
  globalThis.history = { state: null, replaceState() {}, pushState() {} }
  const go = (key) => {
    globalThis.location = new URL(`http://flow.local/flow/${key}?company=demo&workspace=product`)
  }
  go(screen)
  const island = createFlowWorkspace({ screen }, { call })
  island.mount({ root: root(), lifetime: lifetime.signal })
  return {
    fixture,
    calls,
    island,
    reads: () => calls.filter((name) => name === 'flow.workspace.bootstrap').length,
    hold: () => {
      const held = Promise.withResolvers()
      gate = held.promise
      return held.resolve
    },
    navigate: (key) => {
      go(key)
      island.update({ screen: key })
    },
    task: (id) => ctx.data().tasks.find((t) => t.id === id),
    close: () => {
      lifetime.abort()
      island.dispose()
    },
  }
}

test('a write that changes one task returns its detail; creating a task or commenting does not', () => {
  const s = createOrganizationSession(),
    version = (id) => s.sessions.get('demo').data.tasks.find((t) => t.id === id).version,
    write = (name, args, key) => s.call(name, { companyId: 'demo', idempotencyKey: key, ...args }).value,
    detail = (id) => s.call('flow.issue.detail', { companyId: 'demo', id }).value
  const saved = write(
    'flow.issue.save',
    { id: 'KV-142', title: 'Đổi tên', expectedVersion: version('KV-142') },
    'a',
  )
  assert.equal(saved.record.task.title, 'Đổi tên')
  assert.deepEqual(saved.record, detail('KV-142'))
  assert.ok(
    saved.record.history.some((h) => h.text.includes('Đổi tên')),
    'its own history comes too',
  )
  for (const [name, args] of [
    ['flow.issue.follow', { id: 'KV-142' }],
    ['flow.issue.assignSprint', { id: 'KV-142', sprint: 'Backlog' }],
  ])
    assert.deepEqual(write(name, args, name).record, detail('KV-142'), name)
  const column = s.sessions.get('demo').data.columns.find((c) => c.kind === 'todo').id
  const moved = write(
    'flow.issue.move',
    { id: 'KV-129', columnId: column, expectedVersion: version('KV-129') },
    'm',
  )
  assert.deepEqual(moved.record, detail('KV-129'))
  const created = write(
    'flow.issue.save',
    { title: 'Việc mới', projectId: 'core', subtasks: ['Việc con'] },
    'n',
  )
  assert.ok(created.id)
  assert.equal(created.record, undefined, 'a new task and its subtasks are read with the screen')
  const commented = write('flow.issue.comment', { id: 'KV-142', text: 'Một bình luận' }, 'c')
  assert.notEqual(commented.ok, false)
  assert.equal(commented.record, undefined)
})

test('a task write patches the task in place and reads the screen once writes pause', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  // Timers wait for tick(); the reads themselves settle on the event loop.
  const flush = async () => {
    for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  const h = harness()
  const save = (id, title) =>
    ctx.mutate('flow.issue.save', { id, title, expectedVersion: h.task(id).version }, null, { quiet: true })
  try {
    await flush()
    assert.equal(h.reads(), 1)
    const id = ctx.data().tasks.find((x) => x.summary && x.projectId === 'core').id
    assert.ok(await save(id, 'Tên mới'))
    assert.equal(h.reads(), 1, 'the write completes without reading the screen')
    assert.equal(h.task(id).title, 'Tên mới')
    assert.equal(h.task(id).summary, true, 'a summary stays a summary')
    assert.equal('description' in h.task(id), false)
    t.mock.timers.tick(200)
    await flush()
    assert.ok(await save(id, 'Tên sau cùng'), 'the next write carries the patched version')
    t.mock.timers.tick(200)
    await flush()
    assert.equal(h.reads(), 1, 'writes that keep coming put the read off')
    t.mock.timers.tick(100)
    await flush()
    assert.equal(h.reads(), 2, 'the writes are followed by one read')
    assert.equal(h.task(id).title, 'Tên sau cùng')
    assert.equal(h.task(id).summary, true)
  } finally {
    h.close()
  }
})
test('a write that returns no record is read before it completes', async () => {
  const h = harness()
  try {
    await settle()
    let seen
    assert.ok(
      await ctx.mutate(
        'flow.issue.save',
        { title: 'Việc mới', projectId: 'core', subtasks: ['Việc con'] },
        (value) => {
          seen = value.id
        },
      ),
    )
    assert.equal(h.reads(), 2, 'read before the write completes')
    assert.ok(h.task(seen), 'the new task is there when its callback runs')
    assert.ok(ctx.data().tasks.some((t) => t.parentId === seen && t.title === 'Việc con'))
    await settle(AFTER_WRITES)
    assert.equal(h.reads(), 2, 'and not again')
  } finally {
    h.close()
  }
})

test('a read that began before a write does not undo the write', async () => {
  const h = harness()
  try {
    await settle()
    const id = ctx.data().tasks.find((t) => t.summary && t.projectId === 'core').id
    const release = h.hold()
    h.navigate('board')
    await settle()
    assert.equal(h.reads(), 2, 'the board read is out')
    assert.ok(
      await ctx.mutate('flow.issue.save', {
        id,
        title: 'Ghi trong lúc đọc',
        expectedVersion: h.task(id).version,
      }),
    )
    release()
    await settle()
    assert.equal(h.task(id).title, 'Ghi trong lúc đọc', 'the earlier read is dropped')
    await settle(AFTER_WRITES)
    assert.equal(h.reads(), 3, 'the screen is read again after the write')
    assert.equal(h.task(id).title, 'Ghi trong lúc đọc')
  } finally {
    h.close()
  }
})

test('navigation shows a screen read again for a while, and asks again after a write or once it has passed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const h = harness()
  try {
    await settle()
    h.navigate('board')
    await settle()
    assert.equal(h.reads(), 2)
    const board = ctx.data()
    h.navigate('all-issues')
    await settle()
    h.navigate('board')
    await settle()
    assert.equal(h.reads(), 2, 'browsing back and forth asks for nothing')
    assert.equal(ctx.data().tasks, board.tasks, 'the board shows the read it had')
    assert.ok(await ctx.mutate('flow.issue.follow', { id: board.tasks[0].id }))
    h.navigate('all-issues')
    await settle()
    assert.equal(h.reads(), 3, 'a read from before the write is not shown again')
    await settle(AFTER_WRITES)
    assert.equal(h.reads(), 3, 'the read that began after the write stands for the one after it')
    h.navigate('board')
    await settle()
    h.navigate('all-issues')
    await settle()
    assert.equal(h.reads(), 4, 'the board is read again; the list read after the write is shown')
    t.mock.timers.tick(30_001)
    h.navigate('board')
    await settle()
    assert.equal(h.reads(), 5, 'a read older than the while is asked for again')
  } finally {
    h.close()
  }
})
