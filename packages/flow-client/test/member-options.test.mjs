import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemberOptions } from '../client/member-options.mjs'
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
test('remote people reads cancel stale search, preserve paging and isolate Company changes', async () => {
  let company = 'one'
  const calls = [],
    received = []
  const picker = createMemberOptions({
    companyId: () => company,
    delay: 0,
    onItems: (items) => received.push(items),
    call: (name, input, options) => {
      const pending = deferred()
      calls.push({ name, input, options, pending })
      return pending.promise
    },
  })
  picker.open('picker', 'project')
  picker.query('last member')
  await tick()
  assert.equal(calls[0].options.signal.aborted, true)
  calls[0].pending.resolve({ items: [{ id: 'stale' }], total: 1, cursor: null })
  calls[1].pending.resolve({ items: [{ id: '1000', name: 'Last member' }], total: 2, cursor: 'next' })
  await tick()
  assert.equal(picker.state().items[0].id, '1000')
  const more = picker.more()
  calls[2].pending.resolve({ items: [{ id: '1000' }, { id: '1001' }], total: 2, cursor: null })
  await more
  assert.deepEqual(
    picker.state().items.map((u) => u.id),
    ['1000', '1001'],
  )
  picker.query('old Company')
  await tick()
  company = 'two'
  picker.open('next-picker', 'new-project')
  calls[3].pending.resolve({ items: [{ id: 'private' }], total: 1, cursor: null })
  await tick()
  assert.equal(
    received.some((items) => items.some((u) => u.id === 'private')),
    false,
  )
  picker.close('picker')
  assert.equal(picker.state().id, 'next-picker')
  picker.close('next-picker')
  assert.equal(calls[4].options.signal.aborted, true)
  calls[4].pending.resolve({ items: [], total: 0, cursor: null })
  picker.dispose()
})
test('permission refusals erase retained options and invoke recovery once', async () => {
  let refused = 0
  const picker = createMemberOptions({
    companyId: () => 'one',
    onRefusal: () => refused++,
    call: async () => {
      throw Object.assign(new Error('Access removed'), { code: 'forbidden' })
    },
  })
  picker.open('picker', 'project')
  await tick()
  assert.equal(picker.state().error, 'Access removed')
  assert.deepEqual(picker.state().items, [])
  assert.equal(refused, 1)
  picker.dispose()
})
