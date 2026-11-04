import { randomUUID } from 'node:crypto'
import { and, asc, eq, from, gt, ilike, inArray, isNull, likeLiteral, ne, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { permittedFor } from '../../user/roles.ts'
import { advanceRevision, cas, hash, mutate, revision } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { owned, rank, refuse, requireCapability, string } from './policy.ts'
import { limitOf, visibleScope } from './queries.ts'
import { requiredTitle, timestamped } from './organization.ts'

const choices = (value: unknown, values: string[], fallback: string, field: string) => {
  const result = value === undefined ? fallback : string(value)
  return values.includes(result) ? result : refuse('validation', { [field]: 'invalid' })
}

/** Scalar visibility is indexed. A bounded compatibility window preserves old
 * native views until the explicit Company backfill; never post-filter a cut page. */
async function readScope(ctx: Ctx, input: Row, allowedProjects?: unknown[]) {
  const scope = await visibleScope(ctx),
    { a } = scope
  await requireCapability(ctx, 'member.read', {})
  const projects = scope.projects.filter(
    (p) => !p.archived && (!allowedProjects || allowedProjects.includes(p.id)),
  )
  if (input.projectId && !projects.some((p) => p.id === input.projectId)) return refuse('forbidden')
  const ids = projects.map((p) => p.id),
    workspaceIds = scope.workspaces.filter((w) => !w.archived && a.workspaceRole(w)).map((w) => w.id)
  const V = ctx.table('flow.SavedView')
  const projectFence = or(
    ...(ids.length ? [inArray(V.projectId, ids)] : []),
    and(
      isNull(V.projectId),
      eq(V.ownerId, a.actorId),
      or(isNull(V.workspaceId), ...(workspaceIds.length ? [inArray(V.workspaceId, workspaceIds)] : [])),
    ),
  )
  const legacy = await ctx.db.all(
    from(V)
      .select(V.id, V.query)
      .where(
        eq(V.companyId, a.companyId),
        eq(V.archived, false),
        isNull(V.visibility),
        ne(V.ownerId, a.actorId),
        projectFence,
      )
      .limit(1001),
  )
  if (legacy.length > 1000) return refuse('migration_required')
  const shared = legacy.filter((v) => (v.query as Row | null)?.visibility === 'project').map((v) => v.id)
  let query = from(V).where(
    eq(V.companyId, a.companyId),
    eq(V.archived, false),
    projectFence,
    or(
      eq(V.ownerId, a.actorId),
      eq(V.visibility, 'project'),
      ...(shared.length ? [inArray(V.id, shared)] : []),
    ),
  )
  if (input.projectId)
    query = query.where(
      input.includePersonal === true
        ? or(eq(V.projectId, input.projectId), and(isNull(V.projectId), eq(V.ownerId, a.actorId)))
        : eq(V.projectId, input.projectId),
    )
  const text = string(input.query).trim()
  if (text.length > 1000) return refuse('validation', { query: 'too_long' })
  if (text) query = query.where(ilike(V.title, '%' + likeLiteral(text) + '%'))
  const keys = await permittedFor(ctx, a.actorId)
  const canSave = keys === null || keys.includes('flow.view.save')
  const dto = async (rows: Row[]) => {
    const U = ctx.table('user.User'),
      ownerIds = [...new Set(rows.map((row) => row.ownerId))]
    const users = ownerIds.length
      ? await ctx.db.all(from(U).select(U.id, U.name).where(inArray(U.id, ownerIds)))
      : []
    return rows.map((row): Row => {
      const q = (row.query as Row | null) ?? {},
        project = projects.find((p) => p.id === row.projectId)
      const canShare = Boolean(
        project &&
          a.member?.role !== 'guest' &&
          (a.manageOrganization || (rank[project.accessInfo.role] ?? 0) >= 2),
      )
      const routes = row.projectId ? ['board', 'project-issues'] : ['my-work', 'all-issues']
      return {
        ...row,
        query: string(q.text),
        description: string(q.description),
        status: string(row.status),
        visibility: row.visibility ?? q.visibility ?? 'private',
        sourceRoute: routes.includes(string(q.sourceRoute))
          ? q.sourceRoute
          : row.projectId
            ? 'project-issues'
            : 'all-issues',
        sort: ['due', 'priority', 'manual'].includes(string(q.sort)) ? q.sort : 'due',
        group: ['none', 'status', 'priority', 'assignee', 'sprint'].includes(string(q.group))
          ? q.group
          : 'status',
        workspaceId: project?.workspaceId ?? row.workspaceId,
        ownerName: users.find((user) => user.id === row.ownerId)?.name ?? '',
        canShare,
        canEdit:
          row.ownerId === a.actorId &&
          canSave &&
          (string(row.visibility ?? q.visibility) !== 'project' || canShare),
      }
    })
  }
  const fence = hash(
    JSON.stringify([
      a.companyId,
      a.actorId,
      ids.map(String).sort(),
      workspaceIds.map(String).sort(),
      input.projectId ?? '',
      input.includePersonal === true,
      text,
      await revision(ctx),
      await revision(ctx, 'operations'),
    ]),
  )
  return { V, query, dto, fence }
}

export async function listSavedViews(ctx: Ctx, input: Row, allowedProjects?: unknown[]) {
  const { V, query, dto, fence } = await readScope(ctx, input, allowedProjects)
  const limit = limitOf(input.limit, 25)
  let page = query
  if (input.cursor) {
    if (string(input.cursor).length > 4096) return refuse('validation', { cursor: 'invalid' })
    let held: Row
    try {
      held = JSON.parse(Buffer.from(string(input.cursor), 'base64url').toString())
    } catch {
      return refuse('validation', { cursor: 'invalid' })
    }
    if (!held || typeof held.id !== 'string' || typeof held.title !== 'string' || held.fence !== fence)
      return refuse('conflict')
    page = page.where(or(gt(V.title, held.title), and(eq(V.title, held.title), gt(V.id, held.id))))
  }
  const total = await ctx.db.count(query),
    rows = await ctx.db.all(page.orderBy(asc(V.title), asc(V.id)).limit(limit + 1))
  const visible = rows.slice(0, limit),
    last = visible.at(-1)
  return {
    items: await dto(visible),
    total,
    cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ id: last.id, title: last.title, fence })).toString('base64url')
        : null,
  }
}

