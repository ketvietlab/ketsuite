import type { Ctx } from '@ketvietlab/ketjs'

/** Unrounded conversion: money per package must not be rounded as a stock quantity. */
export async function unitRatio(ctx: Ctx, fromId: unknown, toId: unknown): Promise<number | null> {
  const [from, to] = await Promise.all([
    ctx.db.select('uom.Unit', { id: fromId }).then((rows) => rows[0]),
    ctx.db.select('uom.Unit', { id: toId }).then((rows) => rows[0]),
  ])
  if (!from || !to) return null
  const root = (path: unknown) =>
    String(path ?? '')
      .split('/')
      .filter(Boolean)[0]
  if (!root(from.parentPath) || root(from.parentPath) !== root(to.parentPath)) return null
  const ratio = Number(from.absoluteFactor) / Number(to.absoluteFactor)
  return Number.isFinite(ratio) && ratio > 0 ? Number(ratio.toPrecision(15)) : null
}
