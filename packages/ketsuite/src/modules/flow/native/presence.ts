import { asc, defineJob, deleteFrom, eq, from, gt, lte } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { hash, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { MAX_DOCUMENT_PRESENCE_INDEX, readLiveDocument } from './live-document.ts'
import { identity, refuse, string } from './policy.ts'

const TTL = 90_000
const kindOf = (page: boolean) => (page ? 'page' : 'issue')

/** Ephemeral, actor-owned lease; never advances business collection epochs. */
export async function announceDocumentPresence(
  ctx: Ctx,
  input: Row,
  page: boolean,
  extensions: NativeServerExtension[],
) {
  if (
    !Number.isSafeInteger(input.index) ||
    Number(input.index) < 0 ||
    Number(input.index) > MAX_DOCUMENT_PRESENCE_INDEX
  )
    return refuse('validation', { index: 'invalid' })
  return ctx.tx(async (tx) => {
    const owner = await readLiveDocument(tx, input, page)
    const who = await identity(tx),
      ownerKind = kindOf(page)
    const id = hash(JSON.stringify([who.companyId, ownerKind, owner.id, who.actorId]))
    const mutation = {
      name: `flow.${ownerKind}.document.presence`,
      capability: owner.projectId ? 'project.read' : 'workspace.read',
      input: { id: owner.id, index: input.index, gone: input.gone === true },
    }
    for (const extension of extensions) await extension.beforeMutation?.(tx, mutation)
    const P = tx.table('flow.DocumentPresence')
    if (input.gone === true) {
      await tx.db.del(
        deleteFrom(P).where(eq(P.companyId, who.companyId), eq(P.id, id), eq(P.actorId, who.actorId)),
      )
      return { id: who.actorId }
    }
    const expiresAt = new Date(Date.now() + TTL).toISOString()
    await tx.db.insertIfAbsent('flow.DocumentPresence', {
      id,
      ownerKind,
      ownerId: owner.id,
      actorId: who.actorId,
      index: input.index,
      expiresAt,
      version: 1,
    })
    const held = await tx.db.one(from(P).where(eq(P.companyId, who.companyId), eq(P.id, id)))
    if (!held) return refuse('conflict')
    const version = Number(held.version) + 1
    const changed = await tx.db.compareAndSet(
      'flow.DocumentPresence',
      { id, companyId: who.companyId },
      { version: held.version },
      { index: input.index, expiresAt, version },
    )
    if (!('matched' in changed) || !changed.matched) return refuse('conflict')
    await tx.jobs.enqueue(
      'flow.expireDocumentPresence',
      { id },
      { runAt: new Date(expiresAt), uniqueKey: `presence:${id}:${expiresAt}:${version}` },
    )
    return { id: who.actorId }
  })
}

export async function listDocumentPresence(ctx: Ctx, input: Row, page: boolean) {
  const owner = await readLiveDocument(ctx, input, page),
    P = ctx.table('flow.DocumentPresence')
  const leases = await ctx.db.all(
    from(P)
      .where(
        eq(P.companyId, ctx.scope.company),
        eq(P.ownerKind, kindOf(page)),
        eq(P.ownerId, owner.id),
        gt(P.expiresAt, now()),
      )
      .orderBy(asc(P.id))
      .limit(1001),
  )
  if (leases.length > 1000) return refuse('limit')
  const items: Row[] = []
  for (const lease of leases) {
    // Revoked/disabled senders disappear even before their last heartbeat expires.
    const sender = { ...ctx, actor: string(lease.actorId) }
    try {
      await readLiveDocument(sender, { id: owner.id }, page)
      const who = await identity(sender)
      items.push({
        id: who.actorId,
        name: string(who.user.name) || who.actorId,
        index: lease.index,
        version: lease.version,
      })
    } catch {
      /* A stale lease never grants visibility or leaks a revoked identity. */
    }
  }
  return { items }
}

export const expireDocumentPresence = defineJob({
  queue: 'maintenance',
  input: { id: 'id' },
  idempotent: true,
  effects: ['read:flow.DocumentPresence', 'write:flow.DocumentPresence'],
  handler: async (ctx, input) => {
    if (!ctx.scope.company) throw new Error('Presence cleanup requires Company scope')
    const P = ctx.table('flow.DocumentPresence')
    // Conditional deletion cannot remove a heartbeat that extended the lease.
    await ctx.db.del(
      deleteFrom(P).where(eq(P.companyId, ctx.scope.company), eq(P.id, input.id), lte(P.expiresAt, now())),
    )
  },
})
