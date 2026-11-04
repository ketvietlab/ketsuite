import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Y from 'yjs'
import type { ServeContext } from '@ketvietlab/ketjs'
import { flatten } from '../packages/ketsuite/src/modules/livedoc/documents.ts'
import { forget, getOrCreateLive } from '../packages/ketsuite/src/modules/livedoc/sync.ts'

test('snapshot reconciliation is reserved before bytes even when the owner commit fails', async () => {
  const ref = { company: 'cleanup', kind: 'test-owner', id: 'failed-commit' }
  const doc = getOrCreateLive(ref).doc,
    block = new Y.XmlElement('block'),
    text = new Y.XmlText()
  block.setAttribute('type', 'p')
  block.insert(0, [text])
  text.insert(0, 'Persisted later')
  doc.getXmlFragment('content').insert(0, [block])
  const events: string[] = []
  const ctx = {
    storageOf: async () => ({
      put: async (_key: string, body: AsyncIterable<Uint8Array>) => {
        events.push('bytes')
        for await (const chunk of body) assert.ok(chunk.length > 0)
      },
    }),
    callUnchecked: async (fn: string) => {
      events.push(fn)
      if (fn === 'test.commit') throw new Error('Controlled owner rollback')
      return { ok: true }
    },
  } as unknown as ServeContext
  try {
    await assert.rejects(
      flatten(
        ctx,
        {
          kind: 'test-owner',
          readFn: 'test.read',
          writeFn: 'test.write',
          commitFn: 'test.commit',
          attachmentOf: () => null,
        },
        new URL('https://test.invalid'),
        {} as never,
        ref,
        false,
      ),
      /Controlled owner rollback/,
    )
    assert.deepEqual(events, ['livedoc.sync.scheduleCleanup', 'bytes', 'test.commit'])
  } finally {
    forget(ref)
  }
})
