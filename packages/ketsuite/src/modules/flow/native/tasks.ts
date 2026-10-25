import { recordTaskChanges } from './task-history.ts'
import { relationProjection } from './blocked-counts.ts'
import { randomUUID } from 'node:crypto'
import { asc, deleteFrom, eq, from, inArray, isDateText, isNull, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { advanceRevision, cas, hash, mutate, now, revision, touchProjects } from './command.ts'
import { appendTaskRank, assigneeKey } from './task-ranks.ts'
import type { NativeServerExtension } from './command.ts'
import { authority, FlowRefusal, owned, refuse, requireCapability, string } from './policy.ts'
import { taskByKey, taskDetail } from './queries.ts'
import { requiredTitle, timestamped } from './organization.ts'
import { finalizeTaskUploads } from './attachments.ts'
import { decodeCustomFieldValue, encodeCustomFieldValue } from './field-values.ts'

const idsOf = (value: unknown, field: string, maximum = 30): string[] => {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((x) => typeof x !== 'string' || !x.trim())
  )
    return refuse('validation', { [field]: 'invalid' })
  return [...new Set(value.map(string))]
}
const date = (value: unknown, field: string) => {
  if (value === null || value === '') return null
  if (!isDateText(value)) return refuse('validation', { [field]: 'invalid' })
  return value
}
async function assignees(ctx: Ctx, ids: string[], projectId: string) {
  const a = await authority(ctx)
  if (a.member?.role === 'guest' && ids.some((id) => id !== a.actorId)) return refuse('forbidden')
  if (!ids.length) return
  const M = ctx.table('flow.Member'),
    U = ctx.table('user.User')
  const [members, users] = await Promise.all([
    ctx.db.all(
      from(M).where(inArray(M.userId, ids), eq(M.companyId, a.companyId), eq(M.status, 'active')).limit(30),
    ),
    ctx.db.all(from(U).where(inArray(U.id, ids), eq(U.active, true)).limit(30)),
  ])
  if (members.length !== ids.length || users.length !== ids.length)
    return refuse('validation', { assigneeIds: 'invalid' })
  for (const actor of ids) await requireCapability({ ...ctx, actor } as Ctx, 'project.read', { projectId })
}

export async function catalog(ctx: Ctx, model: string, id: unknown, projectId: unknown, field: string) {
  const row = await owned(ctx, model, id)
  if (row.archived || (row.projectId && row.projectId !== projectId))
    return refuse('validation', { [field]: 'invalid' })
  const project = await owned(ctx, 'flow.ProjectRecord', projectId)
  const override = (project.catalogOverrides as Row)[
    model === 'flow.TaskStatus' ? 'taskStatusIds' : model === 'flow.Label' ? 'taskLabelIds' : ''
  ]
  if (
    (Array.isArray(override) && !override.includes(row.id)) ||
    (model === 'flow.Label' && row.domain !== 'task')
  )
    return refuse('validation', { [field]: 'invalid' })
  return row
}

