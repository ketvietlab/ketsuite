import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayTime } from '../client/timeline.mjs'

test('personal timezones format timestamps without changing business dates', () => {
  const instant = '2026-10-27T12:00:00Z'
  for (const timezone of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
    assert.equal(
      displayTime(instant, 'en-US', timezone),
      new Date(instant).toLocaleString('en-US', { timeZone: timezone }),
    )
    assert.equal(displayTime('2026-10-28', 'en-US', timezone), '2026-10-28')
  }
  assert.notEqual(
    displayTime(instant, 'en-US', 'Pacific/Kiritimati'),
    displayTime(instant, 'en-US', 'America/Los_Angeles'),
  )
  assert.equal(displayTime(undefined, 'en-US', 'UTC'), undefined)
  assert.equal(displayTime('invalidTimestamp', 'en-US', 'UTC'), 'invalidTimestamp')
})
