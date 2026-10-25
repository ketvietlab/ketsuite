import type { Ctx, Row } from '@ketvietlab/ketjs'
import { hash } from './command.ts'
import { owned, refuse, requireCapability } from './policy.ts'

export async function readSprintReport(ctx: Ctx, input: Row) {
  const sprint = await owned(ctx, 'flow.SprintRecord', input.id)
  await requireCapability(ctx, 'project.read', { projectId: sprint.projectId })
  if (sprint.archived || (input.projectId && input.projectId !== sprint.projectId)) return refuse('not_found')
  if (sprint.state !== 'closed') return refuse('sprint_state')
  const saved = sprint.closeReport as Row | null
  if (!saved || !Array.isArray(saved.tasks)) return refuse('unavailable')
  const limit = input.limit === undefined ? 10 : Number(input.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return refuse('validation', { limit: 'invalid' })
  const fence = hash(
    JSON.stringify([
      ctx.scope.company,
      ctx.actor,
      sprint.projectId,
      sprint.id,
      sprint.version,
      saved.closedAt,
    ]),
  )
  let offset = 0
  if (input.cursor !== undefined) {
    let cursor: Row
    try {
      if (typeof input.cursor !== 'string' || input.cursor.length > 2048) throw new Error()
      cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as Row
      if (
        !cursor ||
        Array.isArray(cursor) ||
        !Number.isInteger(cursor.offset) ||
        Number(cursor.offset) < 1 ||
        Number(cursor.offset) > saved.tasks.length ||
        typeof cursor.fence !== 'string'
      )
        throw new Error()
    } catch {
      return refuse('validation', { cursor: 'invalid' })
    }
    if (cursor.fence !== fence) return refuse('conflict', { cursor: 'scope_changed' })
    offset = Number(cursor.offset)
  }
  const { tasks, taskIds: _ids, ...report } = saved
  const rows = tasks as Row[],
    page = rows.slice(offset, offset + limit),
    next = offset + page.length
  return {
    report,
    tasks: page,
    total: rows.length,
    cursor:
      next < rows.length ? Buffer.from(JSON.stringify({ offset: next, fence })).toString('base64url') : null,
  }
}
