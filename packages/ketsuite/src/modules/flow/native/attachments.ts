import { randomUUID } from 'node:crypto'
import { eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import storage from '../../storage/index.ts'
import { cas, mutate, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { authority, owned, policyEffects, refuse, requireCapability, string } from './policy.ts'
import { taskByKey } from './queries.ts'
import { readableDocument } from './documents.ts'
import { flowBlobPrefix, flowUploadKey, isExclusiveFlowBlob } from './blob-keys.ts'

const ownerModels = new Set(['flow.Task', 'flow.Document', 'flow.ProjectRecord', 'flow.EpicRecord'])
const quarantinedOwners = new Set(['flow.Project', 'flow.Issue', 'flow.Page'])
async function ownerAccess(ctx: Ctx, attachment: Row, write = false) {
  const a = await authority(ctx)
  if (!a.member) return refuse('forbidden')
  const B = ctx.table('flow.FlowAttachmentBinding')
  const binding = await ctx.db.one(
    from(B).where(eq(B.companyId, ctx.scope.company), eq(B.attachmentId, attachment.id)),
  )
  if (binding) {
    if (!binding.finalizedAt && (binding.actorId !== ctx.actor || string(binding.expiresAt) < now()))
      return refuse('forbidden')
    if (binding.archived && !write) return refuse('not_found')
    if (binding.documentId) await readableDocument(ctx, binding.documentId, write)
    else
      await requireCapability(ctx, write ? 'project.write' : 'project.read', { projectId: binding.projectId })
    return binding
  }
  // LiveDoc snapshots have an owner but no file binding.
  if (attachment.resModel === 'flow.Document') return readableDocument(ctx, attachment.resId, write)
  const row = await owned(ctx, string(attachment.resModel), attachment.resId)
  await requireCapability(ctx, write ? 'project.write' : 'project.read', {
    projectId: attachment.resModel === 'flow.ProjectRecord' ? row.id : row.projectId,
  })
  return row
}

/** Generic storage routes must respect Flow ownership, including direct HTTP calls. */
export function createFlowStorageModule() {
  const functions: Record<string, FnSpec> = {}
  const effects = [
    ...policyEffects,
    'read:flow.Task',
    'read:flow.Document',
    'read:flow.EpicRecord',
    'read:flow.DocumentGrant',
    'read:flow.FlowAttachmentBinding',
    'read:storage.Attachment',
  ]
  for (const [name, spec] of Object.entries(storage.functions)) {
    const handler = spec.handler!
    functions[name] = {
      ...spec,
      effects: [...new Set([...(spec.effects ?? []), ...effects])],
      handler: async (ctx, args) => {
        if (
          name === 'createAttachment' &&
          [args.storeKey, args.publicStoreKey].some(
            (key) =>
              string(key).startsWith(flowBlobPrefix(string(ctx.scope.company))) ||
              /^blobs\/[^/]+\/flow\//.test(string(key)),
          )
        )
          throw new KetError({ code: 'E_FLOW_ATTACHMENT_OWNER', message: 'Use the owning Flow command' })
        const A = ctx.table('storage.Attachment')
        const attachment = args.id
          ? await ctx.db.one(from(A).where(eq(A.companyId, ctx.scope.company), eq(A.id, args.id)))
          : null
        if (quarantinedOwners.has(string(attachment?.resModel ?? args.resModel))) {
          if (name === 'getPublicAttachment') return null
          throw new KetError({
            code: 'E_FLOW_LEGACY_QUARANTINED',
            message: 'Legacy Flow ownership is quarantined',
          })
        }
        if (ownerModels.has(string(attachment?.resModel ?? args.resModel))) {
          if (['createAttachment', 'removeAttachment', 'listAttachments'].includes(name))
            throw new KetError({ code: 'E_FLOW_ATTACHMENT_OWNER', message: 'Use the owning Flow command' })
          if (attachment) await ownerAccess(ctx, attachment)
          else if (args.resModel === 'flow.Document') await readableDocument(ctx, args.resId)
          else {
            const row = await owned(ctx, string(args.resModel), args.resId)
            await requireCapability(ctx, 'project.read', {
              projectId: args.resModel === 'flow.ProjectRecord' ? row.id : row.projectId,
            })
          }
        }
        return handler(ctx, args)
      },
    }
  }
  // Flow builds on storage, so the ownership checks name Flow and the user grants optional.
  return { ...storage, optional: [...(storage.optional ?? []), 'flow', 'user'], functions }
}

export async function prepareAttachment(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const task = input.taskId ? await taskByKey(ctx, input.taskId) : null
  const projectId = task?.projectId ?? input.projectId
  if (!projectId) return refuse('validation')
  return mutate(
    ctx,
    {
      name: 'flow.attachment.prepare',
      capability: 'project.write',
      input: { ...input, projectId },
      subjects: task ? [{ model: 'flow.Task', id: task.id, projectId: task.projectId }] : [],
    },
    extensions,
    async (tx) => {
      if (
        !/^[a-f0-9]{64}$/.test(string(input.checksum)) ||
        input.storeKey !==
          flowUploadKey(string(tx.scope.company), string(input.id), string(input.checksum)) ||
        !isExclusiveFlowBlob(string(input.storeKey), string(tx.scope.company)) ||
        !Number.isSafeInteger(input.size) ||
        Number(input.size) < 0 ||
        Number(input.size) > 25 * 1024 * 1024
      )
        return refuse('validation')
      const id = string(input.id)
      await tx.db.insert('storage.Attachment', {
        id,
        name: string(input.name).slice(0, 1000),
        kind: 'stored',
        resModel: task ? 'flow.Task' : 'flow.ProjectRecord',
        resId: task?.id ?? projectId,
        resField: 'attachment',
        storeKey: input.storeKey,
        checksum: input.checksum,
        size: input.size,
        mimetype: input.mimetype,
        public: false,
        createdAt: now(),
      })
      const expiresAt = new Date(Date.now() + 3600000).toISOString()
      await tx.db.insert('flow.FlowAttachmentBinding', {
        id,
        attachmentId: id,
        actorId: tx.actor,
        taskId: task?.id ?? null,
        documentId: null,
        projectId,
        expiresAt,
        finalizedAt: null,
        createdAt: now(),
        ready: false,
        archived: false,
        version: 1,
      })
      await tx.jobs.enqueue(
        'flow.expireUpload',
        { id },
        { uniqueKey: 'flow-upload:' + id, runAt: new Date(expiresAt) },
      )
      return { ok: true, id }
    },
  )
}

/** Called only inside the owning task transaction. The bytes already exist. */
export async function finalizeTaskUploads(tx: Ctx, task: Row, files: unknown, draft = false) {
  if (!Array.isArray(files) || files.length > 20) return refuse('validation', { attachments: 'invalid' })
  if (!files.length) return
  const ids = files.map((f) => string(f?.uploadId))
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    return refuse('validation', { attachments: 'upload_required' })
  const B = tx.table('flow.FlowAttachmentBinding')
  const records = await tx.db.all(
    from(B).where(eq(B.companyId, tx.scope.company), inArray(B.id, ids)).limit(20),
  )
  if (
    records.length !== ids.length ||
    records.some(
      (b) =>
        b.actorId !== tx.actor ||
        b.projectId !== task.projectId ||
        b.taskId !== (draft ? null : task.id) ||
        !b.ready ||
        b.finalizedAt ||
        string(b.expiresAt) < now(),
    )
  )
    return refuse('validation', { attachments: 'upload_expired' })
  for (const binding of records) {
    await cas(tx, 'flow.FlowAttachmentBinding', string(binding.id), binding.version, {
      taskId: task.id,
      finalizedAt: now(),
      expiresAt: null,
    })
    await tx.db.update(
      'storage.Attachment',
      { id: binding.attachmentId, companyId: tx.scope.company },
      { resModel: 'flow.Task', resId: task.id },
    )
  }
  await tx.db.insert('flow.TaskHistory', {
    id: randomUUID(),
    taskId: task.id,
    projectId: task.projectId,
    workspaceId: null,
    actorId: tx.actor,
    kind: 'attachment',
    description: 'Files attached',
    metadata: { ids },
    createdAt: now(),
  })
}

/** Only the trusted upload route calls this, after storage.put has completed. */
export async function completeAttachment(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const binding = await owned(ctx, 'flow.FlowAttachmentBinding', input.id)
  await mutate(
    ctx,
    {
      name: 'flow.attachment.complete',
      capability: 'project.write',
      input: { ...input, projectId: binding.projectId, idempotencyKey: 'complete-' + input.id },
    },
    extensions,
    async (tx) => {
      if (binding.actorId !== tx.actor || binding.finalizedAt || string(binding.expiresAt) < now())
        return refuse('upload_expired')
      if (!binding.ready)
        await cas(tx, 'flow.FlowAttachmentBinding', string(binding.id), binding.version, { ready: true })
      return { ok: true, id: binding.id }
    },
  )
  return readAttachment(ctx, input)
}

export async function saveAttachments(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const task = await taskByKey(ctx, input.taskId)
  return mutate(
    ctx,
    {
      name: 'flow.attachment.save',
      capability: 'project.write',
      input: { ...input, projectId: task.projectId },
      subjects: [{ model: 'flow.Task', id: task.id, projectId: task.projectId }],
    },
    extensions,
    async (tx) => {
      if (!Array.isArray(input.files) || !input.files.length || input.files.length > 20)
        return refuse('validation', { files: 'invalid' })
      const ids = input.files.map((f: Row) => string(f?.uploadId))
      if (new Set(ids).size !== ids.length) return refuse('validation', { files: 'invalid' })
      const B = tx.table('flow.FlowAttachmentBinding')
      const records = await tx.db.all(
        from(B).where(eq(B.companyId, tx.scope.company), inArray(B.id, ids)).limit(20),
      )
      if (
        records.length !== ids.length ||
        records.some(
          (b) =>
            b.actorId !== tx.actor ||
            b.taskId !== task.id ||
            !b.ready ||
            b.finalizedAt ||
            string(b.expiresAt) < now(),
        )
      )
        return refuse('upload_expired')
      for (const binding of records)
        await cas(tx, 'flow.FlowAttachmentBinding', string(binding.id), binding.version, {
          finalizedAt: now(),
          expiresAt: null,
        })
      await tx.db.insert('flow.TaskHistory', {
        id: randomUUID(),
        taskId: task.id,
        projectId: task.projectId,
        workspaceId: null,
        actorId: tx.actor,
        kind: 'attachment',
        description: 'Files attached',
        metadata: { ids },
        createdAt: now(),
      })
      return { ok: true, id: task.key }
    },
  )
}

export async function attachmentAction(
  ctx: Ctx,
  input: Row,
  extensions: NativeServerExtension[],
  archived: boolean,
) {
  const binding = await owned(ctx, 'flow.FlowAttachmentBinding', input.id)
  return mutate(
    ctx,
    {
      name: archived ? 'flow.attachment.archive' : 'flow.attachment.restore',
      capability: 'project.write',
      input: { ...input, projectId: binding.projectId },
      subjects: [{ model: 'flow.FlowAttachmentBinding', id: binding.id, projectId: binding.projectId }],
    },
    extensions,
    async (tx) => {
      if (!binding.finalizedAt) return refuse('not_found')
      await cas(tx, 'flow.FlowAttachmentBinding', string(binding.id), input.expectedVersion, { archived })
      return { ok: true, id: binding.id }
    },
  )
}

export async function readAttachment(ctx: Ctx, input: Row) {
  const row = await owned(ctx, 'storage.Attachment', input.id)
  if (!ownerModels.has(string(row.resModel))) return refuse('not_found')
  await ownerAccess(ctx, row)
  return row
}

export async function taskFiles(ctx: Ctx, task: Row) {
  await requireCapability(ctx, 'project.read', { projectId: task.projectId })
  const B = ctx.table('flow.FlowAttachmentBinding'),
    A = ctx.table('storage.Attachment')
  const bindings = await ctx.db.all(
    from(B).where(eq(B.companyId, ctx.scope.company), eq(B.taskId, task.id)).limit(100),
  )
  const records = await ctx.db.all(
    from(A)
      .where(
        eq(A.companyId, ctx.scope.company),
        inArray(
          A.id,
          bindings.filter((b) => b.finalizedAt).map((b) => b.attachmentId),
        ),
      )
      .limit(100),
  )
  return records.map((row) => ({
    id: row.id,
    taskId: task.key,
    title: row.name,
    size: row.size,
    type: row.mimetype,
    archived: bindings.find((b) => b.attachmentId === row.id)?.archived,
    version: bindings.find((b) => b.attachmentId === row.id)?.version,
    url: '/flow/files/' + encodeURIComponent(string(row.id)),
  }))
}