export async function fieldValues(
  ctx: Ctx,
  projectId: unknown,
  input: unknown,
  existing: Row | null,
  requireAll = false,
) {
  const F = ctx.table('flow.CustomField')
  const fields = await ctx.db.all(
    from(F)
      .where(
        eq(F.companyId, ctx.scope.company),
        eq(F.archived, false),
        or(isNull(F.projectId), eq(F.projectId, projectId)),
        or(isNull(F.appliesTo), eq(F.appliesTo, projectId)),
      )
      .orderBy(asc(F.sequence), asc(F.id))
      .limit(201),
  )
  if (fields.length > 200) return refuse('limit')
  const allowed = fields.filter((f) => !f.projectId || f.projectId === projectId)
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)))
    return refuse('validation', { fieldValues: 'invalid' })
  const values = input === undefined ? undefined : { ...(input as Row) }
  const saved = new Map<string, unknown>()
  if (existing) {
    const V = ctx.table('flow.TaskFieldValue')
    for (const row of await ctx.db.all(
      from(V).where(eq(V.companyId, ctx.scope.company), eq(V.taskId, existing.id)).limit(200),
    ))
      saved.set(string(row.fieldId), decodeCustomFieldValue(row.value))
  }
  for (const key of Object.keys(values ?? {}))
    if (!allowed.some((f) => f.id === key)) return refuse('validation', { [`fieldValues.${key}`]: 'unknown' })
  for (const f of allowed) {
    const value =
      values && Object.hasOwn(values, string(f.id)) ? values[string(f.id)] : saved.get(string(f.id))
    const empty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) &&
        !value.length &&
        ['text', 'multi-select', 'multiselect'].includes(string(f.kind)))
    if (empty && f.required && requireAll)
      return refuse('validation', { [`fieldValues.${f.id}`]: 'required' })
    if (empty) continue
    const options = Array.isArray(f.options)
      ? f.options.map((o) => (typeof o === 'string' ? o : string((o as Row).id)))
      : []
    let valid = true
    if (f.kind === 'number') {
      valid =
        (typeof value === 'number' || (typeof value === 'string' && Boolean(value.trim()))) &&
        Number.isFinite(Number(value))
      if (valid && values && Object.hasOwn(values, string(f.id))) values[string(f.id)] = Number(value)
    } else if (f.kind === 'date') valid = isDateText(value)
    else if (['select', 'single-select'].includes(string(f.kind))) valid = options.includes(string(value))
    else if (['multi-select', 'multiselect'].includes(string(f.kind)))
      valid = Array.isArray(value) && value.every((x) => options.includes(string(x)))
    else if (['checkbox', 'boolean'].includes(string(f.kind))) valid = typeof value === 'boolean'
    else valid = typeof value === 'string' && value.length <= 4000
    if (!valid) return refuse('validation', { [`fieldValues.${f.id}`]: 'invalid' })
  }
  return values
}

export async function statusGuard(ctx: Ctx, task: Row, column: Row, completing?: ReadonlySet<string>) {
  if (column.kind !== 'done') return
  const R = ctx.table('flow.TaskRelation'),
    T = ctx.table('flow.Task')
  const blockers = await ctx.db.all(
    from(R)
      .where(eq(R.companyId, ctx.scope.company), eq(R.targetId, task.id), eq(R.kind, 'blocks'))
      .limit(101),
  )
  if (blockers.length > 100) return refuse('limit')
  if (!blockers.length) return
  const tasks = await ctx.db.all(
    from(T)
      .where(
        eq(T.companyId, ctx.scope.company),
        inArray(
          T.id,
          blockers.map((x) => x.taskId),
        ),
      )
      .limit(100),
  )
  for (const other of tasks) {
    if (completing?.has(string(other.id))) continue
    const status = await owned(ctx, 'flow.TaskStatus', other.columnId)
    if (!other.archived && !['done', 'cancelled'].includes(string(status.kind))) return refuse('blocked')
  }
}

/** Private acceptance services use the same completion validation as Core writes. */
export async function validateTaskCompletion(ctx: Ctx, task: Row) {
  await requireCapability(ctx, 'project.write', { projectId: task.projectId })
  await fieldValues(ctx, task.projectId, undefined, task, true)
  const C = ctx.table('flow.TaskStatus')
  const column = await ctx.db.one(
    from(C).where(
      eq(C.companyId, ctx.scope.company),
      eq(C.kind, 'done'),
      or(isNull(C.projectId), eq(C.projectId, task.projectId)),
      eq(C.archived, false),
    ),
  )
  if (!column) return refuse('validation', { columnId: 'invalid' })
  await statusGuard(ctx, task, column)
}

