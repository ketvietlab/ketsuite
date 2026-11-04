import { randomUUID } from 'node:crypto'
import * as Y from 'yjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { eq, from } from '@ketvietlab/ketjs'
import type { DocumentOwner } from '../../livedoc/index.ts'
import { snapshotBlocksOf } from '../../livedoc/sync.ts'
import { cas, mutate, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { readableDocument, documentRecord } from './documents.ts'
import { taskByKey, taskDocumentRecord } from './queries.ts'
import { owned, requireCapability, refuse, string } from './policy.ts'
import { flowSnapshotKey, isFlowSnapshotKey } from './blob-keys.ts'
import type { FlowDocumentKind } from './blob-keys.ts'
import { validFlowDocument } from './document-schema.ts'

export const MAX_DOCUMENT_PRESENCE_INDEX = 10000

type DocumentOwnerInput = boolean | FlowDocumentKind
export const documentKind = (owner: DocumentOwnerInput): FlowDocumentKind =>
  typeof owner === 'boolean' ? (owner ? 'page' : 'issue') : owner
const modelOf = (kind: FlowDocumentKind) =>
  ({ page: 'flow.Document', issue: 'flow.Task', project: 'flow.ProjectRecord', epic: 'flow.EpicRecord' })[
    kind
  ]
const writeCapability = (kind: FlowDocumentKind) =>
  kind === 'project' || kind === 'epic' ? 'project.manage' : 'project.write'

export async function readLiveDocument(
  ctx: Ctx,
  input: Row,
  owner: DocumentOwnerInput,
  write = false,
  includeRecord = true,
): Promise<Row> {
  const kind = documentKind(owner),
    page = kind === 'page'
  let row = page
    ? await readableDocument(ctx, input.id, write)
    : kind === 'issue'
      ? await taskByKey(ctx, input.id)
      : await owned(ctx, modelOf(kind), input.id)
  if (!page) {
    const projectId = kind === 'project' ? row.id : row.projectId
    await requireCapability(ctx, write ? writeCapability(kind) : 'project.read', { projectId })
    const project = kind === 'project' ? row : await owned(ctx, 'flow.ProjectRecord', projectId)
    if (write && project.archived) return refuse('archived')
    row = { ...row, projectId, workspaceId: project.workspaceId }
  }
  if (write && row.archived) return refuse('archived')
  if (includeRecord && page) row = { ...row, documentRecord: await documentRecord(ctx, row) }
  if (includeRecord && kind === 'issue') row = { ...row, documentRecord: await taskDocumentRecord(ctx, row) }
  if (includeRecord && kind === 'project')
    row = { ...row, documentRecord: { ...row, ...(row.catalogOverrides as Row) } }
  if (includeRecord && kind === 'epic') {
    const U = ctx.table('user.User')
    const who = row.ownerId ? await ctx.db.one(from(U).where(eq(U.id, row.ownerId))) : null
    row = { ...row, documentRecord: { ...row, owner: who?.name ?? '' } }
  }
  return {
    ...row,
    snapshot: page ? row.bodyDoc : row.descriptionDoc,
    blocks: page ? row.blocks : [{ type: 'paragraph', text: row.description }],
  }
}

const descriptionProjection = (row: Row, kind: FlowDocumentKind): Row => ({
  [kind === 'issue' ? 'task' : kind]: row.documentRecord ?? {
    id: kind === 'issue' ? row.key : row.id,
    version: row.version,
    description: row.description,
  },
})

/** The existing editor's Yjs storage vocabulary, with no product markup. */
function initialSnapshot(row: Row) {
  if (row.contentAttachmentId) return null
  if (typeof row.snapshot === 'string' && row.snapshot) return Buffer.from(row.snapshot, 'base64')
  const doc = new Y.Doc()
  // Canonical genesis: separate workers must construct the same CRDT identities
  // before the first durable snapshot exists. Subsequent authors keep random IDs.
  doc.clientID = 0
  try {
    const fragment = doc.getXmlFragment('content')
    for (const block of Array.isArray(row.blocks) ? (row.blocks as Row[]) : []) {
      const element = new Y.XmlElement('block'),
        text = new Y.XmlText()
      element.setAttribute(
        'type',
        (({ paragraph: 'p', heading: 'h2', subheading: 'h3', task: 'check' } as Row)[
          string(block.type)
        ] as string) ?? string(block.type),
      )
      element.setAttribute('id', string(block.id) || `initial-${fragment.length}`)
      if (block.checked) element.setAttribute('checked', 'true')
      for (const key of ['align', 'width', 'src', 'alt'])
        if (block[key] !== undefined) element.setAttribute(key, string(block[key]))
      if (Array.isArray(block.rows)) element.setAttribute('rows', JSON.stringify(block.rows))
      fragment.insert(fragment.length, [element])
      element.insert(0, [text])
      if (block.text)
        text.applyDelta([
          {
            insert: string(block.text),
            attributes: { ...(block.bold ? { bold: true } : {}), ...(block.italic ? { italic: true } : {}) },
          },
        ])
    }
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

export async function commitLiveDocument(
  ctx: Ctx,
  input: Row,
  owner: DocumentOwnerInput,
  extensions: NativeServerExtension[],
) {
  const kind = documentKind(owner),
    page = kind === 'page'
  const held = await readLiveDocument(ctx, input, kind, true, false)
  if (
    !/^[a-f0-9]{64}$/.test(string(input.checksum)) ||
    !isFlowSnapshotKey(
      string(input.storeKey),
      string(ctx.scope.company),
      kind,
      string(held.id),
      string(input.checksum),
    ) ||
    !Number.isSafeInteger(input.size) ||
    Number(input.size) < 0 ||
    Number(input.size) > 2 * 1024 * 1024
  )
    return refuse('validation')
  if (page && (!Array.isArray(input.blocks) || input.blocks.length > 10000)) return refuse('validation')
  const acknowledgement = await mutate<Row>(
    ctx,
    {
      name: `flow.${kind}.document.commit`,
      capability: page ? (held.projectId ? 'project.write' : 'workspace.write') : writeCapability(kind),
      subjects:
        kind === 'project'
          ? []
          : [
              {
                model: kind === 'page' ? 'flow.Document' : kind === 'issue' ? 'flow.Task' : 'flow.EpicRecord',
                id: held.id,
                projectId: held.projectId,
              },
            ],
      input: {
        ...input,
        // The trusted route's per-attempt key is transport metadata. Retries of
        // identical canonical bytes keep the original snapshot receipt/version.
        storeKey: undefined,
        expectedVersion: undefined,
        projectId: held.projectId,
        workspaceId: held.workspaceId,
        idempotencyKey: `snapshot:${input.id}:${input.checksum}`,
      },
    },
    extensions,
    async (tx) => {
      const current = await readLiveDocument(tx, input, kind, true, false)
      const id = randomUUID(),
        preview = string(input.previewText).slice(0, 1000000)
      await tx.db.insert('storage.Attachment', {
        id,
        name: 'document.yjs',
        kind: 'stored',
        resModel: modelOf(kind),
        resId: current.id,
        resField: 'content',
        storeKey: input.storeKey,
        checksum: input.checksum,
        size: input.size,
        mimetype: 'application/octet-stream',
        public: false,
        createdAt: now(),
      })
      const values: Row = { contentAttachmentId: id }
      if (page) {
        values.body = preview
        values.blocks = input.blocks
        values.bodyDoc = null
        if (current.titleSource === 'content')
          values.title =
            preview
              .split(/\r?\n/)
              .find((line) => line.trim())
              ?.trim()
              .slice(0, 1000) || 'Untitle'
      } else {
        values.description = preview
        values.descriptionDoc = null
      }
      const record = await cas(tx, modelOf(kind), string(current.id), input.expectedVersion, values)
      if (current.contentAttachmentId) {
        await tx.jobs.enqueue(
          'flow.expireSnapshot',
          { id: current.contentAttachmentId },
          {
            uniqueKey: 'flow-snapshot:' + current.contentAttachmentId,
            runAt: new Date(Date.now() + 7200000),
          },
        )
      }
      return {
        ok: true,
        id: current.id,
        contentAttachmentId: id,
        record: page
          ? {
              page: {
                id: record.id,
                version: record.version,
                title: record.title,
                content: record.body,
                blocks: record.blocks,
              },
            }
          : descriptionProjection(record, kind),
      }
    },
  )
  // A retry can arrive after another edit. Never send an old receipt's version
  // back to the editor and overwrite newer task/page metadata in its cache.
  const current = await readLiveDocument(ctx, input, kind)
  return {
    ...acknowledgement,
    record: page ? { page: current.documentRecord } : descriptionProjection(current, kind),
  }
}

export const flowDocumentOwner = (owner: DocumentOwnerInput): DocumentOwner => {
  const kind = documentKind(owner),
    page = kind === 'page'
  return {
    kind: modelOf(kind),
    readFn: `flow.${kind}.document.read`,
    writeFn: `flow.${kind}.document.write`,
    commitFn: `flow.${kind}.document.commit`,
    attachmentOf: (row) => row.contentAttachmentId,
    initialSnapshotOf: initialSnapshot,
    durablePush: true,
    validateSnapshot: validFlowDocument,
    recordOf: (row) => (page ? { page: row.documentRecord } : descriptionProjection(row, kind)),
    presenceFn: `flow.${kind}.document.presence`,
    presenceMaxIndex: MAX_DOCUMENT_PRESENCE_INDEX,
    presenceListFn: `flow.${kind}.document.presence.list`,
    snapshotKey: (company, id, checksum) => flowSnapshotKey(company, kind, id, checksum),
    ...(page ? { snapshotMetadata: (ref) => ({ blocks: snapshotBlocksOf(ref) }) } : {}),
  }
}
