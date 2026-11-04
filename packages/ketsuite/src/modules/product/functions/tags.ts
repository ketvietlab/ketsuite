import { randomUUID } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { lockTags, tagFailure, tagNameKey, tagRefusal } from '../tag-policy.ts'
export async function saveTagHandler(ctx: Ctx, args: Row) {
  const name = String(args.name ?? '')
    .trim()
    .normalize('NFC')
  if (!name) return tagRefusal('name', 'required')
  if ([...name].length > 30) return tagRefusal('name', 'tooLong')
  try {
    return await ctx.tx(async (tx) => {
      const current = (await lockTags(tx, [String(args.id)]))[0]
      if (current?.active === false) return tagRefusal('id', 'inactive')
      if (current && args.expectedRevisionId !== current.revisionId)
        return tagRefusal('expectedRevisionId', 'conflict')
      const nameKey = tagNameKey(name)
      if ((await tx.db.select('product.Tag', { nameKey })).some((row) => row.id !== args.id))
        return tagRefusal('name', 'duplicateName')
      const values = { name, nameKey, active: true, revisionId: randomUUID() }
      if (current) await tx.db.update('product.Tag', { id: args.id }, values)
      else await tx.db.insert('product.Tag', { id: args.id, ...values })
      return { ok: true, id: args.id }
    })
  } catch (error) {
    const refused = tagFailure(error)
    if (refused) return refused
    throw error
  }
}
export async function setTagActiveHandler(ctx: Ctx, args: Row) {
  return ctx.tx(async (tx) => {
    const row = (await lockTags(tx, [String(args.id)]))[0]
    if (!row) return tagRefusal('id', 'missing')
    if (args.expectedRevisionId !== row.revisionId) return tagRefusal('expectedRevisionId', 'conflict')
    await tx.db.update('product.Tag', { id: args.id }, { active: args.active, revisionId: randomUUID() })
    return { ok: true, id: args.id }
  })
}
export async function listTagsHandler(ctx: Ctx, args: Row) {
  const ids = Array.isArray(args.ids) ? new Set(args.ids.map(String)) : null
  return (await ctx.db.select('product.Tag'))
    .filter((row) => (ids ? ids.has(String(row.id)) : args.includeArchived === true || row.active !== false))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'))
}
export const tagFunctions = {
  saveTag: defineFn({
    input: { id: 'id', name: 'text', expectedRevisionId: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Tag', 'write:product.Tag'],
    idempotent: true,
    agent: true,
    handler: saveTagHandler,
  }),
  setTagActive: defineFn({
    input: { id: 'id', active: 'bool', expectedRevisionId: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:product.Tag', 'write:product.Tag'],
    idempotent: true,
    agent: true,
    handler: setTagActiveHandler,
  }),
  listTags: defineFn({
    input: { includeArchived: 'bool?', ids: 'json?' },
    output: { id: 'id', name: 'text', active: 'bool', revisionId: 'text' },
    effects: ['read:product.Tag'],
    agent: true,
    handler: listTagsHandler,
  }),
}
