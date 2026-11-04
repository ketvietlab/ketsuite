import type { Ctx } from '@ketvietlab/ketjs'

/** Names always come from the session, never a browser-provided identity. */
export async function readViewer(ctx: Ctx) {
  if (!ctx.actor) return { id: null, name: null }
  const found = (await ctx.db.select('user.User', { id: ctx.actor }))[0]
  return { id: String(ctx.actor), name: found ? String(found.name ?? '') : null }
}
