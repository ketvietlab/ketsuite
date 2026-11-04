import { json, text, parseListState, encodeListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Row } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { applyRowListState, rowListGroups } from '../../backend/row-list.ts'
import { loadListFavorites } from '../../backend/search-filter.ts'
import { inLocale } from '../../backend/screen.ts'
import { forecastListSearch } from '../search.ts'
import { forecastSearch } from '../forecast/search.ts'
import { forecastHref, forecastQuery } from '../forecast/shared.ts'
import type { ForecastRow, ForecastAnswer } from '../forecast/shared.ts'
import { dayText, forecastPagePath, quantityText } from '../forecast/format.ts'

/** K40: the forecast list's single paged read. */
export const forecastDataRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (
      req.headers['sec-fetch-site'] === 'cross-site' ||
      !(await ctx.allows('stock.getForecastCollection', url, req))
    )
      return text('Forbidden', { status: 403 })
    const input = await readForm(req),
      query = forecastQuery(
        new URL(input.href || '/admin/stock/forecast', url),
        Number(input.pageSize) || undefined,
      )
    const requested = new URL(query.href, url),
      state = parseListState(forecastListSearch, requested).state
    const lang = ctx.localeOf(url, req),
      _ = ctx.translate(lang)
    // K43: sales and accounting read the forecast but not the rules behind it.
    const readsRules = await ctx.allows('stock.getOrderpointCollection', url, req)
    const answerOf = (await ctx.call('stock.getForecastCollection', {}, url, req)) as { rows: Row[] }
    const rows: ForecastRow[] = answerOf.rows.map((row, queue) => {
      const rule = row.rule as { minQuantity: number } | null
      const status = String(row.status)
      return {
        id: `${String(row.warehouseId)}:${String(row.productId)}`,
        queue,
        product: row.productCode
          ? `${String(row.productName)} · ${String(row.productCode)}`
          : String(row.productName),
        warehouse: String(row.warehouse),
        usable: `${quantityText(lang, Number(row.usable))} ${String(row.uom)}`.trim(),
        incoming: quantityText(lang, Number(row.incoming)),
        outgoing: quantityText(lang, Number(row.outgoing)),
        // The number sorts and filters; its text is what the column shows.
        forecast: Number(row.forecast),
        forecastText: quantityText(lang, Number(row.forecast)),
        onOrder: Number(row.onOrder) ? quantityText(lang, Number(row.onOrder)) : '',
        minQuantity: rule && readsRules ? quantityText(lang, rule.minQuantity) : '',
        shortDate: dayText(lang, String(row.shortDate ?? '')),
        status: readsRules || status !== 'belowMin' ? status : 'ok',
        statusLabel: _(
          `stock_backend.forecast.status.${readsRules || status !== 'belowMin' ? status : 'ok'}`,
        ),
        editHref: inLocale(url, forecastPagePath(String(row.warehouseId), String(row.productId))),
      }
    })
    const filtered = applyRowListState(forecastListSearch, state, rows)
    const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      page = Math.min(query.page, pages)
    const href = forecastHref(query.href, { page: page > 1 ? String(page) : null })
    const favorites = await loadListFavorites(ctx, url, req, forecastListSearch, state)
    const answer: ForecastAnswer = {
      query: { ...query, href, page },
      total: filtered.length,
      page,
      pages,
      counts: { all: rows.length },
      isEmpty: !rows.length,
      rows: filtered.slice((page - 1) * query.pageSize, page * query.pageSize),
      search: forecastSearch(_, state, href, favorites),
      ...(state.groupBy.length
        ? {
            groups: rowListGroups(forecastListSearch, state, filtered, requested, (key, value) =>
              key === 'status' ? _(`stock_backend.forecast.status.${value}`) : String(value ?? '—'),
            ),
          }
        : {}),
      sorts: Object.fromEntries(
        ['product', 'forecast'].map((key) => [
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
      ...(page > 1 ? { previous: forecastHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
      ...(page < pages ? { next: forecastHref(href, { page: String(page + 1) }) } : {}),
    }
    return json({ ok: true, value: answer })
  }
