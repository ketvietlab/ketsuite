import { json, text, parseListState, encodeListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Row } from '@ketvietlab/ketjs'
import { addDecimals } from '../../account/money.ts'
import { readForm } from '../../backend/forms.ts'
import { applyRowListState } from '../../backend/row-list.ts'
import { loadListFavorites } from '../../backend/search-filter.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { valuationListSearch } from '../search.ts'
import { valuationSearch } from '../valuation/search.ts'
import { VALUATION_PATH, valuationHref, valuationQuery } from '../valuation/shared.ts'
import type { ValuationAnswer, ValuationRow } from '../valuation/shared.ts'

const SORTS = ['code', 'name', 'quantity', 'averageCost', 'value'] as const

/** K26's single paged read: the stock value of every product held, narrowed by the bar. */
export const valuationDataRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (
      req.headers['sec-fetch-site'] === 'cross-site' ||
      !(await ctx.allows('stock.listValuation', url, req))
    )
      return text('Forbidden', { status: 403 })
    const input = await readForm(req),
      query = valuationQuery(new URL(input.href || VALUATION_PATH, url), Number(input.pageSize) || undefined)
    const requested = new URL(query.href, url),
      state = parseListState(valuationListSearch, requested).state
    const _ = ctx.translate(ctx.localeOf(url, req))
    const records: Row[] = []
    let currency: unknown = null
    for (let page = 1; ; page++) {
      const answer = (await ctx.call(
        'stock.listValuation',
        { warehouseId: query.warehouse, page, pageSize: 100 },
        url,
        req,
      )) as Row
      currency = answer.currency
      records.push(...((answer.rows as Row[]) ?? []))
      if (page >= Number(answer.pages ?? 1)) break
    }
    const quantity = new Intl.NumberFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', {
      maximumFractionDigits: 6,
    })
    const rows: ValuationRow[] = records.map((row) => ({
      id: String(row.productId),
      code: String(row.code ?? ''),
      name: String(row.name ?? ''),
      // Numbers sort numerically; the text columns keep every digit for display.
      quantity: Number(row.quantity),
      averageCost: Number(row.averageCost),
      value: Number(row.value),
      exactValue: String(row.value),
      quantityText: quantity.format(Number(row.quantity)),
      uomName: String(row.uomName ?? ''),
      averageCostText: formatMoney(_, row.averageCost, currency),
      valueText: formatMoney(_, row.value, currency),
    }))
    const filtered = applyRowListState(valuationListSearch, state, rows)
    const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      page = Math.min(query.page, pages)
    const href = valuationHref(query.href, { page: page > 1 ? String(page) : null })
    const favorites = await loadListFavorites(ctx, url, req, valuationListSearch, state)
    const warehouses = (await ctx.allows('stock.listWarehouses', url, req))
      ? ((await ctx.call('stock.listWarehouses', {}, url, req)) as Row[])
      : []
    const answer: ValuationAnswer = {
      query: { ...query, href, page },
      total: filtered.length,
      page,
      pages,
      counts: { all: rows.length },
      isEmpty: !rows.length,
      rows: filtered.slice((page - 1) * query.pageSize, page * query.pageSize),
      search: valuationSearch(_, state, href, favorites),
      totalText: formatMoney(
        _,
        filtered.reduce((sum, row) => addDecimals(sum, row.exactValue), '0'),
        currency,
      ),
      warehouses: warehouses.length
        ? [
            {
              id: '',
              name: _('stock_backend.valuation.allWarehouses'),
              href: valuationHref(query.href, { warehouse: null, page: null }),
              active: !query.warehouse,
            },
            ...warehouses.map((warehouse) => ({
              id: String(warehouse.id),
              name: String(warehouse.name),
              href: valuationHref(query.href, { warehouse: String(warehouse.id), page: null }),
              active: query.warehouse === String(warehouse.id),
            })),
          ]
        : [],
      sorts: Object.fromEntries(
        SORTS.map((key) => [
          key,
          {
            href: valuationHref(
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
      ...(page > 1 ? { previous: valuationHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
      ...(page < pages ? { next: valuationHref(href, { page: String(page + 1) }) } : {}),
    }
    return json({ ok: true, value: answer })
  }
