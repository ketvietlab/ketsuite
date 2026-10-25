import { taskActivity } from './task-activity.ts'
import { readCatalog } from './catalog-read.ts'
import { taskCatalogs } from './task-catalogs.ts'
import { projectDefaultView } from './project-view.ts'
import { blockedCounts } from './blocked-counts.ts'
import { labelUsage } from './label-usage.ts'
import { gettingStartedState } from './getting-started.ts'
import { invitationOffer } from './access.ts'
import {
  and,
  asc,
  desc,
  eq,
  from,
  gte,
  lte,
  ilike,
  inArray,
  isNull,
  likeLiteral,
  or,
  lt,
  not,
} from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { authority, owned, rank, refuse, requireCapability, string } from './policy.ts'
import { hash, revision } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { listDocuments } from './documents.ts'
import { accessProjection } from './access.ts'
import { readAccess } from './access-read.ts'
import { operationsProjection } from './operations.ts'
import { taskFiles } from './attachments.ts'
import { decodeCustomFieldValue } from './field-values.ts'
import { contextOptionsHandler } from '../../user/functions/context.ts'
import { orderedTaskWindow, taskSort } from './task-read-order.ts'
import type { TaskPosition } from './task-read-order.ts'
import { sprintTaskTotals } from './sprint-totals.ts'
import { overviewPeople } from './overview-people.ts'
type VisibleProject = Row & { accessInfo: { role: string; sources: string[] } }
const projectNavigation = (p: Row, directory = false): Row => ({
  id: p.id,
  companyId: p.companyId,
  workspaceId: p.workspaceId,
  title: p.title,
  code: p.code,
  access: p.access,
  archived: p.archived,
  defaultView: projectDefaultView(p.defaultView),
  accessInfo: { role: (p.accessInfo as Row).role },
  ...(directory ? { ownerId: p.ownerId, end: p.end } : {}),
})

export async function taskByKey(ctx: Ctx, key: unknown) {
  const T = ctx.table('flow.Task')
  const task = await ctx.db.one(
    from(T).where(eq(T.companyId, ctx.scope.company), or(eq(T.key, string(key)), eq(T.id, string(key)))),
  )
  if (!task) return refuse('not_found')
  return task
}

export const limitOf = (value: unknown, fallback = 50) => {
  const n = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 100) return refuse('validation', { limit: 'invalid' })
  return n
}
export const summaryQuery = (ctx: Ctx) => {
  const T = ctx.table('flow.Task')
  return from(T).select(
    T.id,
    T.key,
    T.title,
    T.projectId,
    T.columnId,
    T.typeId,
    T.priority,
    T.points,
    T.due,
    T.start,
    T.parentId,
    T.epicId,
    T.sprintId,
    T.reporterId,
    T.sequence,
    T.version,
    T.archived,
    T.createdAt,
    T.updatedAt,
  )
}
const cursorOf = (value: unknown): TaskPosition | null => {
  if (!value) return null
  try {
    if (typeof value !== 'string' || value.length > 2048) return refuse('validation', { cursor: 'invalid' })
    const x = JSON.parse(Buffer.from(string(value), 'base64url').toString('utf8'))
    if (
      !Number.isSafeInteger(x.sequence) ||
      x.sequence < -2147483647 ||
      x.sequence > 2147483647 ||
      typeof x.id !== 'string' ||
      !x.id ||
      x.id.length > 200 ||
      typeof x.fence !== 'string' ||
      !/^[a-f0-9]{64}$/.test(x.fence) ||
      (x.due !== null &&
        (typeof x.due !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(x.due) ||
          !Number.isFinite(Date.parse(x.due)) ||
          new Date(x.due).toISOString().slice(0, 10) !== x.due)) ||
      !['urgent', 'high', 'normal'].includes(x.priority)
    )
      return refuse('validation', { cursor: 'invalid' })
    return x
  } catch {
    return refuse('validation', { cursor: 'invalid' })
  }
}

export async function visibleScope(ctx: Ctx) {
  const a = await authority(ctx)
  const W = ctx.table('flow.Workspace'),
    P = ctx.table('flow.ProjectRecord')
  if (!a.member) return { a, workspaces: [] as Row[], projects: [] as VisibleProject[] }
  const granted = (scope: string) =>
    a.grants
      .filter((g) => g.scope === scope && (rank[string(g.role)] ?? 0) > 0)
      .map((g) => string(g.targetId))
  const directProjectIds = granted('project')
  const directParents = directProjectIds.length
    ? await ctx.db.all(
        from(P)
          .where(eq(P.companyId, a.companyId), inArray(P.id, directProjectIds))
          .select(P.workspaceId)
          .limit(directProjectIds.length),
      )
    : []
  const grantedWorkspaces = [
    ...new Set([...granted('workspace'), ...directParents.map((p) => string(p.workspaceId))]),
  ]
  const workspaces = await ctx.db.all(
    from(W)
      .where(
        eq(W.companyId, a.companyId),
        ...(a.manageOrganization
          ? []
          : [
              eq(W.archived, false),
              or(
                inArray(W.id, grantedWorkspaces),
                ...(a.member.role === 'guest' ? [] : [eq(W.access, 'internal')]),
              ),
            ]),
      )
      .orderBy(asc(W.title), asc(W.id))
      .limit(501),
  )
  if (workspaces.length > 500) return refuse('limit')
  const inheritedWorkspaces = workspaces.filter((w) => a.workspaceRole(w)).map((w) => w.id)
  const projects = await ctx.db.all(
    from(P)
      .where(
        eq(P.companyId, a.companyId),
        isNull(P.deletionId),
        inArray(
          P.workspaceId,
          workspaces.filter((w) => !w.archived).map((w) => w.id),
        ),
        or(
          inArray(P.id, directProjectIds),
          and(eq(P.access, 'workspace'), inArray(P.workspaceId, inheritedWorkspaces)),
        ),
      )
      .orderBy(asc(P.title), asc(P.id))
      .limit(501),
  )
  if (projects.length > 500) return refuse('limit')
  const workspaceById = new Map(workspaces.map((x) => [string(x.id), x]))
  const visibleProjects = projects.flatMap<VisibleProject>((p) => {
    if (p.deletionId) return []
    const w = workspaceById.get(string(p.workspaceId))
    const role = w ? a.projectRole(p, w) : null
    return role ? [{ ...p, accessInfo: { role, sources: [] } }] : []
  })
  const parents = new Set(visibleProjects.map((p) => p.workspaceId))
  return {
    a,
    workspaces: workspaces.filter((w) => a.workspaceRole(w) || parents.has(w.id) || a.manageOrganization),
    projects: visibleProjects,
  }
}

