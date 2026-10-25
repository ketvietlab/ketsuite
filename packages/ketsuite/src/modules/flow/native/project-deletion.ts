import { randomUUID } from 'node:crypto'
import { asc, defineJob, deleteFrom, eq, from, gt, inArray, ne } from '@ketvietlab/ketjs'
import type { Ctx, JobContext, JobSpec, Row } from '@ketvietlab/ketjs'
import { forget } from '../../livedoc/sync.ts'
import { permittedFor } from '../../user/roles.ts'
import { advanceRevision, cas, hash, lock, mutate, now, revision } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { limitOf } from './queries.ts'
import { nativeFlowModels } from './models.ts'
import { owned, refuse, requireCapability, string } from './policy.ts'
import { isExclusiveFlowBlob } from './blob-keys.ts'

const WINDOW = 100
const GRACE = 60 * 60 * 1000
const projectModels = Object.entries(nativeFlowModels)
  .filter(
    ([name, model]) =>
      model.fields.projectId && !['DeletionRecord', 'Task', 'Document', 'EpicRecord'].includes(name),
  )
  .map(([name]) => 'flow.' + name)
const taskModels = Object.entries(nativeFlowModels)
  .filter(([, model]) => model.fields.taskId)
  .map(([name]) => 'flow.' + name)

async function deletionAuthority(ctx: Ctx) {
  const a = await requireCapability(ctx, 'organization.manage', {})
  const keys = await permittedFor(ctx, a.actorId)
  if (keys !== null && !keys.includes('flow.project.delete')) return refuse('forbidden')
}

async function impact(ctx: Ctx, project: Row) {
  const counts: Row = {}
  for (const name of [
    'Task',
    'Document',
    'EpicRecord',
    'SprintRecord',
    'InternalForm',
    'FlowAttachmentBinding',
  ]) {
    const T = ctx.table('flow.' + name)
    counts[name] = await ctx.db.count(
      from(T).where(eq(T.companyId, ctx.scope.company), eq(T.projectId, project.id)),
    )
  }
  const A = ctx.table('storage.Attachment')
  counts.projectFiles = await ctx.db.count(
    from(A).where(
      eq(A.companyId, ctx.scope.company),
      eq(A.resModel, 'flow.ProjectRecord'),
      eq(A.resId, project.id),
    ),
  )
  return counts
}

export async function previewProjectDeletion(ctx: Ctx, input: Row) {
  const projectId = string(input.id)
  await requireCapability(ctx, 'project.manage', { projectId })
  // The same organization lock as mutations makes version/counts one snapshot.
  return ctx.tx(async (tx) => {
    await lock(tx, 'organization')
    await requireCapability(tx, 'project.manage', { projectId })
    const project = await owned(tx, 'flow.ProjectRecord', projectId)
    const counted = await impact(tx, project)
    return {
      ok: true,
      projectId,
      version: project.version,
      title: project.title,
      impact: counted,
      impactDigest: hash(
        JSON.stringify([
          project.id,
          project.version,
          await revision(tx, 'project-change:' + projectId),
          counted,
        ]),
      ),
    }
  })
}

export async function deleteProject(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const projectId = string(input.id)
  return mutate(
    ctx,
    { name: 'flow.project.delete', capability: 'project.delete', input: { ...input, projectId } },
    extensions,
    async (tx) => {
      const project = await owned(tx, 'flow.ProjectRecord', projectId)
      if (project.deletionId) return refuse('deleting')
      if (input.confirmName !== project.title) return refuse('validation', { confirmName: 'mismatch' })
      const counted = await impact(tx, project)
      if (
        input.impactDigest !==
        hash(
          JSON.stringify([
            project.id,
            project.version,
            await revision(tx, 'project-change:' + projectId),
            counted,
          ]),
        )
      )
        return refuse('conflict')
      const id = randomUUID()
      await cas(tx, 'flow.ProjectRecord', projectId, input.expectedVersion, {
        deletionId: id,
        archived: true,
      })
      await tx.db.insert('flow.DeletionRecord', {
        id,
        projectId,
        projectTitle: project.title,
        projectCode: project.code,
        requestedBy: tx.actor,
        reason: string(input.reason).slice(0, 2000),
        state: 'requested',
        impact: counted,
        removed: {},
        requestedAt: now(),
        completedAt: null,
        version: 1,
      })
      await tx.jobs.enqueue(
        'flow.purgeNativeProject',
        { deletionId: id },
        { uniqueKey: 'flow-delete:' + id + ':1' },
      )
      return {
        ok: true,
        id,
        projectId,
        state: 'requested',
        revision: await advanceRevision(tx, { expectedRevision: await revision(tx) }),
      }
    },
  )
}

