import { json, text, parseListState, encodeListState } from '@ketvietlab/ketjs'
import type { ListState, Route, ServeContext, Row, Translator } from '@ketvietlab/ketjs'
import { addDecimals } from '../../account/money.ts'
import { readForm } from '../../backend/forms.ts'
import { applyRowListState, rowListGroups, type RowListSpec } from '../../backend/row-list.ts'
import { loadListFavorites } from '../../backend/search-filter.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { transferHref } from '../routes.ts'
import { agingListSearch, moveAnalysisListSearch, moveHistoryListSearch } from '../search.ts'
import { localizeGeneratedRecords } from '../generated-names.ts'
import { stockReportSearch } from '../reports/search.ts'
import { STOCK_REPORTS, reportHref, reportQuery } from '../reports/shared.ts'
import type { ReportAnswer, ReportRow, StockReport } from '../reports/shared.ts'

/** A civil day, `YYYY-MM-DD`, as the stock screens print one. */
export const dayText = (value: unknown): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

type Built = {
  rows: ReportRow[]
  totals: (rows: ReportRow[]) => string[]
  group: (key: string, value: unknown) => string
}
type Report = {
  report: StockReport
  spec: RowListSpec
  needs: string
  sorts: readonly string[]
  build: (
    ctx: ServeContext,
    _: Translator,
    url: URL,
    req: Parameters<Route>[1],
    warehouse: string | null,
  ) => Promise<Built>
}

const numbers = (_: Translator) =>
  new Intl.NumberFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 6 })
const sum = (rows: ReportRow[], key: string) =>
  rows.reduce((total, row) => (row[key] == null ? total : addDecimals(total, String(row[key]))), '0')