export async function assignmentProjection(ctx: Ctx, task: Row) {
  // Existing legacy edges remain unready until both ends are backfilled.
  await ctx.db.update(
    'flow.TaskRelation',
    { taskId: task.id },
    { projectId: task.projectId, sourceStatusId: task.columnId, sourceArchived: task.archived },
  )
  await ctx.db.update(
    'flow.TaskRelation',
    { targetId: task.id },
    {
      projectId: task.projectId,
      targetStatusId: task.columnId,
      targetArchived: task.archived,
      targetDue: task.due ?? null,
    },
  )
  await ctx.db.update(
    'flow.TaskLabel',
    { taskId: task.id },
    { projectId: task.projectId, archived: task.archived },
  )
  await ctx.db.update(
    'flow.TaskAssignee',
    { taskId: task.id },
    {
      title: task.title,
      key: task.key,
      projectId: task.projectId,
      columnId: task.columnId,
      sequence: task.sequence,
      due: task.due,
      priority: task.priority,
      archived: task.archived,
    },
  )
}

export async function linkTask(ctx: Ctx, input: Row, extensions: NativeServerExtension[], child = false) {
  const parent = await taskByKey(ctx, input.id),
    target = await taskByKey(ctx, input.target ?? input.targetId)
  if (parent.projectId !== target.projectId || parent.id === target.id)
    return refuse('validation', { target: 'invalid' })
  return mutate(
    ctx,
    {
      name: child ? 'flow.issue.linkChild' : 'flow.issue.dependency',
      capability: 'project.write',
      input: { ...input, projectId: parent.projectId },
      subjects: [parent, target].map((task) => ({
        model: 'flow.Task',
        id: task.id,
        projectId: task.projectId,
      })),
    },
    extensions,
    async (tx) => {
      const current = await owned(tx, 'flow.Task', parent.id),
        other = await owned(tx, 'flow.Task', target.id)
      if (current.archived || other.archived) return refuse('archived')
      await cas(tx, 'flow.Task', string(parent.id), input.expectedVersion, {})
      if (child) {
        let ancestor: Row | null = current
        for (let depth = 0; ancestor; depth++) {
          if (ancestor.id === other.id || depth >= 128) return refuse('cycle')
          ancestor = ancestor.parentId ? await owned(tx, 'flow.Task', ancestor.parentId) : null
        }
        await cas(tx, 'flow.Task', string(other.id), input.expectedChildVersion, { parentId: current.id })
      } else {
        const R = tx.table('flow.TaskRelation')
        const seen = new Set<string>(),
          pending = [string(current.id)]
        // target blocks current. A path from current to target would close a cycle.
        while (!input.remove && pending.length) {
          const id = pending.pop()!
          if (id === other.id) return refuse('cycle')
          if (seen.has(id)) continue
          if (seen.size >= 1000) return refuse('limit')
          seen.add(id)
          const next = await tx.db.all(
            from(R)
              .where(eq(R.companyId, tx.scope.company), eq(R.taskId, id), eq(R.kind, 'blocks'))
              .limit(101),
          )
          if (next.length > 100) return refuse('limit')
          pending.push(...next.map((x) => string(x.targetId)))
        }
        const old = await tx.db.one(
          from(R).where(
            eq(R.companyId, tx.scope.company),
            eq(R.taskId, other.id),
            eq(R.targetId, current.id),
            eq(R.kind, 'blocks'),
          ),
        )
        if (input.remove && old)
          await tx.db.del(deleteFrom(R).where(eq(R.id, old.id), eq(R.companyId, tx.scope.company)))
        if (!input.remove && !old)
          await tx.db.insert('flow.TaskRelation', {
            id: randomUUID(),
            taskId: other.id,
            targetId: current.id,
            kind: 'blocks',
            ...relationProjection(other, current),
          })
      }
      return { ok: true, id: parent.key }
    },
  )
}

