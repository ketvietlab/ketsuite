import { recordTaskChanges } from './task-history.ts'
import { randomUUID } from 'node:crypto'
import { asc, eq, from, gte, ilike, inArray, isDateText, likeLiteral, lte, ne } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { cas, mutate, now } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { owned, refuse, requireCapability, string } from './policy.ts'
import { requiredTitle, timestamped } from './organization.ts'
import { assignmentProjection } from './tasks.ts'

const dates = (input: Row, current: Row | null) => {
  const start = input.start === undefined ? (current?.start ?? null) : input.start || null,
    end = input.end === undefined ? (current?.end ?? null) : input.end || null
  if (
    (start && !isDateText(start)) ||
    (end && !isDateText(end)) ||
    (start && end && string(start) > string(end))
  )
    return refuse('validation', { end: 'invalid' })
  return { start, end }
}

export async function savePlan(ctx: Ctx, input: Row, extensions: NativeServerExtension[], sprint: boolean) {
  const model = sprint ? 'flow.SprintRecord' : 'flow.EpicRecord'
  const old = input.id ? await owned(ctx, model, input.id) : null
  const projectId = old?.projectId ?? input.projectId
  return mutate(
    ctx,
    {
      name: sprint ? 'flow.sprint.save' : 'flow.epic.save',
      capability: 'project.manage',
      input: { ...input, projectId },
    },
    extensions,
    async (tx) => {
      const project = await owned(tx, 'flow.ProjectRecord', projectId)
      if (project.archived || (sprint && project.sprintCadence === null)) return refuse('archived')
      const current = old ? await owned(tx, model, old.id) : null
      if (input.projectId !== undefined && input.projectId !== projectId)
        return refuse('validation', { projectId: 'immutable' })
      if (sprint && current?.state !== undefined && current.state !== 'planned') return refuse('sprint_state')
      const range = dates(input, current),
        title = input.title === undefined && current ? current.title : requiredTitle(input)
      if (!range.start || !range.end) return refuse('validation', { start: 'required', end: 'required' })
      if (sprint) {
        const S = tx.table(model)
        const duplicate = await tx.db.one(
          from(S).where(
            eq(S.companyId, tx.scope.company),
            eq(S.projectId, projectId),
            eq(S.archived, false),
            ilike(S.title, likeLiteral(string(title))),
            ...(current ? [ne(S.id, current.id)] : []),
          ),
        )
        if (duplicate) return refuse('validation', { title: 'duplicate' })
        const overlap = await tx.db.one(
          from(S).where(
            eq(S.companyId, tx.scope.company),
            eq(S.projectId, projectId),
            eq(S.archived, false),
            ne(S.state, 'closed'),
            lte(S.start, range.end),
            gte(S.end, range.start),
            ...(current ? [ne(S.id, current.id)] : []),
          ),
        )
        if (overlap) return refuse('sprint_overlap')
      }
      const patch: Row = {
        title,
        ...range,
        ...(sprint
          ? { goal: string(input.description ?? input.goal ?? current?.goal) }
          : { description: string(input.description ?? current?.description) }),
      }
      if (!sprint) {
        const ownerId = input.ownerId === undefined ? current?.ownerId : input.ownerId
        const M = tx.table('flow.Member')
        const owner = await tx.db.one(
          from(M).where(
            eq(M.companyId, tx.scope.company),
            eq(M.userId, string(ownerId)),
            eq(M.status, 'active'),
          ),
        )
        if (!owner || owner.role === 'guest') return refuse('validation', { ownerId: 'invalid' })
        await requireCapability({ ...tx, actor: string(ownerId) } as Ctx, 'project.read', { projectId })
        patch.ownerId = ownerId
        patch.outcome =
          input.outcome === undefined && current ? current.outcome : requiredTitle(input, 'outcome', 4000)
        if (!patch.outcome) return refuse('validation', { outcome: 'required' })
      }
      const id = current ? string(current.id) : randomUUID()
      const updated = current ? await cas(tx, model, id, input.expectedVersion, patch) : null
      if (!current)
        await tx.db.insert(model, {
          id,
          projectId,
          state: sprint ? 'planned' : 'active',
          ...(sprint ? { closeReport: null } : { descriptionDoc: null }),
          ...timestamped(),
          ...patch,
        })
      return { ok: true, id, version: updated?.version ?? 1 }
    },
  )
}

