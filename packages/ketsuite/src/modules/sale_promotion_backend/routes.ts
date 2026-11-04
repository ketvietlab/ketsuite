import { randomUUID } from 'node:crypto'
import { json, text, type Route, type Row, type ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../backend/screen.ts'
import { USER_RECORD_MODAL_LABELS } from '../user/modal-labels.ts'
import { promotionRecordScreen } from './screens/record.tsx'
import { promotionsScreen } from './screens/list.tsx'
import { programSummary, promotionExport, promotionRead, searchConfig, listLabels } from './list/read.ts'
import { LIST_PATH, queryFromUrl, recordBack } from './list/shared.ts'
const localized = (url: URL, path: string) => {
  const next = new URL(path, url)
  for (const key of ['lang', 'company', 'branch'])
    if (url.searchParams.has(key)) next.searchParams.set(key, url.searchParams.get(key)!)
  return next.pathname + next.search
}
const defaults: Row = {
  id: '',
  name: '',
  programType: 'promotion',
  active: true,
  revision: 0,
  cards: 0,
  uses: 0,
  minimumQuantity: '0',
  minimumAmount: '0',
  taxMode: 'excl',
  pointMode: 'money',
  pointAmount: '1',
  pointStep: '1000',
  rewardType: 'discount',
  discount: '10',
  discountMode: 'percent',
  discountApplicability: 'order',
  rewardProductQuantity: '1',
  requiredPoints: '1',
  productIds: [],
  categoryIds: [],
  tagIds: [],
  pricelistIds: [],
  rewardProductIds: [],
}
export const promotionContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new',
      save = await ctx.allows('loyalty_sale.saveProgram', url, req)
    if (!(await ctx.allows('loyalty_sale.getProgram', url, req)) || (creating && !save))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? defaults
      : ((await ctx.call('loyalty_sale.getProgram', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const references: Record<string, Array<{ value: string; label: string }>> = {}
    if (await ctx.allows('loyalty_sale.searchProgramReferences', url, req))
      await Promise.all(
        [
          ['productIds', 'product'],
          ['categoryIds', 'category'],
          ['tagIds', 'tag'],
          ['pricelistIds', 'pricelist'],
          ['rewardProductIds', 'product'],
          ['rewardProductId', 'product'],
        ].map(async ([field, kind]) => {
          const value = record[field!]
          const ids = Array.isArray(value) ? value : value ? [String(value)] : []
          const rows = ids.length
            ? ((await ctx.call('loyalty_sale.searchProgramReferences', { kind, ids }, url, req)) as Row[])
            : []
          references[field!] = rows.map((row) => ({ value: String(row.id), label: String(row.name) }))
        }),
      )
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi',
      manifest = await ctx.live(req)
    return json({
      data: {
        record,
        references,
        // What the list says of this program: its reward in one line and how often it was used.
        summary: creating
          ? null
          : programSummary(ctx.translate(lang), record, references.rewardProductId?.[0]?.label ?? null),
        save,
        lang,
        lifecycle: await ctx.allows('loyalty_sale.setProgramActive', url, req),
        generate: await ctx.allows('loyalty_sale.generateCoupons', url, req),
        cardHref:
          !creating && (await ctx.allows('loyalty_sale.listProgramCards', url, req))
            ? localized(url, LIST_PATH + '/' + encodeURIComponent(String(record.id)) + '/cards')
            : null,
      },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) =>
              key.startsWith('sale_promotion_backend.') ||
              key.startsWith('loyalty_sale.') ||
              key.startsWith('backend.relation.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
export const promotionRecord =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (
      !(await ctx.allows(
        params.id === 'new' ? 'loyalty_sale.saveProgram' : 'loyalty_sale.getProgram',
        url,
        req,
      ))
    )
      return text('Forbidden', { status: 403 })
    return adminPage(ctx, url, req, {
      title: 'sale_promotion_backend.title',
      active: LIST_PATH,
      body: (_, frame) =>
        promotionRecordScreen(_, frame, {
          id: params.id!,
          title: _('sale_promotion_backend.title'),
          loading: _('backend.relation.loading'),
          back: recordBack(url),
        }),
    })
  }
export const promotionList =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const cards = Boolean(params.id),
      fn = cards ? 'loyalty_sale.listProgramCards' : 'loyalty_sale.listPrograms'
    if (!(await ctx.allows(fn, url, req))) return text('Forbidden', { status: 403 })
    const program = cards
      ? ((await ctx.call(
          'loyalty_sale.listProgramCards',
          { id: params.id, pageSize: 1 },
          url,
          req,
        )) as Row | null)
      : null
    if (cards && !program) return text('Not found', { status: 404 })
    const save = !cards && (await ctx.allows('loyalty_sale.saveProgram', url, req))
    return adminPage(ctx, url, req, {
      title: 'sale_promotion_backend.title',
      active: LIST_PATH,
      body: (_, frame) =>
        promotionsScreen(_, frame, {
          title: cards
            ? _('sale_promotion_backend.cards') + ' — ' + String((program!.program as Row).name)
            : undefined,
          backHref: cards
            ? localized(url, LIST_PATH + '/' + encodeURIComponent(String(params.id)))
            : undefined,
          createHref: save ? localized(url, LIST_PATH + '/new') : null,
          props: {
            mode: cards ? 'cards' : 'programs',
            key: randomUUID(),
            source: localized(url, url.pathname + '/read'),
            query: queryFromUrl(url),
            search: searchConfig(url, _, cards),
            labels: listLabels(_),
          },
        }),
    })
  }
export const routes = {
  '/admin/sales/promotions': promotionList,
  '/admin/sales/promotions/read': promotionRead,
  '/admin/sales/promotions/export': promotionExport,
  '/admin/sales/promotions/{id}': promotionRecord,
  '/admin/sales/promotions/{id}/context': promotionContext,
  '/admin/sales/promotions/{id}/cards': promotionList,
  '/admin/sales/promotions/{id}/cards/read': promotionRead,
}
