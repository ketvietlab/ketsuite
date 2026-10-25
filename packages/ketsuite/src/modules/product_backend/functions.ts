import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../backend/search-filter-state.ts'
import { attributeSearchHref } from './attribute-search-state.ts'
import { PRODUCT_LIST_EFFECTS, PRODUCT_LIST_OUTPUT, productListShape, readProductList } from './list/read.ts'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../user/authorization.ts'
import { readUnitUsage, unitAnswer, unitModalData, unitRowsOf } from './units.ts'
import { UNIT_RECORD_MODAL_LABELS } from './units/labels.ts'

export const functions: Record<string, FnSpec> = {
  /**
   * The Units of measure list's one paged read: units by family, each with how many
   * products count in it. `status` is `active` (the default), `archived` or `all`;
   * `kind` is `reference`, `derived` or everything.
   */
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
    handler: async (ctx, args) =>
      unitAnswer(unitRowsOf(await ctx.db.select('uom.Unit'), await readUnitUsage(ctx)), args),
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
    handler: async (ctx, args) => {
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
    },
  }),
  applyAttributeSearchFilter: defineFn({
    input: {
      query: 'text?',
      returnTo: 'text?',
      facets: 'json?',
      filters: 'json?',
      groupBy: 'json?',
      favoriteId: 'text?',
      customFilters: 'json?',
    },
    output: { href: 'text' },
    effects: ['read:product.Attribute'],
    handler: (_ctx, args) => ({ href: attributeSearchHref(args) }),
  }),

  // The catalogue's one paged read (list/read.ts). With stock installed the list reads
  // through `stock_backend.searchProductTemplates` instead, which adds the stock column.
  searchTemplates: defineFn({
    input: { href: 'text?', pageSize: 'int?', timezone: 'text?' },
    output: PRODUCT_LIST_OUTPUT,
    effects: [...PRODUCT_LIST_EFFECTS],
    handler: (ctx, args) => readProductList(ctx, args),
  }),

  // The catalogue's search bar, on the shared implementation every list uses. Its shape
  // carries the stock preset and sort wherever stock answers the list.
  ...listSearchFilterFunctions(
    [
      {
        key: 'product.templates',
        path: '/admin/product/templates',
        spec: (ctx) =>
          productListShape(
            ctx.table('product.Template'),
            Boolean(ctx.manifest.functions['stock_backend.searchProductTemplates']),
          ),
      },
    ],
    ['product.Template'],
  ),
}
