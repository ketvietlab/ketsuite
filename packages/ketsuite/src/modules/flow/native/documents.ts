import { randomUUID } from 'node:crypto'
import { and, asc, deleteFrom, eq, from, gt, inArray, isNull, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { cas, hash, mutate } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { authority, owned, rank, refuse, string } from './policy.ts'
import { timestamped } from './organization.ts'
import { requireDocumentTransport } from './rich-content.ts'

export async function documentAccess(ctx: Ctx, document: Row) {
  const a = await authority(ctx)
  const w = await owned(ctx, 'flow.Workspace', document.workspaceId)
  const p = document.projectId ? await owned(ctx, 'flow.ProjectRecord', document.projectId) : null
  if (p?.deletionId) return { read: false, write: false, manage: false }
  const role = p ? a.projectRole(p, w) : a.workspaceRole(w)
  const G = ctx.table('flow.DocumentGrant')
  const grant = await ctx.db.one(
    from(G).where(eq(G.companyId, a.companyId), eq(G.documentId, document.id), eq(G.userId, a.actorId)),
  )
  const owner = document.authorId === a.actorId
  const explicit = Boolean(grant)
  const read = Boolean(
    role &&
      (a.member?.role === 'guest' ? explicit : document.visibility === 'private' ? owner || explicit : true),
  )
  const write =
    read &&
    a.member?.role !== 'guest' &&
    (rank[role ?? ''] ?? 0) >= 2 &&
    (document.visibility !== 'private' || owner)
  return { read, write, manage: read && owner }
}

export async function readableDocument(ctx: Ctx, id: unknown, write = false) {
  const document = await owned(ctx, 'flow.Document', id)
  const access = await documentAccess(ctx, document)
  if (!(write ? access.write : access.read)) return refuse('forbidden')
  return document
}

function documentRecordValue(row: Row, access: Row, readerIds: unknown[], readers?: Row[]) {
  const { body, bodyDoc, blocks, ...metadata } = row
  return {
    ...metadata,
    ownerId: row.authorId,
    content: body ?? '',
    blocks: blocks ?? [],
    liveDoc: bodyDoc ?? null,
    documentTransport: { base: '/flow/live/pages', docId: row.id },
    readerIds,
    ...(readers ? { readers } : {}),
    access,
  }
}

/** Complete editable metadata for the already-read version, without rereading
 * the owner row and pairing a newer version with an older snapshot pointer. */
export async function documentRecord(ctx: Ctx, row: Row) {
  const access = await documentAccess(ctx, row)
  if (!access.read) return refuse('forbidden')
  const owner = row.authorId === ctx.actor,
    G = ctx.table('flow.DocumentGrant'),
    U = ctx.table('user.User')
  const grants = await ctx.db.all(
    from(G)
      .where(
        eq(G.companyId, ctx.scope.company),
        eq(G.documentId, row.id),
        ...(owner ? [] : [eq(G.userId, ctx.actor)]),
      )
      .orderBy(asc(G.id))
      .limit(101),
  )
  if (grants.length > 100) return refuse('limit')
  const users =
    owner && grants.length
      ? await ctx.db.all(
          from(U)
            .where(
              inArray(
                U.id,
                grants.map((g) => g.userId),
              ),
            )
            .select(U.id, U.name)
            .limit(100),
        )
      : []
  return documentRecordValue(
    row,
    access,
    grants.map((g) => g.userId),
    owner
      ? grants.map((g) => ({ id: g.userId, name: string(users.find((u) => u.id === g.userId)?.name) }))
      : undefined,
  )
}

const blockInput = (value: unknown): Row[] => {
  if (!Array.isArray(value) || value.length > 2000 || JSON.stringify(value).length > 1000000)
    return refuse('validation', { blocks: 'invalid' })
  if (
    value.some(
      (block) =>
        !block ||
        typeof block !== 'object' ||
        ![
          'paragraph',
          'heading',
          'subheading',
          'h1',
          'h2',
          'h3',
          'p',
          'bullet',
          'ordered',
          'task',
          'quote',
          'code',
          'table',
          'divider',
          'image',
        ].includes(string(block.type)),
    )
  )
    return refuse('validation', { blocks: 'invalid' })
  return value
}
const firstLine = (blocks: Row[]) => {
  for (const block of blocks) {
    const line = string(block.text)
      .split(/\r\n|\r|\n/)
      .find((text) => text.trim())
    if (line) return line.trim().slice(0, 1000)
  }
  return 'Untitle'
}
const documentScope = (document: Row) => ({
  workspaceId: document.workspaceId,
  projectId: document.projectId,
})
const capability = (document: Row) => (document.projectId ? 'project.write' : 'workspace.write')

/** A reparent may increase every descendant's depth, including archived pages.
 * Page children by ID, keeping only the current path and bounded read windows. */
async function requireSubtreeDepth(ctx: Ctx, rootId: string, parentDepth: number) {
  const D = ctx.table('flow.Document'),
    path = new Set<string>()
  const visit = async (id: string, depth: number): Promise<void> => {
    if (depth > 128 || path.has(id)) return refuse('cycle')
    path.add(id)
    let after = ''
    while (true) {
      const children = await ctx.db.all(
        from(D)
          .where(eq(D.companyId, ctx.scope.company), eq(D.parentId, id), ...(after ? [gt(D.id, after)] : []))
          .select(D.id)
          .orderBy(asc(D.id))
          .limit(100),
      )
      for (const child of children) await visit(string(child.id), depth + 1)
      if (children.length < 100) break
      after = string(children.at(-1)!.id)
    }
    path.delete(id)
  }
  await visit(rootId, parentDepth)
}

export async function saveDocument(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const existing = input.id ? await readableDocument(ctx, input.id, true) : null
  const parentBefore = input.parentId ? await readableDocument(ctx, input.parentId, true) : null
  const projectId = existing?.projectId ?? parentBefore?.projectId ?? input.projectId ?? null
  const project = projectId ? await owned(ctx, 'flow.ProjectRecord', projectId) : null
  const workspaceId =
    existing?.workspaceId ?? parentBefore?.workspaceId ?? project?.workspaceId ?? input.workspaceId
  const target = { projectId, workspaceId }
  return mutate(
    ctx,
    { name: 'flow.page.save', capability: capability(target), input: { ...input, ...target } },
    extensions,
    async (tx) => {
      const current = existing ? await readableDocument(tx, existing.id, true) : null
      requireDocumentTransport(current, input, true)
      // Parent ancestry, privacy and archive state may change while waiting for
      // the organization lock. Validate its current row inside the transaction.
      const parent = parentBefore ? await readableDocument(tx, parentBefore.id, true) : null
      const blocks =
        input.blocks === undefined
          ? ((current?.blocks as Row[]) ?? [{ type: 'h1', text: 'Untitle' }])
          : blockInput(input.blocks)
      const titleSource = string(input.titleSource ?? current?.titleSource ?? 'content')
      if (!['content', 'explicit'].includes(titleSource))
        return refuse('validation', { titleSource: 'invalid' })
      const title =
        titleSource === 'content' ? firstLine(blocks) : string(input.title ?? current?.title) || 'Untitle'
      const visibility = string(input.visibility ?? current?.visibility ?? parent?.visibility ?? 'shared')
      if (!['shared', 'private'].includes(visibility)) return refuse('validation', { visibility: 'invalid' })
      if (
        parent &&
        (parent.projectId !== projectId ||
          parent.workspaceId !== workspaceId ||
          parent.archived ||
          (parent.visibility === 'private' && visibility !== 'private'))
      )
        return refuse('validation', { parentId: 'invalid' })
      let ancestor = parent,
        depth = 0
      while (ancestor) {
        if (ancestor.id === current?.id || ++depth > 128) return refuse('cycle')
        ancestor = ancestor.parentId ? await readableDocument(tx, ancestor.parentId) : null
      }
      if (current && parent && parent.id !== current.parentId)
        await requireSubtreeDepth(tx, string(current.id), depth)
      const body = input.description === undefined ? string(current?.body) : string(input.description)
      if (body.length > 1000000) return refuse('validation', { description: 'too_long' })
      if (
        input.liveDoc !== undefined &&
        (typeof input.liveDoc !== 'string' || input.liveDoc.length > 2000000)
      )
        return refuse('validation', { liveDoc: 'invalid' })
      const values = {
        title,
        titleSource,
        body,
        blocks,
        bodyDoc: input.liveDoc ?? current?.bodyDoc ?? null,
        visibility,
        parentId: input.parentId === undefined ? (current?.parentId ?? null) : (parent?.id ?? null),
      }
      const id = current ? string(current.id) : randomUUID()
      const row = current
        ? await cas(tx, 'flow.Document', id, input.expectedVersion, values)
        : { id, version: 1 }
      if (!current)
        await tx.db.insert('flow.Document', {
          id,
          ...target,
          authorId: tx.actor,
          ...values,
          contentAttachmentId: null,
          sequence: await tx.sequence(`flow.document_${hash(string(projectId ?? workspaceId)).slice(0, 32)}`),
          ...timestamped(),
        })
      return { ok: true, id, version: row.version }
    },
  )
}

export async function archiveDocument(
  ctx: Ctx,
  input: Row,
  extensions: NativeServerExtension[],
  archived: boolean,
) {
  const document = await readableDocument(ctx, input.id, true)
  return mutate(
    ctx,
    {
      name: `flow.page.${archived ? 'archive' : 'restore'}`,
      capability: capability(document),
      input: { ...input, ...documentScope(document) },
    },
    extensions,
    async (tx) => {
      await readableDocument(tx, document.id, true)
      const updated = await cas(tx, 'flow.Document', string(document.id), input.expectedVersion, { archived })
      return { ok: true, id: document.id, version: updated.version }
    },
  )
}

export async function shareDocument(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const document = await readableDocument(ctx, input.id)
  return mutate(
    ctx,
    {
      name: 'flow.page.share',
      capability: document.projectId ? 'project.read' : 'workspace.read',
      input: { ...input, ...documentScope(document) },
    },
    extensions,
    async (tx) => {
      if (!(await documentAccess(tx, document)).manage) return refuse('forbidden')
      if (
        !['shared', 'private'].includes(string(input.visibility)) ||
        !Array.isArray(input.readerIds) ||
        input.readerIds.length > 100 ||
        input.readerIds.some((id) => typeof id !== 'string')
      )
        return refuse('validation', { readerIds: 'invalid' })
      const readers = [...new Set(input.readerIds)]
      // A document grant cannot create project/workspace access for its recipient.
      for (const actor of readers) {
        const recipient = await documentAccess({ ...tx, actor }, { ...document, visibility: 'shared' })
        // Guest access additionally requires an existing document grant; eligibility
        // instead comes from their explicit project read membership.
        if (!recipient.read) {
          const a = await authority({ ...tx, actor }),
            w = await owned(tx, 'flow.Workspace', document.workspaceId)
          const p = document.projectId ? await owned(tx, 'flow.ProjectRecord', document.projectId) : null
          if (!a.member || !(p ? a.projectRole(p, w) : a.workspaceRole(w)))
            return refuse('validation', { readerIds: 'invalid' })
        }
      }
      const updated = await cas(tx, 'flow.Document', string(document.id), input.expectedVersion, {
        visibility: input.visibility,
      })
      const G = tx.table('flow.DocumentGrant')
      await tx.db.del(deleteFrom(G).where(eq(G.companyId, tx.scope.company), eq(G.documentId, document.id)))
      for (const userId of readers)
        await tx.db.insert('flow.DocumentGrant', {
          id: randomUUID(),
          documentId: document.id,
          userId,
          role: 'viewer',
          version: 1,
        })
      return { ok: true, id: document.id, version: updated.version }
    },
  )
}

async function documentReadQuery(ctx: Ctx, projects: Row[], workspaces: Row[], input: Row) {
  const a = await authority(ctx),
    D = ctx.table('flow.Document'),
    G = ctx.table('flow.DocumentGrant')
  const workspaceIds = workspaces.filter((w) => a.workspaceRole(w)).map((w) => w.id)
  const grants = await ctx.db.all(
    from(G).where(eq(G.companyId, a.companyId), eq(G.userId, a.actorId)).limit(1001),
  )
  if (grants.length > 1000) return refuse('limit')
  let query = from(D).where(
    eq(D.companyId, a.companyId),
    or(
      inArray(
        D.projectId,
        projects.map((p) => p.id),
      ),
      and(isNull(D.projectId), inArray(D.workspaceId, workspaceIds)),
    ),
  )
  if (input.projectId) query = query.where(eq(D.projectId, input.projectId))
  if (input.workspaceId && !input.projectId) query = query.where(eq(D.workspaceId, input.workspaceId))
  if (a.member?.role === 'guest')
    query = query.where(
      inArray(
        D.id,
        grants.map((g) => g.documentId),
      ),
    )
  else
    query = query.where(
      or(
        eq(D.visibility, 'shared'),
        eq(D.authorId, a.actorId),
        inArray(
          D.id,
          grants.map((g) => g.documentId),
        ),
      ),
    )
  return { a, D, grants, query }
}

/** Same privacy predicates as document navigation, without loading any bodies. */
export async function hasReadableDocument(
  ctx: Ctx,
  projects: Row[],
  workspaces: Row[],
  workspaceId: unknown,
) {
  const { D, query } = await documentReadQuery(
    ctx,
    projects.filter((p) => !p.archived),
    workspaces,
    { workspaceId },
  )
  return Boolean(await ctx.db.one(query.where(eq(D.archived, false)).select(D.id).limit(1)))
}

export async function listDocuments(ctx: Ctx, projects: Row[], workspaces: Row[], input: Row) {
  const { a, D, grants, query } = await documentReadQuery(ctx, projects, workspaces, input)
  const rows = await ctx.db.all(
    query
      .select(
        D.id,
        D.companyId,
        D.projectId,
        D.workspaceId,
        D.parentId,
        D.authorId,
        D.title,
        D.titleSource,
        D.visibility,
        D.sequence,
        D.archived,
        D.version,
        D.createdAt,
        D.updatedAt,
      )
      .orderBy(asc(D.sequence), asc(D.id))
      .limit(100),
  )
  const active = input.recordId ? string(input.recordId) : string(rows.find((p) => !p.archived)?.id)
  const opened = active ? await readableDocument(ctx, active) : null
  if (input.recordId && !rows.some((p) => p.id === input.recordId)) {
    if (opened) rows.push(opened)
  }
  const W = new Map(workspaces.map((w) => [w.id, w])),
    P = new Map(projects.map((p) => [p.id, p]))
  // The owner of the open document manages its sharing, so they read every reader with a
  // name (at most 100, as sharing writes); elsewhere `readerIds` only says whether the
  // actor is one.
  const managed = rows.find((row) => row.id === active && row.authorId === a.actorId)
  const G = ctx.table('flow.DocumentGrant'),
    U = ctx.table('user.User')
  const shared = managed
    ? await ctx.db.all(
        from(G)
          .where(eq(G.companyId, a.companyId), eq(G.documentId, managed.id))
          .select(G.userId)
          .orderBy(asc(G.id))
          .limit(101),
      )
    : []
  if (shared.length > 100) return refuse('limit')
  const names = shared.length
    ? await ctx.db.all(
        from(U)
          .where(
            inArray(
              U.id,
              shared.map((g) => g.userId),
            ),
          )
          .select(U.id, U.name),
      )
    : []
  return rows.map((row) => {
    const workspace = W.get(row.workspaceId),
      project = P.get(row.projectId)
    const role = workspace ? (project ? a.projectRole(project, workspace) : a.workspaceRole(workspace)) : null
    const owner = row.authorId === a.actorId
    const write =
      a.member?.role !== 'guest' && (rank[role ?? ''] ?? 0) >= 2 && (row.visibility !== 'private' || owner)
    return documentRecordValue(
      {
        ...row,
        body: row.id === active ? opened?.body : '',
        blocks: row.id === active ? opened?.blocks : [],
        bodyDoc: row.id === active ? opened?.bodyDoc : null,
      },
      { read: true, write, manage: owner },
      row === managed
        ? shared.map((g) => g.userId)
        : grants.filter((g) => g.documentId === row.id).map((g) => g.userId),
      row === managed
        ? shared.map((g) => ({
            id: g.userId,
            name: string(names.find((u) => u.id === g.userId)?.name),
          }))
        : undefined,
    )
  })
}

export async function reorderDocument(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const document = await readableDocument(ctx, input.id, true),
    target = await readableDocument(ctx, input.targetId, true)
  if (
    document.projectId !== target.projectId ||
    document.workspaceId !== target.workspaceId ||
    document.parentId !== target.parentId
  )
    return refuse('validation', { targetId: 'invalid' })
  if (!['before', 'after'].includes(string(input.position)))
    return refuse('validation', { position: 'invalid' })
  return mutate(
    ctx,
    {
      name: 'flow.page.reorder',
      capability: capability(document),
      input: { ...input, ...documentScope(document) },
    },
    extensions,
    async (tx) => {
      const D = tx.table('flow.Document')
      let q = from(D).where(
        eq(D.companyId, tx.scope.company),
        eq(D.workspaceId, document.workspaceId),
        eq(D.archived, false),
      )
      q = q.where(
        document.projectId ? eq(D.projectId, document.projectId) : isNull(D.projectId),
        document.parentId ? eq(D.parentId, document.parentId) : isNull(D.parentId),
      )
      const rows = await tx.db.all(q.orderBy(asc(D.sequence), asc(D.id)).limit(1001))
      if (rows.length > 1000) return refuse('too_many_siblings')
      if (
        !Array.isArray(input.expectedSiblingIds) ||
        JSON.stringify(rows.map((row) => row.id)) !== JSON.stringify(input.expectedSiblingIds)
      )
        return refuse('conflict')
      const ordered = rows.filter((row) => row.id !== document.id),
        at = ordered.findIndex((row) => row.id === target.id)
      if (at < 0) return refuse('not_found')
      ordered.splice(at + (input.position === 'after' ? 1 : 0), 0, document)
      for (const [sequence, row] of ordered.entries())
        await tx.db.update('flow.Document', { id: row.id }, { sequence })
      return { ok: true, id: document.id }
    },
  )
}
