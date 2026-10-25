import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, from, inArray, isNull, lt, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { advanceRevision, cas, hash, mutate, now, revision } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { authority, FlowRefusal, owned, refuse, requireCapability, string } from './policy.ts'
import { requiredTitle, timestamped } from './organization.ts'
import { writeTask } from './tasks.ts'
import { notificationAction } from './notifications.ts'
import { limitOf, visibleScope } from './queries.ts'

export async function saveForm(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const old = input.id ? await owned(ctx, 'flow.InternalForm', input.id) : null,
    projectId = old?.projectId ?? input.projectId
  return mutate(
    ctx,
    { name: 'flow.form.save', capability: 'project.manage', input: { ...input, projectId } },
    extensions,
    async (tx) => {
      const fields = input.fields
      if (!Array.isArray(fields) || fields.length > 12) return refuse('validation', { fields: 'invalid' })
      const schemaFields = fields.map((f: Row, i: number) => {
        if (
          !f ||
          !string(f.label) ||
          string(f.label).length > 240 ||
          !['text', 'textarea', 'number'].includes(string(f.type)) ||
          (f.required !== undefined && typeof f.required !== 'boolean')
        )
          return refuse('validation', { fields: 'invalid' })
        return { id: 'field-' + i, label: string(f.label), type: f.type, required: Boolean(f.required) }
      })
      const _a = await authority(tx),
        M = tx.table('flow.Member'),
        U = tx.table('user.User')
      const member = await tx.db.one(
        from(M).where(
          eq(M.companyId, tx.scope.company),
          eq(M.userId, input.assigneeId),
          eq(M.status, 'active'),
        ),
      )
      if (!member || member.role === 'guest') return refuse('validation', { assignee: 'invalid' })
      // A recipient who cannot open the project is an invalid choice, not the actor's refusal.
      await requireCapability({ ...tx, actor: string(member.userId) }, 'project.read', { projectId }).catch(
        (error) =>
          error instanceof FlowRefusal && error.code === 'forbidden'
            ? refuse('validation', { assignee: 'invalid' })
            : Promise.reject(error),
      )
      const user = await tx.db.one(from(U).where(eq(U.id, member.userId), eq(U.active, true)))
      if (
        !user ||
        !['internal', 'project'].includes(string(input.access)) ||
        !['normal', 'high', 'urgent'].includes(string(input.priority ?? 'normal'))
      )
        return refuse('validation')
      const id = old ? string(old.id) : randomUUID()
      const patch = {
        title: requiredTitle(input),
        description: string(input.description),
        state: input.publish === undefined ? (old?.state ?? 'draft') : input.publish ? 'published' : 'draft',
        schema: {
          fields: schemaFields,
          access: input.access,
          priority: input.priority ?? 'normal',
          assigneeId: member.userId,
        },
      }
      if (old) await cas(tx, 'flow.InternalForm', id, input.expectedVersion, patch)
      else await tx.db.insert('flow.InternalForm', { id, projectId, ...timestamped(), ...patch })
      return { ok: true, id, revision: await advanceRevision(tx, input, 'operations') }
    },
  )
}

