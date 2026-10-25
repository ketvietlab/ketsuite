import assert from 'node:assert/strict'
import { test } from 'node:test'
import { restoreRelationSelectionFocus } from '../packages/design-system/src/interactions/relation-select/focus.ts'

test('selected relation returns body/removed-option focus to its trigger without scrolling', () => {
  const calls: unknown[] = [],
    trigger = { isConnected: true, focus: (options: unknown) => calls.push(options) },
    body = { isConnected: true }
  assert.equal(restoreRelationSelectionFocus(trigger, body, body, null), true)
  assert.equal(restoreRelationSelectionFocus(trigger, { isConnected: false }, body, null), true)
  assert.deepEqual(calls, [{ preventScroll: true }, { preventScroll: true }])
})
test('selected relation restores a closing popup focus while preserving an explicit consumer focus destination', () => {
  let calls = 0
  const trigger = { isConnected: true, focus: () => calls++ },
    body = { isConnected: true },
    option = { isConnected: true },
    nextField = { isConnected: true }
  const popup = { contains: (target: unknown) => target === option }
  assert.equal(restoreRelationSelectionFocus(trigger, option, body, popup), true)
  assert.equal(restoreRelationSelectionFocus(trigger, nextField, body, popup), false)
  assert.equal(calls, 1)
})
test('disposed relation fields cannot take focus from a new page', () => {
  let calls = 0
  const body = { isConnected: true }
  assert.equal(
    restoreRelationSelectionFocus({ isConnected: false, focus: () => calls++ }, body, body, null),
    false,
  )
  assert.equal(restoreRelationSelectionFocus(null, body, body, null), false)
  assert.equal(calls, 0)
})
