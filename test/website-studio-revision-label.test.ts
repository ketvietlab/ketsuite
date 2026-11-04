import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatTime, revisionLabel } from '../packages/website-client/client/screens/format.ts'

/** The history pickers in the Builder panel and the History screen name a revision a person can read. */
test('a revision is named by when, its title and a short id, never by its bare id', () => {
  const revision = {
    revisionId: 'dbf12737-158f-4fb9-b8f0-cafc3145831e',
    title: 'Trang chủ',
    updatedAt: '2026-10-27T03:04:05.000Z',
  }
  const label = revisionLabel(revision)
  assert.equal(label, `${formatTime(revision.updatedAt)} · Trang chủ · dbf127`)
  assert.doesNotMatch(label, /158f-4fb9/)
  // Two saves in the same minute under one title still read differently.
  assert.notEqual(label, revisionLabel({ ...revision, revisionId: 'a1b2c3d4-0000-0000-0000-000000000000' }))
  assert.equal(
    revisionLabel({ revisionId: 'abcdef123', title: '', updatedAt: null }),
    `${formatTime(null)} · abcdef`,
  )
})