/** K63's paged reads: one POST answers the island with the page, the groups and the totals. */
const reportDataRoute =
  (report: Report) =>
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (req.headers['sec-fetch-site'] === 'cross-site' || !(await ctx.allows(report.needs, url, req)))
      return text('Forbidden', { status: 403 })
    const { path } = STOCK_REPORTS[report.report]
    const input = await readForm(req),
      query = reportQuery(
        report.report,
        new URL(input.href || path, url),
        Number(input.pageSize) || undefined,
      )
    const requested = new URL(query.href, url),
      state: ListState = parseListState(report.spec, requested).state
    const _ = ctx.translate(ctx.localeOf(url, req))
    const built = await report.build(ctx, _, requested, req, query.warehouse)
    const filtered = applyRowListState(report.spec, state, built.rows)
    const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      page = Math.min(query.page, pages)
    const href = reportHref(report.report, query.href, { page: page > 1 ? String(page) : null })
    const favorites = await loadListFavorites(ctx, url, req, report.spec, state)
    const warehouses = (await ctx.allows('stock.listWarehouses', url, req))
      ? ((await ctx.call('stock.listWarehouses', {}, url, req)) as Row[])
      : []
    const answer: ReportAnswer = {
      query: { ...query, href, page },
      total: filtered.length,
      page,
      pages,
      counts: { all: built.rows.length },
      isEmpty: !built.rows.length,
      rows: filtered.slice((page - 1) * query.pageSize, page * query.pageSize),
      ...(state.groupBy.length
        ? { groups: rowListGroups(report.spec, state, filtered, requested, built.group) }
        : {}),
      search: stockReportSearch(report.report, _, state, href, favorites),
      totals: built.totals(filtered),
      warehouses: warehouses.length
        ? [
            {
              id: '',
              name: _('stock_backend.valuation.allWarehouses'),
              href: reportHref(report.report, query.href, { warehouse: null, page: null }),
              active: !query.warehouse,
            },
            ...warehouses.map((warehouse) => ({
              id: String(warehouse.id),
              name: String(warehouse.name),
              href: reportHref(report.report, query.href, { warehouse: String(warehouse.id), page: null }),
              active: query.warehouse === String(warehouse.id),
            })),
          ]
        : [],
      sorts: Object.fromEntries(
        report.sorts.map((key) => [
          key,
          {
            href: reportHref(
              report.report,
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
      ...(page > 1
        ? { previous: reportHref(report.report, href, { page: page > 2 ? String(page - 1) : null }) }
        : {}),
      ...(page < pages ? { next: reportHref(report.report, href, { page: String(page + 1) }) } : {}),
    }
    return json({ ok: true, value: answer })
  }

const dateGroup = (value: unknown) => {
  const text = String(value ?? '')
  return /^\d{4}-\d{2}$/.test(text) ? `${text.slice(5, 7)}/${text.slice(0, 4)}` : dayText(text) || '—'
}

export const moveAnalysisDataRoute = reportDataRoute({
  report: 'analysis',
  spec: moveAnalysisListSearch,
  needs: 'stock.listMoveAnalysis',
  sorts: ['date', 'pickingName', 'product', 'value', 'remaining'],
  build: async (ctx, _, url, req, warehouse) => {
    const answer = (await ctx.call('stock.listMoveAnalysis', { warehouseId: warehouse }, url, req)) as Row
    const quantity = numbers(_)
    const count = (value: unknown) => (value == null ? '' : quantity.format(Number(value)))
    const money = (value: unknown) => (value == null ? '' : formatMoney(_, value, answer.currency))
    const rows: ReportRow[] = ((answer.rows as Row[]) ?? []).map((row) => ({
      id: String(row.id),
      href: transferHref(url, String(row.pickingId)),
      date: String(row.date),
      dateText: dayText(row.date),
      pickingName: String(row.pickingName),
      code: String(row.code ?? ''),
      product: String(row.code ? `[${row.code}] ${row.name}` : row.name),
      kind: String(row.kind),
      kindText: _(`stock_backend.analysis.kind.${String(row.kind)}`),
      state: String(row.state),
      stateText: _(`stock_backend.state.${String(row.state)}`),
      uomName: String(row.uomName ?? ''),
      // Numbers filter and sort numerically; the text columns keep every digit for display.
      demand: Number(row.demand),
      quantity: Number(row.quantity),
      value: row.value == null ? null : Number(row.value),
      remaining: row.remaining == null ? null : Number(row.remaining),
      exactValue: row.value == null ? null : String(row.value),
      exactRemainingValue: row.remainingValue == null ? null : String(row.remainingValue),
      demandText: count(row.demand),
      quantityText: count(row.quantity),
      valueText: money(row.value),
      remainingText: count(row.remaining),
      remainingValueText: money(row.remainingValue),
    }))
    return {
      rows,
      totals: (kept) => [
        `${_('stock_backend.analysis.total.value')}: ${formatMoney(_, sum(kept, 'exactValue'), answer.currency)}`,
        `${_('stock_backend.analysis.total.remainingValue')}: ${formatMoney(_, sum(kept, 'exactRemainingValue'), answer.currency)}`,
      ],
      group: (key, value) =>
        key === 'kind'
          ? _(`stock_backend.analysis.kind.${String(value)}`)
          : key === 'state'
            ? _(`stock_backend.state.${String(value)}`)
            : key === 'date'
              ? dateGroup(value)
              : String(value ?? '—'),
    }
  },
})

export const agingDataRoute = reportDataRoute({
  report: 'aging',
  spec: agingListSearch,
  needs: 'stock.listStockAging',
  sorts: ['code', 'name', 'quantity', 'ageOlder', 'oldest', 'value'],
  build: async (ctx, _, url, req, warehouse) => {
    const answer = (await ctx.call('stock.listStockAging', { warehouseId: warehouse }, url, req)) as Row
    const quantity = numbers(_)
    const rows: ReportRow[] = ((answer.rows as Row[]) ?? []).map((row) => ({
      id: String(row.id),
      code: String(row.code ?? ''),
      name: String(row.name ?? ''),
      warehouse: String(row.warehouseName ?? '—'),
      uomName: String(row.uomName ?? ''),
      quantity: Number(row.quantity),
      age30: Number(row.age30),
      age60: Number(row.age60),
      age90: Number(row.age90),
      ageOlder: Number(row.ageOlder),
      oldest: String(row.oldest ?? ''),
      value: Number(row.value),
      exactValue: String(row.value),
      ...Object.fromEntries(
        ['quantity', 'age30', 'age60', 'age90', 'ageOlder'].map((key) => [
          `${key}Text`,
          quantity.format(Number(row[key])),
        ]),
      ),
      oldestText: dayText(row.oldest),
      valueText: formatMoney(_, row.value, answer.currency),
    }))
    return {
      rows,
      totals: (kept) => [
        `${_('stock_backend.valuation.total')}: ${formatMoney(_, sum(kept, 'exactValue'), answer.currency)}`,
      ],
      group: (_key, value) => String(value ?? '—'),
    }
  },
})

export const moveHistoryDataRoute = reportDataRoute({
  report: 'history',
  spec: moveHistoryListSearch,
  needs: 'stock.listMoveHistory',
  sorts: ['doneAt', 'pickingName', 'product', 'quantity'],
  build: async (ctx, _, url, req, warehouse) => {
    const [answer, locations, warehouses] = await Promise.all([
      ctx.call('stock.listMoveHistory', { warehouseId: warehouse }, url, req) as Promise<Row>,
      ctx.call('stock.listLocations', {}, url, req) as Promise<Row[]>,
      ctx.call('stock.listWarehouses', {}, url, req) as Promise<Row[]>,
    ])
    const codes = new Map(warehouses.map((row) => [String(row.id), String(row.code ?? row.name)]))
    // A location reads as its warehouse's code and its name, `WH/Kho`, so two warehouses' stock tell apart.
    const names = new Map(
      localizeGeneratedRecords(_, locations, 'location').map((row) => [
        String(row.id),
        row.warehouseId && codes.has(String(row.warehouseId))
          ? `${codes.get(String(row.warehouseId))}/${String(row.name)}`
          : String(row.name),
      ]),
    )
    const quantity = numbers(_)
    const rows: ReportRow[] = ((answer.rows as Row[]) ?? []).map((row) => ({
      id: String(row.id),
      href: transferHref(url, String(row.pickingId)),
      doneAt: String(row.doneAt),
      date: String(row.date),
      dateText: dayText(row.date),
      period: String(row.period),
      pickingName: String(row.pickingName),
      code: String(row.code ?? ''),
      name: String(row.name),
      product: String(row.code ? `[${row.code}] ${row.name}` : row.name),
      lot: String(row.lot ?? ''),
      from: names.get(String(row.locationId)) ?? String(row.locationId),
      to: names.get(String(row.locationDestId)) ?? String(row.locationDestId),
      kind: String(row.kind),
      kindText: _(`stock_backend.analysis.kind.${String(row.kind)}`),
      quantity: Number(row.quantity),
      quantityText: quantity.format(Number(row.quantity)),
      uomName: String(row.uomName ?? ''),
    }))
    return {
      rows,
      totals: () => [],
      group: (key, value) =>
        key === 'kind'
          ? _(`stock_backend.analysis.kind.${String(value)}`)
          : key === 'date'
            ? dateGroup(value)
            : String(value ?? '—'),
    }
  },
})
