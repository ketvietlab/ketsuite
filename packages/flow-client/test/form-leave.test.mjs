import test from 'node:test'
import assert from 'node:assert/strict'
import { createFormLeaveGuard } from '../client/form-leave.mjs'

function fixture() {
  const form = { value: 'original' }
  let context = 'demo|product|goal-edit|g1'
  const guard = createFormLeaveGuard({
    context: () => context,
    forms: () => [form],
    snapshot: (f) => f.value,
  })
  guard.sync()
  return {
    form,
    guard,
    context: (value) => {
      context = value
    },
  }
}

test('cancel compares native draft values, including edits reverted to the baseline', () => {
  const { form, guard } = fixture()
  assert.equal(guard.hasChanges(), false)
  form.value = 'draft'
  guard.sync()
  assert.equal(guard.hasChanges(), true)
  form.value = 'original'
  assert.equal(guard.hasChanges(), false)
})

test('failed saves retain the draft and accepted saves clear only the submitted values', () => {
  const { form, guard } = fixture()
  form.value = 'submitted'
  const submission = guard.submission(form)
  assert.equal(guard.hasChanges(), true)
  form.value = 'new edits while saving'
  guard.accept(submission)
  assert.equal(guard.hasChanges(), true)
  form.value = 'submitted'
  assert.equal(guard.hasChanges(), false)
})

test('draft baselines cannot cross route or tenant context and autosaved views are excluded', () => {
  const f = fixture()
  f.form.value = 'draft'
  const old = f.guard.submission(f.form)
  f.context('other-company|product|goal-edit|g1')
  f.guard.sync()
  f.form.value = 'other draft'
  f.guard.accept(old)
  assert.equal(f.guard.hasChanges(), true)
  f.context('')
  f.guard.sync()
  assert.equal(f.guard.hasChanges(), false)
})

test('confirmed discard removes only the local baseline and disposal releases it', () => {
  const { form, guard } = fixture()
  form.value = 'draft'
  guard.discard()
  assert.equal(guard.hasChanges(), false)
  guard.sync()
  form.value = 'another draft'
  assert.equal(guard.hasChanges(), true)
  guard.dispose()
  assert.equal(guard.hasChanges(), false)
})

test('accepting one native form does not discard an unsaved draft in a sibling form', () => {
  const forms = [{ value: 'a' }, { value: 'b' }]
  const guard = createFormLeaveGuard({
    context: () => 'workload',
    forms: () => forms,
    snapshot: (f) => f.value,
  })
  guard.sync()
  forms[0].value = 'submitted'
  forms[1].value = 'other draft'
  guard.accept(guard.submission(forms[0]))
  assert.equal(guard.hasChanges(), true)
  forms[1].value = 'b'
  assert.equal(guard.hasChanges(), false)
})
