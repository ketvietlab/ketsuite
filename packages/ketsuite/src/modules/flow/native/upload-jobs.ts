import { defineJob, deleteFrom, eq, from } from '@ketvietlab/ketjs'
import type { JobSpec } from '@ketvietlab/ketjs'
import { now } from './command.ts'
import { string } from './policy.ts'
import { isExclusiveFlowBlob } from './blob-keys.ts'

/** Expired draft ownership is removed transactionally; shared storage owns byte GC. */
export const expireUpload: JobSpec = defineJob({
  queue: 'maintenance',
  input: { id: 'id' },
  idempotent: true,
  effects: [
    'read:flow.FlowAttachmentBinding',
    'write:flow.FlowAttachmentBinding',
    'read:storage.Attachment',
    'write:storage.Attachment',
    'enqueue:storage.sweep',
  ],
  handler: async (ctx, args) => {
    if (!ctx.scope.company) throw new Error('Flow upload cleanup requires Company scope')
    const B = ctx.table('flow.FlowAttachmentBinding'),
      A = ctx.table('storage.Attachment')
    await ctx.tx(async (tx) => {
      const binding = await tx.db.one(from(B).where(eq(B.companyId, tx.scope.company), eq(B.id, args.id)))
      if (!binding || binding.finalizedAt || !binding.expiresAt || string(binding.expiresAt) > now()) return
      const attachment = await tx.db.one(
        from(A).where(eq(A.companyId, tx.scope.company), eq(A.id, binding.attachmentId)),
      )
      if (
        attachment &&
        (!isExclusiveFlowBlob(string(attachment.storeKey), string(tx.scope.company)) ||
          attachment.resField !== 'attachment')
      )
        throw new Error('Unexpected Flow draft attachment ownership')
      const claimed = await tx.db.compareAndSet(
        'flow.FlowAttachmentBinding',
        { id: binding.id, companyId: tx.scope.company },
        { version: binding.version },
        { version: Number(binding.version) + 1 },
      )
      if (!('matched' in claimed) || !claimed.matched)
        throw new Error('Flow upload cleanup raced with finalization')
      await tx.db.del(deleteFrom(B).where(eq(B.companyId, tx.scope.company), eq(B.id, binding.id)))
      if (attachment)
        await tx.db.del(deleteFrom(A).where(eq(A.companyId, tx.scope.company), eq(A.id, attachment.id)))
      // A delayed put refreshes mtime. Reconcile after the normal storage grace
      // as well, without deleting a recent or referenced object ourselves.
      await tx.jobs.enqueue(
        'storage.sweep',
        { minAgeMs: 3600000 },
        { uniqueKey: 'flow-expired-upload:' + binding.id },
      )
      await tx.jobs.enqueue(
        'storage.sweep',
        { minAgeMs: 3600000 },
        {
          uniqueKey: 'flow-expired-upload-late:' + binding.id,
          runAt: new Date(Date.now() + 7200000),
        },
      )
    })
  },
})
