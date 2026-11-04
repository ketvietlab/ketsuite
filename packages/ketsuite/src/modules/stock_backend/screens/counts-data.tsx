import { json, text, parseListState, encodeListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Row } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { optionalRead } from '../../backend/optional-read.ts'
import { applyRowListState } from '../../backend/row-list.ts'
import { loadListFavorites } from '../../backend/search-filter.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { countListSearch } from '../search.ts'
import { countSearch } from '../counts/search.ts'
import { COUNTS_PATH, countHref, countQuery } from '../counts/shared.ts'
import type { CountAnswer, CountRow } from '../counts/shared.ts'

const SORTS = ['name', 'warehouse', 'date', 'lines'] as const
const QUEUE = ['review', 'counting', 'done', 'cancel']

/** K38's single paged read: the company's physical counts, those waiting for approval first, then the newest. */
export const countsDataRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (
      req.headers['sec-fetch-site'] === 'cross-site' ||
      !(await ctx.allows('stock.listCountSessions', url, req))
    )
      return text('Forbidden', { status: 403 })
    const input = await readForm(req),
      query = countQuery(new URL(input.href || COUNTS_PATH, url), Number(input.pageSize) || undefined)
    const requested = new URL(query.href, url),
      state = parseListState(countListSearch, requested).state
    const _ = ctx.translate(ctx.localeOf(url, req))
    const [counts, warehouses] = await Promise.all([
      ctx.call(
        'stock.listCountSessions',
        query.warehouse ? { warehouseId: query.warehouse } : {},
        url,
        req,
      ) as Promise<Row[]>,
      optionalRead<Row[]>(ctx, 'stock.listWarehouses', {}, url, req, []),
    ])
    const warehouseNames = new Map(warehouses.map((row) => [String(row.id), String(row.name)]))
    const day = new Intl.DateTimeFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', {
      dateStyle: 'short',
      timeZone: 'UTC',
    })
    const page = new URL(query.href, url)
    const ordered = [...counts].sort(
      (a, b) =>
        QUEUE.indexOf(String(a.state)) - QUEUE.indexOf(String(b.state)) ||
        String(b.startedAt).localeCompare(String(a.startedAt)) ||
        String(b.name).localeCompare(String(a.name)),
    )
    const rows: CountRow[] = ordered.map((row) => {
      const at = String(row.startedAt ?? '')
      return {
        id: String(row.id),
        name: String(row.name),
        warehouse: warehouseNames.get(String(row.warehouseId)) ?? String(row.warehouseId),
        scopeText: Array.isArray(row.productIds)
          ? _('stock_backend.count.scopeProducts', { count: String(row.productIds.length) })
          : _('stock_backend.count.scopeAll'),
        date: at,
        dateText: at ? day.format(new Date(at)) : '',
        lines: Number(row.lineCount),
        linesText:
          row.state === 'counting'
            ? `${String(row.countedLines)}/${String(row.lineCount)}`
            : String(row.lineCount),
        differing: row.differingLines == null ? null : Number(row.differingLines),
        // K34: a blind count shows no differences until it is sent for approval.
        differingText: row.differingLines == null ? '—' : String(row.differingLines),
        settlementState: row.settlementState,
        state: String(row.state),
        stateText: _(`stock_backend.count.state.${String(row.state)}`),
        href: recordModalHref(page, { kind: 'stock.countSession', id: String(row.id) }),
      }
    })
    const filtered = applyRowListState(countListSearch, state, rows)
    const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      current = Math.min(query.page, pages)
    const href = countHref(query.href, { page: current > 1 ? String(current) : null })
    const favorites = await loadListFavorites(ctx, url, req, countListSearch, state)
    const answer: CountAnswer = {
      query: { ...query, href, page: current },
      total: filtered.length,
      page: current,
      pages,
      counts: { all: rows.length },
      isEmpty: !rows.length,
      rows: filtered.slice((current - 1) * query.pageSize, current * query.pageSize),
      search: countSearch(_, state, href, favorites),
      warehouses: warehouses.length
        ? [
            {
              id: '',
              name: _('stock_backend.count.allWarehouses'),
              href: countHref(query.href, { warehouse: null, page: null }),
              active: !query.warehouse,
            },
            ...warehouses.map((warehouse) => ({
              id: String(warehouse.id),
              name: String(warehouse.name),
              href: countHref(query.href, { warehouse: String(warehouse.id), page: null }),
              active: query.warehouse === String(warehouse.id),
            })),
          ]
        : [],
      sorts: Object.fromEntries(
        SORTS.map((key) => [
          key,
          {
            href: countHref(
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
        ? { previous: countHref(href, { page: current > 2 ? String(current - 1) : null }) }
        : {}),
      ...(current < pages ? { next: countHref(href, { page: String(current + 1) }) } : {}),
    }
    return json({ ok: true, value: answer })
  }
