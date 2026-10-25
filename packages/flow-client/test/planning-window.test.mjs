import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlanningWindows } from '../client/planning-window.mjs'

test('risk windows keep modes and workspace isolated', async () => {
  let scope = 'company:workspace',
    requests = []
  const windows = createPlanningWindows({
    scope: () => scope,
    projectId: () => undefined,
    read: (input, signal) => new Promise((resolve) => requests.push({ input, signal, resolve })),
    accept: () => {},
    refused: () => {},
  })
  const blocked = { risk: 'blocked' },
    review = { risk: 'review' }
  const a = windows.load(blocked),
    b = windows.load(review)
  requests[1].resolve({
    tasks: [],
    total: 0,
    cursor: null,
    projectCounts: {},
    projects: [],
    projectTotal: 1,
    today: '2026-10-13',
  })
  await b
  requests[0].resolve({
    tasks: [{ id: 'one' }],
    total: 1,
    cursor: null,
    projectCounts: { p: 1 },
    projects: [{ id: 'p', count: 1 }],
    projectTotal: 1,
  })
  await a
  assert.equal(windows.state(blocked).total, 1)
  assert.equal(windows.state(review).total, 0)
  assert.equal(windows.state(blocked).projects[0].count, 1)
  scope = 'company:another-workspace'
  assert.equal(windows.state(blocked), undefined)
  windows.dispose()
})

test('planning task windows isolate scopes, dedupe pages and retry stale cursors from the beginning', async () => {
  let scope = 'one',
    requests = [],
    accepted = [],
    refused = []
  const windows = createPlanningWindows({
    scope: () => scope,
    projectId: () => 'project',
    read: (input, signal) =>
      new Promise((resolve, reject) => requests.push({ input, signal, resolve, reject })),
    accept: (tasks) => accepted.push(tasks),
    refused: (error) => refused.push(error.code),
  })
  const input = { sprintId: 'sprint' }
  let pending = windows.load(input)
  assert.equal(requests[0].input.limit, 10)
  assert.equal(requests[0].input.projectId, 'project')
  requests[0].resolve({ tasks: [{ id: '1' }], total: 3, cursor: 'next' })
  await pending
  pending = windows.load(input)
  assert.equal(requests[1].input.cursor, 'next')
  requests[1].resolve({ tasks: [{ id: '1' }, { id: '2' }], total: 3, cursor: 'last' })
  await pending
  assert.equal(windows.state(input).items.length, 2)
  pending = windows.load(input)
  requests[2].reject(Object.assign(new Error('stale'), { code: 'conflict' }))
  await pending
  assert.equal(windows.state(input).error.code, 'conflict')
  pending = windows.load(input, { restart: true })
  assert.equal(requests[3].input.cursor, undefined)
  requests[3].resolve({ tasks: [{ id: '3' }], total: 1, cursor: null })
  await pending
  assert.deepEqual(windows.state(input).items, [{ id: '3' }])
  const after = { sprintId: 'another' }
  pending = windows.load(after)
  scope = 'two'
  requests[4].resolve({ tasks: [{ id: 'private' }], total: 1 })
  await pending
  assert.equal(
    accepted.flat().some((t) => t.id === 'private'),
    false,
  )
  assert.equal(windows.state(input), undefined, 'a reused sprint ID never reuses another context page')
  windows.reset()
  pending = windows.load(after)
  windows.reset()
  assert.equal(requests[5].signal.aborted, true)
  requests[5].resolve({ tasks: [{ id: 'late' }] })
  await pending
  assert.equal(windows.state(after), undefined)
  pending = windows.load(after)
  requests[6].reject(Object.assign(new Error('denied'), { code: 'forbidden' }))
  await pending
  assert.deepEqual(refused, ['forbidden'])
  windows.dispose()
})

test('Epic task and milestone windows cannot reuse each other or another Epic', async () => {
  const windows = createPlanningWindows({
    scope: () => 'company/project/epic',
    projectId: () => 'p',
    read: async (input) => ({ tasks: [{ id: input.epicId + ':' + !!input.milestonesOnly }], total: 1 }),
    accept() {},
    refused() {},
  })
  for (const input of [{ epicId: 'a' }, { epicId: 'a', milestonesOnly: true }, { epicId: 'b' }])
    await windows.load(input)
  assert.equal(windows.state({ epicId: 'a' }).items[0].id, 'a:false')
  assert.equal(windows.state({ epicId: 'a', milestonesOnly: true }).items[0].id, 'a:true')
  assert.equal(windows.state({ epicId: 'b' }).items[0].id, 'b:false')
  windows.dispose()
})