export async function submitForm(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const old = await owned(ctx, 'flow.InternalForm', input.id)
  return mutate(
    ctx,
    { name: 'flow.form.submit', capability: 'project.write', input: { ...input, projectId: old.projectId } },
    extensions,
    async (tx) => {
      const form = await owned(tx, 'flow.InternalForm', old.id)
      if (form.archived || form.state !== 'published') return refuse('form_unpublished')
      if (form.version !== input.expectedVersion) return refuse('conflict')
      const schema = form.schema as Row,
        fields = schema.fields as Row[]
      if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers))
        return refuse('validation', { answers: 'invalid' })
      const answers = input.answers as Row,
        normalized: Row = {}
      for (const key of Object.keys(answers))
        if (!fields.some((f) => f.id === key)) return refuse('validation', { answers: 'unknown' })
      for (const field of fields) {
        const value = answers[string(field.id)],
          text = string(value)
        if (
          (value !== undefined && typeof value !== 'string' && typeof value !== 'number') ||
          text.length > 10000 ||
          (field.required && !text) ||
          (field.type === 'number' && text && !Number.isFinite(Number(text)))
        )
          return refuse('validation', { ['answer-' + field.id]: 'invalid' })
        normalized[string(field.id)] = field.type === 'number' && text ? Number(text) : text
      }
      const taskInput = {
        projectId: form.projectId,
        title: requiredTitle(input, 'title', 1000),
        description: fields.map((f) => string(f.label) + ': ' + normalized[string(f.id)]).join('\n'),
        assigneeIds: [schema.assigneeId],
        priority: schema.priority,
      }
      for (const extension of extensions)
        await extension.beforeMutation?.(tx, {
          name: 'flow.issue.save',
          capability: 'project.write',
          input: taskInput,
        })
      const task = await writeTask(tx, taskInput, null)
      const T = tx.table('flow.Task'),
        row = await tx.db.one(from(T).where(eq(T.companyId, tx.scope.company), eq(T.key, task.id)))
      if (!row) throw new Error('Created task missing')
      await tx.db.insert('flow.FormResponse', {
        id: randomUUID(),
        formId: form.id,
        taskId: row.id,
        respondentId: tx.actor,
        schemaRevision: form.version,
        answers: normalized,
        createdAt: now(),
      })
      return { ok: true, id: task.id, revision: await advanceRevision(tx, input, 'operations') }
    },
  )
}

export async function saveView(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const old = input.id ? await owned(ctx, 'flow.SavedView', input.id) : null,
    projectId = old?.projectId ?? input.projectId
  return mutate(
    ctx,
    {
      name: 'flow.view.save',
      capability: projectId ? 'project.read' : 'member.read',
      input: { ...input, projectId },
    },
    extensions,
    async (tx) => {
      if (old && old.ownerId !== tx.actor) return refuse('forbidden')
      const visibility = string(input.visibility ?? (old?.query as Row | null)?.visibility ?? 'private')
      if (!['private', 'project'].includes(visibility) || (visibility === 'project' && !projectId))
        return refuse('validation', { visibility: 'invalid' })
      const id = old ? string(old.id) : randomUUID(),
        patch = {
          title: requiredTitle(input),
          archived: Boolean(input.archive),
          status: string(input.status ?? old?.status ?? 'all'),
          query: {
            text: string(input.query ?? (old?.query as Row | null)?.text),
            description: string(input.description ?? (old?.query as Row | null)?.description),
            visibility,
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

export async function savePreferences(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.preferences.save', capability: 'member.read', input },
    extensions,
    async (tx) => {
      const values: Row = {}
      if (input.timezone !== undefined) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: string(input.timezone) }).format(new Date())
        } catch {
          return refuse('validation', { timezone: 'invalid' })
        }
        values.timezone = input.timezone
      }
      if (input.notifications !== undefined) {
        if (!['all', 'mentions', 'none'].includes(string(input.notifications)))
          return refuse('validation', { notifications: 'invalid' })
        values.notifications = input.notifications
      }
      const id = hash(JSON.stringify([tx.scope.company, tx.actor, 'personal'])),
        P = tx.table('flow.UserPreference')
      const old = await tx.db.one(from(P).where(eq(P.companyId, tx.scope.company), eq(P.id, id)))
      const value = { ...((old?.value as Row) ?? {}), ...values }
      if (old) await cas(tx, 'flow.UserPreference', id, old.version, { value })
      else
        await tx.db.insert('flow.UserPreference', {
          id,
          userId: tx.actor,
          key: 'personal',
          value,
          version: 1,
        })
      // Personal: the record's own version settles races; no shared revision moves.
      return { ok: true }
    },
  )
}

export async function readInbox(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  return mutate(
    ctx,
    { name: 'flow.inbox.read', capability: 'member.read', input },
    extensions,
    async (tx) => {
      if (!Array.isArray(input.ids) || input.ids.length > 100 || input.ids.some((x) => typeof x !== 'string'))
        return refuse('validation', { ids: 'invalid' })
      const T = tx.table('flow.Inbox'),
        ids = [...new Set(input.ids)]
      const items = await tx.db.all(
        from(T)
          .where(eq(T.companyId, tx.scope.company), eq(T.recipientId, tx.actor), inArray(T.id, ids))
          .limit(100),
      )
      if (items.length !== ids.length) return refuse('forbidden')
      for (const item of items)
        if (item.taskId) {
          const task = await owned(tx, 'flow.Task', item.taskId)
          await requireCapability(tx, 'project.read', { projectId: task.projectId })
        }
      for (const item of items) await cas(tx, 'flow.Inbox', string(item.id), item.version, { read: true })
      // Personal: reading a notification moves no shared revision.
      return { ok: true }
    },
  )
}

