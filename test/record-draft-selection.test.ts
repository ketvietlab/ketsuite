import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  consumeRecordCommandDrafts,
  consumeRecordDialogDrafts,
  recordDraftCheckedValues,
  resetRecordDraftFields,
} from '../packages/ketsuite/src/ui/client/record-modal.tsx'

const draft = () => ({
  values: { shipmentIds: 'a', shipmentIdsMore: 'keep', reason: 'Keep my reason' },
  initialValues: { shipmentIds: '', reason: '' },
  checks: {
    'shipmentIds\u0000a': true,
    'shipmentIds\u0000b': false,
    'shipmentIds\u0000page-two': true,
    'shipmentIdsMore\u0000other': true,
    'other\u0000a': true,
  },
  initialChecks: { 'shipmentIds\u0000a': false, 'shipmentIdsMore\u0000other': false },
})

test('dialog consumption defaults to clearing while an explicit ancillary refresh retains values and checkbox baselines', () => {
  const state = draft()
  const empty = { values: {}, checks: {}, initialValues: {}, initialChecks: {} }
  assert.deepEqual(consumeRecordDialogDrafts(state), empty)
  assert.deepEqual(consumeRecordDialogDrafts(state, false), empty)
  assert.equal(consumeRecordDialogDrafts(state, true), state)
  assert.deepEqual(state, draft())
})

test('record checked values include captured other-page selections and exclude unchecked or similarly named fields', () => {
  const state = draft()
  assert.deepEqual(recordDraftCheckedValues(state, 'shipmentIds'), ['a', 'page-two'])
  assert.deepEqual(recordDraftCheckedValues(state, 'missing'), [])
  const returned = recordDraftCheckedValues(state, 'shipmentIds')
  assert.notEqual(returned, recordDraftCheckedValues(state, 'shipmentIds'))
  assert.deepEqual(state, draft(), 'reading selections does not mutate the draft')
})

test('named resets and successful consumption clear every checkbox value and preserve other drafts', () => {
  const state = draft()
  for (const cleared of [
    resetRecordDraftFields(state, ['shipmentIds']),
    consumeRecordCommandDrafts(state, ['shipmentIds']),
  ]) {
    assert.deepEqual(recordDraftCheckedValues(cleared, 'shipmentIds'), [])
    assert.deepEqual(recordDraftCheckedValues(cleared, 'shipmentIdsMore'), ['other'])
    assert.equal(cleared.values.reason, 'Keep my reason')
    assert.equal(cleared.values.shipmentIds, undefined)
    assert.equal(cleared.initialChecks['shipmentIds\u0000a'], undefined)
  }
  assert.deepEqual(state, draft(), 'reset snapshots stay immutable')
  assert.deepEqual(consumeRecordCommandDrafts(state, []), state, 'empty reset is compatible')
  assert.deepEqual(recordDraftCheckedValues(consumeRecordCommandDrafts(state), 'shipmentIds'), [])
})

test('reading and resetting a child layer cannot consume parent selections', () => {
  const parent = draft()
  const child = { ...draft(), checks: { 'shipmentIds\u0000child': true } }
  assert.deepEqual(recordDraftCheckedValues(child, 'shipmentIds'), ['child'])
  assert.deepEqual(
    recordDraftCheckedValues(resetRecordDraftFields(child, ['shipmentIds']), 'shipmentIds'),
    [],
  )
  assert.deepEqual(recordDraftCheckedValues(parent, 'shipmentIds'), ['a', 'page-two'])
})
