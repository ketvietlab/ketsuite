import { randomUUID } from 'node:crypto'
import { KetError, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { fold } from '../product/text-fold.ts'
import { company, ours } from './scope.ts'
import { invalid } from './functions/shared.ts'

/**
 * Sales tags (D15): a name and nothing else, kept per company. A quotation or order carries up
 * to ten, also once confirmed. An archived tag is offered no more, but an order that carries it
 * keeps it until someone takes it off.
 */
export const MAX_ORDER_TAGS = 10
const refused = (field: string, reason: string) => invalid(field, `sale.error.tag.${reason}`)
class TagRefused extends Error {
  readonly result: ReturnType<typeof refused>
  constructor(field: string, reason: string) {
    super(reason)
    this.result = refused(field, reason)
  }
}
const nameKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('vi')

/** Assigning and archiving hold the same rows, so neither slips past the other. */
async function lockTags(ctx: Ctx, ids: readonly string[]): Promise<Row[]> {
  if (!ids.length) return []
  const Tag = ctx.table('sale.Tag')
  const rows = (
    await ctx.db.all(from(Tag).where(eq(Tag.companyId, company(ctx)), inArray(Tag.id, [...ids])))
  ).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  for (const row of rows) {
    const held = await ctx.db.compareAndSet(
      'sale.Tag',
      { id: row.id },
      { revisionId: row.revisionId, active: row.active },
      { revisionId: row.revisionId },
    )
    if (!('dryRun' in held) && !held.matched)
      throw new KetError({ code: 'conflict', message: 'The tag changed; reload before saving.' })
  }
  return rows
}

function duplicate(error: unknown) {
  for (let current = error, depth = 0; current && depth < 6; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (/sale_tag.*name_key|name_key.*sale_tag|UNIQUE constraint failed: sale_tag\./i.test(message))
      return true
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : null
  }
  return false
}

export async function saveTag(ctx: Ctx, args: Row) {
  const name = String(args.name ?? '')
    .trim()
    .normalize('NFC')
  if (!name) return refused('name', 'required')
  if ([...name].length > 30) return refused('name', 'tooLong')
  try {
    return await ctx.tx(async (tx) => {
      const current = (await lockTags(tx, [String(args.id)]))[0]
      if (!current && (await tx.db.select('sale.Tag', { id: args.id })).length)
        return refused('id', 'missing')
      if (current?.active === false) return refused('id', 'inactive')
      if (current && args.expectedRevisionId !== current.revisionId)
        return refused('expectedRevisionId', 'conflict')
      const key = nameKey(name)
      if ((await ours(tx, 'sale.Tag', { nameKey: key })).some((row) => row.id !== args.id))
        return refused('name', 'duplicateName')
      const values = { name, nameKey: key, active: true, revisionId: randomUUID() }
      if (current) await tx.db.update('sale.Tag', { id: args.id }, values)
      else await tx.db.insert('sale.Tag', { id: args.id, ...values })
      return { ok: true, id: args.id, revisionId: values.revisionId }
    })
  } catch (error) {
    if (duplicate(error)) return refused('name', 'duplicateName')
    throw error
  }
}

export async function setTagActive(ctx: Ctx, args: Row) {
  return ctx.tx(async (tx) => {
    const row = (await lockTags(tx, [String(args.id)]))[0]
    if (!row) return refused('id', 'missing')
    if (args.expectedRevisionId !== row.revisionId) return refused('expectedRevisionId', 'conflict')
    const revisionId = randomUUID()
    await tx.db.update('sale.Tag', { id: args.id }, { active: args.active === true, revisionId })
    return { ok: true, id: args.id, revisionId }
  })
}

/** The company's tags by name, each with the number of quotations and orders that carry it. */
export async function listTags(ctx: Ctx, args: Row) {
  const [tags, links] = await Promise.all([ours(ctx, 'sale.Tag'), ours(ctx, 'sale.OrderTag')])
  const orders = new Map<string, number>()
  for (const link of links) orders.set(String(link.tagId), (orders.get(String(link.tagId)) ?? 0) + 1)
  const ids = Array.isArray(args.ids) ? new Set(args.ids.map(String)) : null
  return tags
    .filter((row) => (ids ? ids.has(String(row.id)) : args.includeArchived === true || row.active !== false))
    .map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active !== false,
      revisionId: row.revisionId,
      orderCount: orders.get(String(row.id)) ?? 0,
    }))
    .sort(
      (a, b) =>
        String(a.name).localeCompare(String(b.name), 'vi') || String(a.id).localeCompare(String(b.id)),
    )
}

