import { projectDefaultView } from './project-view.ts'
import { randomUUID } from 'node:crypto'
import { asc, eq, from, isDateText } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { advanceRevision, cas, mutate, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { authority, owned, refuse, string } from './policy.ts'
import { projectCatalogs, remapProjectTags } from './project-catalogs.ts'

export const timestamped = () => ({ version: 1, archived: false, createdAt: now(), updatedAt: now() })
export const requiredTitle = (input: Row, field = 'title', maximum = 240) => {
  const title = string(input[field])
  if (!title) return refuse('validation', { [field]: 'required' })
  if (title.length > maximum) return refuse('validation', { [field]: 'too_long' })
  return title
}

async function initializeCatalogs(ctx: Ctx) {
  const statuses = [
    ['todo', 'Todo', 'neutral', 'circle'],
    ['progress', 'In progress', 'blue', 'circle-dot'],
    ['review', 'Review', 'yellow', 'circle-check'],
    ['done', 'Done', 'green', 'circle-check'],
  ]
  for (const [sequence, values] of statuses.entries()) {
    const [kind, title, color, icon] = values
    await ctx.db.insert('flow.TaskStatus', {
      id: randomUUID(),
      projectId: null,
      kind,
      title,
      color,
      icon,
      sequence,
      ...timestamped(),
    })
  }
  for (const [sequence, [code, title, icon]] of [
    ['task', 'Task', 'list'],
    ['bug', 'Bug', 'flag'],
    ['story', 'Story', 'layers'],
    ['milestone', 'Milestone', 'flag'],
  ].entries())
    await ctx.db.insert('flow.TaskType', {
      id: randomUUID(),
      code,
      projectId: null,
      title,
      icon,
      sequence,
      ...timestamped(),
    })
}

export async function createWorkspace(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const a = await authority(ctx)
  return mutate(
    ctx,
    { name: 'flow.workspace.create', capability: a.member ? 'organization.manage' : 'initialize', input },
    extensions,
    async (tx) => {
      if (input.access !== undefined && !['internal', 'restricted'].includes(string(input.access)))
        return refuse('validation', { access: 'invalid' })
      const title = requiredTitle(input)
      const first = !(await authority(tx)).member
      const revision = await advanceRevision(tx, input)
      if (first) {
        await tx.db.insert('flow.Member', {
          id: randomUUID(),
          userId: tx.actor,
          role: 'owner',
          status: 'active',
          title: null,
          weeklyHours: 40,
          version: 1,
        })
        await tx.db.insert('flow.CompanySettings', {
          id: tx.scope.company,
          title: '',
          acceptanceEnabled: false,
          version: 1,
        })
        await initializeCatalogs(tx)
      }
      const id = randomUUID()
      await tx.db.insert('flow.Workspace', {
        id,
        title,
        description: string(input.description),
        access: input.access ?? 'internal',
        ownerId: tx.actor,
        acceptanceEnabled: null,
        ...timestamped(),
      })
      await tx.db.insert('flow.ScopedGrant', {
        id: randomUUID(),
        scope: 'workspace',
        targetId: id,
        subjectType: 'user',
        subjectId: tx.actor,
        role: 'admin',
        version: 1,
      })
      return { ok: true, id, workspaceId: id, revision }
    },
  )
}

export async function updateWorkspace(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.workspace.update', capability: 'workspace.manage', input },
    extensions,
    async (tx) => {
      const id = string(input.id ?? input.workspaceId)
      const patch: Row = {}
      if (input.title !== undefined) patch.title = requiredTitle(input)
      if (input.description !== undefined) patch.description = string(input.description)
      if (input.access !== undefined) {
        if (!['internal', 'restricted'].includes(string(input.access)))
          return refuse('validation', { access: 'invalid' })
        patch.access = input.access
      }
      if (input.archived !== undefined) {
        if (typeof input.archived !== 'boolean') return refuse('validation', { archived: 'invalid' })
        patch.archived = input.archived
        if (input.archived) {
          const P = tx.table('flow.ProjectRecord')
          if (
            await tx.db.count(
              from(P).where(eq(P.companyId, tx.scope.company), eq(P.workspaceId, id), eq(P.archived, false)),
            )
          )
            return refuse('workspace_has_active_projects')
        }
      }
      if (input.acceptanceEnabled !== undefined) {
        if (input.acceptanceEnabled !== null && typeof input.acceptanceEnabled !== 'boolean')
          return refuse('validation', { acceptanceEnabled: 'invalid' })
        patch.acceptanceEnabled = input.acceptanceEnabled
      }
      const current = await owned(tx, 'flow.Workspace', id)
      const updated = await cas(tx, 'flow.Workspace', id, input.expectedVersion ?? current.version, patch)
      const revision = await advanceRevision(tx, input)
      return { ok: true, id, workspaceId: id, version: updated.version, revision }
    },
  )
}

