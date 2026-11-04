import { pricelistRevision } from '../../pricing/record-revision.ts'
import { timezoneOf } from '../../backend/screen.ts'
import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'

export const pricelistContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (
      !(await ctx.allows('pricing.listPricelists', url, req)) ||
      !(await ctx.allows('pricing.listPricelistItems', url, req))
    )
      return text('Forbidden', { status: 403 })
    const record = ((await ctx.call('pricing.listPricelists', {}, url, req)) as Row[]).find(
      (row) => row.id === params.id,
    )
    if (!record) return text('Not found', { status: 404 })
    const [items, units, products, templates, categories, lists, save, saveItem, ruleUnits] =
      await Promise.all([
        ctx.call('pricing.listPricelistItems', { pricelistId: params.id }, url, req) as Promise<Row[]>,
        optionalRead<Row[]>(ctx, 'uom.listUnits', {}, url, req, []),
        optionalRead<Row[]>(ctx, 'product.listVariants', { limit: 100 }, url, req, []),
        optionalRead<Row[]>(ctx, 'product.listTemplates', { limit: 100 }, url, req, []),
        optionalRead<Row[]>(ctx, 'product.listCategories', {}, url, req, []),
        ctx.call('pricing.listPricelists', {}, url, req) as Promise<Row[]>,
        ctx.allows('pricing.savePricelist', url, req),
        ctx.allows('pricing.savePricelistItem', url, req),
        ctx.allows('pricing.listRuleUnits', url, req),
      ])
    const can = Object.fromEntries(
      await Promise.all(
        [
          'product.listVariants',
          'product.listTemplates',
          'product.listCategories',
          'pricing.listRuleUnits',
        ].map(async (fn) => [fn, await ctx.allows(fn, url, req)]),
      ),
    )
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const timezone = await timezoneOf(ctx, url, req)
    const local = (value: unknown) => {
      if (!value) return ''
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(String(value)))
      const at = (type: string) => parts.find((part) => part.type === type)?.value
      return `${at('year')}-${at('month')}-${at('day')}T${at('hour')}:${at('minute')}`
    }
    const displayItems = items.map((item) => ({
      ...item,
      dateStart: local(item.dateStart),
      dateEnd: local(item.dateEnd),
    }))
    const manifest = await ctx.live(req)
    return json({
      data: {
        record,
        revision: pricelistRevision(record, items),
        items: displayItems,
        timezone,
        save,
        saveItem,
        ruleUnits,
        can,
        draftId: randomUUID(),
        lang,
        // A category reads by its full name, as the categories screen lists it.
        choices: {
          units,
          products,
          templates,
          categories: categories.map((row) => ({ ...row, displayName: row.path ?? row.name })),
          lists: lists.filter((row) => row.active !== false && row.id !== params.id),
        },
      },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) =>
              key.startsWith('pricing_backend.') ||
              key.startsWith('pricing.error.') ||
              key.startsWith('product.error.category.') ||
              key.startsWith('backend.relation.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