export async function taskDTOs(ctx: Ctx, tasks: Row[], detail = false) {
  if (!tasks.length) return []
  const ids = tasks.map((t) => string(t.id))
  const A = ctx.table('flow.TaskAssignee'),
    L = ctx.table('flow.TaskLabel'),
    V = ctx.table('flow.TaskFieldValue'),
    F = ctx.table('flow.TaskFollower'),
    T = ctx.table('flow.Task'),
    S = ctx.table('flow.SprintRecord'),
    E = ctx.table('flow.EpicRecord'),
    TTY = ctx.table('flow.TaskType'),
    U = ctx.table('user.User'),
    R = ctx.table('flow.TaskRelation')
  const [assignments, labels, values, followers] = await Promise.all([
    ctx.db.all(
      from(A)
        .where(inArray(A.taskId, ids), eq(A.companyId, ctx.scope.company))
        .limit(ids.length * 30 + 1),
    ),
    ctx.db.all(
      from(L)
        .where(inArray(L.taskId, ids), eq(L.companyId, ctx.scope.company))
        .limit(ids.length * 30 + 1),
    ),
    detail
      ? ctx.db.all(
          from(V)
            .where(inArray(V.taskId, ids), eq(V.companyId, ctx.scope.company))
            .limit(ids.length * 200 + 1),
        )
      : [],
    ctx.db.all(
      from(F)
        .where(inArray(F.taskId, ids), eq(F.userId, ctx.actor), eq(F.companyId, ctx.scope.company))
        .limit(100),
    ),
  ])
  if (
    assignments.length > ids.length * 30 ||
    labels.length > ids.length * 30 ||
    values.length > ids.length * 200
  )
    return refuse('limit')
  const parentIds = [...new Set(tasks.map((t) => string(t.parentId)).filter(Boolean))]
  const parents = parentIds.length
    ? await ctx.db.all(
        from(T)
          .where(inArray(T.id, parentIds), eq(T.companyId, ctx.scope.company))
          .select(T.id, T.key, T.projectId)
          .limit(100),
      )
    : []
  const parentRows = new Map(parents.map((t) => [t.id, t]))
  const userIds = [...new Set(assignments.map((x) => x.userId))]
  const sprintIds = [...new Set(tasks.map((t) => t.sprintId).filter(Boolean))]
  const epicIds = [...new Set(tasks.map((t) => t.epicId).filter(Boolean))]
  const typeIds = [...new Set(tasks.map((t) => t.typeId).filter(Boolean))]
  const [users, sprints, _epics, types, relations] = await Promise.all([
    userIds.length
      ? ctx.db.all(from(U).where(inArray(U.id, userIds)).select(U.id, U.name).limit(userIds.length))
      : [],
    sprintIds.length
      ? ctx.db.all(
          from(S)
            .where(eq(S.companyId, ctx.scope.company), inArray(S.id, sprintIds))
            .select(S.id, S.title)
            .limit(100),
        )
      : [],
    epicIds.length
      ? ctx.db.all(
          from(E)
            .where(eq(E.companyId, ctx.scope.company), inArray(E.id, epicIds))
            .select(E.id, E.title)
            .limit(100),
        )
      : [],
    typeIds.length
      ? ctx.db.all(
          from(TTY)
            .where(eq(TTY.companyId, ctx.scope.company), inArray(TTY.id, typeIds))
            .select(TTY.id, TTY.code, TTY.title, TTY.icon, TTY.projectId)
            .limit(typeIds.length),
        )
      : [],
    ctx.db.all(
      from(R)
        .where(eq(R.companyId, ctx.scope.company), inArray(R.targetId, ids), eq(R.kind, 'blocks'))
        .limit(ids.length * 100 + 1),
    ),
  ])
  if (relations.length > ids.length * 100) return refuse('limit')
  const blockerIds = [...new Set(relations.map((r) => r.taskId))]
  const blockers = blockerIds.length
    ? await ctx.db.all(
        from(T)
          .where(eq(T.companyId, ctx.scope.company), inArray(T.id, blockerIds))
          .select(T.id, T.key, T.projectId, T.columnId, T.archived)
          .limit(blockerIds.length),
      )
    : []
  const BStatus = ctx.table('flow.TaskStatus')
  const blockerStatusIds = [...new Set(blockers.map((b) => b.columnId))]
  const blockerStates = blockerStatusIds.length
    ? await ctx.db.all(
        from(BStatus)
          .where(eq(BStatus.companyId, ctx.scope.company), inArray(BStatus.id, blockerStatusIds))
          .select(BStatus.id, BStatus.kind)
          .limit(blockerStatusIds.length),
      )
    : []
  const terminal = new Set(
    blockerStates.filter((s) => ['done', 'cancelled'].includes(string(s.kind))).map((s) => s.id),
  )
  const blockerById = new Map(blockers.map((b) => [b.id, b]))
  const blockersByTarget = new Map<unknown, Row[]>()
  for (const relation of relations) {
    const source = blockerById.get(relation.taskId)
    if (source) {
      const list = blockersByTarget.get(relation.targetId) ?? []
      list.push(source)
      blockersByTarget.set(relation.targetId, list)
    }
  }
  const dependenciesOf = (task: Row, active: boolean) =>
    (blockersByTarget.get(task.id) ?? []).filter(
      (b) => b.projectId === task.projectId && (!active || (!b.archived && !terminal.has(b.columnId))),
    )
  // Joins above can finish after a transfer. Drop summaries whose captured
  // owner changed; a detail retries rather than mixing two projects' data.
  const currentOwners = await ctx.db.all(
    from(T)
      .where(eq(T.companyId, ctx.scope.company), inArray(T.id, ids))
      .select(T.id, T.projectId)
      .limit(tasks.length),
  )
  const stable = tasks.filter((t) => currentOwners.some((r) => r.id === t.id && r.projectId === t.projectId))
  if (detail && stable.length !== tasks.length) return refuse('conflict')
  const statusIds = [...new Set(stable.map((task) => task.columnId).filter(Boolean))]
  const currentStatuses = statusIds.length
    ? await ctx.db.all(
        from(BStatus)
          .where(eq(BStatus.companyId, ctx.scope.company), inArray(BStatus.id, statusIds))
          .select(BStatus.id, BStatus.title, BStatus.kind, BStatus.color, BStatus.projectId)
          .limit(statusIds.length),
      )
    : []
  const definitions = new Map(currentStatuses.map((item) => [item.id, item]))
  const statusDefinition = (task: Row) => {
    const definition = definitions.get(task.columnId)
    if (!definition || (definition.projectId && definition.projectId !== task.projectId)) return undefined
    return { id: definition.id, label: definition.title, kind: definition.kind, color: definition.color }
  }
  const labelIds = [...new Set(labels.map((label) => label.labelId))]
  const Label = ctx.table('flow.Label')
  const labelDefinitions = labelIds.length
    ? await ctx.db.all(
        from(Label)
          .where(eq(Label.companyId, ctx.scope.company), inArray(Label.id, labelIds))
          .select(Label.id, Label.title, Label.color, Label.archived, Label.projectId)
          .limit(labelIds.length),
      )
    : []
  const labelById = new Map(labelDefinitions.map((label) => [label.id, label]))
  const typeDefinition = (task: Row) => {
    const definition = types.find(
      (item) => item.id === task.typeId && (!item.projectId || item.projectId === task.projectId),
    )
    return definition
      ? { id: definition.id, code: definition.code, title: definition.title, icon: definition.icon }
      : undefined
  }
  return stable.map((t) => ({
    id: t.key,
    title: t.title,
    projectId: t.projectId,
    columnId: t.columnId,
    statusDefinition: statusDefinition(t),
    typeId: t.typeId,
    typeDefinition: typeDefinition(t),
    priority: t.priority,
    points: Number(t.points),
    dueDate: t.due,
    startDate: t.start,
    parentId: parentRows.get(t.parentId)?.projectId === t.projectId ? parentRows.get(t.parentId)?.key : null,
    epicId: t.epicId,
    sprintId: t.sprintId,
    reporterId: t.reporterId,
    sequence: t.sequence,
    order: t.sequence,
    version: t.version,
    archived: t.archived,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    summary: !detail,
    ...(detail
      ? { description: t.description, descriptionDoc: t.descriptionDoc, checklist: t.checklist }
      : {}),
    ...(detail ? { documentTransport: { base: '/flow/live/issues', docId: t.key } } : {}),
    assigneeIds: assignments.filter((x) => x.taskId === t.id).map((x) => x.userId),
    assignees: users.filter((u) => assignments.some((x) => x.taskId === t.id && x.userId === u.id)),
    tagIds: labels.filter((x) => x.taskId === t.id).map((x) => x.labelId),
    tagDefinitions: labels
      .filter((link) => link.taskId === t.id)
      .flatMap((link) => {
        const label = labelById.get(link.labelId)
        return label && (!label.projectId || label.projectId === t.projectId)
          ? [{ id: label.id, title: label.title, color: label.color, archived: label.archived }]
          : []
      }),
    ...(detail
      ? {
          fieldValues: Object.fromEntries(
            values
              .filter((x) => x.taskId === t.id)
              .map((x) => [string(x.fieldId), decodeCustomFieldValue(x.value)]),
          ),
          customFields: Object.fromEntries(
            values
              .filter((x) => x.taskId === t.id)
              .map((x) => [string(x.fieldId), decodeCustomFieldValue(x.value)]),
          ),
        }
      : {}),
    following: followers.some((x) => x.taskId === t.id),
    followed: followers.some((x) => x.taskId === t.id),
    status: t.columnId,
    type: typeDefinition(t)?.code ?? t.typeId,
    sprint: sprints.find((s) => s.id === t.sprintId)?.title ?? 'Backlog',
    epic: t.epicId ?? null,
    tags: labels.filter((x) => x.taskId === t.id).map((x) => x.labelId),
    blocked: dependenciesOf(t, true).length > 0,
    blockerCount: dependenciesOf(t, true).length,
    blockedBy: (detail ? dependenciesOf(t, false) : dependenciesOf(t, true).slice(0, 3)).map((b) => b.key),
    assignee: users
      .filter((u) => assignments.some((x) => x.taskId === t.id && x.userId === u.id))
      .map((u) => u.name)
      .join(', '),
  }))
}

