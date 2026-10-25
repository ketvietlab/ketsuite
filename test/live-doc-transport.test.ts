import { test } from 'node:test'
import assert from 'node:assert/strict'
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
