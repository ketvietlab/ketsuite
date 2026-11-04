import { json, text, parseListState, encodeListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Row } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { applyRowListState, rowListGroups } from '../../backend/row-list.ts'
import { loadListFavorites } from '../../backend/search-filter.ts'
import { replenishmentListSearch } from '../search.ts'
import { replenishmentSearch } from '../replenishment/search.ts'
import { replenishmentHref, replenishmentQuery } from '../replenishment/shared.ts'
import type { ReplenishmentRow, ReplenishmentAnswer } from '../replenishment/shared.ts'

/** The collection's single paged read: no business rows enter the server-rendered page. */
export const replenishmentDataRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (
      req.headers['sec-fetch-site'] === 'cross-site' ||
      !(await ctx.allows('stock.getOrderpointCollection', url, req))
    )
      return text('Forbidden', { status: 403 })
    const input = await readForm(req),
      query = replenishmentQuery(
        new URL(input.href || '/admin/stock/replenishment', url),
        Number(input.pageSize) || undefined,
      )
    const requested = new URL(query.href, url),
      state = parseListState(replenishmentListSearch, requested).state
    const _ = ctx.translate(ctx.localeOf(url, req))
    const records = (await ctx.call('stock.getOrderpointCollection', {}, url, req)) as Row[]
    const rows: ReplenishmentRow[] = records.map((row) => ({
      ...row,
      id: String(row.id),
      product: String(row.product),
      location: `${row.warehouse} · ${row.location}`,
      triggerLabel: _(`stock_backend.trigger.${row.trigger}`),
      sourceName: String(row.sourceName || _(`stock_backend.replenishment.source.${row.source}`)),
      editHref: replenishmentHref(query.href, {}).replace(
        '/admin/stock/replenishment',
        `/admin/stock/replenishment/${encodeURIComponent(String(row.id))}`,
      ),
    }))
    const filtered = applyRowListState(replenishmentListSearch, state, rows)
    const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      page = Math.min(query.page, pages)
    const href = replenishmentHref(query.href, { page: page > 1 ? String(page) : null })
    const favorites = await loadListFavorites(ctx, url, req, replenishmentListSearch, state)
    const answer: ReplenishmentAnswer = {
      query: { ...query, href, page },
      total: filtered.length,
      page,
      pages,
      counts: { all: rows.length },
      isEmpty: !rows.length,
      rows: filtered.slice((page - 1) * query.pageSize, page * query.pageSize),
      search: replenishmentSearch(_, state, href, favorites),
      ...(state.groupBy.length
        ? {
            groups: rowListGroups(replenishmentListSearch, state, filtered, requested, (key, value) =>
              key === 'trigger' ? _(`stock_backend.trigger.${value}`) : String(value ?? '—'),
            ),
          }
        : {}),
      sorts: Object.fromEntries(
        ['product', 'toOrder'].map((key) => [
          key,
          {
            href: encodeListState(
              {
                ...state,
                page: 1,
                sort: [
                  { key, dir: state.sort[0]?.key === key && state.sort[0]?.dir === 'asc' ? 'desc' : 'asc' },
                ],
              },
              requested,
            ),
            ...(state.sort[0]?.key === key ? { direction: state.sort[0].dir } : {}),
          },
        ]),
      ),
      ...(page > 1
        ? { previous: replenishmentHref(href, { page: page > 2 ? String(page - 1) : null }) }
        : {}),
      ...(page < pages ? { next: replenishmentHref(href, { page: String(page + 1) }) } : {}),
    }
    return json({ ok: true, value: answer })
  }
