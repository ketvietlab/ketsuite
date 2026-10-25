import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { ensureTrailingParagraph } from '../packages/ketsuite/src/ui/client/live-doc-tail.ts'
import {
  applySnapshot,
  forget,
  getOrCreateLive,
  isHydrated,
  markHydrated,
  publishPresence,
  snapshotBytes,
  snapshotBlocksOf,
  tailTopic,
  topicFor,
} from '../packages/ketsuite/src/modules/livedoc/sync.ts'
import { flatten, hydrate } from '../packages/ketsuite/src/modules/livedoc/documents.ts'
import type { ServeContext } from '@ketvietlab/ketjs'
import type { IncomingMessage } from 'node:http'

test('snapshot metadata and preview stay at the written revision during a concurrent storage write', async () => {
  const ref = { company: 'test', kind: 'test.Document', id: 'metadata-race' },
    doc = new Y.Doc()
  const fragment = doc.getXmlFragment('content')
  for (const [type, text] of [
    ['h1', 'Original title'],
    ['p', 'Body stays out of the title'],
  ]) {
    const block = new Y.XmlElement('block'),
      value = new Y.XmlText()
    block.setAttribute('type', type!)
    block.setAttribute('id', type!)
    fragment.insert(fragment.length, [block])
    block.insert(0, [value])
    value.insert(0, text!)
  }
  getOrCreateLive(ref)
  applySnapshot(ref, Y.encodeStateAsUpdate(doc))
  markHydrated(ref)
  let payload: Record<string, unknown> = {},
    bytes = new Uint8Array()
  const ctx = {
    storageOf: async () => ({
      put: async (_key: string, body: AsyncIterable<Uint8Array>) => {
        const chunks: Uint8Array[] = []
        for await (const part of body) chunks.push(part)
        bytes = Buffer.concat(chunks)
        const title = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText
        title.delete(0, title.length)
        title.insert(0, 'Newer title')
        applySnapshot(ref, Y.encodeStateAsUpdate(doc))
      },
    }),
    callUnchecked: async (_fn: string, input: Record<string, unknown>) => {
      payload = input
      return { ok: true }
    },
  } as unknown as ServeContext
  try {
    await flatten(
      ctx,
      {
        kind: ref.kind,
        readFn: 'test.read',
        writeFn: 'test.write',
        commitFn: 'test.commit',
        attachmentOf: () => null,
        snapshotMetadata: (current) => ({ blocks: snapshotBlocksOf(current) }),
      },
      new URL('http://127.0.0.1/document'),
      {} as IncomingMessage,
      ref,
      false,
    )
    assert.equal(payload.previewText, 'Original title\nBody stays out of the title')
    assert.equal((payload.blocks as Record<string, unknown>[])[0]!.text, 'Original title')
    const written = new Y.Doc()
    Y.applyUpdate(written, bytes)
    assert.equal(
      ((written.getXmlFragment('content').get(0) as Y.XmlElement).get(0) as Y.XmlText).toString(),
      'Original title',
    )
    written.destroy()
    assert.equal(snapshotBlocksOf(ref)[0]!.text, 'Newer title', 'the race really changed the live tree')
  } finally {
    forget(ref)
    doc.destroy()
  }
})

test('a durable owner refresh merges committed content into an already hydrated stale cache', async () => {
  const ref = { company: 'test', kind: 'test.Document', id: 'stale-cache' }
  const committed = new Y.Doc(),
    stale = new Y.Doc()
  const text = committed.getText('test')
  text.insert(0, 'Base')
  const base = Y.encodeStateAsUpdate(committed)
  Y.applyUpdate(stale, base)
  text.insert(text.length, ' Alpha')
  const bytes = Y.encodeStateAsUpdate(committed)
  getOrCreateLive(ref)
  applySnapshot(ref, Y.encodeStateAsUpdate(stale))
  markHydrated(ref)
  assert.equal(isHydrated(ref), true, 'Exercise the already hydrated branch')
  const ctx = {
    callUnchecked: async () => ({ storeKey: 'test/snapshot' }),
    storageOf: async () => ({
      get: async () => ({
        body: (async function* () {
          yield bytes
        })(),
      }),
    }),
  } as unknown as ServeContext
  try {
    assert.equal(
      await hydrate(
        ctx,
        new URL('http://127.0.0.1/document'),
        {} as IncomingMessage,
        ref,
        'attachment',
        null,
        true,
      ),
      true,
    )
    const loaded = new Y.Doc()
    Y.applyUpdate(loaded, snapshotBytes(ref)!)
    assert.equal(loaded.getText('test').toString(), 'Base Alpha')
    loaded.destroy()
  } finally {
    forget(ref)
    committed.destroy()
    stale.destroy()
  }
})

test('an idle live document tail rotates normally instead of truncating its HTTP stream', async () => {
  const ref = { company: 'test', kind: 'test.Document', id: 'idle-rotation' }
  getOrCreateLive(ref)
  try {
    await publishPresence(ref, { viewer: 'test' })
    const chunks = []
    for await (const chunk of tailTopic(topicFor(ref, 1), 0, { timeoutMs: 1 })) chunks.push(chunk)
    assert.equal(chunks.length, 1)
    assert.deepEqual(chunks[0].data, { presence: { viewer: 'test' } })
  } finally {
    forget(ref)
  }
})

test('local document always retains one empty final paragraph without accumulating placeholders', () => {
  const doc = new Y.Doc(),
    content = doc.getXmlFragment('content')
  doc.on('beforeObserverCalls', () => ensureTrailingParagraph(doc))
  ensureTrailingParagraph(doc)
  const tail = () => content.get(content.length - 1) as Y.XmlElement
  const assertTail = () => {
    assert.equal(tail().getAttribute('type'), 'p')
    assert.equal((tail().get(0) as Y.XmlText).length, 0)
  }
  assert.equal(content.length, 1)
  ;(tail().get(0) as Y.XmlText).insert(0, 'Write after image')
  assert.equal(content.length, 2)
  assertTail()
  content.delete(1, 1)
  assert.equal(content.length, 2)
  assertTail()
  doc.transact(() => {
    content.delete(0, content.length)
    const image = new Y.XmlElement('block')
    image.setAttribute('type', 'image')
    image.insert(0, [new Y.XmlText()])
    content.insert(0, [image])
  })
  assert.equal(content.length, 2)
  assertTail()
  for (let i = 0; i < 5; i++) ensureTrailingParagraph(doc)
  assert.equal(content.length, 2)
  const reopened = new Y.Doc()
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc))
  ensureTrailingParagraph(reopened)
  assert.equal(reopened.getXmlFragment('content').length, 2)
  reopened.destroy()
  doc.destroy()
})
