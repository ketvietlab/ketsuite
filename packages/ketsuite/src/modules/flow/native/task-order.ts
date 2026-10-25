import { and, asc, desc, eq, from, gt, inArray, isNull, lt, not, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { advanceRevision, mutate } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { owned, refuse, requireCapability, string } from './policy.ts'
import { taskByKey, visibleScope } from './queries.ts'
import { writeTask } from './tasks.ts'
import { assigneeKey, rankStep as step, safeRank } from './task-ranks.ts'

function groupAssignees(value: string): string[] {
  if (!value) return []
  let ids: unknown
  if (value.startsWith('user:')) ids = [value.slice(5)]
  else if (value.startsWith('users:')) {
    try {
      ids = JSON.parse(value.slice(6))
    } catch {
      return refuse('validation', { groupValue: 'invalid' })
    }
  }
  if (
    !Array.isArray(ids) ||
    ids.length > 30 ||
    ids.some((id) => typeof id !== 'string' || !id) ||
    new Set(ids).size !== ids.length ||
    assigneeKey(ids) !== value
  )
    return refuse('validation', { groupValue: 'invalid' })
  return ids as string[]
}

async function groupPatch(ctx: Ctx, task: Row, field: string, value: string): Promise<Row> {
  if (field === 'none') {
    if (value) return refuse('validation')
    return {}
  }
  if (field === 'status') return { columnId: value }
  if (field === 'priority') {
    if (!['urgent', 'high', 'normal'].includes(value)) return refuse('validation')
    return { priority: value }
  }
  if (field === 'assignee') return { assigneeIds: groupAssignees(value) }
  if (value === 'Backlog') return { sprintId: null }
  const S = ctx.table('flow.SprintRecord')
  const matches = await ctx.db.all(
    from(S)
      .where(
        eq(S.companyId, ctx.scope.company),
        eq(S.projectId, task.projectId),
        eq(S.title, value),
        eq(S.archived, false),
      )
      .limit(2),
  )
  if (matches.length !== 1 || (matches[0]!.state === 'closed' && task.sprintId !== matches[0]!.id))
    return refuse('validation', { groupValue: 'invalid_sprint' })
  // Keeping an existing closed sprint is valid; choosing it for a new task is not.
  return task.sprintId === matches[0]!.id ? {} : { sprintId: matches[0]!.id }
}

async function belongs(ctx: Ctx, task: Row, field: string, value: string) {
  if (field === 'none') return value === ''
  if (field === 'status') return task.columnId === value
  if (field === 'priority') return task.priority === value
  if (field === 'assignee') {
    const A = ctx.table('flow.TaskAssignee')
    const rows = await ctx.db.all(
      from(A).where(eq(A.companyId, ctx.scope.company), eq(A.taskId, task.id)).limit(31),
    )
    return rows.length <= 30 && assigneeKey(rows.map((r) => string(r.userId))) === value
  }
  return task.sprintId
    ? (await owned(ctx, 'flow.SprintRecord', task.sprintId)).title === value
    : value === 'Backlog'
}

/** Allocate ranks between neighbors, rebalance at most a bounded local window. */
async function place(ctx: Ctx, moving: Row[], target: Row | null, position: string) {
  const T = ctx.table('flow.Task'),
    ids = moving.map((t) => t.id)
  const base = () => from(T).where(eq(T.companyId, ctx.scope.company), not(inArray(T.id, ids)))
  const before = (t: Row) => or(lt(T.sequence, t.sequence), and(eq(T.sequence, t.sequence), lt(T.id, t.id)))
  const after = (t: Row) => or(gt(T.sequence, t.sequence), and(eq(T.sequence, t.sequence), gt(T.id, t.id)))
  const left =
    target && position === 'after'
      ? target
      : target
        ? await ctx.db.one(base().where(before(target)).orderBy(desc(T.sequence), desc(T.id)))
        : await ctx.db.one(base().orderBy(desc(T.sequence), desc(T.id)))
  const right =
    target && position === 'before'
      ? target
      : target
        ? await ctx.db.one(base().where(after(target)).orderBy(asc(T.sequence), asc(T.id)))
        : null
  const allocate = (rows: Row[], low: number, high: number) => {
    const gap = Math.floor((high - low) / (rows.length + 1))
    if (gap < 1 || !safeRank(low + gap) || !safeRank(low + gap * rows.length)) return null
    return rows.map((row, i) => ({ row, rank: low + gap * (i + 1) }))
  }
  let ranks = allocate(
    moving,
    Number(left?.sequence ?? Number(right?.sequence ?? 0) - step * (moving.length + 1)),
    Number(right?.sequence ?? Number(left?.sequence ?? 0) + step * (moving.length + 1)),
  )
  if (!ranks) {
    const center = target ?? left
    if (!center) return refuse('limit')
    for (const width of [32, 64, 128, 256, 512]) {
      const [beforeRows, afterRows] = await Promise.all([
        ctx.db.all(
          base()
            .where(before(center))
            .orderBy(desc(T.sequence), desc(T.id))
            .limit(width + 1),
        ),
        ctx.db.all(
          base()
            .where(after(center))
            .orderBy(asc(T.sequence), asc(T.id))
            .limit(width + 1),
        ),
      ])
      const lower = beforeRows.length > width ? beforeRows.pop()! : null
      const upper = afterRows.length > width ? afterRows.pop()! : null
      const window = [...beforeRows.reverse(), center, ...afterRows]
      const offset = window.findIndex((t) => t.id === center.id) + (target && position === 'before' ? 0 : 1)
      window.splice(offset, 0, ...moving)
      ranks = allocate(
        window,
        Number(lower?.sequence ?? Number(window[0]!.sequence) - step * (window.length + 1)),
        Number(upper?.sequence ?? Number(window.at(-1)!.sequence) + step * (window.length + 1)),
      )
      if (ranks) break
    }
  }
  if (!ranks) return refuse('limit')
  for (const { row, rank } of ranks) {
    await ctx.db.update('flow.Task', { id: row.id }, { sequence: rank })
    await ctx.db.update('flow.TaskAssignee', { taskId: row.id }, { sequence: rank })
  }
}

export async function reorderTasks(ctx: Ctx, input: Row, extensions: NativeServerExtension[]) {
  const ids = input.ids ?? [input.id]
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 900 ||
    ids.some((id) => typeof id !== 'string' || !id) ||
    new Set(ids).size !== ids.length ||
    !ids.includes(input.id)
  )
    return refuse('validation', { ids: 'invalid' })
  if (
    !['none', 'status', 'priority', 'assignee', 'sprint'].includes(string(input.groupBy)) ||
    !['before', 'after'].includes(string(input.position))
  )
    return refuse('validation')
  const first = await taskByKey(ctx, input.id)
  return mutate(
    ctx,
    {
      name: 'flow.issue.reorder',
      capability: 'project.write',
      input: { ...input, projectId: first.projectId },
    },
    extensions,
    async (tx) => {
      const moving: Row[] = []
      for (const id of ids) {
        const task = await taskByKey(tx, id)
        await requireCapability(tx, 'project.write', { projectId: task.projectId })
        if (task.archived) return refuse('archived')
        const version = input.ids
          ? (input.expectedVersions as Row | undefined)?.[string(task.key)]
          : input.expectedVersion
        if (!Number.isSafeInteger(version) || task.version !== version) return refuse('conflict')
        moving.push(task)
      }
      moving.sort(
        (a, b) => Number(a.sequence) - Number(b.sequence) || string(a.id).localeCompare(string(b.id)),
      )
      const field = string(input.groupBy),
        value = string(input.groupValue)
      const patches = await Promise.all(moving.map((task) => groupPatch(tx, task, field, value)))
      let target = input.targetId ? await taskByKey(tx, input.targetId) : null
      if (target) {
        await requireCapability(tx, 'project.read', { projectId: target.projectId })
        if (
          target.archived ||
          moving.some((t) => t.id === target!.id) ||
          !(await belongs(tx, target, field, value))
        )
          return refuse('validation', { targetId: 'invalid' })
      } else {
        const { projects } = await visibleScope(tx),
          T = tx.table('flow.Task')
        const projectIds = projects
          .filter((p) => !input.projectId || p.id === input.projectId)
          .filter((p) => !input.workspaceId || p.workspaceId === input.workspaceId)
          .map((p) => p.id)
        let query = from(T).where(
          eq(T.companyId, tx.scope.company),
          eq(T.archived, false),
          inArray(T.projectId, projectIds),
          not(
            inArray(
              T.id,
              moving.map((t) => t.id),
            ),
          ),
        )
        if (field === 'status') query = query.where(eq(T.columnId, value))
        if (field === 'priority') query = query.where(eq(T.priority, value))
        if (field === 'assignee') query = query.where(eq(T.assigneeKey, value))
        if (field === 'sprint') {
          const S = tx.table('flow.SprintRecord')
          const sprints =
            value === 'Backlog'
              ? []
              : await tx.db.all(
                  from(S)
                    .where(
                      eq(S.companyId, tx.scope.company),
                      inArray(S.projectId, projectIds),
                      eq(S.title, value),
                      eq(S.archived, false),
                    )
                    .limit(501),
                )
          query = query.where(
            value === 'Backlog'
              ? isNull(T.sprintId)
              : inArray(
                  T.sprintId,
                  sprints.map((s) => s.id),
                ),
          )
        }
        target = await tx.db.one(query.orderBy(desc(T.sequence), desc(T.id)))
      }
      const order = await advanceRevision(tx, { expectedRevision: input.expectedOrderRevision }, 'task-order')
      const completing = field === 'status' ? new Set(moving.map((t) => string(t.id))) : undefined
      for (let i = 0; i < moving.length; i++) {
        const task = moving[i]!,
          args = { ...patches[i], id: task.key, projectId: task.projectId, expectedVersion: task.version }
        for (const extension of extensions)
          await extension.beforeMutation?.(tx, {
            name: 'flow.issue.reorder',
            capability: 'project.write',
            input: args,
          })
        await writeTask(tx, args, task, completing)
      }
      await place(tx, moving, target, input.targetId ? string(input.position) : 'after')
      return { ok: true, id: first.key, ids: moving.map((t) => t.key), taskOrderRevision: order }
    },
  )
}
