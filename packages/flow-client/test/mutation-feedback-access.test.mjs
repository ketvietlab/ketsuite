import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mutationFeedback } from '../client/mutation-feedback.mjs'

test('a committed command still completes if a concurrent access refusal clears workspace data', () => {
  const result = mutationFeedback('flow.project.delete', { id: 'removed-project' }, { id: 'audit' }, null)
  assert.equal(typeof result.message, 'string')
  assert.ok(result.message.length > 0)
  assert.equal(result.target, null)
})
