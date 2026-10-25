import { randomUUID } from 'node:crypto'
import * as Y from 'yjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import type { DocumentOwner } from '../../livedoc/index.ts'
import { snapshotBlocksOf } from '../../livedoc/sync.ts'
import { cas, mutate, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { readableDocument } from './documents.ts'
import { taskByKey } from './queries.ts'
import { requireCapability, refuse, string } from './policy.ts'
import { flowSnapshotKey, isFlowSnapshotKey } from './blob-keys.ts'

export const MAX_DOCUMENT_PRESENCE_INDEX = 10000

export async function readLiveDocument(ctx: Ctx, input: Row, page: boolean, write = false): Promise<Row> {
  const row = page ? await readableDocument(ctx, input.id, write) : await taskByKey(ctx, input.id)
  if (!page)
    await requireCapability(ctx, write ? 'project.write' : 'project.read', { projectId: row.projectId })
  if (write && row.archived) return refuse('archived')
  return {
    ...row,
    snapshot: page ? row.bodyDoc : row.descriptionDoc,
    blocks: page ? row.blocks : [{ type: 'paragraph', text: row.description }],
  }
}

/** The existing editor's Yjs storage vocabulary, with no product markup. */
function initialSnapshot(row: Row) {
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
        (({ paragraph: 'p', heading: 'h2', subheading: 'h3' } as Row)[string(block.type)] as string) ??
          string(block.type),
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
  page: boolean,
  extensions: NativeServerExtension[],
) {
  const held = await readLiveDocument(ctx, input, page, true)
  if (
    !/^[a-f0-9]{64}$/.test(string(input.checksum)) ||
    !isFlowSnapshotKey(
      string(input.storeKey),
      string(ctx.scope.company),
      page ? 'page' : 'issue',
      string(held.id),
      string(input.checksum),
    ) ||
    !Number.isSafeInteger(input.size) ||
    Number(input.size) < 0 ||
    Number(input.size) > 2 * 1024 * 1024
  )
    return refuse('validation')
  if (page && (!Array.isArray(input.blocks) || input.blocks.length > 10000)) return refuse('validation')
  const acknowledgement = await mutate(
    ctx,
    {
      name: `flow.${page ? 'page' : 'issue'}.document.commit`,
      capability: held.projectId ? 'project.write' : 'workspace.write',
      subjects: [{ model: page ? 'flow.Document' : 'flow.Task', id: held.id, projectId: held.projectId }],
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
      const current = await readLiveDocument(tx, input, page, true)
      const id = randomUUID(),
        preview = string(input.previewText).slice(0, 1000000)
      await tx.db.insert('storage.Attachment', {
        id,
        name: 'document.yjs',
        kind: 'stored',
        resModel: page ? 'flow.Document' : 'flow.Task',
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
      } else values.description = preview
      const record = await cas(
        tx,
        page ? 'flow.Document' : 'flow.Task',
        string(current.id),
        input.expectedVersion,
        values,
      )
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
          : { task: { id: record.key, version: record.version, description: record.description } },
      }
    },
  )
  // A retry can arrive after another edit. Never send an old receipt's version
  // back to the editor and overwrite newer task/page metadata in its cache.
  const current = await readLiveDocument(ctx, input, page)
  return {
    ...acknowledgement,
    record: page
      ? {
          page: {
            id: current.id,
            version: current.version,
            title: current.title,
            content: current.body,
            blocks: current.blocks,
          },
        }
      : { task: { id: current.key, version: current.version, description: current.description } },
  }
}

export const flowDocumentOwner = (page: boolean): DocumentOwner => ({
  kind: page ? 'flow.Document' : 'flow.Task',
  readFn: `flow.${page ? 'page' : 'issue'}.document.read`,
  writeFn: `flow.${page ? 'page' : 'issue'}.document.write`,
  commitFn: `flow.${page ? 'page' : 'issue'}.document.commit`,
  attachmentOf: (row) => row.contentAttachmentId,
  initialSnapshotOf: initialSnapshot,
  durablePush: true,
  presenceFn: `flow.${page ? 'page' : 'issue'}.document.presence`,
  presenceMaxIndex: MAX_DOCUMENT_PRESENCE_INDEX,
  presenceListFn: `flow.${page ? 'page' : 'issue'}.document.presence.list`,
  snapshotKey: (company, id, checksum) => flowSnapshotKey(company, page ? 'page' : 'issue', id, checksum),
  ...(page ? { snapshotMetadata: (ref) => ({ blocks: snapshotBlocksOf(ref) }) } : {}),
})
