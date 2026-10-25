import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requiredTitle } from '../packages/ketsuite/src/modules/flow/native/organization.ts'
import { FlowRefusal } from '../packages/ketsuite/src/modules/flow/native/policy.ts'

test('native title validation distinguishes missing content from excessive length', () => {
  assert.equal(requiredTitle({ title: '  Valid name  ' }), 'Valid name')
  for (const [title, code] of [
    [' ', 'required'],
    ['a'.repeat(241), 'too_long'],
  ])
    assert.throws(
      () => requiredTitle({ title }),
      (error) => error instanceof FlowRefusal && error.fields.title === code,
    )
})
