import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { createLiveDocTransport } from '../packages/ketsuite/src/ui/client/live-doc-transport.ts'

test('unacknowledged edits remain queued across failure and reconnect; newer edits cannot overtake them', async () => {
  let online = true,
    attempts = 0
  const sent: number[][] = [],
    states: string[] = []
  const runtime = createLiveDocTransport({
    online: () => online,
    merge: (chunks) => new Uint8Array(chunks.flatMap((x) => [...x])),
    onState: (state) => states.push(state.status),
    send: async (update) => {
      sent.push([...update])
      if (++attempts === 1) throw new Error('lost connection')
      return { record: { version: attempts } }
    },
  })
  runtime.enqueue(new Uint8Array([1]))
  assert.equal(await runtime.flush(), false)
  assert.equal(runtime.isPending(), true)
  online = false
  runtime.enqueue(new Uint8Array([2]))
  assert.equal(await runtime.flush(), false)
  assert.equal(attempts, 1)
  assert.equal(states.at(-1), 'offline')
  online = true
  assert.equal(await runtime.flush(), true)
  assert.deepEqual(sent, [[1], [1, 2]])
  assert.equal(runtime.isPending(), false)
  assert.equal(states.at(-1), 'saved')
  runtime.dispose()
})

test('a concurrent edit is sent after the in-flight batch, and dispose does not claim unsaved edits were saved', async () => {
  let ack!: () => void
  const sent: number[][] = []
  const runtime = createLiveDocTransport({
    merge: (chunks) => new Uint8Array(chunks.flatMap((x) => [...x])),
    send: async (update) => {
      sent.push([...update])
      if (sent.length === 1)
        await new Promise<void>((resolve) => {
          ack = resolve
        })
      return {}
    },
  })
  runtime.enqueue(new Uint8Array([1]))
  runtime.enqueue(new Uint8Array([2]))
  ack()
  assert.equal(await runtime.flush(), true)
  assert.deepEqual(sent, [[1], [2]])
  runtime.dispose()
  runtime.enqueue(new Uint8Array([3]))
  assert.equal(runtime.isPending(), false)
})

test('offline CRDT bursts compact bounded fragments and converge without losing edits', async () => {
  let online = false,
    widestMerge = 0
  const sent: Uint8Array[] = []
  const runtime = createLiveDocTransport({
    online: () => online,
    merge: (chunks) => {
      widestMerge = Math.max(widestMerge, chunks.length)
      return Y.mergeUpdates(chunks)
    },
    send: async (update) => {
      sent.push(update)
      return {}
    },
  })
  const local = new Y.Doc(),
    remote = new Y.Doc()
  local.on('update', (update: Uint8Array) => runtime.enqueue(update))
  try {
    for (let n = 0; n < 1500; n++) local.getText('body').insert(n, String(n % 10))
    assert.equal(await runtime.flush(), false)
    assert.equal(sent.length, 0)
    assert.equal(runtime.isPending(), true)
    online = true
    assert.equal(await runtime.flush(), true)
    assert.ok(widestMerge <= 64, 'offline duration cannot grow a batch into thousands of fragments')
    for (const update of sent) Y.applyUpdate(remote, update)
    assert.equal(remote.getText('body').toString(), local.getText('body').toString())
    assert.equal(runtime.isPending(), false)
  } finally {
    runtime.dispose()
    local.destroy()
    remote.destroy()
  }
})

test('failed in-flight writes retain concurrent compacted successors exactly once', async () => {
  let release!: () => void,
    attempt = 0
  const writes: number[][] = [],
    states: string[] = []
  const runtime = createLiveDocTransport({
    merge: (chunks) => new Uint8Array(chunks.flatMap((chunk) => [...chunk])),
    onState: (state) => states.push(state.status),
    send: async (update) => {
      writes.push([...update])
      if (++attempt === 1) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        throw Error('lost ack')
      }
      return {}
    },
  })
  runtime.enqueue(new Uint8Array([0]))
  for (let n = 1; n < 200; n++) runtime.enqueue(new Uint8Array([n]))
  release()
  assert.equal(await runtime.flush(), false)
  assert.equal(await runtime.flush(), true)
  assert.deepEqual(
    writes[1],
    Array.from({ length: 200 }, (_, i) => i),
  )
  assert.equal(runtime.isPending(), false)
  runtime.dispose()
  const before = states.length
  runtime.enqueue(new Uint8Array([201]))
  assert.equal(states.length, before)
})