/** Each item is re-authorized and guarded; refused items never enter a write. */
export async function bulkTasks(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const ids = idsOf(input.ids, 'ids', 100)
  if (!ids.length || !['move', 'status'].includes(string(input.action))) return refuse('validation')
  return mutate(ctx, { name: 'flow.issue.bulk', capability: 'member.read', input }, [], async (tx) => {
    const refused: Row[] = []
    const changedProjects = new Set<string>()
    let applied = 0
    for (const key of ids) {
      try {
        const task = await taskByKey(tx, key)
        const args = { ...input, id: key, projectId: task.projectId, columnId: input.value }
        await requireCapability(tx, 'project.write', args)
        const column = await catalog(tx, 'flow.TaskStatus', input.value, task.projectId, 'value')
        if (task.archived) return refuse('archived')
        await fieldValues(tx, task.projectId, undefined, task, column.kind === 'done')
        await statusGuard(tx, task, column)
        for (const extension of extensions)
          await extension.beforeMutation?.(tx, {
            name: 'flow.issue.move',
            capability: 'project.write',
            input: args,
          })
        const updated = await cas(tx, 'flow.Task', string(task.id), task.version, { columnId: column.id })
        await assignmentProjection(tx, updated)
        await recordTaskChanges(tx, updated, [
          { field: 'status', before: task.columnId, after: updated.columnId },
        ])
        changedProjects.add(string(task.projectId))
        applied++
      } catch (error) {
        if (!(error instanceof FlowRefusal)) throw error
        refused.push({ id: key, code: error.code })
      }
    }
    await touchProjects(tx, changedProjects)
    return { ok: true, applied, refused }
  })
}

export async function saveTask(
  ctx: Ctx,
  input: Row,
  extensions: NativeServerExtension[],
  commandName = 'flow.issue.save',
) {
  const existing = input.id ? await taskByKey(ctx, input.id) : null
  const projectId = string(existing?.projectId ?? input.projectId)
  if (existing && input.projectId !== undefined && input.projectId !== existing.projectId) {
    await requireCapability(ctx, 'project.write', { projectId })
    return refuse('validation', { projectId: 'immutable' })
  }
  const args: Row = { ...input, projectId }
  const saved = await mutate(
    ctx,
    {
      name: commandName,
      capability: 'project.write',
      input: args,
      subjects: existing ? [{ model: 'flow.Task', id: existing.id, projectId: existing.projectId }] : [],
    },
    extensions,
    async (tx) => {
      const saved = await writeTask(tx, args, existing)
      if (args.attachments !== undefined)
        await finalizeTaskUploads(tx, await taskByKey(tx, saved.id), args.attachments, !existing)
      if (args.subtasks !== undefined) {
        if (
          existing ||
          !Array.isArray(args.subtasks) ||
          args.subtasks.length > 50 ||
          args.subtasks.some((t) => typeof t !== 'string' || !t.trim() || t.length > 1000)
        )
          return refuse('validation', { subtasks: 'invalid' })
        for (const title of args.subtasks) {
          const child = {
            projectId,
            title,
            parentId: saved.id,
            assigneeIds: args.assigneeIds,
            typeId: args.typeId,
          }
          await requireCapability(tx, 'project.write', child)
          for (const extension of extensions)
            await extension.beforeMutation?.(tx, {
              name: 'flow.issue.save',
              capability: 'project.write',
              input: child,
            })
          await writeTask(tx, child, null)
        }
      }
      return saved
    },
  )
  return { ...saved, ...(existing ? { record: await taskDetail(ctx, { id: saved.id }, extensions) } : {}) }
}

