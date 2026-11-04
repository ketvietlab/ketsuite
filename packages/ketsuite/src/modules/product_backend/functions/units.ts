import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { readUnitUsage, readUnits, unitModalData } from '../units.ts'
import { UNIT_RECORD_MODAL_LABELS } from '../units/labels.ts'

export async function searchUnitsHandler(ctx: Ctx, args: Row) {
  return readUnits(ctx, args)
}
export async function unitContextHandler(ctx: Ctx, args: Row) {
  const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  const can = (fn: string): boolean => allowed === null || allowed.includes(fn)
  const editable = can('uom.saveUnit')
  if (args.id ? !can('product_backend.searchUnits') : !editable) return null
  const lang = args.locale === 'en' ? 'en' : 'vi'
  const data = unitModalData(
    await ctx.db.select('uom.Unit'),
    await readUnitUsage(ctx),
    args.id ? String(args.id) : null,
    { lang, editable },
  )
  if (!data) return null
  const messages = Object.fromEntries(
    Object.entries(ctx.manifest.messages?.[lang] ?? {})
      .filter(([key]) => key.startsWith('product_backend.uom.') || key.startsWith('uom.error.'))
      .map(([key, message]) => [
        key,
        typeof message === 'string' ? message : String(message.other ?? Object.values(message)[0] ?? key),
      ]),
  )
  return { data, messages: { ...messages, ...UNIT_RECORD_MODAL_LABELS[lang] } }
}

export const unitFunctions = {
  searchUnits: defineFn({
    input: { q: 'text?', status: 'text?', kind: 'text?', page: 'int?', pageSize: 'int?' },
    output: {
      query: 'json',
      total: 'int',
      page: 'int',
      pages: 'int',
      rows: 'json',
      counts: 'json',
      isEmpty: 'bool',
    },
    effects: ['read:uom.Unit', 'read:product.Template', 'read:product.TemplateUom'],
    handler: searchUnitsHandler,
  }),
  /**
   * A unit's record modal: the unit, the units it may count in, and what uses it. A new
   * unit (no `id`) needs the right to save one; an existing one, the right to list units.
   */
  unitContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: [
      ...AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:')),
      'read:uom.Unit',
      'read:product.Template',
      'read:product.TemplateUom',
    ],
    handler: unitContextHandler,
  }),
}