export async function listInbox(ctx: Ctx, input: Row, allowedProjectIds?: unknown[]) {
  await requireCapability(ctx, 'member.read', {})
  const scope = allowedProjectIds ? null : await visibleScope(ctx)
  if (input.workspaceId && scope && !scope.workspaces.some((workspace) => workspace.id === input.workspaceId))
    return refuse('forbidden')
  const projectIds =
    allowedProjectIds ??
    scope!.projects
      .filter((project) => !input.workspaceId || project.workspaceId === input.workspaceId)
      .map((project) => project.id)
  const filter = string(input.filter) || 'unread'
  if (!['unread', 'all', 'mentions', 'action'].includes(filter))
    return refuse('validation', { filter: 'invalid' })
  const limit = limitOf(input.limit, 25)
  if (limit > 50) return refuse('validation', { limit: 'invalid' })
  const I = ctx.table('flow.Inbox')
  const base = from(I).where(
    eq(I.companyId, ctx.scope.company),
    eq(I.recipientId, ctx.actor),
    or(isNull(I.taskId), ...(projectIds.length ? [inArray(I.projectId, projectIds)] : [])),
  )
  let query =
    filter === 'unread'
      ? base.where(eq(I.read, false))
      : filter === 'mentions'
        ? base.where(eq(I.kind, 'mention'))
        : filter === 'action'
          ? base.where(eq(I.actionNeeded, true))
          : base
  const [total, unreadCount] = await Promise.all([
    ctx.db.count(query),
    ctx.db.count(base.where(eq(I.read, false))),
  ])
  const fence = hash(JSON.stringify([ctx.actor, ctx.scope.company, filter, projectIds.map(string).sort()]))
  if (input.cursor) {
    let cursor: Row
    try {
      cursor = JSON.parse(Buffer.from(string(input.cursor), 'base64url').toString())
    } catch {
      return refuse('validation', { cursor: 'invalid' })
    }
    if (!cursor || typeof cursor.at !== 'string' || typeof cursor.id !== 'string')
      return refuse('validation', { cursor: 'invalid' })
    if (cursor.fence !== fence) return refuse('conflict')
    query = query.where(or(lt(I.createdAt, cursor.at), and(eq(I.createdAt, cursor.at), lt(I.id, cursor.id))))
  }
  const rows = await ctx.db.all(query.orderBy(desc(I.createdAt), desc(I.id)).limit(limit + 1))
  const page = rows.slice(0, limit),
    T = ctx.table('flow.Task')
  const taskIds = page.map((note) => note.taskId).filter(Boolean)
  const tasks = taskIds.length
    ? await ctx.db.all(from(T).where(eq(T.companyId, ctx.scope.company), inArray(T.id, taskIds)).limit(limit))
    : []
  const items: Row[] = []
  for (const note of page) {
    const task = tasks.find((task) => task.id === note.taskId)
    if (note.taskId && !task) continue
    items.push({
      ...note,
      taskId: task?.key ?? null,
      projectId: task?.projectId ?? null,
      taskTitle: task?.title ?? null,
      description: note.body,
      actionNeeded: await notificationAction(ctx, note, task),
    })
  }
  const last = page.at(-1)
  return {
    items,
    total,
    unreadCount,
    filter,
    cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id, fence })).toString('base64url')
        : null,
  }
}