export async function listProjectDeletions(ctx: Ctx, input: Row) {
  await deletionAuthority(ctx)
  const D = ctx.table('flow.DeletionRecord'),
    limit = limitOf(input.limit, 20)
  const cursor = string(input.cursor)
  if (cursor.length > 200) return refuse('validation', { cursor: 'invalid' })
  const rows = await ctx.db.all(
    from(D)
      .where(eq(D.companyId, ctx.scope.company), ...(cursor ? [gt(D.id, cursor)] : []))
      .orderBy(asc(D.id))
      .limit(limit + 1),
  )
  return {
    ok: true,
    records: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  }
}

export async function retryProjectDeletion(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  await deletionAuthority(ctx)
  return mutate(
    ctx,
    { name: 'flow.project.deletion.retry', capability: 'organization.manage', input },
    extensions,
    async (tx) => {
      await deletionAuthority(tx)
      const deletion = await owned(tx, 'flow.DeletionRecord', input.id)
      if (['done', 'retained_blobs'].includes(string(deletion.state)))
        return { ok: true, id: deletion.id, state: deletion.state }
      const name = deletion.state === 'waiting_blobs' ? 'flow.purgeNativeBlobs' : 'flow.purgeNativeProject'
      await tx.jobs.enqueue(
        name,
        { deletionId: deletion.id },
        { uniqueKey: `flow-delete-retry:${deletion.id}:${input.idempotencyKey}` },
      )
      return { ok: true, id: deletion.id, state: deletion.state }
    },
  )
}

async function removeRows(ctx: Ctx, model: string, column: string, ids: string[]) {
  if (!ids.length) return 0
  const T = ctx.table(model)
  const rows = await ctx.db.all(
    from(T).select(T.id).where(eq(T.companyId, ctx.scope.company), inArray(T[column]!, ids)).limit(WINDOW),
  )
  if (rows.length)
    await ctx.db.del(
      deleteFrom(T).where(
        eq(T.companyId, ctx.scope.company),
        inArray(
          T.id,
          rows.map((row) => row.id),
        ),
      ),
    )
  return rows.length
}

async function notificationOutboxes(ctx: Ctx, column: 'taskId' | 'projectId', ids: string[]) {
  const I = ctx.table('flow.Inbox')
  const rows = await ctx.db.all(
    from(I).select(I.id).where(eq(I.companyId, ctx.scope.company), inArray(I[column]!, ids)).limit(WINDOW),
  )
  return removeRows(
    ctx,
    'flow.Outbox',
    'targetId',
    rows.map((row) => string(row.id)),
  )
}

/** One attachment/rendition window per transaction; owners stay until children drain. */
async function stageAttachments(ctx: Ctx, deletionId: string, model: string, ids: string[]) {
  const A = ctx.table('storage.Attachment'),
    R = ctx.table('storage.AttachmentRendition')
  const row = await ctx.db.one(
    from(A).where(eq(A.companyId, ctx.scope.company), eq(A.resModel, model), inArray(A.resId, ids)),
  )
  if (!row) return { changed: false, removed: 0 }
  const stage = async (key: unknown, store = 'private') => {
    if (!key) return
    const value = string(key),
      company = string(ctx.scope.company)
    const allowed = store === 'public' ? ['published/'] : ['blobs/', 'renditions/']
    if (!allowed.some((prefix) => value.startsWith(prefix + company + '/')))
      return refuse('invalid_blob_scope')
    await ctx.db.insertIfAbsent('flow.DeletionBlob', {
      id: hash(JSON.stringify([company, deletionId, store, value])),
      deletionId,
      key: value,
      store,
      state: 'pending',
    })
  }
  await stage(row.storeKey)
  await stage(row.publicStoreKey, 'public')
  const renditions = await ctx.db.all(
    from(R).where(eq(R.companyId, ctx.scope.company), eq(R.attachmentId, row.id)).limit(WINDOW),
  )
  if (renditions.length) {
    for (const rendition of renditions) await stage(rendition.storeKey)
    await ctx.db.del(
      deleteFrom(R).where(
        eq(R.companyId, ctx.scope.company),
        inArray(
          R.id,
          renditions.map((r) => r.id),
        ),
      ),
    )
    return { changed: true, removed: 0 }
  }
  if (await removeRows(ctx, 'flow.FlowAttachmentBinding', 'attachmentId', [string(row.id)]))
    return { changed: true, removed: 0 }
  await ctx.db.del(deleteFrom(A).where(eq(A.companyId, ctx.scope.company), eq(A.id, row.id)))
  return { changed: true, removed: 1 }
}

