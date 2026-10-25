import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  consumeRecordCommandDrafts,
  consumeRecordDialogDrafts,
  recordDraftCheckedValues,
  recordDraftHasChanges,
  resetRecordDraftFields,
  settleRecordDraftBaselines,
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

test('a record read again drops baselines no capture holds, so a saved field is not reported as edited', () => {
  // After a save consumes the drafts, the render before the re-read seeds `draft()` baselines
  // from the data the save replaced; the next capture then compares the saved value to them.
  const seeded: Parameters<typeof settleRecordDraftBaselines>[0] = {
    values: {},
    checks: {},
    initialValues: { custodian: 'Old desk', name: 'Chairs' },
    initialChecks: { 'tags\u0000a': false },
  }
  const captured = { ...seeded, values: { custodian: 'New desk', name: 'Chairs' } }
  assert.equal(recordDraftHasChanges(captured), true, 'the stale baseline reads as an edit')
  const settled = settleRecordDraftBaselines(seeded)
  assert.deepEqual(settled, { values: {}, checks: {}, initialValues: {}, initialChecks: {} })
  // The next render seeds the field the way `draft()` does, from the record as read now.
  const reseed = (state: typeof seeded) => {
    state.initialValues = { ...state.initialValues }
    state.initialValues.custodian ??= 'New desk'
    return { ...state, values: { custodian: 'New desk' } }
  }
  assert.equal(recordDraftHasChanges(reseed(settleRecordDraftBaselines(seeded))), false)
  assert.equal(recordDraftHasChanges(reseed({ ...seeded })), true, 'unsettled, the stale baseline wins')
  // A field the reader has captured keeps its baseline and its typed value.
  const typed = settleRecordDraftBaselines(draft())
  assert.deepEqual(typed.values, draft().values)
  assert.deepEqual(typed.initialValues, { shipmentIds: '', reason: '' })
  assert.deepEqual(typed.initialChecks, draft().initialChecks)
  assert.deepEqual(seeded.initialValues, { custodian: 'Old desk', name: 'Chairs' }, 'settling never mutates')
})

test('every read of a record settles its baselines in the same batch as the new data', () => {
  const runtime = readFileSync('packages/ketsuite/src/ui/client/record-modal.tsx', 'utf8')
  const adopt = runtime.slice(runtime.indexOf('const adopt = '), runtime.indexOf('const load = async'))
  assert.match(adopt, /batch\(\(\) => \{\s*envelope\.set\(next\)/u)
  assert.match(adopt, /recordDrafts\.set\(settleRecordDraftBaselines\(recordDrafts\(\)\)\)/u)
  assert.match(adopt, /dialogDrafts\.set\(settleRecordDraftBaselines\(dialogDrafts\(\)\)\)/u)
  const load = runtime.slice(runtime.indexOf('const load = async'), runtime.indexOf('const layers = '))
  assert.doesNotMatch(load, /envelope\.set\(/u, 'load replaces the record only through adopt')
  assert.equal(load.match(/adopt\(/gu)?.length, 2, 'the cached and the fresh read both adopt')
})
