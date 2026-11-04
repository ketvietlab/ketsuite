import { json, text, parseListState, encodeListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Row } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { applyRowListState } from '../../backend/row-list.ts'
import { loadListFavorites } from '../../backend/search-filter.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { landedCostListSearch } from '../search.ts'
import { landedCostSearch } from '../landed-costs/search.ts'
import { LANDED_COSTS_PATH, landedCostHref, landedCostQuery, sumAmounts } from '../landed-costs/shared.ts'
import type { LandedCostAnswer, LandedCostRow } from '../landed-costs/shared.ts'

const SORTS = ['name', 'date', 'vendor', 'total'] as const

/** K64's single paged read: the company's landed costs, the newest first. */
export const landedCostsDataRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (
      req.headers['sec-fetch-site'] === 'cross-site' ||
      !(await ctx.allows('stock.listLandedCosts', url, req))
    )
      return text('Forbidden', { status: 403 })
    const input = await readForm(req),
      query = landedCostQuery(
        new URL(input.href || LANDED_COSTS_PATH, url),
        Number(input.pageSize) || undefined,
      )
    const requested = new URL(query.href, url),
      state = parseListState(landedCostListSearch, requested).state
    const _ = ctx.translate(ctx.localeOf(url, req))
    const costs = (await ctx.call('stock.listLandedCosts', {}, url, req)) as Row[]
    const day = new Intl.DateTimeFormat(_.locale === 'en' ? 'en' : 'vi', { timeZone: 'UTC' })
    const scope = new URLSearchParams(
      [...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
    ).toString()
    const ordered = [...costs].sort(
      (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.name).localeCompare(String(a.name)),
    )
    const rows: LandedCostRow[] = ordered.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      date: String(row.date),
      dateText: row.date ? day.format(new Date(`${String(row.date)}T00:00:00Z`)) : '',
      vendor: String(row.vendorName ?? ''),
      receipts: ((row.receipts as Row[] | undefined) ?? []).map((receipt) => String(receipt.name)).join(', '),
      total: Number(row.total),
      totalText: formatMoney(_, row.total, row.currency),
      state: String(row.state),
      stateText: _(`stock_backend.landedCost.state.${String(row.state)}`),
      href: `${LANDED_COSTS_PATH}/${encodeURIComponent(String(row.id))}${scope ? `?${scope}` : ''}`,
    }))
    const filtered = applyRowListState(landedCostListSearch, state, rows)
    const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      current = Math.min(query.page, pages)
    const href = landedCostHref(query.href, { page: current > 1 ? String(current) : null })
    const favorites = await loadListFavorites(ctx, url, req, landedCostListSearch, state)
    const sum = sumAmounts(
      filtered
        .filter((row) => row.state !== 'cancel')
        .map((row) => String(costs.find((cost) => cost.id === row.id)?.total ?? '0')),
    )
    const answer: LandedCostAnswer = {
      query: { ...query, href, page: current },
      total: filtered.length,
      page: current,
      pages,
      counts: { all: rows.length },
      isEmpty: !rows.length,
      rows: filtered.slice((current - 1) * query.pageSize, current * query.pageSize),
      sumText: formatMoney(_, sum, costs[0]?.currency),
      search: landedCostSearch(_, state, href, favorites),
      sorts: Object.fromEntries(
        SORTS.map((key) => [
          key,
          {
            href: landedCostHref(
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
        ? { previous: landedCostHref(href, { page: current > 2 ? String(current - 1) : null }) }
        : {}),
      ...(current < pages ? { next: landedCostHref(href, { page: String(current + 1) }) } : {}),
    }
    return json({ ok: true, value: answer })
  }
