import { from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
/** Resolve only the actors already referenced by this scoped history. */
export async function auditActorNames(ctx: Ctx, rows: Row[]): Promise<Map<unknown, string>> {
  const ids = [...new Set(rows.map((row) => row.actorId).filter(Boolean))]
  if (!ids.length || !ctx.manifest.models['user.User']) return new Map()
  const U = ctx.table('user.User')
  const actors = await ctx.db.all(from(U).select(U.id, U.name!).where(inArray(U.id, ids)).limit(100))
  return new Map(actors.map((row) => [row.id, String(row.name)]))
}