async function heldTagIds(ctx: Ctx, orderId: unknown): Promise<string[]> {
  return (await ours(ctx, 'sale.OrderTag', { orderId }))
    .sort((a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)))
    .map((row) => String(row.tagId))
}

export async function getOrderTags(ctx: Ctx, args: Row) {
  if (!(await ours(ctx, 'sale.Order', { id: args.id }))[0]) return null
  const ids = await heldTagIds(ctx, args.id)
  const rows = new Map((await ours(ctx, 'sale.Tag')).map((row) => [String(row.id), row]))
  return {
    id: args.id,
    tags: ids.flatMap((id) => {
      const row = rows.get(id)
      return row ? [{ id, name: row.name, active: row.active !== false }] : []
    }),
  }
}

/** Replaces the tags an order carries. Tags are not commercial terms, so the order's revision stays. */
export async function setOrderTags(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx(async (tx) => {
      const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (!order) return refused('id', 'orderMissing')
      if (!Array.isArray(args.tagIds) || args.tagIds.some((id) => typeof id !== 'string' || !id.trim()))
        return refused('tagIds', 'invalid')
      const ids = [...new Set(args.tagIds.map((id: string) => id.trim()))]
      if (ids.length > MAX_ORDER_TAGS) return refused('tagIds', 'tooMany')
      const held = new Set(await heldTagIds(tx, order.id))
      const rows = await lockTags(tx, ids)
      if (ids.some((id) => !rows.some((row) => row.id === id && (row.active !== false || held.has(id)))))
        throw new TagRefused('tagIds', 'invalid')
      const Link = tx.table('sale.OrderTag')
      await tx.db.del(
        deleteFrom(Link).where(eq(Link.companyId, company(tx)), eq(Link.orderId, String(order.id))),
      )
      for (const [sequence, tagId] of ids.entries())
        await tx.db.insert('sale.OrderTag', {
          id: JSON.stringify([company(tx), String(order.id), tagId]),
          orderId: order.id,
          tagId,
          sequence,
        })
      return { ok: true, id: order.id }
    })
  } catch (error) {
    if (error instanceof TagRefused) return error.result
    throw error
  }
}

/** The orders carrying a tag whose name contains the search, without accents or case. */
export async function ordersTagged(ctx: Ctx, search: string): Promise<string[]> {
  const wanted = fold(search.trim())
  if (!wanted) return []
  const ids = (await ours(ctx, 'sale.Tag'))
    .filter((row) => fold(String(row.name)).includes(wanted))
    .map((row) => String(row.id))
  if (!ids.length) return []
  const Link = ctx.table('sale.OrderTag')
  const rows = await ctx.db.all(
    from(Link)
      .select(Link.orderId)
      .where(eq(Link.companyId, company(ctx)), inArray(Link.tagId, ids)),
  )
  return [...new Set(rows.map((row) => String(row.orderId)))]
}

/** Each listed order's tag names, joined in the order it carries them, for lists that search in memory. */
export async function withTagNames<R extends Row>(
  ctx: Ctx,
  rows: R[],
): Promise<Array<R & { tagNames: string }>> {
  const ids = rows.map((row) => String(row.id))
  if (!ids.length) return []
  const Link = ctx.table('sale.OrderTag')
  const links = (
    await ctx.db.all(from(Link).where(eq(Link.companyId, company(ctx)), inArray(Link.orderId, ids)))
  ).sort((a, b) => Number(a.sequence) - Number(b.sequence))
  const names = new Map((await ours(ctx, 'sale.Tag')).map((row) => [String(row.id), String(row.name)]))
  const byOrder = new Map<string, string[]>()
  for (const link of links) {
    const name = names.get(String(link.tagId))
    if (name) byOrder.set(String(link.orderId), [...(byOrder.get(String(link.orderId)) ?? []), name])
  }
  return rows.map((row) => ({ ...row, tagNames: (byOrder.get(String(row.id)) ?? []).join(', ') }))
}
