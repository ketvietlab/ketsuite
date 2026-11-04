import { defineJob, deleteFrom, eq, from } from '@ketvietlab/ketjs'
import { isExclusiveFlowBlob } from './blob-keys.ts'
import { string } from './policy.ts'

const models = ['flow.Document', 'flow.Task', 'flow.ProjectRecord', 'flow.EpicRecord']

/** Retain old pointer metadata longer than in-flight reads, then release only
 * an unreferenced native snapshot. Storage sweep owns physical byte deletion. */
export const expireSnapshot = defineJob({
  queue: 'maintenance',
  input: { id: 'id' },
  idempotent: true,
  effects: [
    'read:storage.Attachment',
    'write:storage.Attachment',
    ...models.map((model) => 'read:' + model),
    'enqueue:storage.sweep',
  ],
  handler: async (ctx, args) => {
    if (!ctx.scope.company) throw new Error('Flow snapshot cleanup requires Company scope')
    await ctx.tx(async (tx) => {
      const A = tx.table('storage.Attachment')
      const row = await tx.db.one(from(A).where(eq(A.companyId, tx.scope.company), eq(A.id, args.id)))
      if (!row) return
      if (
        !models.includes(string(row.resModel)) ||
        row.resField !== 'content' ||
        !isExclusiveFlowBlob(string(row.storeKey), string(tx.scope.company))
      )
        throw new Error('Unexpected Flow snapshot ownership')
      const owner = (
        await tx.db.select(string(row.resModel), { id: row.resId, companyId: tx.scope.company })
      )[0]
      if (owner?.contentAttachmentId === row.id) return
      await tx.db.del(deleteFrom(A).where(eq(A.companyId, tx.scope.company), eq(A.id, row.id)))
      await tx.jobs.enqueue(
        'storage.sweep',
        { minAgeMs: 3600000 },
        { uniqueKey: 'flow-snapshot-expired:' + row.id },
      )
    })
  },
})