export function nativeDeletionJobs(
  extensions: NativeServerExtension[],
  effects: string[],
): Record<string, JobSpec> {
  const purge = async (ctx: Ctx, model: string, ids: string[], projectId: string) => {
    for (const extension of extensions) await extension.purge?.(ctx, { model, ids, projectId })
  }
  return {
    purgeNativeProject: defineJob({
      queue: 'maintenance',
      input: { deletionId: 'id' },
      effects: [
        ...effects,
        'read:storage.AttachmentRendition',
        'write:storage.AttachmentRendition',
        'enqueue:flow.purgeNativeProject',
        'enqueue:flow.purgeNativeBlobs',
      ],
      idempotent: true,
      maxAttempts: 8,
      timeoutMs: 120000,
      handler: async (ctx, args) => {
        // A finite number of owner windows per execution; continuation is durable.
        for (let window = 0; window < 20; window++) {
          if (ctx.signal.aborted) throw ctx.signal.reason
          const finished = await ctx.tx(async (tx) => {
            await lock(tx, 'organization')
            const deletion = await owned(tx, 'flow.DeletionRecord', args.deletionId)
            if (['waiting_blobs', 'done', 'retained_blobs'].includes(string(deletion.state))) return true
            const projectId = string(deletion.projectId),
              project = await owned(tx, 'flow.ProjectRecord', projectId)
            if (project.deletionId !== deletion.id) return refuse('invalid_deletion_owner')
            const removed = { ...(deletion.removed as Row) }
            const checkpoint = async (model: string, count: number) => {
              removed[model] = Number(removed[model] ?? 0) + count
              await cas(tx, 'flow.DeletionRecord', string(deletion.id), deletion.version, {
                state: 'purging',
                removed,
              })
              return false
            }
            for (const model of ['flow.Task', 'flow.Document', 'flow.EpicRecord']) {
              const T = tx.table(model)
              const rows = await tx.db.all(
                from(T)
                  .select(T.id)
                  .where(eq(T.companyId, tx.scope.company), eq(T.projectId, projectId))
                  .orderBy(asc(T.id))
                  .limit(WINDOW),
              )
              if (!rows.length) continue
              const ids = rows.map((row) => string(row.id))
              await purge(tx, model, ids, projectId)
              const files = await stageAttachments(tx, string(deletion.id), model, ids)
              if (files.changed) return checkpoint('attachments', files.removed)
              const children =
                model === 'flow.Task' ? taskModels : model === 'flow.Document' ? ['flow.DocumentGrant'] : []
              for (const child of children) {
                if (child === 'flow.Inbox') {
                  const outboxes = await notificationOutboxes(tx, 'taskId', ids)
                  if (outboxes) return checkpoint('flow.Outbox', outboxes)
                }
                const count = await removeRows(
                  tx,
                  child,
                  model === 'flow.Task' ? 'taskId' : 'documentId',
                  ids,
                )
                if (count) return checkpoint(child, count)
              }
              if (model === 'flow.Task' || model === 'flow.Document') {
                const P = tx.table('flow.DocumentPresence')
                const leases = await tx.db.all(
                  from(P)
                    .select(P.id)
                    .where(
                      eq(P.companyId, tx.scope.company),
                      eq(P.ownerKind, model === 'flow.Task' ? 'issue' : 'page'),
                      inArray(P.ownerId, ids),
                    )
                    .limit(WINDOW),
                )
                if (leases.length) {
                  await tx.db.del(
                    deleteFrom(P).where(
                      eq(P.companyId, tx.scope.company),
                      inArray(
                        P.id,
                        leases.map((row) => row.id),
                      ),
                    ),
                  )
                  return checkpoint('flow.DocumentPresence', leases.length)
                }
              }
              if (model === 'flow.Task') {
                const incoming = await removeRows(tx, 'flow.TaskRelation', 'targetId', ids)
                if (incoming) return checkpoint('flow.TaskRelation', incoming)
              }
              await tx.db.del(deleteFrom(T).where(eq(T.companyId, tx.scope.company), inArray(T.id, ids)))
              for (const id of ids) forget({ company: string(tx.scope.company), kind: model, id })
              return checkpoint(model, ids.length)
            }
            await purge(tx, 'flow.ProjectRecord', [projectId], projectId)
            const files = await stageAttachments(tx, string(deletion.id), 'flow.ProjectRecord', [projectId])
            if (files.changed) return checkpoint('attachments', files.removed)
            // Drain child ledgers before their parent IDs disappear. This also
            // covers commitments referring to tasks transferred to another project.
            for (const [parent, children, column] of [
              ['flow.SprintRecord', ['flow.SprintCommitment', 'flow.SprintReport'], 'sprintId'],
              ['flow.InternalForm', ['flow.FormResponse'], 'formId'],
            ] as const) {
              const T = tx.table(parent)
              const rows = await tx.db.all(
                from(T)
                  .select(T.id)
                  .where(eq(T.companyId, tx.scope.company), eq(T.projectId, projectId))
                  .limit(WINDOW),
              )
              if (!rows.length) continue
              const ids = rows.map((row) => string(row.id))
              for (const child of children) {
                const count = await removeRows(tx, child, column, ids)
                if (count) return checkpoint(child, count)
              }
              return checkpoint(parent, await removeRows(tx, parent, 'id', ids))
            }
            for (const model of projectModels) {
              if (model === 'flow.CommandReceipt') {
                const T = tx.table(model)
                const rows = await tx.db.all(
                  from(T)
                    .select(T.id)
                    .where(
                      eq(T.companyId, tx.scope.company),
                      eq(T.projectId, projectId),
                      ne(T.command, 'flow.project.delete'),
                    )
                    .limit(WINDOW),
                )
                if (rows.length)
                  return checkpoint(
                    model,
                    await removeRows(
                      tx,
                      model,
                      'id',
                      rows.map((row) => string(row.id)),
                    ),
                  )
              } else {
                if (model === 'flow.Inbox') {
                  const outboxes = await notificationOutboxes(tx, 'projectId', [projectId])
                  if (outboxes) return checkpoint('flow.Outbox', outboxes)
                }
                const count = await removeRows(tx, model, 'projectId', [projectId])
                if (count) return checkpoint(model, count)
              }
            }
            for (const model of ['flow.ScopedGrant', 'flow.Invitation']) {
              const T = tx.table(model)
              const rows = await tx.db.all(
                from(T)
                  .select(T.id)
                  .where(eq(T.companyId, tx.scope.company), eq(T.scope, 'project'), eq(T.targetId, projectId))
                  .limit(WINDOW),
              )
              if (!rows.length) continue
              const ids = rows.map((row) => string(row.id))
              if (model === 'flow.Invitation') {
                const outbox = await removeRows(tx, 'flow.Outbox', 'targetId', ids)
                if (outbox) return checkpoint('flow.Outbox', outbox)
              }
              return checkpoint(model, await removeRows(tx, model, 'id', ids))
            }
            const P = tx.table('flow.ProjectRecord')
            await tx.db.del(
              deleteFrom(P).where(
                eq(P.companyId, tx.scope.company),
                eq(P.id, projectId),
                eq(P.deletionId, deletion.id),
              ),
            )
            const B = tx.table('flow.DeletionBlob')
            const pending = await tx.db.count(
              from(B).where(
                eq(B.companyId, tx.scope.company),
                eq(B.deletionId, deletion.id),
                eq(B.state, 'pending'),
              ),
            )
            const state = pending ? 'waiting_blobs' : 'done'
            await cas(tx, 'flow.DeletionRecord', string(deletion.id), deletion.version, {
              state,
              removed,
              completedAt: pending ? null : now(),
            })
            if (pending)
              await tx.jobs.enqueue(
                'flow.purgeNativeBlobs',
                { deletionId: deletion.id },
                { uniqueKey: `flow-delete-blobs:${deletion.id}`, runAt: new Date(Date.now() + GRACE) },
              )
            await tx.notify(
              `flow_${hash(string(tx.scope.company)).slice(0, 48)}`,
              JSON.stringify({ changed: true }),
            )
            return true
          })
          if (finished) return
        }
        const held = await owned(ctx, 'flow.DeletionRecord', args.deletionId)
        await ctx.jobs.enqueue(
          'flow.purgeNativeProject',
          { deletionId: held.id },
          { uniqueKey: `flow-delete:${held.id}:${held.version}` },
        )
      },
    }),
    purgeNativeBlobs: defineJob({
      queue: 'maintenance',
      input: { deletionId: 'id' },
      effects: [
        ...effects,
        'read:storage.AttachmentRendition',
        'storage:read',
        'storage:remove',
        'enqueue:flow.purgeNativeBlobs',
      ],
      idempotent: true,
      maxAttempts: 8,
      timeoutMs: 120000,
      handler: async (ctx: JobContext, args) => {
        const deletion = await owned(ctx, 'flow.DeletionRecord', args.deletionId)
        if (['done', 'retained_blobs'].includes(string(deletion.state))) return
        if (deletion.state !== 'waiting_blobs') return refuse('invalid_deletion_state')
        const B = ctx.table('flow.DeletionBlob'),
          A = ctx.table('storage.Attachment'),
          R = ctx.table('storage.AttachmentRendition')
        const rows = await ctx.db.all(
          from(B)
            .where(eq(B.companyId, ctx.scope.company), eq(B.deletionId, deletion.id), eq(B.state, 'pending'))
            .orderBy(asc(B.id))
            .limit(WINDOW),
        )
        let runAt = Date.now()
        for (const blob of rows) {
          if (ctx.signal.aborted) throw ctx.signal.reason
          const company = string(ctx.scope.company),
            key = string(blob.key),
            publicStore = blob.store === 'public'
          if (
            !(publicStore
              ? key.startsWith(`published/${company}/`)
              : [`blobs/${company}/`, `renditions/${company}/`].some((prefix) => key.startsWith(prefix)))
          )
            return refuse('invalid_blob_scope')
          const shared =
            (await ctx.db.count(
              from(A).where(
                eq(A.companyId, company),
                publicStore ? eq(A.publicStoreKey, key) : eq(A.storeKey, key),
              ),
            )) +
            (publicStore
              ? 0
              : await ctx.db.count(from(R).where(eq(R.companyId, company), eq(R.storeKey, key))))
          let state = 'shared'
          if (!shared && (publicStore || !isExclusiveFlowBlob(key, company))) {
            // Content-addressed keys can be rewritten by another module between
            // checking references and remove(). The interface cannot fence it.
            state = 'retained_legacy'
          } else if (!shared) {
            const store = publicStore ? ctx.storage.public : ctx.storage
            if (!store) throw new Error('Deletion publication storage is unavailable')
            const meta = await store.head(key)
            // Missing modification metadata cannot establish upload safety.
            if (meta && (!meta.modifiedAt || !Number.isFinite(Date.parse(meta.modifiedAt))))
              throw new Error('Deletion storage modification time is unavailable')
            const readyAt = meta ? Date.parse(meta.modifiedAt!) + GRACE : 0
            if (readyAt > Date.now()) {
              runAt = Math.max(runAt, readyAt)
              continue
            }
            await store.remove(key)
            state = 'removed'
          }
          await ctx.db.update(
            'flow.DeletionBlob',
            { id: blob.id, companyId: company, state: 'pending' },
            { state },
          )
        }
        await ctx.tx(async (tx) => {
          await lock(tx, 'organization')
          const held = await owned(tx, 'flow.DeletionRecord', deletion.id)
          if (['done', 'retained_blobs'].includes(string(held.state))) return
          const pending = await tx.db.count(
            from(B).where(
              eq(B.companyId, tx.scope.company),
              eq(B.deletionId, deletion.id),
              eq(B.state, 'pending'),
            ),
          )
          if (!pending) {
            const retained = await tx.db.count(
              from(B).where(
                eq(B.companyId, tx.scope.company),
                eq(B.deletionId, deletion.id),
                eq(B.state, 'retained_legacy'),
              ),
            )
            await cas(tx, 'flow.DeletionRecord', string(held.id), held.version, {
              state: retained ? 'retained_blobs' : 'done',
              completedAt: now(),
            })
          } else
            await tx.jobs.enqueue(
              'flow.purgeNativeBlobs',
              { deletionId: held.id },
              { uniqueKey: `flow-delete-blobs:${held.id}:${randomUUID()}`, runAt: new Date(runAt) },
            )
        })
      },
    }),
  }
}
