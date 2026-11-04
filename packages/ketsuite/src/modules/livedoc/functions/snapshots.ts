import type { Ctx, Row } from '@ketvietlab/ketjs'

export async function resolveSnapshotKey(ctx: Ctx, args: Row) {
  if (!args.attachmentId) return { storeKey: null }
  const held = (await ctx.db.select('storage.Attachment', { id: args.attachmentId }))[0]
  return { storeKey: held?.storeKey ?? null }
}

/** Reserve a delayed reconciliation before object I/O. A failed owner commit
 * must still leave a durable cleanup job. One job per Company/hour bounds the
 * queue; the latest object in that hour is at least an hour old when it runs. */
export async function scheduleSnapshotCleanup(ctx: Ctx) {
  if (!ctx.scope.company) throw new Error('Snapshot cleanup requires Company scope')
  await ctx.jobs.enqueue(
    'storage.sweep',
    { minAgeMs: 3600000 },
    {
      uniqueKey: 'livedoc-snapshots:' + Math.floor(Date.now() / 3600000),
      runAt: new Date(Date.now() + 7200000),
    },
  )
  return { ok: true }
}
