import test from 'node:test'
import assert from 'node:assert/strict'
import { createFlowHistory, createHistoryLeaveGuard } from '../client/navigation-history.mjs'

function fixture() {
  const calls = [],
    native = {
      state: { flowBackground: { screen: 'goals' } },
      replaceState(state, _, url) {
        this.state = state
        calls.push(['replace', url])
      },
      pushState(state, _, url) {
        this.state = state
        calls.push(['push', url])
      },
      go(delta) {
        calls.push(['go', delta])
      },
      back() {
        calls.push(['back'])
      },
    }
  const history = createFlowHistory(native)
  history.initialize('/flow/goals')
  return { calls, native, history }
}

test('Flow history preserves route state, indexes pushes and keeps replacements at the same position', () => {
  const { native, history } = fixture()
  assert.equal(native.state.flowBackground.screen, 'goals')
  history.pushState({ flowModalDepth: 1 }, '', '/flow/goal-edit')
  assert.equal(history.position, 1)
  assert.equal(native.state.flowModalDepth, 1)
  history.replaceState({ flowModalDepth: 1 }, '', '/flow/goal-edit?lang=vi')
  assert.equal(native.state.flowHistoryIndex, 1)
  native.state = { flowHistoryIndex: 0 }
  assert.equal(history.delta(), -1)
  history.accept('/flow/goals')
  assert.equal(history.position, 0)
})

test('fragment completion adopts KetJS pushes and pop entries without duplicating history', () => {
  const { native, history, calls } = fixture()
  native.state = { __ketScroll: [0, 0] }
  history.navigated('/flow/board', 'push')
  assert.equal(history.position, 1)
  assert.equal(native.state.flowHistoryIndex, 1)
  history.navigated('/flow/sprints', 'push')
  assert.equal(history.position, 2)
  native.state = { flowHistoryIndex: 0, __ketScroll: [0, 0] }
  history.navigated('/flow/goals', 'pop')
  assert.equal(history.position, 0)
  history.navigated('/flow/goals?lang=vi', 'replace')
  assert.equal(history.position, 0)
  assert.ok(calls.every(([operation]) => operation === 'replace'))
})

for (const delta of [-1, 1, -3])
  test(`dirty history traversal ${delta} restores the draft before confirmation`, () => {
    const { native, calls, history } = fixture()
    for (let i = 0; i < 3; i++) history.pushState({}, '', '/flow/goal-edit')
    let dirty = true,
      requested,
      reads = 0,
      restores = 0
    const guard = createHistoryLeaveGuard(history, {
      hasChanges: () => dirty,
      request: (action, returning) => {
        requested = { action, returning }
      },
      restored: () => restores++,
      read: () => reads++,
    })
    native.state = { flowHistoryIndex: 3 + delta }
    guard.pop('/flow/target')
    assert.equal(guard.restoring, true)
    assert.deepEqual(calls.at(-1), ['go', -delta])
    assert.equal(reads, 0)
    assert.equal(requested.returning, true)
    native.state = { flowHistoryIndex: 3 }
    guard.pop('/flow/goal-edit')
    assert.equal(guard.restoring, false)
    assert.equal(restores, 1)
    assert.equal(reads, 0)
    // Keeping the draft performs no traversal. Confirming discards then retries.
    dirty = false
    requested.action()
    assert.deepEqual(calls.at(-1), ['go', delta])
    native.state = { flowHistoryIndex: 3 + delta }
    guard.pop('/flow/target')
    assert.equal(reads, 1)
    assert.equal(history.position, 3 + delta)
  })

test('an old unindexed entry keeps the draft until its target is explicitly accepted', () => {
  const { native, history } = fixture()
  let requested,
    reads = 0
  const guard = createHistoryLeaveGuard(history, {
    hasChanges: () => true,
    request: (action) => {
      requested = action
    },
    restored: () => {},
    read: () => reads++,
  })
  native.state = {}
  guard.pop('/flow/old-route')
  assert.equal(history.currentURL, '/flow/goals')
  assert.equal(reads, 0)
  requested()
  assert.equal(history.currentURL, '/flow/old-route')
  assert.equal(reads, 1)
})