export async function listTasks(ctx: Ctx, input: Row, extensions: NativeServerExtension[] = []) {
  const { a, projects, workspaces } = await visibleScope(ctx)
  if (input.projectId && !projects.some((project) => project.id === input.projectId))
    return refuse('forbidden')
  if (input.workspaceId && !workspaces.some((workspace) => workspace.id === input.workspaceId))
    return refuse('forbidden')
  if (!a.member) return { tasks: [], total: 0, cursor: null, statusCounts: {} }
  const selected = projects
    .filter((p) => !input.projectId || p.id === input.projectId)
    .filter((p) => !input.workspaceId || p.workspaceId === input.workspaceId)
  if (input.projectId && !selected.length) return refuse('forbidden')
  if (!selected.length) return { tasks: [], total: 0, cursor: null, statusCounts: {} }
  const projectIds = selected.map((p) => p.id),
    T = ctx.table('flow.Task'),
    A = ctx.table('flow.TaskAssignee')
  const personal = input.route === 'my-work' || input.mine === true
  const planning =
    input.sprintId !== undefined ||
    input.backlog === true ||
    input.epicId !== undefined ||
    input.milestonesOnly === true
  if (
    (input.unfinishedOnly === true && personal) ||
    (planning &&
      (!input.projectId ||
        personal ||
        (input.sprintId && input.backlog) ||
        (input.milestonesOnly && !input.epicId)))
  )
    return refuse('validation', { projectId: 'planning_scope' })
  const sort = taskSort(input.sort)
  const hasDateWindow = input.dueFrom !== undefined || input.dueTo !== undefined
  const valid = (value: unknown) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  if (
    input.dueBefore !== undefined &&
    (!valid(input.dueBefore) || hasDateWindow || input.includeUndated !== undefined)
  )
    return refuse('validation', { dueBefore: 'invalid_range' })
  if (hasDateWindow) {
    const span = Date.parse(string(input.dueTo)) - Date.parse(string(input.dueFrom))
    if (!valid(input.dueFrom) || !valid(input.dueTo) || span < 0 || span > 41 * 86400000)
      return refuse('validation', { dueFrom: 'invalid_range' })
  } else if (input.includeUndated !== undefined) return refuse('validation', { dueFrom: 'required' })
  const archive = ['archive', 'issues-archived'].includes(string(input.route)) || input.archived === true
  const fence = hash(
    JSON.stringify([
      a.companyId,
      a.actorId,
      projectIds.map(String).sort(),
      personal,
      archive,
      input.columnId ?? '',
      input.status ?? 'all',
      string(input.query),
      sort,
      input.dueFrom ?? '',
      input.dueTo ?? '',
      input.includeUndated === true,
      input.dueBefore ?? '',
      input.sprintId ?? '',
      input.backlog === true,
      input.unfinishedOnly === true,
      input.epicId ?? '',
      input.milestonesOnly === true,
      await revision(ctx, 'collection-change'),
      await revision(ctx, 'task-order'),
    ]),
  )
  const table = personal ? A : T
  let query = (personal ? from(A) : summaryQuery(ctx)).where(
    eq(table.companyId, a.companyId),
    inArray(table.projectId, projectIds),
    eq(table.archived, archive),
  )
  if (personal) {
    query = query.where(eq(A.userId, a.actorId))
    // Optional physical columns allow a safe upgrade. Reads refuse a pending
    // backfill instead of silently dropping old assignments from sorted pages.
    if (await ctx.db.one(query.where(isNull(A.priority)).limit(1))) return refuse('unavailable')
  }
  if (input.columnId) query = query.where(eq(table.columnId, input.columnId))
  if (input.epicId) query = query.where(eq(T.epicId, input.epicId))
  if (input.milestonesOnly === true) {
    const TY = ctx.table('flow.TaskType')
    const types = await ctx.db.all(
      from(TY)
        .where(
          eq(TY.companyId, a.companyId),
          eq(TY.code, 'milestone'),
          or(isNull(TY.projectId), inArray(TY.projectId, projectIds)),
        )
        .select(TY.id),
    )
    query = query.where(
      inArray(
        T.typeId,
        types.map((t) => t.id),
      ),
    )
  }
  if (input.sprintId) query = query.where(eq(T.sprintId, input.sprintId))
  if (input.backlog === true) query = query.where(isNull(T.sprintId))
  if (input.unfinishedOnly === true) {
    const S = ctx.table('flow.TaskStatus')
    const done = await ctx.db.all(
      from(S)
        .where(
          eq(S.companyId, a.companyId),
          eq(S.kind, 'done'),
          or(isNull(S.projectId), inArray(S.projectId, projectIds)),
        )
        .select(S.id),
    )
    if (done.length)
      query = query.where(
        not(
          inArray(
            T.columnId,
            done.map((s) => s.id),
          ),
        ),
      )
  }
  if (input.dueBefore !== undefined) query = query.where(lt(table.due, input.dueBefore))
  if (hasDateWindow) {
    const window = and(gte(table.due, input.dueFrom), lte(table.due, input.dueTo))
    query = query.where(input.includeUndated === true ? or(window, isNull(table.due)) : window)
  }
  if (input.status && input.status !== 'all') query = query.where(eq(table.columnId, input.status))
  if (string(input.query)) {
    const pattern = '%' + likeLiteral(string(input.query)) + '%'
    // Filtering happens before counts and the cursor, never on a page already cut.
    query = query.where(or(ilike(table.title, pattern), ilike(table.key, pattern)))
  }
  // The status groups partition exactly this authorized, filtered collection.
  // Derive its total from that same aggregate instead of scanning every task a
  // second time; this also keeps total/status counts on one database snapshot.
  const groups = await ctx.db.group(query.groupBy({ col: table.columnId }))
  const total = groups.reduce((sum, group) => sum + Number(group.count), 0)
  const S = ctx.table('flow.TaskStatus')
  const states = await ctx.db.all(
    from(S)
      .where(
        eq(S.companyId, a.companyId),
        inArray(
          S.id,
          groups.map((g) => g.key[0]),
        ),
      )
      .select(S.id, S.kind),
  )
  const statusCounts = Object.fromEntries(groups.map((g) => [string(g.key[0]), Number(g.count)]))
  const countKind = (kind: string) =>
    states.filter((s) => s.kind === kind).reduce((sum, s) => sum + (statusCounts[string(s.id)] ?? 0), 0)
  const metrics: Row = {
    total: Number(total),
    progress: countKind('progress'),
    review: countKind('review'),
    done: countKind('done'),
  }
  let projectMetrics: Record<string, Row> | undefined
  let deadlineCounts: Row | undefined
  let peopleMetrics: Awaited<ReturnType<typeof overviewPeople>> | undefined
  {
    const C = ctx.table('company.Company')
    const company = await ctx.db.one(from(C).where(eq(C.id, a.companyId)).select(C.accountingTimezone))
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: string(company?.accountingTimezone) || 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const part = (name: string) => parts.find((p) => p.type === name)?.value
    const today = `${part('year')}-${part('month')}-${part('day')}`
    const doneIds = states.filter((s) => s.kind === 'done').map((s) => s.id)
    const overdueQuery = query.where(
      lt(table.due, today),
      ...(doneIds.length ? [not(inArray(table.columnId, doneIds))] : []),
    )
    metrics.overdue = Number(await ctx.db.count(overdueQuery))
    if (input.route === 'workspace-overview') {
      peopleMetrics = await overviewPeople(ctx, projectIds, today)
      const dayAt = (offset: number) =>
        new Date(Date.parse(today + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10)
      const dueGroups = await ctx.db.group(
        query
          .where(
            gte(table.due, today),
            lt(table.due, dayAt(14)),
            ...(doneIds.length ? [not(inArray(table.columnId, doneIds))] : []),
          )
          .groupBy({ col: table.due }),
      )
      const byDay = new Map(dueGroups.map((g) => [string(g.key[0]), Number(g.count)]))
      const days = Object.fromEntries(
        Array.from({ length: 14 }, (_, i) => [dayAt(i), byDay.get(dayAt(i)) ?? 0]),
      )
      deadlineCounts = {
        today,
        overdue: metrics.overdue,
        days,
        dueSoon: Array.from({ length: 7 }, (_, i) => byDay.get(dayAt(i)) ?? 0).reduce((sum, n) => sum + n, 0),
      }
      const [projectGroups, overdueGroups] = await Promise.all([
        ctx.db.group(query.groupBy({ col: T.projectId }, { col: T.columnId })),
        ctx.db.group(overdueQuery.groupBy({ col: T.projectId })),
      ])
      projectMetrics = Object.fromEntries(
        selected.map((p) => [
          string(p.id),
          {
            total: 0,
            todo: 0,
            progress: 0,
            review: 0,
            done: 0,
            overdue: 0,
          },
        ]),
      )
      const kindById = new Map(states.map((s) => [s.id, string(s.kind)]))
      for (const group of projectGroups) {
        const current = projectMetrics[string(group.key[0])]
        if (!current) continue
        current.total = Number(current.total) + Number(group.count)
        const kind = kindById.get(group.key[1])
        if (kind && ['todo', 'progress', 'review', 'done'].includes(kind))
          current[kind] = Number(current[kind]) + Number(group.count)
      }
      for (const group of overdueGroups)
        if (projectMetrics[string(group.key[0])])
          projectMetrics[string(group.key[0])]!.overdue = Number(group.count)
    }
  }
  const cursor = cursorOf(input.cursor),
    limit = limitOf(input.limit)
  if (cursor && cursor.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
  const rows = await orderedTaskWindow(ctx, query, table, sort, cursor, limit)
  const page = rows.slice(0, limit)
  const records =
    personal && page.length
      ? await ctx.db.all(
          summaryQuery(ctx)
            .where(
              eq(T.companyId, a.companyId),
              inArray(T.projectId, projectIds),
              eq(T.archived, archive),
              inArray(
                T.id,
                page.map((r) => r.taskId),
              ),
            )
            .limit(limit),
        )
      : page
  const ordered = personal ? page.flatMap((r) => records.filter((t) => t.id === r.taskId)) : records
  const last = page.at(-1)
  const result: Row = {
    tasks: await taskDTOs(ctx, ordered),
    total,
    cursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              sequence: last.sequence,
              id: last.id,
              due: last.due,
              priority: last.priority,
              fence,
            }),
          ).toString('base64url')
        : null,
    statusCounts,
    metrics,
    ...(projectMetrics ? { projectMetrics } : {}),
    ...(deadlineCounts ? { deadlineCounts } : {}),
    ...(peopleMetrics ? { peopleMetrics } : {}),
  }
  for (const extension of extensions) {
    const projection = await extension.projection?.(ctx, string(input.route), result.tasks as Row[], {
      input,
      projectIds,
      workspaceIds: [...new Set(selected.map((p) => p.workspaceId))],
    })
    for (const [key, value] of Object.entries(projection ?? {})) {
      if (Object.hasOwn(result, key)) throw new Error(`Flow projection field already owned: ${key}`)
      result[key] = value
    }
  }
  return result
}

