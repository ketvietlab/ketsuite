import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Y from 'yjs'
import {
  applySnapshotChanged,
  forget,
  getOrCreateLive,
} from '../packages/ketsuite/src/modules/livedoc/sync.ts'

test('native document merge distinguishes duplicate, new text and deletion-only updates', () => {
  const ref = { company: 'native-replay-company', kind: 'flow.Document', id: 'native-replay' }
  const client = new Y.Doc()
  try {
    getOrCreateLive(ref)
    const text = client.getText('producer-replay')
    text.insert(0, 'Keep this text')
    const update = Y.encodeStateAsUpdate(client)
    assert.equal(applySnapshotChanged(ref, update), true)
    assert.equal(applySnapshotChanged(ref, update), false)
    const before = Y.encodeStateVector(client)
    text.delete(0, 5)
    assert.deepEqual(
      Y.encodeStateVector(client),
      before,
      'delete-only changes cannot be detected from a state vector alone',
    )
    const deletion = Y.encodeStateAsUpdate(client, before)
    assert.equal(applySnapshotChanged(ref, deletion), true)
    assert.equal(applySnapshotChanged(ref, deletion), false)
  } finally {
    client.destroy()
    forget(ref)
  }
})