export async function savedViewById(ctx: Ctx, id: unknown, allowedProjects: unknown[]) {
  const { V, query, dto } = await readScope(ctx, {}, allowedProjects)
  const row = await ctx.db.one(query.where(eq(V.id, id)))
  return row ? (await dto([row]))[0] : null
}

export async function saveView(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const previous = input.id ? await owned(ctx, 'flow.SavedView', input.id) : null
  const projectId = previous?.projectId ?? input.projectId ?? null
  return mutate(
    ctx,
    {
      name: 'flow.view.save',
      capability: projectId ? 'project.read' : 'member.read',
      input: { ...input, projectId },
    },
    extensions,
    async (tx) => {
      const old = previous ? await owned(tx, 'flow.SavedView', previous.id) : null
      if (old && old.ownerId !== tx.actor) return refuse('forbidden')
      if (old && input.projectId && input.projectId !== old.projectId)
        return refuse('validation', { projectId: 'immutable' })
      const q = old?.query as Row | undefined
      const visibility = choices(
        input.visibility,
        ['private', 'project'],
        string(old?.visibility ?? q?.visibility ?? 'private'),
        'visibility',
      )
      if (visibility === 'project' && !projectId) return refuse('validation', { visibility: 'invalid' })
      if (visibility === 'project' || old?.visibility === 'project' || q?.visibility === 'project')
        await requireCapability(tx, 'project.write', { projectId })
      const sourceRoute = choices(
        input.sourceRoute,
        projectId ? ['board', 'project-issues'] : ['my-work', 'all-issues'],
        string(q?.sourceRoute ?? (projectId ? 'project-issues' : 'all-issues')),
        'sourceRoute',
      )
      const workspaceId =
        projectId || sourceRoute === 'my-work' ? null : old ? old.workspaceId : input.workspaceId || null
      if (workspaceId) await requireCapability(tx, 'workspace.read', { workspaceId })
      const text = string(input.query ?? q?.text),
        description = string(input.description ?? q?.description)
      if (text.length > 1000 || description.length > 10000) return refuse('validation', { query: 'too_long' })
      const id = old ? string(old.id) : randomUUID()
      const patch = {
        title: requiredTitle(input),
        workspaceId,
        visibility,
        archived: Boolean(input.archive),
        status: string(input.status ?? old?.status ?? 'all'),
        query: {
          text,
          description,
          visibility,
          sourceRoute,
          sort: choices(input.sort, ['due', 'priority', 'manual'], string(q?.sort ?? 'due'), 'sort'),
          group: choices(
            input.group,
            ['none', 'status', 'priority', 'assignee', 'sprint'],
            string(q?.group ?? 'status'),
            'group',
          ),
        },
      }
      if (old) await cas(tx, 'flow.SavedView', id, input.expectedVersion, patch)
      else
        await tx.db.insert('flow.SavedView', {
          id,
          projectId: projectId || null,
          ownerId: tx.actor,
          ...timestamped(),
          ...patch,
        })
      return { ok: true, id, revision: await advanceRevision(tx, input, 'operations') }
    },
  )
}

export async function archiveView(
  ctx: Ctx,
  input: Row,
  extensions: NativeServerExtension[],
  archived: boolean,
) {
  return mutate(
    ctx,
    { name: 'flow.view.' + (archived ? 'archive' : 'restore'), capability: 'member.read', input },
    extensions,
    async (tx) => {
      const old = await owned(tx, 'flow.SavedView', input.id)
      if (old.ownerId !== tx.actor) return refuse('forbidden')
      if (old.projectId)
        await requireCapability(
          tx,
          string(old.visibility ?? (old.query as Row)?.visibility) === 'project'
            ? 'project.write'
            : 'project.read',
          { projectId: old.projectId },
        )
      if (old.workspaceId) await requireCapability(tx, 'workspace.read', { workspaceId: old.workspaceId })
      const record = await cas(tx, 'flow.SavedView', string(old.id), input.expectedVersion, { archived })
      return {
        ok: true,
        id: record.id,
        version: record.version,
        revision: await advanceRevision(tx, input, 'operations'),
      }
    },
  )
}