export async function planAction(
  ctx: Ctx,
  input: Row,
  extensions: NativeServerExtension[],
  sprint: boolean,
  action: 'start' | 'close' | 'archive' | 'restore',
) {
  const model = sprint ? 'flow.SprintRecord' : 'flow.EpicRecord',
    old = await owned(ctx, model, input.id)
  return mutate(
    ctx,
    {
      name: 'flow.' + (sprint ? 'sprint.' : 'epic.') + action,
      capability: 'project.manage',
      input: { ...input, projectId: old.projectId },
    },
    extensions,
    async (tx) => {
      const current = await owned(tx, model, old.id),
        S = tx.table(model)
      if (current.version !== input.expectedVersion) return refuse('conflict')
      if (action === 'archive' || action === 'restore') {
        if (sprint && action === 'archive' && current.state === 'active') return refuse('sprint_state')
        await cas(tx, model, string(current.id), input.expectedVersion, { archived: action === 'archive' })
      } else if (action === 'start') {
        if (current.archived || current.state !== 'planned') return refuse('sprint_state')
        if (
          await tx.db.one(
            from(S).where(
              eq(S.companyId, tx.scope.company),
              eq(S.projectId, current.projectId),
              eq(S.state, 'active'),
              eq(S.archived, false),
            ),
          )
        )
          return refuse('sprint_active')
        const T = tx.table('flow.Task')
        const tasks = await tx.db.all(
          from(T)
            .where(eq(T.companyId, tx.scope.company), eq(T.sprintId, current.id), eq(T.archived, false))
            .orderBy(asc(T.id))
            .limit(1001),
        )
        if (tasks.length > 1000) return refuse('limit')
        for (const task of tasks)
          await tx.db.insert('flow.SprintCommitment', {
            id: randomUUID(),
            sprintId: current.id,
            taskId: task.id,
            points: task.points,
            createdAt: now(),
          })
        await cas(tx, model, string(current.id), input.expectedVersion, { state: 'active' })
      } else {
        if (current.archived || current.state !== 'active') return refuse('sprint_state')
        const T = tx.table('flow.Task'),
          C = tx.table('flow.TaskStatus')
        const tasks = await tx.db.all(
          from(T)
            .where(eq(T.companyId, tx.scope.company), eq(T.sprintId, current.id), eq(T.archived, false))
            .orderBy(asc(T.id))
            .limit(1001),
        )
        if (tasks.length > 1000) return refuse('limit')
        const statuses = await tx.db.all(
          from(C)
            .where(
              eq(C.companyId, tx.scope.company),
              inArray(C.id, [...new Set(tasks.map((t) => t.columnId))]),
            )
            .limit(200),
        )
        const finished = new Set(statuses.filter((c) => c.kind === 'done').map((c) => c.id))
        let carry: Row | null = null
        if (input.carryTo && input.carryTo !== 'Backlog') {
          carry = await tx.db.one(
            from(S).where(
              eq(S.companyId, tx.scope.company),
              eq(S.projectId, current.projectId),
              eq(S.title, input.carryTo),
              ne(S.id, current.id),
              eq(S.archived, false),
              ne(S.state, 'closed'),
            ),
          )
          if (!carry) return refuse('validation', { carryTo: 'invalid' })
        }
        const Commitment = tx.table('flow.SprintCommitment')
        const commitments = await tx.db.all(
          from(Commitment)
            .where(eq(Commitment.companyId, tx.scope.company), eq(Commitment.sprintId, current.id))
            .limit(1001),
        )
        if (commitments.length > 1000) return refuse('limit')
        const completed = tasks.filter((t) => finished.has(t.columnId))
        const report = {
          title: current.title,
          start: current.start,
          end: current.end,
          total: tasks.length,
          done: completed.length,
          completed: completed.length,
          carried: tasks.length - completed.length,
          carryTo: carry?.title ?? 'Backlog',
          committedPoints: commitments.reduce((n, c) => n + Number(c.points ?? 0), 0),
          completedPoints: completed.reduce((n, t) => n + Number(t.points), 0),
          added: tasks.filter((t) => !commitments.some((c) => c.taskId === t.id)).length,
          removed: commitments.filter((c) => !tasks.some((t) => t.id === c.taskId)).length,
          tasks: tasks.map((t) => ({
            id: t.key,
            title: t.title,
            status: t.columnId,
            columnId: t.columnId,
            points: Number(t.points),
            done: finished.has(t.columnId),
          })),
          taskIds: tasks.map((t) => t.key),
          closedAt: now(),
        }
        for (const task of tasks.filter((t) => !finished.has(t.columnId))) {
          const updated = await cas(tx, 'flow.Task', string(task.id), task.version, {
            sprintId: carry?.id ?? null,
          })
          await assignmentProjection(tx, updated)
          await recordTaskChanges(tx, updated, [
            { field: 'sprint', before: task.sprintId, after: updated.sprintId },
          ])
        }
        await tx.db.insert('flow.SprintReport', {
          id: randomUUID(),
          sprintId: current.id,
          closedBy: tx.actor,
          summary: report,
          createdAt: now(),
        })
        await cas(tx, model, string(current.id), input.expectedVersion, {
          state: 'closed',
          closeReport: report,
        })
      }
      return { ok: true, id: current.id }
    },
  )
}
