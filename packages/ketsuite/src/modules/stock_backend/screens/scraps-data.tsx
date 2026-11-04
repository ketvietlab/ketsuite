import { json, text, parseListState, encodeListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Row } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { optionalRead } from '../../backend/optional-read.ts'
import { applyRowListState } from '../../backend/row-list.ts'
import { loadListFavorites } from '../../backend/search-filter.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { scrapListSearch } from '../search.ts'
import { scrapSearch } from '../scraps/search.ts'
import { SCRAPS_PATH, scrapHref, scrapQuery } from '../scraps/shared.ts'
import type { ScrapAnswer, ScrapRow } from '../scraps/shared.ts'

const SORTS = ['name', 'date', 'product', 'quantity'] as const
const QUEUE = ['draft', 'done', 'reversed', 'cancel']

/** K59's single paged read: the company's scrap orders, drafts first and then the newest. */
export const scrapsDataRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (req.headers['sec-fetch-site'] === 'cross-site' || !(await ctx.allows('stock.listScraps', url, req)))
      return text('Forbidden', { status: 403 })
    const input = await readForm(req),
      query = scrapQuery(new URL(input.href || SCRAPS_PATH, url), Number(input.pageSize) || undefined)
    const requested = new URL(query.href, url),
      state = parseListState(scrapListSearch, requested).state
    const _ = ctx.translate(ctx.localeOf(url, req))
    const lookup = (fn: string) => optionalRead<Row[]>(ctx, fn, {}, url, req, [])
    const [scraps, warehouses, templates, lots] = await Promise.all([
      ctx.call(
        'stock.listScraps',
        query.warehouse ? { warehouseId: query.warehouse } : {},
        url,
        req,
      ) as Promise<Row[]>,
      lookup('stock.listWarehouses'),
      lookup('stock.listStorableProducts'),
      lookup('stock.listLots'),
    ])
    const names = (rows: Row[]) => new Map(rows.map((row) => [String(row.id), String(row.name)]))
    const warehouseNames = names(warehouses)
    const lotNames = names(lots)
    const productNames = new Map(
      templates.flatMap((template) =>
        ((template.variants as Row[]) ?? []).map((variant) => [
          String(variant.id),
          `${String(template.name)}${variant.defaultCode ? ` · ${String(variant.defaultCode)}` : ''}`,
        ]),
      ),
    )
    const quantity = new Intl.NumberFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', {
      maximumFractionDigits: 6,
    })
    const day = new Intl.DateTimeFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', {
      dateStyle: 'short',
      timeZone: 'UTC',
    })
    const page = new URL(query.href, url)
    const ordered = [...scraps].sort(
      (a, b) =>
        QUEUE.indexOf(String(a.state)) - QUEUE.indexOf(String(b.state)) ||
        String(b.dateDone ?? b.date).localeCompare(String(a.dateDone ?? a.date)) ||
        String(b.name).localeCompare(String(a.name)),
    )
    const rows: ScrapRow[] = ordered.map((row) => {
      const at = String(row.dateDone ?? row.date ?? '')
      return {
        id: String(row.id),
        name: String(row.name),
        // The list runs by its queue; its day is a column of its own, sortable as text.
        date: at,
        dateText: at ? day.format(new Date(at)) : '',
        warehouse: warehouseNames.get(String(row.warehouseId)) ?? String(row.warehouseId),
        product: productNames.get(String(row.productId)) ?? String(row.productId),
        lot: row.lotId ? (lotNames.get(String(row.lotId)) ?? String(row.lotId)) : '',
        quantity: Number(row.quantity),
        quantityText: quantity.format(Number(row.quantity)),
        reason: String(row.reason),
        reasonText: _(`stock_backend.scrap.reason.${String(row.reason)}`),
        state: String(row.state),
        stateText: _(`stock_backend.scrap.state.${String(row.state)}`),
        href: recordModalHref(page, { kind: 'stock.scrap', id: String(row.id) }),
      }
    })
    const filtered = applyRowListState(scrapListSearch, state, rows)
    const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      current = Math.min(query.page, pages)
    const href = scrapHref(query.href, { page: current > 1 ? String(current) : null })
    const favorites = await loadListFavorites(ctx, url, req, scrapListSearch, state)
    const answer: ScrapAnswer = {
      query: { ...query, href, page: current },
      total: filtered.length,
      page: current,
      pages,
      counts: { all: rows.length },
      isEmpty: !rows.length,
      rows: filtered.slice((current - 1) * query.pageSize, current * query.pageSize),
      search: scrapSearch(_, state, href, favorites),
      warehouses: warehouses.length
        ? [
            {
              id: '',
              name: _('stock_backend.scrap.allWarehouses'),
              href: scrapHref(query.href, { warehouse: null, page: null }),
              active: !query.warehouse,
            },
            ...warehouses.map((warehouse) => ({
              id: String(warehouse.id),
              name: String(warehouse.name),
              href: scrapHref(query.href, { warehouse: String(warehouse.id), page: null }),
              active: query.warehouse === String(warehouse.id),
            })),
          ]
        : [],
      sorts: Object.fromEntries(
        SORTS.map((key) => [
          key,
          {
            href: scrapHref(
              encodeListState(
                {
                  ...state,
                  page: 1,
                  sort: [
                    { key, dir: state.sort[0]?.key === key && state.sort[0]?.dir === 'asc' ? 'desc' : 'asc' },
                  ],
                },
                requested,
              ),
              {},
            ),
            ...(state.sort[0]?.key === key ? { direction: state.sort[0].dir } : {}),
          },
        ]),
      ),
      ...(current > 1
        ? { previous: scrapHref(href, { page: current > 2 ? String(current - 1) : null }) }
        : {}),
      ...(current < pages ? { next: scrapHref(href, { page: String(current + 1) }) } : {}),
    }
    return json({ ok: true, value: answer })
  }