export async function projectOptions(ctx: Ctx, input: Row) {
  const { a, projects, workspaces } = await visibleScope(ctx)
  if (input.workspaceId && !workspaces.some((w) => w.id === input.workspaceId)) return refuse('forbidden')
  const query = string(input.query).trim().toLocaleLowerCase('en-US')
  if (query.length > 1000) return refuse('validation', { query: 'too_long' })
  const limit = limitOf(input.limit, 25)
  if (limit > 50) return refuse('validation', { limit: 'invalid' })
  // Inheriting projects are counted by the server, past the projects a screen loaded.
  const access = input.access === undefined || input.access === null ? '' : string(input.access)
  if (access && access !== 'workspace' && access !== 'private')
    return refuse('validation', { access: 'invalid' })
  const fence = hash(
    JSON.stringify([
      a.actorId,
      a.companyId,
      query,
      input.workspaceId ?? '',
      access,
      Boolean(input.manage),
      Boolean(input.directory),
      await revision(ctx),
      projects
        .map((p) => [p.id, p.title, p.code, p.workspaceId, p.archived, p.version, p.accessInfo.role])
        .sort((a, b) => string(a[0]).localeCompare(string(b[0]))),
    ]),
  )
  const records = projects
    .filter(
      (p) =>
        !p.archived &&
        (!input.workspaceId || p.workspaceId === input.workspaceId) &&
        (!access || p.access === access) &&
        // `manage` keeps the projects whose access the actor may change, as access.grant checks.
        (!input.manage || a.manageOrganization || (rank[p.accessInfo.role] ?? 0) >= 3) &&
        (!query || (string(p.title) + ' ' + string(p.code)).toLocaleLowerCase('en-US').includes(query)),
    )
    .sort(
      (a, b) =>
        string(a.title).localeCompare(string(b.title), 'en-US') || string(a.id).localeCompare(string(b.id)),
    )
  let start = 0
  if (input.cursor) {
    let held: Row
    try {
      held = JSON.parse(Buffer.from(string(input.cursor), 'base64url').toString())
    } catch {
      return refuse('validation', { cursor: 'invalid' })
    }
    if (!held || typeof held !== 'object' || typeof held.id !== 'string' || typeof held.fence !== 'string')
      return refuse('validation', { cursor: 'invalid' })
    if (held.fence !== fence) return refuse('conflict')
    start = records.findIndex((p) => p.id === held.id) + 1
    if (!start) return refuse('conflict')
  }
  const page = records.slice(start, start + limit)
  return {
    items: page.map((p) =>
      input.directory
        ? projectNavigation(p, true)
        : { id: p.id, code: p.code, title: p.title, workspaceId: p.workspaceId },
    ),
    total: records.length,
    cursor:
      start + page.length < records.length
        ? Buffer.from(JSON.stringify({ id: page.at(-1)!.id, fence })).toString('base64url')
        : null,
  }
}