export async function writeTask(tx: Ctx, input: Row, existing: Row | null, completing?: ReadonlySet<string>) {
  const projectId = string(existing?.projectId ?? input.projectId)
  const project = await owned(tx, 'flow.ProjectRecord', projectId)
  if (project.archived) return refuse('archived')
  const current = existing ? await owned(tx, 'flow.Task', existing.id) : null
  const changes: Row[] = []
  const changed = (field: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null))
      changes.push({ field, before: before ?? null, after: after ?? null })
  }
  const title =
    input.title === undefined && current ? string(current.title) : requiredTitle(input, 'title', 1000)
  const S = tx.table('flow.TaskStatus')
  const statusIds = (project.catalogOverrides as Row).taskStatusIds
  const first =
    current?.columnId ??
    (
      await tx.db.one(
        from(S)
          .where(
            eq(S.companyId, tx.scope.company),
            Array.isArray(statusIds) ? inArray(S.id, statusIds) : isNull(S.projectId),
            eq(S.kind, 'todo'),
            eq(S.archived, false),
          )
          .orderBy(asc(S.sequence)),
      )
    )?.id
  const column = await catalog(tx, 'flow.TaskStatus', input.columnId ?? first, projectId, 'columnId')
  const typeId = input.typeId === undefined ? (current?.typeId ?? null) : input.typeId || null
  if (typeId) await catalog(tx, 'flow.TaskType', typeId, projectId, 'typeId')
  const priority = string(input.priority ?? current?.priority ?? 'normal')
  if (!['normal', 'high', 'urgent'].includes(priority)) return refuse('validation', { priority: 'invalid' })
  const values: Row = { title, columnId: column.id, typeId, priority }
  if (input.points !== undefined) {
    if (
      typeof input.points !== 'number' ||
      !Number.isFinite(input.points) ||
      input.points < 0 ||
      input.points > 100000
    )
      return refuse('validation', { points: 'invalid' })
    values.points = input.points
  }
  if (!current || input.description !== undefined) {
    const text = string(input.description)
    if (text.length > 100000) return refuse('validation', { description: 'too_long' })
    values.description = text
  }
  if (input.descriptionDoc !== undefined) values.descriptionDoc = input.descriptionDoc
  if (input.checklist !== undefined) {
    if (!Array.isArray(input.checklist) || input.checklist.length > 200)
      return refuse('validation', { checklist: 'invalid' })
    const seen = new Set<string>()
    values.checklist = input.checklist.map((x) => {
      if (
        !x ||
        typeof x !== 'object' ||
        typeof x.id !== 'string' ||
        !x.id ||
        seen.has(x.id) ||
        typeof x.text !== 'string' ||
        !x.text.trim() ||
        x.text.length > 10000 ||
        typeof x.checked !== 'boolean'
      )
        return refuse('validation', { checklist: 'invalid' })
      seen.add(x.id)
      return { id: x.id, text: x.text.trim(), checked: x.checked }
    })
  }
  if (input.dueDate !== undefined) values.due = date(input.dueDate, 'dueDate')
  if (input.startDate !== undefined) values.start = date(input.startDate, 'startDate')
  const start = Object.hasOwn(values, 'start') ? values.start : current?.start,
    due = Object.hasOwn(values, 'due') ? values.due : current?.due
  if (start && due && string(start) > string(due)) return refuse('validation', { dueDate: 'before_start' })
  for (const [field, model] of [
    ['sprintId', 'flow.SprintRecord'],
    ['epicId', 'flow.EpicRecord'],
  ] as const) {
    if (input[field] !== undefined) {
      if (input[field]) {
        const record = await owned(tx, model, input[field])
        if (
          record.projectId !== projectId ||
          record.archived ||
          (field === 'sprintId' && record.state === 'closed')
        )
          return refuse('validation', { [field]: 'invalid' })
      }
      values[field] = input[field] || null
    }
  }
  if (input.parentId !== undefined) {
    const parent = input.parentId ? await taskByKey(tx, input.parentId) : null
    if (parent && parent.projectId !== projectId) return refuse('validation', { parentId: 'invalid' })
    let ancestor = parent,
      depth = 0
    while (ancestor) {
      if (ancestor.id === current?.id || ++depth > 128) return refuse('cycle')
      ancestor = ancestor.parentId ? await owned(tx, 'flow.Task', ancestor.parentId) : null
    }
    values.parentId = parent?.id ?? null
  }
  const assignments = input.assigneeIds === undefined ? undefined : idsOf(input.assigneeIds, 'assigneeIds')
  if (assignments) await assignees(tx, assignments, projectId)
  if (assignments) values.assigneeKey = assigneeKey(assignments)
  const tags = input.tagIds === undefined ? undefined : idsOf(input.tagIds, 'tagIds')
  if (tags) for (const id of tags) await catalog(tx, 'flow.Label', id, projectId, 'tagIds')
  const fields = await fieldValues(tx, projectId, input.fieldValues, current, column.kind === 'done')
  let task: Row
  if (current) {
    if (input.blockerIds === undefined) await statusGuard(tx, current, column, completing)
    task = await cas(tx, 'flow.Task', string(current.id), input.expectedVersion, values)
  } else {
    const number = await tx.sequence(`flow.task_${hash(projectId).slice(0, 32)}`)
    const id = randomUUID(),
      key = `${project.code}-${number}`
    await tx.db.insert('flow.Task', {
      id,
      key,
      number,
      projectId,
      reporterId: tx.actor,
      description: '',
      descriptionDoc: null,
      checklist: [],
      points: 0,
      due: null,
      start: null,
      parentId: null,
      epicId: null,
      sprintId: null,
      assigneeKey: '',
      sequence: await appendTaskRank(tx),
      ...timestamped(),
      ...values,
    })
    task = await owned(tx, 'flow.Task', id)
  }
  if (assignments) {
    const A = tx.table('flow.TaskAssignee')
    await tx.db.del(deleteFrom(A).where(eq(A.taskId, task.id), eq(A.companyId, tx.scope.company)))
    for (const userId of assignments)
      await tx.db.insert('flow.TaskAssignee', {
        id: randomUUID(),
        taskId: task.id,
        userId,
        title: task.title,
        key: task.key,
        projectId,
        columnId: task.columnId,
        sequence: task.sequence,
        due: task.due,
        priority: task.priority,
        archived: task.archived,
      })
  }
  await assignmentProjection(tx, task)
  if (input.blockerIds !== undefined) {
    const requested = idsOf(input.blockerIds, 'blockerIds', 100),
      R = tx.table('flow.TaskRelation')
    const incoming = await tx.db.all(
      from(R)
        .where(eq(R.companyId, tx.scope.company), eq(R.targetId, task.id), eq(R.kind, 'blocks'))
        .limit(101),
    )
    if (incoming.length > 100) return refuse('limit')
    const blockers = [] as Row[]
    for (const key of requested) {
      const blocker = await taskByKey(tx, key)
      if (blocker.id === task.id || blocker.projectId !== projectId || blocker.archived)
        return refuse('validation', { blockerIds: 'scope' })
      blockers.push(blocker)
    }
    const seen = new Set<string>(),
      pending = [string(task.id)]
    while (pending.length) {
      const id = pending.pop()!
      if (blockers.some((b) => b.id === id)) return refuse('cycle')
      if (seen.has(id)) continue
      if (seen.size >= 1000) return refuse('limit')
      seen.add(id)
      const next = await tx.db.all(
        from(R).where(eq(R.companyId, tx.scope.company), eq(R.taskId, id), eq(R.kind, 'blocks')).limit(101),
      )
      if (next.length > 100) return refuse('limit')
      pending.push(...next.map((x) => string(x.targetId)))
    }
    for (const old of incoming)
      if (!blockers.some((b) => b.id === old.taskId))
        await tx.db.del(deleteFrom(R).where(eq(R.companyId, tx.scope.company), eq(R.id, old.id)))
    for (const blocker of blockers)
      if (!incoming.some((r) => r.taskId === blocker.id))
        await tx.db.insert('flow.TaskRelation', {
          id: randomUUID(),
          taskId: blocker.id,
          targetId: task.id,
          kind: 'blocks',
          ...relationProjection(blocker, task),
        })
    await statusGuard(tx, task, column)
  }
  if (tags) {
    const L = tx.table('flow.TaskLabel')
    const before = current
      ? await tx.db.all(from(L).where(eq(L.taskId, task.id), eq(L.companyId, tx.scope.company)).limit(31))
      : []
    changed('tags', before.map((r) => r.labelId).sort(), [...tags].sort())
    await tx.db.del(deleteFrom(L).where(eq(L.taskId, task.id), eq(L.companyId, tx.scope.company)))
    for (const labelId of tags)
      await tx.db.insert('flow.TaskLabel', {
        id: randomUUID(),
        taskId: task.id,
        labelId,
        projectId: task.projectId,
        archived: task.archived,
      })
  }
  if (fields) {
    const V = tx.table('flow.TaskFieldValue')
    for (const [fieldId, value] of Object.entries(fields)) {
      const row = await tx.db.one(
        from(V).where(eq(V.taskId, task.id), eq(V.fieldId, fieldId), eq(V.companyId, tx.scope.company)),
      )
      const stored = encodeCustomFieldValue(value)
      changed(
        'customFields',
        { [fieldId]: row ? decodeCustomFieldValue(row.value) : null },
        { [fieldId]: value },
      )
      if (row) await tx.db.update('flow.TaskFieldValue', { id: row.id }, { value: stored })
      else
        await tx.db.insert('flow.TaskFieldValue', {
          id: randomUUID(),
          taskId: task.id,
          fieldId,
          value: stored,
        })
    }
  }
  if (current) {
    const fieldNames: Record<string, string> = {
      columnId: 'status',
      due: 'dueDate',
      start: 'startDate',
      sprintId: 'sprint',
      epicId: 'epic',
      typeId: 'type',
    }
    for (const field of Object.keys(values)) {
      if (field === 'assigneeKey') {
        const people = (key: unknown): string[] =>
          string(key).startsWith('users:')
            ? (JSON.parse(string(key).slice(6)) as string[])
            : string(key).startsWith('user:')
              ? [string(key).slice(5)]
              : []
        changed('assigneeIds', people(current.assigneeKey), people(task.assigneeKey))
      } else if (field === 'description' || field === 'descriptionDoc') {
        // Audit that the content changed without storing another full body snapshot.
        if (JSON.stringify(current[field]) !== JSON.stringify(task[field]))
          changes.push({ field, before: null, after: null })
      } else changed(fieldNames[field] ?? field, current[field], task[field])
    }
  }
  await tx.db.insert('flow.TaskHistory', {
    id: randomUUID(),
    taskId: task.id,
    projectId,
    workspaceId: project.workspaceId,
    actorId: tx.actor,
    kind: current ? 'updated' : 'created',
    description: current ? 'Task updated' : 'Task created',
    metadata: { version: task.version, changes },
    createdAt: now(),
  })
  return { ok: true, id: task.key, version: task.version }
}

