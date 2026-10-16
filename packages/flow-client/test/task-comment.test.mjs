import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'

test('comment refuses blank and non-string content with a field error and no write', () => {
  for (const text of ['', '   ', null, 42, ['hello'], { text: 'hello' }]) {
    const session = createFixtureSession()
    const before = structuredClone(session.data)
    const result = session.call('flow.issue.comment', { id: 'KV-142', text, idempotencyKey: 'refused' })
    assert.equal(result.value.ok, false)
    assert.equal(result.value.errors[0].code, 'validation')
    assert.ok(result.value.fields.text)
    assert.deepEqual(session.data, before)
  }
})

test('comment never creates an orphan for a missing task and refuses read-only callers atomically', () => {
  for (const scenario of ['baseline', 'readonly']) {
    const session = createFixtureSession(scenario)
    const before = structuredClone(session.data)
    const result = session.call('flow.issue.comment', {
      id: 'missing',
      text: 'A comment',
      idempotencyKey: 'refused',
    })
    assert.equal(result.value.ok, false)
    assert.equal(result.value.errors[0].code, scenario === 'readonly' ? 'forbidden' : 'notFound')
    assert.deepEqual(session.data, before)
  }
})

test('comment replay preserves the exact text and appends once after response recovery', () => {
  const session = createFixtureSession()
  const initial = session.data.comments.length
  const args = { id: 'KV-142', text: '@Hà — reviewed\nNext step: retry.', idempotencyKey: 'comment-one' }
  const accepted = session.call('flow.issue.comment', args)
  assert.equal(accepted.ok, true)
  assert.equal(session.data.comments.length, initial + 1)
  assert.equal(session.data.comments.at(-1).text, args.text)
  assert.equal(session.data.comments.at(-1).taskId, args.id)
  const committed = structuredClone(session.data)
  assert.deepEqual(session.call('flow.issue.comment', args), accepted)
  assert.deepEqual(session.data, committed)
})
