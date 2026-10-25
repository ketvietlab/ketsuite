// The five routes one live document needs, over any owner.
//
// These are handed back as a route table rather than mounted here, because a
// route belongs to the module that declares it: the owner already owns
// `/admin/flow/issues/{id}`, so it owns the five endpoints hanging off it too,
// and its own permission keys are what gate them. This module supplies the
// behaviour; the owner spreads it into its `routes` under whatever base it
// likes.

import { json, streamed, text, withHeaders } from '@ketvietlab/ketjs'
import type { IncomingMessage } from 'node:http'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { type DocumentOwner, flatten, hydrate, readable, storedSnapshot, writable } from './documents.ts'
import {
  applySnapshot,
  forget,
  currentGeneration,
  isLive,
  publishPresence,
  publishUpdate,
  snapshotBytes,
  tailTopic,
  topicBelongsTo,
  topicFor,
} from './sync.ts'

const encoder = new TextEncoder()
const MAX_BODY_BYTES = 2 * 1024 * 1024
class InvalidDocumentUpdate extends Error {}
const durableWrites = new Map<string, Promise<unknown>>()

// Capture/persist the latest merged document inside this queue. A slower earlier
// flush must never replace a later snapshot. Nothing external runs in a DB retry.
async function durable(
  ctx: ServeContext,
  owner: DocumentOwner,
  url: URL,
  req: IncomingMessage,
  ref: { company: string; kind: string; id: string },
  update?: string,
) {
  const key = JSON.stringify(ref)
  const prior = durableWrites.get(key) ?? Promise.resolve()
  const write = prior
    .catch(() => {})
    .then(async () => {
      // Serialize hydration, merge and commit, not just the final storage write.
      // A refused/failed update must never be inherited by the next writer.
      forget(ref)
      try {
        const row = await writable(ctx, owner, url, req, ref.id)
        if (!row) throw new Error('Document write permission revoked')
        if (!(await hydrate(ctx, url, req, ref, owner.attachmentOf(row), owner.initialSnapshotOf?.(row))))
          throw new Error('Document snapshot could not be read')
        if (update) {
          try {
            applySnapshot(ref, Buffer.from(update, 'base64'))
          } catch {
            throw new InvalidDocumentUpdate()
          }
        }
        return await flatten(ctx, owner, url, req, ref, false)
      } finally {
        forget(ref)
      }
    })
  durableWrites.set(key, write)
  try {
    return await write
  } finally {
    if (durableWrites.get(key) === write) durableWrites.delete(key)
  }
}

/**
 * The admin authenticates with a session cookie, so a POST arriving from
 * another origin carries the signed-in user's credentials without their
 * intent. Same guard every other mutating admin route carries.
 */
const crossSite = (req: IncomingMessage): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const onlyPost = (req: IncomingMessage) =>
  req.method !== 'POST'
    ? text('POST', { status: 405 })
    : crossSite(req)
      ? text('Forbidden', { status: 403 })
      : null

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (!size) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * The document endpoints for one owner, keyed under `base`.
 *
 * `base` is the collection path — `/admin/flow/issues` — and the record id is
 * appended as `{id}`, so the five keys come out as siblings of the owner's own
 * detail route. The client is told the same base and builds the same paths.
 */