export async function moveTask(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const task = await taskByKey(ctx, input.id)
  const saved = await mutate(
    ctx,
    {
      name: 'flow.issue.move',
      capability: 'project.write',
      input: { ...input, projectId: task.projectId },
      subjects: [{ model: 'flow.Task', id: task.id, projectId: task.projectId }],
    },
    extensions,
    async (tx) => {
      const column = await catalog(
        tx,
        'flow.TaskStatus',
        input.columnId ?? input.value,
        task.projectId,
        'columnId',
      )
      const current = await owned(tx, 'flow.Task', task.id)
      await fieldValues(tx, current.projectId, undefined, current, column.kind === 'done')
      await statusGuard(tx, current, column)
      const updated = await cas(tx, 'flow.Task', string(task.id), input.expectedVersion, {
        columnId: column.id,
      })
      await assignmentProjection(tx, updated)
      await recordTaskChanges(tx, updated, [
        { field: 'status', before: current.columnId, after: updated.columnId },
      ])
      return { ok: true, id: task.key, version: updated.version }
    },
  )
  return { ...saved, record: await taskDetail(ctx, { id: task.key }, extensions) }
}

export async function followTask(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const task = await taskByKey(ctx, input.id)
  const saved = await mutate(
    ctx,
    {
      name: 'flow.issue.follow',
      capability: 'project.read',
      input: { ...input, projectId: task.projectId },
      subjects: [{ model: 'flow.Task', id: task.id, projectId: task.projectId }],
    },
    extensions,
    async (tx) => {
      if (typeof input.follow !== 'boolean' && typeof input.following !== 'boolean')
        return refuse('validation', { follow: 'required' })
      const desired = input.follow ?? input.following
      const current = await owned(tx, 'flow.Task', task.id)
      await cas(tx, 'flow.Task', string(task.id), input.expectedVersion, {})
      const F = tx.table('flow.TaskFollower')
      const old = await tx.db.one(
        from(F).where(eq(F.taskId, task.id), eq(F.userId, tx.actor), eq(F.companyId, tx.scope.company)),
      )
      if (desired && !old)
        await tx.db.insert('flow.TaskFollower', { id: randomUUID(), taskId: task.id, userId: tx.actor })
      if (!desired && old)
        await tx.db.del(deleteFrom(F).where(eq(F.id, old.id), eq(F.companyId, tx.scope.company)))
      return { ok: true, id: current.key }
    },
  )
  return { ...saved, record: await taskDetail(ctx, { id: task.key }, extensions) }
}