export async function operationsProjection(ctx: Ctx, projectIds: unknown[], route: string, input: Row = {}) {
  const a = await authority(ctx),
    P = ctx.table('flow.UserPreference'),
    V = ctx.table('flow.SavedView'),
    I = ctx.table('flow.Inbox')
  const personal = await ctx.db.one(
    from(P).where(eq(P.companyId, txCompany(ctx)), eq(P.userId, ctx.actor), eq(P.key, 'personal')),
  )
  const views = await ctx.db.all(
    from(V)
      .where(
        eq(V.companyId, ctx.scope.company),
        eq(V.archived, false),
        or(eq(V.ownerId, ctx.actor), ...(projectIds.length ? [inArray(V.projectId, projectIds)] : [])),
      )
      .orderBy(asc(V.title), asc(V.id))
      .limit(100),
  )
  const inboxPage = ['inbox', 'notifications'].includes(route)
    ? await listInbox(ctx, { filter: input.inboxFilter ?? 'unread' }, projectIds)
    : null
  const inboxUnreadCount = await ctx.db.count(
    from(I).where(
      eq(I.companyId, ctx.scope.company),
      eq(I.recipientId, ctx.actor),
      eq(I.read, false),
      or(isNull(I.taskId), ...(projectIds.length ? [inArray(I.projectId, projectIds)] : [])),
    ),
  )
  const favorites = await ctx.db.one(
    from(P).where(eq(P.companyId, ctx.scope.company), eq(P.userId, ctx.actor), eq(P.key, 'favorites')),
  )
  const result: Row = {
    projectFavorites: Array.isArray(favorites?.value)
      ? favorites.value.filter((id) => projectIds.includes(id))
      : [],
    operationsRevision: await revision(ctx, 'operations'),
    preferences: personal?.value ?? {},
    personalPreferences: personal?.value ?? {},
    views: views
      .filter((v) => v.ownerId === ctx.actor || (v.query as Row).visibility === 'project')
      .map((v) => ({ ...v, ...(v.query as Row), query: (v.query as Row).text })),
    inbox: inboxPage?.items ?? [],
    ...(inboxPage ? { inboxPage: { ...inboxPage, items: undefined } } : {}),
    inboxUnreadCount,
  }
  if (route.startsWith('form') && a.member?.role !== 'guest' && projectIds.length) {
    const F = ctx.table('flow.InternalForm'),
      R = ctx.table('flow.FormResponse'),
      U = ctx.table('user.User')
    const forms = await ctx.db.all(
      from(F)
        .where(eq(F.companyId, ctx.scope.company), inArray(F.projectId, projectIds), eq(F.archived, false))
        .orderBy(asc(F.title), asc(F.id))
        .limit(100),
    )
    const responses = await ctx.db.all(
      from(R)
        .where(
          eq(R.companyId, ctx.scope.company),
          inArray(
            R.formId,
            forms.map((f) => f.id),
          ),
        )
        .orderBy(desc(R.createdAt), desc(R.id))
        .limit(100),
    )
    const users = await ctx.db.all(
      from(U)
        .where(
          inArray(U.id, [
            ...new Set([
              ...forms.map((f) => (f.schema as Row).assigneeId),
              ...responses.map((r) => r.respondentId),
            ]),
          ]),
        )
        .limit(200),
    )
    const T = ctx.table('flow.Task'),
      tasks = await ctx.db.all(
        from(T)
          .where(
            eq(T.companyId, ctx.scope.company),
            inArray(
              T.id,
              responses.map((r) => r.taskId),
            ),
          )
          .select(T.id, T.key, T.title)
          .limit(100),
      )
    result.forms = await Promise.all(
      forms.map(async (f) => ({
        ...f,
        ...(f.schema as Row),
        status: f.state,
        assignee: users.find((u) => u.id === (f.schema as Row).assigneeId)?.name,
        responses: await ctx.db.count(from(R).where(eq(R.companyId, ctx.scope.company), eq(R.formId, f.id))),
      })),
    )
    result.formResponses = responses.map((r) => ({
      ...r,
      taskId: tasks.find((t) => t.id === r.taskId)?.key,
      title: tasks.find((t) => t.id === r.taskId)?.title,
      person: users.find((u) => u.id === r.respondentId)?.name,
      at: r.createdAt,
    }))
  }
  return result
}
const txCompany = (ctx: Ctx) => ctx.scope.company

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
      if (old.projectId) await requireCapability(tx, 'project.read', { projectId: old.projectId })
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