export function documentRoutes(owner: DocumentOwner, base: string): Record<string, RouteEntry> {
  const refOf = (company: string, id: string) => ({ company, kind: owner.kind, id })

  return {
    [`${base}/{id}/content`]:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const id = String(params.id)
        const row = await readable(ctx, owner, url, req, id)
        if (!row) return text('forbidden', { status: 403 })
        const scope = await ctx.scopeOf(url, req)
        if (!scope.company) return text('company scope required', { status: 400 })
        const ref = refOf(scope.company, id)
        let bytes: Uint8Array | null
        if (owner.durablePush) {
          bytes = await storedSnapshot(ctx, url, req, owner.attachmentOf(row), owner.initialSnapshotOf?.(row))
          if (!(await readable(ctx, owner, url, req, id))) return text('forbidden', { status: 403 })
        } else {
          if (!(await hydrate(ctx, url, req, ref, owner.attachmentOf(row), owner.initialSnapshotOf?.(row))))
            return text('stored document could not be read', { status: 503 })
          bytes = snapshotBytes(ref)
        }
        if (bytes === null) return text('stored document could not be read', { status: 503 })
        // Who the caller is, so a client knows which presence frames are its
        // own before it can receive any. Learning that from its first announce
        // instead left a window in which its own second tab read as a stranger.
        const viewer = (await ctx.callUnchecked('livedoc.sync.viewer', {}, url, req)) as {
          id: string | null
        }
        return json({
          snapshot: Buffer.from(bytes).toString('base64'),
          topic: topicFor(ref, currentGeneration(ref)),
          viewerId: viewer.id,
        })
      },

    [`${base}/{id}/push`]:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        const refused = onlyPost(req)
        if (refused) return refused
        const id = String(params.id)
        const row = await writable(ctx, owner, url, req, id)
        if (!row) return text('forbidden', { status: 403 })
        const scope = await ctx.scopeOf(url, req)
        if (!scope.company) return text('company scope required', { status: 400 })
        const ref = refOf(scope.company, id)
        let body: Record<string, unknown>
        try {
          body = await readJsonBody(req)
        } catch {
          return text('bad request', { status: 400 })
        }
        const update = typeof body.update === 'string' ? body.update : ''
        if (!update) return text('bad request', { status: 400 })
        if (owner.durablePush) {
          try {
            const committed = await durable(ctx, owner, url, req, ref, update)
            return json({ ok: true, ...(committed && typeof committed === 'object' ? committed : {}) })
          } catch (error) {
            if (error instanceof InvalidDocumentUpdate) return text('bad request', { status: 400 })
            throw error
          }
        }
        // Before the update is merged, not after: an incremental update applied
        // to a blank document keeps only what it carries.
        if (
          !(await hydrate(
            ctx,
            url,
            req,
            ref,
            owner.attachmentOf(row),
            owner.initialSnapshotOf?.(row),
            owner.durablePush,
          ))
        )
          return text('stored document could not be read', { status: 503 })
        let shouldFlatten: boolean
        try {
          ;({ shouldFlatten } = await publishUpdate(ref, update))
        } catch {
          // A malformed update is the client's problem, not a 500.
          return text('bad request', { status: 400 })
        }
        if (shouldFlatten) await flatten(ctx, owner, url, req, ref)
        return json({ ok: true })
      },

    /**
     * The framework's own `/_ket/stream/:id` (packages/ketjs/src/server/http.ts)
     * is closed unless the deployment supplies an authorization/topic resolver.
     * This module still owns a dedicated route because its permission is
     * record-aware and its accepted topic must match the document's current
     * generation; both checks belong beside the record lookup below.
     *
     * There is no server-side disconnect hook here on purpose: a client abort
     * does not reliably reach the route layer (verified against this same
     * `pipeline()`-backed response — even an aborted `fetch()` does not run an
     * async generator's `finally`, in-process or not), which is the same
     * reason real apps send an explicit "I'm leaving" beacon rather than
     * trust transport-level disconnect detection. `/leave` below is that
     * signal; flattening otherwise only happens on the update-count
     * threshold in `/push`.
     */
    [`${base}/{id}/live`]:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const id = String(params.id)
        const topic = url.searchParams.get('topic') ?? ''
        const from = Number(url.searchParams.get('from') ?? 0)
        if (!Number.isSafeInteger(from) || from < 0) return text('invalid cursor', { status: 400 })
        if (!(await readable(ctx, owner, url, req, id))) return text('forbidden', { status: 403 })
        const scope = await ctx.scopeOf(url, req)
        // A topic name that doesn't actually belong to this record's current
        // generation is refused rather than relayed — otherwise a caller
        // authorized for record A could pass record B's topic string and
        // eavesdrop on edits it was never granted.
        if (!scope.company || !topicBelongsTo(topic, refOf(scope.company, id)))
          return text('unknown topic', { status: 404 })

        async function* relay(): AsyncGenerator<Uint8Array> {
          const done = encoder.encode('event: done\ndata: {}\n\n')
          if (!owner.durablePush) {
            for await (const chunk of tailTopic(topic, from, { timeoutMs: 30_000 })) {
              if (!(await readable(ctx, owner, url, req, id))) {
                yield done
                return
              }
              yield encoder.encode(`id: ${chunk.seq}\ndata: ${JSON.stringify(chunk.data)}\n\n`)
            }
            yield done
            return
          }

          // Immutable committed snapshots are the cross-worker source of truth.
          // An initial checkpoint also closes the /content -> /live handoff gap.
          // Local uncommitted update frames must never escape through this relay.
          const presences = new Map<string, string>()
          const deadline = Date.now() + 30_000
          let sent = false,
            lastAttachment: unknown,
            cursor = from,
            lastSequence = -1
          while (Date.now() < deadline) {
            const row = await readable(ctx, owner, url, req, id)
            if (!row) {
              yield done
              return
            }
            const attachment = owner.attachmentOf(row)
            if (!sent || attachment !== lastAttachment) {
              const bytes = await storedSnapshot(ctx, url, req, attachment, owner.initialSnapshotOf?.(row))
              // Permission and snapshot identity may change while blob I/O awaits.
              const current = await readable(ctx, owner, url, req, id)
              if (!current || bytes === null) {
                yield done
                return
              }
              if (owner.attachmentOf(current) === attachment) {
                if (bytes.length)
                  yield encoder.encode(
                    `data: ${JSON.stringify({ update: Buffer.from(bytes).toString('base64') })}\n\n`,
                  )
                sent = true
                lastAttachment = attachment
              }
            }
            if (owner.presenceListFn) {
              const state = (await ctx.callUnchecked(owner.presenceListFn, { id }, url, req)) as {
                items: Array<{ id: string; name: string; index: number; version: number }>
              }
              const next = new Map<string, string>()
              for (const presence of state.items) {
                const signature = JSON.stringify(presence)
                next.set(presence.id, signature)
                if (presences.get(presence.id) === signature) continue
                if (!(await readable(ctx, owner, url, req, id))) {
                  yield done
                  return
                }
                yield encoder.encode(`data: ${JSON.stringify({ presence })}\n\n`)
              }
              for (const actorId of presences.keys())
                if (!next.has(actorId)) {
                  if (!(await readable(ctx, owner, url, req, id))) {
                    yield done
                    return
                  }
                  yield encoder.encode(
                    `data: ${JSON.stringify({ presence: { id: actorId, gone: true } })}\n\n`,
                  )
                }
              presences.clear()
              for (const [actorId, signature] of next) presences.set(actorId, signature)
            }
            const tick = Date.now() + 1_000
            for await (const chunk of tailTopic(topic, cursor, { timeoutMs: 1_000, pollMs: 100 })) {
              if (chunk.seq > lastSequence) {
                lastSequence = chunk.seq
                cursor = Math.floor(chunk.seq)
                const data = chunk.data as { presence?: unknown }
                if (data?.presence && !owner.presenceListFn) {
                  if (!(await readable(ctx, owner, url, req, id))) {
                    yield done
                    return
                  }
                  yield encoder.encode(
                    `id: ${chunk.seq}\ndata: ${JSON.stringify({ presence: data.presence })}\n\n`,
                  )
                }
              }
              // Busy local traffic must not starve shared-state/permission checks.
              if (Date.now() >= tick) break
            }
          }
          yield done
        }

        return withHeaders(streamed(relay(), { type: 'text/event-stream' }), {
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
      },

    /**
     * "I am here, on this block" — relayed to everyone else in the document.
     *
     * Gated on reading the record, not on writing its document: watching
     * somebody type is looking, and a reviewer with read access showing up in
     * the room is the point. Nothing here touches the document.
     *
     * The name is resolved from the session rather than read out of the body.
     * A client that could name itself could sit in the room as somebody else,
     * and everyone else's screen would agree with it.
     */
    [`${base}/{id}/presence`]:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        const refused = onlyPost(req)
        if (refused) return refused
        const id = String(params.id)
        if (!(await readable(ctx, owner, url, req, id))) return text('forbidden', { status: 403 })
        const scope = await ctx.scopeOf(url, req)
        if (!scope.company) return text('company scope required', { status: 400 })
        let body: Record<string, unknown>
        try {
          body = await readJsonBody(req)
        } catch {
          return text('bad request', { status: 400 })
        }
        const index = Number(body.index)
        if (owner.presenceMaxIndex !== undefined && index > owner.presenceMaxIndex)
          return text('presence index out of range', { status: 400 })
        if (owner.presenceFn)
          return json(
            await ctx.callUnchecked(
              owner.presenceFn,
              {
                id,
                index: Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0,
                gone: body.gone === true,
              },
              url,
              req,
            ),
          )
        const viewer = (await ctx.callUnchecked('livedoc.sync.viewer', {}, url, req)) as {
          id: string | null
          name: string | null
        }
        if (!viewer.id) return json({ id: null })
        await publishPresence(refOf(scope.company, id), {
          id: viewer.id,
          name: viewer.name || viewer.id,
          index: Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0,
          gone: body.gone === true,
        })
        return json({ id: viewer.id })
      },

    /**
     * The explicit "I'm done editing" signal — the client calls this
     * (`navigator.sendBeacon`, so it fires reliably on tab close) instead of
     * relying on the SSE connection's own teardown. Flattening is idempotent,
     * so a duplicate or slightly-late beacon just re-persists the same or a
     * slightly newer state.
     *
     * A beacon for a document this process never held is answered without
     * writing anything: it carries no state to save, and the old behaviour —
     * flatten whatever the registry returned — turned every post-restart tab
     * close into a silent wipe of the stored document.
     */
    [`${base}/{id}/leave`]:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        const refused = onlyPost(req)
        if (refused) return refused
        const id = String(params.id)
        if (!(await writable(ctx, owner, url, req, id))) return text('forbidden', { status: 403 })
        const scope = await ctx.scopeOf(url, req)
        if (!scope.company) return text('company scope required', { status: 400 })
        const ref = refOf(scope.company, id)
        if (!isLive(ref)) return json({ ok: true, flattened: false })
        if (owner.durablePush) await durable(ctx, owner, url, req, ref)
        else await flatten(ctx, owner, url, req, ref)
        return json({ ok: true, flattened: true })
      },
  }
}