export async function saveProject(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const id = string(input.id)
  const existing = id ? await owned(ctx, 'flow.ProjectRecord', id) : null
  const workspaceId = string(existing?.workspaceId ?? input.workspaceId)
  const args = { ...input, workspaceId, projectId: existing?.id }
  return mutate(
    ctx,
    { name: 'flow.project.save', capability: existing ? 'project.manage' : 'workspace.manage', input: args },
    extensions,
    async (tx) => {
      const title = input.title === undefined && existing ? string(existing.title) : requiredTitle(input)
      const code = string(input.code ?? existing?.code).toUpperCase()
      if (!/^[A-Z][A-Z0-9]{1,11}$/.test(code)) return refuse('validation', { code: 'invalid' })
      const P = tx.table('flow.ProjectRecord')
      const duplicate = await tx.db.one(from(P).where(eq(P.companyId, tx.scope.company), eq(P.code, code)))
      if (duplicate && duplicate.id !== id) return refuse('validation', { code: 'duplicate' })
      const defaultView =
        input.defaultView === undefined
          ? projectDefaultView(existing?.defaultView)
          : string(input.defaultView)
      if (!['board', 'project-issues'].includes(defaultView))
        return refuse('validation', { defaultView: 'invalid' })
      const access = string(input.access ?? existing?.access ?? 'workspace')
      if (!['workspace', 'private'].includes(access)) return refuse('validation', { access: 'invalid' })
      const cadence =
        input.sprintCadence === undefined
          ? (existing?.sprintCadence ?? { weeks: 2, weekday: 1 })
          : input.sprintCadence
      if (
        cadence !== null &&
        (!cadence ||
          typeof cadence !== 'object' ||
          Array.isArray(cadence) ||
          ![1, 2, 3, 4].includes(Number((cadence as Row).weeks)) ||
          !Number.isInteger((cadence as Row).weekday) ||
          Number((cadence as Row).weekday) < 0 ||
          Number((cadence as Row).weekday) > 6)
      )
        return refuse('validation', { sprintCadence: 'invalid' })
      const projectId = existing ? id : randomUUID()
      const catalogOverrides = await projectCatalogs(
        tx,
        projectId,
        input,
        (existing?.catalogOverrides as Row) ?? {},
        extensions,
        Boolean(existing),
      )
      const state = string(input.state ?? existing?.state ?? 'planned')
      const projectStatuses = (catalogOverrides.projectStatuses as Row[] | null) ?? [
        { id: 'planned' },
        { id: 'active' },
        { id: 'paused' },
        { id: 'completed' },
      ]
      if (!projectStatuses.some((s) => s.id === state)) return refuse('validation', { state: 'invalid' })
      const ownerId = string(input.ownerId ?? existing?.ownerId ?? tx.actor)
      const M = tx.table('flow.Member')
      const owner = await tx.db.one(
        from(M).where(eq(M.companyId, tx.scope.company), eq(M.userId, ownerId), eq(M.status, 'active')),
      )
      if (!owner || owner.role === 'guest') return refuse('validation', { ownerId: 'invalid' })
      const start = input.start === undefined ? (existing?.start ?? null) : input.start || null
      const end = input.end === undefined ? (existing?.end ?? null) : input.end || null
      if (
        (start && !isDateText(start)) ||
        (end && !isDateText(end)) ||
        (start && end && string(start) > string(end))
      )
        return refuse('validation', { end: 'invalid' })
      const tags = remapProjectTags(
        input.tags ?? existing?.tags ?? [],
        (existing?.catalogOverrides as Row) ?? {},
        catalogOverrides,
        input.projectLabels,
      )
      if (!Array.isArray(tags) || tags.length > 30 || tags.some((id) => typeof id !== 'string'))
        return refuse('validation', { tags: 'invalid' })
      for (const tagId of tags) {
        const tag = await owned(tx, 'flow.Label', tagId)
        if (
          tag.archived ||
          tag.domain !== 'project' ||
          (tag.projectId && tag.projectId !== projectId) ||
          (catalogOverrides.projectLabelIds &&
            !(catalogOverrides.projectLabelIds as string[]).includes(tagId))
        )
          return refuse('validation', { tags: 'scope' })
      }
      const values = {
        title,
        code,
        access,
        ownerId,
        start,
        end,
        state,
        tags,
        outcome: string(input.outcome ?? existing?.outcome),
        defaultView,
        description: string(input.description ?? existing?.description),
        sprintCadence: cadence,
        catalogOverrides,
      }
      let version = 1
      if (existing)
        version = Number((await cas(tx, 'flow.ProjectRecord', id, input.expectedVersion, values)).version)
      else {
        await tx.db.insert('flow.ProjectRecord', { id: projectId, workspaceId, ...values, ...timestamped() })
        await tx.db.insert('flow.ScopedGrant', {
          id: randomUUID(),
          scope: 'project',
          targetId: projectId,
          subjectType: 'user',
          subjectId: tx.actor,
          role: 'admin',
          version: 1,
        })
      }
      const G = tx.table('flow.ScopedGrant')
      const grant = async (subjectType: string, subjectId: string, role: string) => {
        const old = await tx.db.one(
          from(G).where(
            eq(G.companyId, tx.scope.company),
            eq(G.scope, 'project'),
            eq(G.targetId, projectId),
            eq(G.subjectType, subjectType),
            eq(G.subjectId, subjectId),
          ),
        )
        if (!old)
          await tx.db.insert('flow.ScopedGrant', {
            id: randomUUID(),
            scope: 'project',
            targetId: projectId,
            subjectType,
            subjectId,
            role,
            version: 1,
          })
        else if (old.role !== 'admin')
          await cas(tx, 'flow.ScopedGrant', string(old.id), old.version, { role })
      }
      await grant('user', ownerId, 'admin')
      for (const [field, model, subjectType] of [
        ['memberIds', 'flow.Member', 'user'],
        ['teamIds', 'flow.Team', 'team'],
      ] as const) {
        const ids = input[field] ?? []
        if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string'))
          return refuse('validation', { [field]: 'invalid' })
        for (const subjectId of new Set(ids)) {
          const T = tx.table(model)
          const subject = await tx.db.one(
            from(T).where(
              eq(T.companyId, tx.scope.company),
              eq(subjectType === 'user' ? T.userId : T.id, subjectId),
            ),
          )
          if (
            !subject ||
            (subjectType === 'user' && (subject.status !== 'active' || subject.role === 'guest')) ||
            subject.archived
          )
            return refuse('validation', { [field]: 'invalid' })
          await grant(subjectType, subjectId, 'member')
        }
      }
      const revision = await advanceRevision(tx, input)
      return { ok: true, id: projectId, projectId, version, revision }
    },
  )
}

export async function projectArchive(
  ctx: Ctx,
  input: Row,
  extensions: NativeServerExtension[],
  archived: boolean,
) {
  const projectId = string(input.id ?? input.projectId)
  return mutate(
    ctx,
    {
      name: archived ? 'flow.project.archive' : 'flow.project.restore',
      capability: 'project.manage',
      input: { ...input, projectId },
    },
    extensions,
    async (tx) => {
      const record = await cas(tx, 'flow.ProjectRecord', projectId, input.expectedVersion, { archived })
      return { ok: true, id: projectId, version: record.version }
    },
  )
}

export async function organizationMembers(ctx: Ctx) {
  const a = await authority(ctx)
  if (!a.member) return []
  const M = ctx.table('flow.Member')
  const rows = await ctx.db.all(
    from(M)
      .where(eq(M.companyId, a.companyId))
      .orderBy(asc(M.id))
      .limit(a.member.role === 'guest' ? 1 : 1000),
  )
  return a.member.role === 'guest' ? [a.member] : rows
}
