import { defineFormSchema, validateForm } from '@ketvietlab/ketjs-view'
import { randomUUID } from 'node:crypto'
import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import {
  comboFailure,
  comboNameKey,
  comboRefusal,
  comboUsage,
  lockCombos,
  validateComboItems,
} from '../combo-policy.ts'

export const comboFormSchema = defineFormSchema({
  fields: { name: { type: 'text', required: true, trim: true, minLength: 1 } },
  unknown: 'drop',
})

export async function saveComboHandler(ctx: Ctx, args: Row) {
  const name = String(args.name ?? '')
    .trim()
    .normalize('NFC')
  if (!validateForm(comboFormSchema, { name }).valid) return comboRefusal('name', 'required')
  if ([...name].length > 40) return comboRefusal('name', 'nameLong')
  try {
    return await ctx.tx(async (tx) => {
      const current = (await lockCombos(tx, [String(args.id)]))[0]
      if (current?.active === false) return comboRefusal('id', 'inactive')
      if (current && args.expectedRevisionId !== current.revisionId)
        return comboRefusal('expectedRevisionId', 'conflict')
      const nameKey = comboNameKey(name)
      if ((await tx.db.select('product.Combo', { nameKey })).some((row) => row.id !== args.id))
        return comboRefusal('name', 'duplicateName')
      const items = await validateComboItems(tx, args.id, args.items)
      const values = { name, nameKey, active: true, revisionId: randomUUID() }
      if (current) await tx.db.update('product.Combo', { id: args.id }, values)
      else await tx.db.insert('product.Combo', { id: args.id, ...values })
      const Item = tx.table('product.ComboItem')
      await tx.db.del(deleteFrom(Item).where(eq(Item.comboId, args.id)))
      for (const [sequence, item] of items.entries())
        await tx.db.insert('product.ComboItem', {
          id: JSON.stringify([String(tx.scope.company ?? ''), String(args.id), item.productId]),
          comboId: args.id,
          ...item,
          sequence,
        })
      return { ok: true, id: args.id }
    })
  } catch (error) {
    const refused = comboFailure(error)
    if (refused) return refused
    throw error
  }
}

export async function setComboActiveHandler(ctx: Ctx, args: Row) {
  return ctx.tx(async (tx) => {
    const row = (await lockCombos(tx, [String(args.id)]))[0]
    if (!row) return comboRefusal('id', 'missing')
    if (args.expectedRevisionId !== row.revisionId) return comboRefusal('expectedRevisionId', 'conflict')
    if (args.active === false && (await comboUsage(tx, args.id)).some((row) => row.active !== false))
      return comboRefusal('id', 'inUse')
    await tx.db.update('product.Combo', { id: args.id }, { active: args.active, revisionId: randomUUID() })
    return { ok: true, id: args.id }
  })
}

export async function listCombosHandler(ctx: Ctx, args: Row) {
  const ids = Array.isArray(args.ids) ? new Set(args.ids.map(String)) : null
  const rows = (await ctx.db.select('product.Combo'))
    .filter((row) => (ids ? ids.has(String(row.id)) : args.includeArchived === true || row.active !== false))
    .sort(
      (a, b) =>
        String(a.name).localeCompare(String(b.name), 'vi') || String(a.id).localeCompare(String(b.id)),
    )
  const [items, links, templates] = await Promise.all([
    ctx.db.select('product.ComboItem'),
    ctx.db.select('product.TemplateCombo'),
    ctx.db.select('product.Template'),
  ])
  const active = new Set(templates.filter((row) => row.active !== false).map((row) => String(row.id)))
  return rows.map((row) => ({
    ...row,
    items: items
      .filter((item) => item.comboId === row.id)
      .sort((a, b) => Number(a.sequence) - Number(b.sequence)),
    productCount: links.filter((link) => link.comboId === row.id && active.has(String(link.templateId)))
      .length,
  }))
}

export const comboFunctions = {
  saveCombo: defineFn({
    input: { id: 'id', name: 'text', items: 'json', expectedRevisionId: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Combo',
      'write:product.Combo',
      'read:product.ComboItem',
      'write:product.ComboItem',
      'read:product.Product',
      'read:product.Template',
      'write:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: saveComboHandler,
  }),
  setComboActive: defineFn({
    input: { id: 'id', active: 'bool', expectedRevisionId: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Combo',
      'write:product.Combo',
      'read:product.TemplateCombo',
      'read:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: setComboActiveHandler,
  }),
  listCombos: defineFn({
    input: { includeArchived: 'bool?', ids: 'json?' },
    output: {
      id: 'id',
      name: 'text',
      active: 'bool',
      revisionId: 'text',
      items: 'json',
      productCount: 'int',
    },
    effects: [
      'read:product.Combo',
      'read:product.ComboItem',
      'read:product.TemplateCombo',
      'read:product.Template',
    ],
    agent: true,
    handler: listCombosHandler,
  }),
}
