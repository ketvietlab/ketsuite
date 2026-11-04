import { deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { company, ours } from './scope.ts'

/**
 * K15 (#1428): who works at which warehouse. Assigning someone to a warehouse only chooses it for them on a
 * new document; it does not limit which warehouses they may work in.
 */

/** The company's active people, by name: who a warehouse can be assigned to. */
export async function warehousePeople(
  ctx: Ctx,
  ids?: readonly string[],
): Promise<{ id: string; name: string }[]> {
  if (ids && !ids.length) return []
  const M = ctx.table('user.Membership')
  const members = [
    ...new Set(
      (
        await ctx.db.all(
          from(M)
            .select(M.userId)
            .where(eq(M.companyId, company(ctx)), ...(ids ? [inArray(M.userId, [...ids])] : [])),
        )
      ).map((row) => String(row.userId)),
    ),
  ]
  if (!members.length) return []
  const U = ctx.table('user.User')
  return (await ctx.db.all(from(U).select(U.id, U.name, U.active).where(inArray(U.id, members))))
    .filter((row) => row.active !== false)
    .map((row) => ({ id: String(row.id), name: String(row.name ?? '') }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id))
}

/** Each warehouse with the people assigned to it, and whether the caller is one of them. */
export async function withWarehouseUsers(ctx: Ctx, warehouses: Row[]): Promise<Row[]> {
  const links = await ours(ctx, 'stock.WarehouseUser')
  const actor = typeof ctx.actor === 'string' ? ctx.actor : ''
  return warehouses.map((warehouse) => {
    const userIds = links
      .filter((link) => link.warehouseId === warehouse.id)
      .map((link) => String(link.userId))
      .sort()
    return { ...warehouse, userIds, assigned: Boolean(actor) && userIds.includes(actor) }
  })
}

/** Replaces who is assigned to a warehouse; the caller has checked the people belong to the company. */
export async function assignWarehouseUsers(ctx: Ctx, warehouseId: string, userIds: readonly string[]) {
  const wanted = new Set(userIds)
  const current = await ours(ctx, 'stock.WarehouseUser', { warehouseId })
  const dropped = current.filter((link) => !wanted.has(String(link.userId))).map((link) => String(link.id))
  if (dropped.length) {
    const W = ctx.table('stock.WarehouseUser')
    await ctx.db.del(deleteFrom(W).where(eq(W.companyId, company(ctx)), inArray(W.id, dropped)))
  }
  const held = new Set(current.map((link) => String(link.userId)))
  for (const userId of wanted)
    if (!held.has(userId))
      await ctx.db.insert('stock.WarehouseUser', {
        id: JSON.stringify([company(ctx), warehouseId, userId]),
        warehouseId,
        userId,
      })
}