export async function taskDetail(ctx: Ctx, input: Row, extensions: NativeServerExtension[] = []) {
  const task = await taskByKey(ctx, input.id)
  await requireCapability(ctx, 'project.read', { projectId: task.projectId })
  const [comments, history, dto] = await Promise.all([
    taskActivity(ctx, { id: task.id, kind: 'comments' }),
    taskActivity(ctx, { id: task.id, kind: 'history' }),
    taskDTOs(ctx, [task], true),
  ])
  const value: Row = {
    task: {
      ...dto[0],
      catalogs: await taskCatalogs(ctx, task.projectId),
      activityPages: {
        comments: { total: comments.total, cursor: comments.cursor },
        history: { total: history.total, cursor: history.cursor },
      },
    },
    comments: comments.items.reverse(),
    history: history.items,
    files: await taskFiles(ctx, task),
  }
  for (const extension of extensions) {
    const extra = (await extension.detail?.(ctx, task)) ?? {}
    for (const [key, record] of Object.entries(extra)) {
      if (Object.hasOwn(value, key)) throw new Error(`Duplicate Flow detail owner: ${key}`)
      value[key] = record
    }
  }
  const current = await owned(ctx, 'flow.Task', task.id)
  await requireCapability(ctx, 'project.read', { projectId: current.projectId })
  if (current.projectId !== task.projectId) return refuse('conflict')
  return value
}