export async function assignSprint(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return saveTask(ctx, { ...input, sprintId: input.sprintId || null }, extensions, 'flow.issue.assignSprint')
}

export async function archiveTask(
  ctx: Ctx,
  input: Row,
  extensions: NativeServerExtension[],
  archived: boolean,
) {
  const task = await taskByKey(ctx, input.id)
  return mutate(
    ctx,
    {
      name: archived ? 'flow.issue.archive' : 'flow.issue.restore',
      capability: 'project.write',
      input: { ...input, projectId: task.projectId },
      subjects: [{ model: 'flow.Task', id: task.id, projectId: task.projectId }],
    },
    extensions,
    async (tx) => {
      const current = await owned(tx, 'flow.Task', task.id)
      if (archived && (typeof input.reason !== 'string' || !input.reason.trim()))
        return refuse('validation', { reason: 'required' })
      const updated = await cas(tx, 'flow.Task', string(task.id), input.expectedVersion, { archived })
      await recordTaskChanges(tx, updated, [
        { field: 'archived', before: current.archived, after: updated.archived },
      ])
      await advanceRevision(tx, { expectedRevision: await revision(tx, 'task-order') }, 'task-order')
      await assignmentProjection(tx, updated)
      return { ok: true, id: task.key, version: updated.version }
    },
  )
}

export async function commentTask(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const task = await taskByKey(ctx, input.id ?? input.taskId)
  return mutate(
    ctx,
    {
      name: 'flow.issue.comment',
      capability: 'project.write',
      input: { ...input, projectId: task.projectId },
      subjects: [{ model: 'flow.Task', id: task.id, projectId: task.projectId }],
    },
    extensions,
    async (tx) => {
      const text = string(input.text ?? input.body)
      if (!text || text.length > 100000) return refuse('validation', { text: 'required' })
      const id = randomUUID()
      await tx.db.insert('flow.TaskComment', {
        id,
        taskId: task.id,
        authorId: tx.actor,
        text,
        contentDoc: input.contentDoc ?? null,
        createdAt: now(),
        version: 1,
      })
      return { ok: true, id, taskId: task.key }
    },
  )
}
