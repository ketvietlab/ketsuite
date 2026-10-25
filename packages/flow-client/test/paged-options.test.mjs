import test from 'node:test'
import assert from 'node:assert/strict'
import { createPagedOptions } from '../client/paged-options.mjs'
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
test('remote options query the entire scoped directory and merge pages without stale scopes', async () => {
  let scope = 'company1/project1'
  const calls = [],
    accepted = []
  const picker = createPagedOptions({
    scope: () => scope,
    delay: 0,
    accept: (items) => accepted.push(...items),
    read: (input, signal) => new Promise((resolve, reject) => calls.push({ input, signal, resolve, reject })),
  })
  void picker.open()
  picker.query('Project 500')
  await tick()
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(calls[1].input.query, 'Project 500')
  calls[0].resolve({ items: [{ id: 'wrong' }], total: 1, cursor: null })
  await tick()
  assert.deepEqual(picker.state().items, [])
  calls[1].resolve({ items: [{ id: '500' }], total: 2, cursor: 'next' })
  await tick()
  void picker.more()
  assert.equal(calls[2].input.cursor, 'next')
  calls[2].resolve({ items: [{ id: '500' }, { id: '501' }], total: 2, cursor: null })
  await tick()
  assert.deepEqual(
    picker.state().items.map((item) => item.id),
    ['500', '501'],
  )
  picker.query('private')
  await tick()
  scope = 'company2/project2'
  calls[3].resolve({ items: [{ id: 'private' }], total: 1, cursor: null })
  await tick()
  assert.equal(
    accepted.some((item) => item.id === 'private'),
    false,
  )
  void picker.open()
  picker.close()
  calls[4].resolve({ items: [{ id: 'closed' }], total: 1, cursor: null })
  await tick()
  assert.equal(
    accepted.some((item) => item.id === 'closed'),
    false,
  )
  picker.dispose()
})
test('remote option retry and revocation do not leave retained private choices', async () => {
  let fail = 'offline',
    refusals = 0
  const picker = createPagedOptions({
    scope: () => 'scope',
    refused: () => refusals++,
    read: async () => {
      if (fail) throw Object.assign(new Error(fail), { code: fail })
      return { items: [{ id: 'one' }], total: 1, cursor: 'more' }
    },
  })
  await picker.open()
  assert.equal(picker.state().error, 'offline')
  fail = ''
  await picker.retry()
  assert.equal(picker.state().items.length, 1)
  fail = 'forbidden'
  await picker.more()
  assert.equal(refusals, 1)
  assert.deepEqual(picker.state().items, [])
  assert.equal(picker.state().cursor, null)
  picker.dispose()
})
