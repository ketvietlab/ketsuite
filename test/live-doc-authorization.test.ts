import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import * as Y from 'yjs'
import type { IncomingMessage } from 'node:http'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { documentRoutes } from '../packages/ketsuite/src/modules/livedoc/routes.ts'
import {
  forget,
  getOrCreateLive,
  publishPresence,
  topicFor,
  snapshotBytes,
} from '../packages/ketsuite/src/modules/livedoc/sync.ts'

test('a rejected durable push cannot contaminate the next writer or the worker cache', async () => {
  const ref = { company: 'synthetic-company', kind: 'flow.Page', id: 'failed-write' }
  const initial = new Y.Doc()
  initial.getText('test').insert(0, 'Committed')
  const base = Y.encodeStateAsUpdate(initial)
  initial.destroy()
  let reject = true,
    committed = new Uint8Array()
  const ctx = {
    scopeOf: async () => ({ company: ref.company }),
    call: async () => ({ id: ref.id, version: 1 }),
    callUnchecked: async (name: string) => {
      if (name === 'livedoc.sync.resolveSnapshotKey') return { storeKey: null }
      if (reject) throw new Error('synthetic CAS conflict')
      return { ok: true }
    },
    storageOf: async () => ({
      put: async (_key: string, body: AsyncIterable<Uint8Array>) => {
        const chunks: Uint8Array[] = []
        for await (const chunk of body) chunks.push(chunk)
        committed = Buffer.concat(chunks)
      },
    }),
  } as unknown as ServeContext
  const route = (
    documentRoutes(
      {
        kind: ref.kind,
        readFn: 'read',
        writeFn: 'write',
        commitFn: 'commit',
        durablePush: true,
        attachmentOf: () => null,
        initialSnapshotOf: () => base,
      },
      '/live',
    )['/live/{id}/push'] as (ctx: ServeContext) => Route
  )(ctx)
  const push = async (text: string) => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, base)
    const vector = Y.encodeStateVector(doc)
    doc.getText('test').insert(9, text)
    const update = Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64')
    doc.destroy()
    const req = Readable.from([Buffer.from(JSON.stringify({ update }))])
    Object.assign(req, { method: 'POST', headers: {} })
    return route(new URL('http://127.0.0.1/live/failed-write/push'), req as IncomingMessage, { id: ref.id })
  }
  await assert.rejects(push(' rejected'), /CAS conflict/)
  assert.equal(snapshotBytes(ref), null, 'failed local update is discarded')
  reject = false
  await push(' accepted')
  const result = new Y.Doc()
  try {
    Y.applyUpdate(result, committed)
    assert.equal(result.getText('test').toString(), 'Committed accepted')
    assert.equal(snapshotBytes(ref), null)
  } finally {
    result.destroy()
    forget(ref)
  }
})

test('durable SSE checkpoints cross-worker commits and checks idle and in-flight revocation', async () => {
  for (const revokeDuringRead of [false, true]) {
    const ref = { company: 'synthetic-company', kind: 'flow.Page', id: `checkpoint-${revokeDuringRead}` }
    let allowed = true,
      attachment = 'snapshot-one',
      reads = 0
    const ctx = {
      scopeOf: async () => ({ company: ref.company }),
      call: async () => (allowed ? { id: ref.id, attachment } : null),
      callUnchecked: async (_name: string, input: { attachmentId: string }) => ({
        storeKey: input.attachmentId,
      }),
      storageOf: async () => ({
        get: async (key: string) => {
          reads++
          return {
            body: (async function* () {
              if (revokeDuringRead) allowed = false
              yield Buffer.from(key)
            })(),
          }
        },
      }),
    } as unknown as ServeContext
    const route = (
      documentRoutes(
        {
          kind: ref.kind,
          readFn: 'read',
          writeFn: 'write',
          commitFn: 'commit',
          durablePush: true,
          attachmentOf: (row) => row.attachment,
        },
        '/live',
      )['/live/{id}/live'] as (ctx: ServeContext) => Route
    )(ctx)
    const url = new URL(`http://127.0.0.1/live/${ref.id}/live?topic=` + encodeURIComponent(topicFor(ref, 1)))
    const response = await route(url, { method: 'GET', headers: {} } as IncomingMessage, { id: ref.id })
    assert.ok(response && typeof response === 'object' && 'body' in response)
    const body = response.body
    assert.ok(typeof body === 'object' && Symbol.asyncIterator in body)
    const iterator = body[Symbol.asyncIterator]()
    const decode = (value: unknown) => new TextDecoder().decode(value as Uint8Array)
    try {
      if (!revokeDuringRead) {
        assert.match(
          decode((await iterator.next()).value),
          new RegExp(Buffer.from('snapshot-one').toString('base64')),
        )
        // No local publication: a different worker committed an immutable pointer.
        attachment = 'snapshot-two'
        const started = Date.now()
        assert.match(
          decode((await iterator.next()).value),
          new RegExp(Buffer.from('snapshot-two').toString('base64')),
        )
        assert.ok(
          Date.now() - started < 3_500,
          'checkpoint must not wait for the default five-second local stream poll',
        )
        assert.equal(reads, 2)
        allowed = false
      }
      const denied = decode((await iterator.next()).value)
      assert.match(denied, /event: done/)
      assert.doesNotMatch(denied, /update/)
      assert.equal((await iterator.next()).done, true)
    } finally {
      await iterator.return?.()
      forget(ref)
    }
  }
})

test('LiveDoc SSE rechecks ownership before each frame and terminates after revocation', async () => {
  const ref = { company: 'synthetic-company', kind: 'flow.Task', id: 'revoked-stream' }
  let allowed = true,
    checks = 0
  const ctx = {
    scopeOf: async () => ({ company: ref.company }),
    call: async () => {
      checks++
      if (!allowed) throw new Error('revoked')
      return { id: ref.id }
    },
  } as unknown as ServeContext
  const entry = documentRoutes(
    {
      kind: ref.kind,
      readFn: 'flow.issue.document.read',
      writeFn: 'flow.issue.document.write',
      commitFn: 'flow.issue.document.commit',
      attachmentOf: () => null,
    },
    '/live',
  )['/live/{id}/live']!
  const route = (entry as (ctx: ServeContext) => Route)(ctx)
  getOrCreateLive(ref)
  const url = new URL(
    'http://127.0.0.1/live/revoked-stream/live?topic=' + encodeURIComponent(topicFor(ref, 1)),
  )
  const response = await route(url, { method: 'GET', headers: {} } as IncomingMessage, { id: ref.id })
  assert.ok(response && typeof response === 'object' && 'body' in response)
  const body = response.body
  assert.ok(typeof body === 'object' && Symbol.asyncIterator in body)
  const iterator = body[Symbol.asyncIterator]()
  try {
    await publishPresence(ref, { blockId: 'before-revoke' })
    const first = await iterator.next()
    assert.equal(first.done, false)
    assert.match(new TextDecoder().decode(first.value), /before-revoke/)
    allowed = false
    await publishPresence(ref, { blockId: 'private-after-revoke' })
    const denied = await iterator.next()
    const text = new TextDecoder().decode(denied.value)
    assert.doesNotMatch(
      text,
      /private-after-revoke/,
      'Revoked readers never receive subsequent private frames',
    )
    assert.match(text, /event: done/)
    assert.equal((await iterator.next()).done, true)
    assert.equal(checks, 3)
  } finally {
    await iterator.return?.()
    forget(ref)
  }
})
