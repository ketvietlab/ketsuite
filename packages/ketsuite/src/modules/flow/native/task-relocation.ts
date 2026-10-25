import { randomUUID } from 'node:crypto'
import {
  and,
  asc,
  deleteFrom,
  eq,
  from,
  gt,
  ilike,
  inArray,
  isNull,
  likeLiteral,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { cas, hash, mutate, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { authority, FlowRefusal, owned, rank, refuse, requireCapability, string } from './policy.ts'
import { taskByKey, taskDetail } from './queries.ts'
import { assignmentProjection, catalog, fieldValues, writeTask } from './tasks.ts'
import { appendTaskRank, assigneeKey } from './task-ranks.ts'
import { decodeCustomFieldValue, encodeCustomFieldValue } from './field-values.ts'

type Mode = 'copy' | 'transfer'
const modeOf = (value: unknown): Mode => {
  if (value !== 'copy' && value !== 'transfer') return refuse('validation', { mode: 'invalid' })
  return value
}

/** Bounded destination options; scope filtering happens before exposing any title. */
export async function taskRelocationOptions(ctx: Ctx, input: Row) {
  const mode = modeOf(input.mode)
  const task = await taskByKey(ctx, input.id)
  await requireCapability(ctx, mode === 'copy' ? 'project.read' : 'project.write', {
    projectId: task.projectId,
  })
  const source = await owned(ctx, 'flow.ProjectRecord', task.projectId)
  if (source.archived || task.archived) return refuse('archived')
  const a = await authority(ctx)
  const P = ctx.table('flow.ProjectRecord'),
    W = ctx.table('flow.Workspace')
  const cursor = string(input.cursor),
    query = string(input.query)
  if (cursor.length > 200 || query.length > 200) return refuse('validation')
  const activeWorkspaces = await ctx.db.all(
    from(W)
      .where(eq(W.companyId, ctx.scope.company), eq(W.archived, false))
      .select(W.id, W.companyId, W.access)
      .orderBy(asc(W.id))
      .limit(1001),
  )
  if (activeWorkspaces.length > 1000) return refuse('limit')
  const writableWorkspaces = activeWorkspaces
    .filter((w) => (rank[a.workspaceRole(w) ?? ''] ?? 0) >= 2)
    .map((w) => w.id)
  const directProjects = a.grants
    .filter((g) => g.scope === 'project' && (rank[string(g.role)] ?? 0) >= 2)
    .map((g) => g.targetId)
  // Apply authority before the window: cursor must never contain an unseen
  // private project ID, even when every project in that window is inaccessible.
  let selection = from(P).where(
    eq(P.companyId, ctx.scope.company),
    eq(P.archived, false),
    inArray(
      P.workspaceId,
      activeWorkspaces.map((w) => w.id),
    ),
    or(
      inArray(P.id, directProjects),
      and(eq(P.access, 'workspace'), inArray(P.workspaceId, writableWorkspaces)),
    ),
  )
  if (cursor) selection = selection.where(gt(P.id, cursor))
  if (query) selection = selection.where(ilike(P.title, `%${likeLiteral(query)}%`))
  const candidates = await ctx.db.all(selection.orderBy(asc(P.id)).limit(101))
  const workspaceIds = [...new Set(candidates.map((p) => string(p.workspaceId)))]
  const workspaces = workspaceIds.length
    ? await ctx.db.all(
        from(W)
          .where(eq(W.companyId, ctx.scope.company), inArray(W.id, workspaceIds), eq(W.archived, false))
          .limit(workspaceIds.length),
      )
    : []
  const windows = candidates.slice(0, 100)
  const projects: Row[] = []
  let last: Row | undefined
  for (const p of windows) {
    last = p
    const w = workspaces.find((w) => w.id === p.workspaceId)
    if (w && (mode === 'copy' || p.id !== task.projectId) && (rank[a.projectRole(p, w) ?? ''] ?? 0) >= 2) {
      projects.push({ id: p.id, title: p.title, workspaceId: p.workspaceId })
      if (projects.length === 50) break
    }
  }
  let catalogs: Row | null = null
  if (input.targetProjectId) {
    const project = await owned(ctx, 'flow.ProjectRecord', input.targetProjectId)
    await requireCapability(ctx, 'project.write', { projectId: project.id })
    if (mode === 'transfer' && project.id === task.projectId)
      return refuse('validation', { targetProjectId: 'same_project' })
    const read = async (model: string, override: string) => {
      const T = ctx.table(model)
      const rows = await ctx.db.all(
        from(T)
          .where(
            eq(T.companyId, ctx.scope.company),
            eq(T.archived, false),
            or(isNull(T.projectId), eq(T.projectId, project.id)),
          )
          .orderBy(asc(T.id))
          .limit(201),
      )
      if (rows.length > 200) return refuse('limit')
      const allowed = (project.catalogOverrides as Row)[override]
      return rows
        .filter(
          (r) =>
            (!Array.isArray(allowed) || allowed.includes(r.id)) &&
            (!r.appliesTo || r.appliesTo === project.id),
        )
        .map((r) => ({
          id: r.id,
          title: r.title,
          label: r.title,
          kind: r.kind,
          code: r.code,
          sequence: r.sequence,
          projectId: r.projectId,
          required: r.required,
          options: r.options,
        }))
    }
    const [columns, types, fields] = await Promise.all([
      read('flow.TaskStatus', 'taskStatusIds'),
      read('flow.TaskType', ''),
      read('flow.CustomField', ''),
    ])
    catalogs = { columns: columns.sort((a, b) => Number(a.sequence) - Number(b.sequence)), types, fields }
  }
  const current = await taskByKey(ctx, input.id)
  if (current.projectId !== task.projectId) return refuse('conflict')
  const latest = await requireCapability(ctx, mode === 'copy' ? 'project.read' : 'project.write', {
    projectId: current.projectId,
  })
  if (input.targetProjectId)
    await requireCapability(ctx, 'project.write', { projectId: input.targetProjectId })
  return {
    ok: true,
    projects: projects.filter((p) => {
      const full = candidates.find((c) => c.id === p.id)!
      const w = workspaces.find((w) => w.id === p.workspaceId)!
      return (rank[latest.projectRole(full, w) ?? ''] ?? 0) >= 2
    }),
    nextCursor: last && (last.id !== candidates.at(-1)?.id || candidates.length > 100) ? last.id : null,
    catalogs,
  }
}

async function related(ctx: Ctx, model: string, taskId: unknown, maximum = 200) {
  const T = ctx.table(model)
  const rows = await ctx.db.all(
    from(T)
      .where(eq(T.companyId, ctx.scope.company), eq(T.taskId, taskId))
      .orderBy(asc(T.id))
      .limit(maximum + 1),
  )
  if (rows.length > maximum) return refuse('limit')
  return rows
}

async function destinationReader(ctx: Ctx, actor: unknown, projectId: unknown) {
  try {
    await requireCapability({ ...ctx, actor: string(actor) } as Ctx, 'project.read', { projectId })
    return true
  } catch (error) {
    if (!(error instanceof FlowRefusal) || !['forbidden', 'not_found'].includes(error.code)) throw error
    return false
  }
}

async function plan(ctx: Ctx, input: Row, mode: Mode) {
  const task = await taskByKey(ctx, input.id)
  await requireCapability(ctx, mode === 'copy' ? 'project.read' : 'project.write', {
    projectId: task.projectId,
  })
  const source = await owned(ctx, 'flow.ProjectRecord', task.projectId)
  const project = await owned(ctx, 'flow.ProjectRecord', input.targetProjectId)
  await requireCapability(ctx, 'project.write', { projectId: project.id })
  if (source.archived || task.archived || project.archived) return refuse('archived')
  if (mode === 'transfer' && source.id === project.id)
    return refuse('validation', { targetProjectId: 'same_project' })

  const S = ctx.table('flow.TaskStatus')
  const defaults = await ctx.db.all(
    from(S)
      .where(
        eq(S.companyId, ctx.scope.company),
        eq(S.archived, false),
        eq(S.kind, 'todo'),
        or(isNull(S.projectId), eq(S.projectId, project.id)),
      )
      .orderBy(asc(S.sequence), asc(S.id))
      .limit(201),
  )
  if (defaults.length > 200) return refuse('limit')
  const override = (project.catalogOverrides as Row).taskStatusIds
  const defaultStatus = defaults.find((s) => !Array.isArray(override) || override.includes(s.id))
  if (!input.columnId && !defaultStatus) return refuse('validation', { columnId: 'required' })
  const status = await catalog(
    ctx,
    'flow.TaskStatus',
    input.columnId ?? defaultStatus!.id,
    project.id,
    'columnId',
  )

  let type: Row | null = null
  if (input.typeId !== undefined) {
    if (input.typeId) type = await catalog(ctx, 'flow.TaskType', input.typeId, project.id, 'typeId')
  } else if (task.typeId) {
    const original = await owned(ctx, 'flow.TaskType', task.typeId)
    if (!original.archived && (!original.projectId || original.projectId === project.id)) type = original
    else if (string(original.code)) {
      const T = ctx.table('flow.TaskType')
      const matches = await ctx.db.all(
        from(T)
          .where(
            eq(T.companyId, ctx.scope.company),
            eq(T.archived, false),
            eq(T.code, original.code),
            eq(T.projectId, project.id),
          )
          .limit(2),
      )
      if (matches.length > 1) return refuse('validation', { typeId: 'ambiguous' })
      type = matches[0] ?? null
    }
  }
  const [answers, labels, assignments, followers, bindings, inbox] = await Promise.all([
    related(ctx, 'flow.TaskFieldValue', task.id),
    related(ctx, 'flow.TaskLabel', task.id, 30),
    related(ctx, 'flow.TaskAssignee', task.id, 30),
    related(ctx, 'flow.TaskFollower', task.id),
    related(ctx, 'flow.FlowAttachmentBinding', task.id, 20),
    related(ctx, 'flow.Inbox', task.id),
  ])
  const F = ctx.table('flow.CustomField')
  const definitions = await ctx.db.all(
    from(F)
      .where(
        eq(F.companyId, ctx.scope.company),
        eq(F.archived, false),
        or(isNull(F.projectId), eq(F.projectId, project.id)),
        or(isNull(F.appliesTo), eq(F.appliesTo, project.id)),
      )
      .orderBy(asc(F.id))
      .limit(201),
  )
  if (definitions.length > 200) return refuse('limit')
  if (
    input.fieldMap !== undefined &&
    (!input.fieldMap || typeof input.fieldMap !== 'object' || Array.isArray(input.fieldMap))
  )
    return refuse('validation', { fieldMap: 'invalid' })
  const mapping = (input.fieldMap ?? {}) as Row
  if (
    Object.keys(mapping).length > 200 ||
    Object.keys(mapping).some((id) => !answers.some((a) => a.fieldId === id))
  )
    return refuse('validation', { fieldMap: 'unknown' })
  const mapped: Row = {},
    used = new Set<string>()
  let fieldsDropped = 0
  for (const answer of answers) {
    const sourceId = string(answer.fieldId)
    const targetId = Object.hasOwn(mapping, sourceId) ? mapping[sourceId] : sourceId
    if (targetId !== null && typeof targetId !== 'string')
      return refuse('validation', { fieldMap: 'invalid' })
    const target = definitions.find((f) => f.id === targetId)
    if (!target) {
      if (Object.hasOwn(mapping, sourceId) && targetId !== null)
        return refuse('validation', { fieldMap: 'scope' })
      fieldsDropped++
      continue
    }
    if (used.has(string(target.id))) return refuse('validation', { fieldMap: 'duplicate' })
    const original = await owned(ctx, 'flow.CustomField', sourceId)
    // A same-shaped value alone does not establish that two fields mean the same thing.
    if (original.kind !== target.kind) return refuse('validation', { fieldMap: 'kind' })
    used.add(string(target.id))
    mapped[string(target.id)] = decodeCustomFieldValue(answer.value)
  }
  const values = (await fieldValues(ctx, project.id, mapped, null, status.kind === 'done'))!
  const keptLabels: string[] = []
  for (const join of labels) {
    try {
      await catalog(ctx, 'flow.Label', join.labelId, project.id, 'tagIds')
      keptLabels.push(string(join.labelId))
    } catch (error) {
      if (!(error instanceof FlowRefusal) || !['validation', 'not_found'].includes(error.code)) throw error
    }
  }
  const access = new Map<string, boolean>()
  for (const id of new Set([
    ...assignments.map((a) => a.userId),
    ...followers.map((f) => f.userId),
    ...inbox.map((i) => i.recipientId),
  ])) {
    access.set(string(id), await destinationReader(ctx, id, project.id))
  }
  const assigneeIds = assignments.filter((a) => access.get(string(a.userId))).map((a) => string(a.userId))
  const removedFollowers = followers.filter((f) => !access.get(string(f.userId)))
  const removedInbox = inbox.filter((i) => !access.get(string(i.recipientId)))
  const R = ctx.table('flow.TaskRelation'),
    T = ctx.table('flow.Task'),
    FR = ctx.table('flow.FormResponse')
  const relations = await ctx.db.all(
    from(R)
      .where(eq(R.companyId, ctx.scope.company), or(eq(R.taskId, task.id), eq(R.targetId, task.id)))
      .orderBy(asc(R.id))
      .limit(201),
  )
  if (relations.length > 200) return refuse('limit')
  if (mode === 'transfer') {
    const child = await ctx.db.one(from(T).where(eq(T.companyId, ctx.scope.company), eq(T.parentId, task.id)))
    const response = await ctx.db.one(
      from(FR).where(eq(FR.companyId, ctx.scope.company), eq(FR.taskId, task.id)),
    )
    if (child) return refuse('validation', { id: 'has_children' })
    if (response) return refuse('validation', { id: 'form_response' })
    if (bindings.some((b) => !b.ready || !b.finalizedAt))
      return refuse('validation', { id: 'pending_uploads' })
  }
  const impact = {
    fieldsCarried: Object.keys(values).length,
    fieldsDropped,
    labelsDropped: labels.length - keptLabels.length,
    assigneesDropped: assignments.length - assigneeIds.length,
    followersDropped: mode === 'copy' ? followers.length : removedFollowers.length,
    notificationsRemoved: mode === 'copy' ? 0 : removedInbox.length,
    dependenciesCleared: relations.length,
    parentCleared: Boolean(task.parentId),
    epicCleared: Boolean(task.epicId),
    sprintCleared: Boolean(task.sprintId),
    typeCleared: Boolean(task.typeId && !type),
    filesExcluded: mode === 'copy' ? bindings.length : 0,
    contentExcluded: mode === 'copy',
  }
  const impactDigest = hash(
    JSON.stringify({
      mode,
      task,
      project,
      status,
      type,
      definitions,
      values,
      labels,
      assigneeIds,
      followers,
      bindings,
      inbox,
      relations,
      impact,
    }),
  )
  return {
    task,
    source,
    project,
    status,
    type,
    values,
    keptLabels,
    assigneeIds,
    removedFollowers,
    removedInbox,
    inbox,
    bindings,
    relations,
    impact,
    impactDigest,
  }
}

export async function previewTaskRelocation(ctx: Ctx, input: Row) {
  const mode = modeOf(input.mode)
  return ctx.tx(async (tx) => {
    const p = await plan(tx, input, mode)
    return {
      ok: true,
      sourceProjectId: p.source.id,
      sourceVersion: p.task.version,
      impact: p.impact,
      impactDigest: p.impactDigest,
      columnId: p.status.id,
      typeId: p.type?.id ?? null,
    }
  })
}

export async function relocateTask(ctx: Ctx, input: Row, mode: Mode, extensions: NativeServerExtension[]) {
  const held = await taskByKey(ctx, input.id)
  // Use the preview's stable source owner: a successful transfer changes the
  // current owner, but the replay request and its authorization must not change.
  const args = { ...input, id: held.key, projectId: input.sourceProjectId }
  const saved = await mutate(
    ctx,
    {
      name: mode === 'copy' ? 'flow.issue.copyTo' : 'flow.issue.transfer',
      capability: mode === 'copy' ? 'project.read' : 'project.write',
      input: args,
      requirements: [{ capability: 'project.write', input: { projectId: input.targetProjectId } }],
    },
    extensions,
    async (tx) => {
      const p = await plan(tx, args, mode)
      if (p.source.id !== input.sourceProjectId) return refuse('conflict')
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== p.task.version)
        return refuse('conflict')
      if (input.impactDigest !== p.impactDigest) return refuse('conflict', { impactDigest: 'stale' })
      if (mode === 'copy') {
        const copied = await writeTask(
          tx,
          {
            projectId: p.project.id,
            title: input.title ?? p.task.title,
            columnId: p.status.id,
            typeId: p.type?.id ?? null,
            priority: p.task.priority,
            points: Number(p.task.points),
            startDate: p.task.start,
            dueDate: p.task.due,
            assigneeIds: p.assigneeIds,
            tagIds: p.keptLabels,
            fieldValues: p.values,
          },
          null,
        )
        return { ...copied, impact: p.impact }
      }
      const task = await cas(tx, 'flow.Task', string(p.task.id), input.expectedVersion, {
        projectId: p.project.id,
        columnId: p.status.id,
        typeId: p.type?.id ?? null,
        parentId: null,
        epicId: null,
        sprintId: null,
        sequence: await appendTaskRank(tx),
        assigneeKey: assigneeKey(p.assigneeIds),
      })
      for (const model of ['flow.TaskAssignee', 'flow.TaskLabel', 'flow.TaskFieldValue']) {
        const T = tx.table(model)
        await tx.db.del(deleteFrom(T).where(eq(T.companyId, tx.scope.company), eq(T.taskId, task.id)))
      }
      for (const userId of p.assigneeIds)
        await tx.db.insert('flow.TaskAssignee', {
          id: randomUUID(),
          taskId: task.id,
          userId,
          title: task.title,
          key: task.key,
          projectId: task.projectId,
          columnId: task.columnId,
          sequence: task.sequence,
          archived: task.archived,
        })
      await assignmentProjection(tx, task)
      for (const labelId of p.keptLabels)
        await tx.db.insert('flow.TaskLabel', {
          id: randomUUID(),
          taskId: task.id,
          labelId,
          projectId: task.projectId,
          archived: task.archived,
        })
      for (const [fieldId, value] of Object.entries(p.values))
        await tx.db.insert('flow.TaskFieldValue', {
          id: randomUUID(),
          taskId: task.id,
          fieldId,
          value: encodeCustomFieldValue(value),
        })
      for (const [model, rows] of [
        ['flow.TaskFollower', p.removedFollowers],
        ['flow.Inbox', p.removedInbox],
        ['flow.TaskRelation', p.relations],
      ] as const) {
        const T = tx.table(model)
        for (const row of rows)
          await tx.db.del(deleteFrom(T).where(eq(T.companyId, tx.scope.company), eq(T.id, row.id)))
      }
      for (const binding of p.bindings)
        await cas(tx, 'flow.FlowAttachmentBinding', string(binding.id), binding.version, {
          projectId: task.projectId,
        })
      for (const note of p.inbox.filter((note) => !p.removedInbox.some((removed) => removed.id === note.id)))
        await cas(tx, 'flow.Inbox', string(note.id), note.version, { projectId: task.projectId })
      await tx.db.insert('flow.TaskHistory', {
        id: randomUUID(),
        taskId: task.id,
        projectId: task.projectId,
        workspaceId: p.project.workspaceId,
        actorId: tx.actor,
        kind: 'transferred',
        description: 'Task transferred',
        metadata: { sourceProjectId: p.source.id, impact: p.impact },
        createdAt: now(),
      })
      return { ok: true, id: task.key, version: task.version, impact: p.impact }
    },
  )
  return { ...saved, record: await taskDetail(ctx, { id: saved.id }, extensions) }
}