export async function bootstrap(ctx: Ctx, input: Row, extensions: NativeServerExtension[] = []) {
  const { a, projects, workspaces } = await visibleScope(ctx)
  if (input.companyId && input.companyId !== a.companyId) return refuse('forbidden')
  const C = ctx.table('company.Company'),
    P = ctx.table('partner.Partner')
  const company = await ctx.db.one(from(C).where(eq(C.id, a.companyId)))
  if (!company) return refuse('forbidden')
  const partner = await ctx.db.one(from(P).where(eq(P.id, company.partnerId)))
  const target = input.projectId ? projects.find((p) => p.id === input.projectId) : null
  if (input.projectId && !target) return refuse('forbidden')
  if (input.workspaceId && !workspaces.some((w) => w.id === input.workspaceId)) return refuse('forbidden')
  const workspaceId =
    target?.workspaceId ?? (input.workspaceId || workspaces.find((w) => !w.archived)?.id || '')
  const settings = a.member ? await owned(ctx, 'flow.CompanySettings', a.companyId) : null
  const contexts = await contextOptionsHandler(ctx, { userId: a.actorId })
  const navigation = projects.filter((p) => !p.archived && p.workspaceId === workspaceId).slice(0, 50)
  const fullProject = (p: Row) => ({
    ...p,
    ...(p.catalogOverrides as Row),
    defaultView: projectDefaultView(p.defaultView),
    description: ['project-profile', 'settings'].includes(string(input.route)) ? p.description : '',
  })
  const projectRows = (records: VisibleProject[]) =>
    records.map((p) => (p.id === target?.id ? fullProject(p) : projectNavigation(p)))
  if (target && !navigation.some((p) => p.id === target.id)) navigation.push(target)
  const value: Row = {
    company: {
      id: company.id,
      name: settings?.title || partner?.name || company.code,
      version: settings?.version,
      acceptanceEnabled: settings?.acceptanceEnabled ?? false,
    },
    companies: 'companies' in contexts ? contexts.companies.map((c) => ({ id: c.id, name: c.name })) : [],
    // The actor's own Teams are always whole: access checks for the actor read them.
    user: {
      id: a.actorId,
      name: a.user.name,
      avatarUrl: a.user.avatarUrl ?? null,
      teamIds: a.teams.map((t) => t.id),
    },
    workspaces,
    projects: projectRows(navigation),
    members: a.member
      ? [
          {
            ...a.member,
            id: a.actorId,
            name: a.user.name,
            email: a.user.email,
            teamIds: a.teams.map((t) => t.id),
          },
        ]
      : [],
    people: [a.user.name],
    teams: a.teams.map((t) => ({ ...t, archived: false })),
    grants: a.grants,
    organizationRevision: await revision(ctx),
    taskOrderRevision: await revision(ctx, 'task-order'),
    context: { companyId: a.companyId, workspaceId, projectId: target?.id ?? null },
    capabilities: {
      write: Boolean(a.member && a.member.role !== 'guest' && target?.accessInfo?.role !== 'viewer'),
      manageOrganization: a.manageOrganization || (await a.canInitialize()),
    },
    columns: [],
    taskTypes: [],
    types: [],
    tags: [],
    fields: [],
    tasks: [],
    comments: [],
    history: [],
    files: [],
    pages: [],
    sprints: [],
    epics: [],
    forms: [],
    formResponses: [],
    views: [],
    inbox: [],
    invitations: [],
    projectFavorites: [],
    recentProjects: [],
    preferences: {},
    auth: { signedIn: true, mustChangePassword: false },
    problem: null,
    timezone: company.accountingTimezone ?? 'Asia/Ho_Chi_Minh',
  }
  if (input.route === 'invitation-accept') value.invitationOffer = await invitationOffer(ctx, input.recordId)
  if (!a.member) return value
  if (input.shellOnly === true) {
    Object.assign(
      value,
      await operationsProjection(
        ctx,
        projects.map((p) => p.id),
        '',
        input,
      ),
    )
    for (const extension of extensions) {
      const extra = await extension.projection?.(ctx, string(input.route), [], {
        input,
        projectIds: target ? [target.id] : projects.map((p) => p.id),
        workspaceIds: workspaces.map((w) => w.id),
      })
      for (const [key, data] of Object.entries(extra ?? {})) {
        if (Object.hasOwn(value, key)) throw new Error(`Duplicate Flow projection owner: ${key}`)
        value[key] = data
      }
    }
    return value
  }
  if (
    a.member.role === 'guest' &&
    [
      'settings',
      'project-profile',
      'project-members',
      'project-move',
      'forms',
      'workspace-settings',
      'workspace-members',
      'organization',
      'organization-members',
      'permissions',
      'teams',
    ].includes(string(input.route))
  )
    return refuse('forbidden')
  if (a.member.role !== 'guest') Object.assign(value, await accessProjection(ctx, input))
  // The access screens carry their first page; the list itself is computed by the server.
  const accessTarget =
    input.route === 'project-members' && target
      ? { scope: 'project', targetId: target.id }
      : input.route === 'workspace-members' && workspaceId
        ? { scope: 'workspace', targetId: workspaceId }
        : null
  if (accessTarget && a.member.role !== 'guest') {
    const page = await readAccess(ctx, { ...accessTarget, limit: 50 })
    value.accessPage = { ...accessTarget, ...page, loadedIds: page.items.map((m) => m.id) }
  }
  const projectIds = projects.map((p) => p.id)
  const selectedIds = input.projectId
    ? [input.projectId]
    : projects.filter((p) => !input.workspaceId || p.workspaceId === input.workspaceId).map((p) => p.id)
  Object.assign(value, await operationsProjection(ctx, selectedIds, string(input.route), input))
  let detail: Row | undefined
  const standalone = ['inbox', 'notifications', 'personal-settings'].includes(string(input.route))
  if (!standalone) {
    if (selectedIds.length) {
      const S = ctx.table('flow.SprintRecord'),
        E = ctx.table('flow.EpicRecord')
      const sprintMetadata = from(S).select(
        S.id,
        S.companyId,
        S.projectId,
        S.title,
        S.goal,
        S.start,
        S.end,
        S.state,
        S.version,
        S.archived,
        S.createdAt,
        S.updatedAt,
      )
      const [sprints, epics] = await Promise.all([
        ctx.db.all(
          sprintMetadata
            .where(eq(S.companyId, ctx.scope.company), inArray(S.projectId, selectedIds))
            .orderBy(desc(S.start), desc(S.id))
            .limit(100),
        ),
        ctx.db.all(
          from(E)
            .where(eq(E.companyId, ctx.scope.company), inArray(E.projectId, selectedIds))
            .orderBy(asc(E.title), asc(E.id))
            .limit(100),
        ),
      ])
      if (input.projectId && ['sprints', 'sprint-close', 'sprint-report'].includes(string(input.route))) {
        const pinned = await ctx.db.one(
          sprintMetadata
            .where(
              eq(S.companyId, a.companyId),
              eq(S.projectId, input.projectId),
              eq(S.archived, false),
              input.recordId ? eq(S.id, input.recordId) : eq(S.state, 'active'),
            )
            .limit(1),
        )
        if (pinned && !sprints.some((s) => s.id === pinned.id)) sprints.push(pinned)
      }
      if (
        input.projectId &&
        input.recordId &&
        ['epic', 'epic-new', 'epic-map'].includes(string(input.route))
      ) {
        const pinned = await ctx.db.one(
          from(E)
            .where(
              eq(E.companyId, a.companyId),
              eq(E.projectId, input.projectId),
              eq(E.archived, false),
              eq(E.id, input.recordId),
            )
            .limit(1),
        )
        if (pinned && !epics.some((e) => e.id === pinned.id)) epics.push(pinned)
      }
      const totals = ['sprints', 'sprint-close', 'workspace-overview'].includes(string(input.route))
        ? await sprintTaskTotals(ctx, sprints)
        : undefined
      value.sprints = sprints.map((s) => ({
        ...s,
        description: s.goal,
        ...(totals ? { taskTotals: totals[String(s.id)] } : {}),
      }))
      const ownerIds = [...new Set(epics.map((e) => e.ownerId).filter(Boolean))]
      const U = ctx.table('user.User')
      const owners = ownerIds.length
        ? await ctx.db.all(from(U).where(inArray(U.id, ownerIds)).limit(100))
        : []
      value.epics = epics.map((e) => ({ ...e, owner: owners.find((u) => u.id === e.ownerId)?.name ?? '' }))
    }
    const catalog = async (model: string) => {
      const T = ctx.table(model)
      const kind = (
        {
          'flow.TaskStatus': 'column',
          'flow.TaskType': 'type',
          'flow.Label': 'tag',
          'flow.CustomField': 'field',
        } as Record<string, string>
      )[model]!
      const collection = (
        { column: 'columns', type: 'types', tag: 'tags', field: 'fields' } as Record<string, string>
      )[kind]!
      const library =
        !target &&
        ['organization-settings', 'tags', 'column-edit', 'type-edit', 'tag-edit', 'field-edit'].includes(
          string(input.route),
        )
      if (library) {
        const page = await readCatalog(ctx, { kind, limit: 50 })
        value.catalogPages ??= {}
        ;(value.catalogPages as Row)[collection] = {
          total: page.total,
          cursor: page.cursor,
          loadedIds: page.items.map((item) => item.id),
        }
        if (input.route === `${kind}-edit` && input.recordId) {
          const pinned = await ctx.db.one(
            from(T)
              .where(
                eq(T.companyId, a.companyId),
                or(isNull(T.projectId), inArray(T.projectId, projectIds)),
                eq(T.id, input.recordId),
                ...(kind === 'tag' ? [] : [eq(T.archived, false)]),
              )
              .limit(1),
          )
          if (pinned) {
            page.items = [...page.items.filter((item) => item.id !== pinned.id), pinned]
            if (pinned.projectId && !navigation.some((project) => project.id === pinned.projectId)) {
              const owner = projects.find((project) => project.id === pinned.projectId)
              if (owner) navigation.push(owner)
            }
          }
        }
        return page.items
      }
      if (target) {
        // A visible but unrelated project's definitions must not evict the
        // current project's choices. Keep each scope bounded, and fail explicitly
        // on overflow instead of returning a valid-looking partial catalog.
        const windows = await Promise.all(
          [isNull(T.projectId), eq(T.projectId, target.id)].map((scope) =>
            ctx.db.all(
              from(T)
                .where(
                  eq(T.companyId, a.companyId),
                  scope,
                  ...(model === 'flow.Label' && ['tags', 'tag-edit'].includes(string(input.route))
                    ? []
                    : [eq(T.archived, false)]),
                )
                .orderBy(asc(T.sequence), asc(T.id))
                .limit(201),
            ),
          ),
        )
        if (windows.some((rows) => rows.length > 200)) return refuse('limit')
        return windows
          .flat()
          .sort(
            (left, right) =>
              Number(left.sequence) - Number(right.sequence) ||
              String(left.id).localeCompare(String(right.id)),
          )
      }
      if (input.route === 'issue-new') {
        const inherited = await ctx.db.all(
          from(T)
            .where(eq(T.companyId, a.companyId), isNull(T.projectId), eq(T.archived, false))
            .orderBy(asc(T.sequence), asc(T.id))
            .limit(201),
        )
        if (inherited.length > 200) return refuse('limit')
        return inherited
      }
      const taskListStatuses =
        model === 'flow.TaskStatus' && ['my-work', 'all-issues'].includes(string(input.route))
      const activeStatusIds = taskListStatuses
        ? projects
            .filter((p) => selectedIds.includes(p.id))
            .flatMap((p) =>
              Array.isArray((p.catalogOverrides as Row).taskStatusIds)
                ? ((p.catalogOverrides as Row).taskStatusIds as string[])
                : [],
            )
        : []
      return ctx.db.all(
        from(T)
          .where(
            eq(T.companyId, a.companyId),
            ...(model === 'flow.Label' && ['tags', 'tag-edit'].includes(string(input.route))
              ? []
              : [eq(T.archived, false)]),
            taskListStatuses
              ? or(
                  isNull(T.projectId),
                  and(inArray(T.projectId, selectedIds), inArray(T.id, activeStatusIds)),
                )
              : or(isNull(T.projectId), inArray(T.projectId, projectIds)),
          )
          .orderBy(asc(T.sequence), asc(T.id))
          .limit(200),
      )
    }
    const [page, columns, types, tags, fields] = await Promise.all([
      listTasks(ctx, input),
      catalog('flow.TaskStatus'),
      catalog('flow.TaskType'),
      catalog('flow.Label'),
      catalog('flow.CustomField'),
    ])
    value.tasks = page.tasks
    value.columns = columns.map((c) => ({ ...c, label: c.title }))
    value.taskTypes = types
    value.types = types
    value.tags = tags
    if (['tags', 'tag-edit'].includes(string(input.route)))
      value.labelUsage = await labelUsage(ctx, projects, tags)
    value.fields = fields
    value.collectionPage = { cursor: page.cursor, total: page.total, limit: 50 }
    value.counts = {
      tasks: page.total,
      statuses: page.statusCounts,
      metrics: page.metrics,
      projects: projects.filter((p) => !p.archived && p.workspaceId === workspaceId).length,
    }
    if (page.projectMetrics) value.projectMetrics = page.projectMetrics
    if (page.deadlineCounts) value.deadlineCounts = page.deadlineCounts
    if (page.peopleMetrics) value.peopleMetrics = page.peopleMetrics
    if (input.route === 'workspace-overview')
      value.gettingStartedState = await gettingStartedState(
        ctx,
        projects,
        workspaces,
        workspaceId,
        value.invitations as Row[],
      )
    if (input.route === 'workspace-overview')
      value.blockedCounts = await blockedCounts(
        ctx,
        projects
          .filter(
            (p) =>
              !p.archived && p.workspaceId === workspaceId && (!input.projectId || p.id === input.projectId),
          )
          .map((p) => p.id),
      )
    const referenced = new Set([
      ...navigation.map((p) => p.id),
      ...(page.tasks as Row[]).map((t) => t.projectId),
      ...(value.sprints as Row[]).map((s) => s.projectId),
      ...(value.epics as Row[]).map((e) => e.projectId),
    ])
    value.projects = projectRows(projects.filter((p) => referenced.has(p.id)))
    if (input.route === 'projects') {
      const directory = await projectOptions(ctx, { workspaceId, directory: true, limit: 50 })
      value.projects = directory.items
      value.projectPage = { total: directory.total, cursor: directory.cursor }
    }
    if (
      ['pages', 'all-pages', 'page', 'page-child', 'page-new', 'page-archived', 'page-move'].includes(
        string(input.route),
      )
    ) {
      value.pages = await listDocuments(ctx, projects, workspaces, input)
    }
    const taskRoutes = [
      'issue-copy',
      'issue-transfer',
      'issue',
      'issue-child',
      'issue-link',
      'issue-move',
      ...extensions.flatMap((x) => x.taskRoutes ?? []),
    ]
    if (input.recordId && taskRoutes.includes(string(input.route))) {
      const record = await taskDetail(ctx, { id: input.recordId }, extensions)
      detail = record
      const task = record.task as Row
      value.tasks = [...(value.tasks as Row[]).filter((x) => x.id !== task.id), task]
      value.comments = record.comments
      value.history = record.history
      value.files = record.files
    }
  }
  for (const extension of extensions) {
    const extra =
      (await extension.projection?.(ctx, string(input.route), value.tasks as Row[], {
        input,
        projectIds: selectedIds,
        workspaceIds: workspaces.map((w) => w.id),
        detail,
      })) ?? {}
    for (const [key, data] of Object.entries(extra)) {
      if (Object.hasOwn(value, key)) throw new Error(`Duplicate Flow projection owner: ${key}`)
      value[key] = data
    }
  }
  for (const [key, data] of Object.entries(detail ?? {}))
    if (!['task', 'comments', 'history', 'files'].includes(key) && !Object.hasOwn(value, key))
      value[key] = data
  return value
}
