import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordDiscardAccepted } from '../packages/ketsuite/src/ui/client/record-modal.js'

const draft = {
  values: { name: 'Edited' },
  initialValues: { name: 'Original' },
  checks: {},
  initialChecks: {},
}
test('record preview discard: legacy drafts and files retain confirmation/cancellation', () => {
  let asked = 0
  const cancel = () => {
    asked++
    return false
  }
  assert.equal(recordDiscardAccepted(draft, false, undefined, cancel), false)
  assert.equal(
    recordDiscardAccepted({ ...draft, values: { name: 'Original' } }, true, 'confirm', cancel),
    false,
  )
  assert.equal(asked, 2)
  assert.equal(
    recordDiscardAccepted(draft, false, 'confirm', () => true),
    true,
  )
})
test('record preview discard: explicit preview allowance does not weaken parent draft protection', () => {
  let asked = 0
  const cancel = () => {
    asked++
    return false
  }
  assert.equal(recordDiscardAccepted(draft, false, 'allow', cancel), true)
  assert.equal(asked, 0)
  assert.equal(recordDiscardAccepted(draft, false, undefined, cancel), false)
  assert.equal(asked, 1)
  assert.equal(draft.values.name, 'Edited')
})
