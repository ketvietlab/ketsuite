import assert from 'node:assert/strict'
import test from 'node:test'
import { canRunReadOnlyCommand } from '../client/command-contract.mjs'

test('read-only preference presenters need a finite extension and per-command opt-in', () => {
  const extensions = [{ readOnlyCommands: ['example.calendar.save'] }]
  assert.equal(canRunReadOnlyCommand('example.calendar.save', {}, extensions), false)
  assert.equal(canRunReadOnlyCommand('example.calendar.save', { allowReadOnly: true }, []), false)
  assert.equal(canRunReadOnlyCommand('example.calendar.save', { allowReadOnly: true }, extensions), true)
  assert.equal(canRunReadOnlyCommand('flow.issue.save', { allowReadOnly: true }, extensions), false)
  assert.equal(canRunReadOnlyCommand('flow.preferences.save'), true)
  assert.equal(canRunReadOnlyCommand('flow.view.save', { allowReadOnly: true }), true)
})
