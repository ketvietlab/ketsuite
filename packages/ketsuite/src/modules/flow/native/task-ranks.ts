import { desc, eq, from } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { advanceRevision, revision } from './command.ts'
import { refuse } from './policy.ts'

export const rankStep = 1024
export const safeRank = (rank: number) =>
  Number.isSafeInteger(rank) && rank >= -2147483647 && rank <= 2147483647
export const assigneeKey = (ids: string[]) =>
  ids.length > 1 ? 'users:' + JSON.stringify([...ids].sort()) : ids.length ? 'user:' + ids[0] : ''

export async function appendTaskRank(ctx: Ctx) {
  const T = ctx.table('flow.Task')
  const last = await ctx.db.one(
    from(T).where(eq(T.companyId, ctx.scope.company)).orderBy(desc(T.sequence), desc(T.id)),
  )
  const rank = Number(last?.sequence ?? 0) + rankStep
  if (!safeRank(rank)) return refuse('limit')
  await advanceRevision(ctx, { expectedRevision: await revision(ctx, 'task-order') }, 'task-order')
  return rank
}
