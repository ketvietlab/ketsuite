import { text, parseListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { EmptyState } from '@ketvietlab/design-system'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { adminPage } from '../../backend/screen.ts'
import { agingListSearch, moveAnalysisListSearch, moveHistoryListSearch } from '../search.ts'
import { stockReportControls, stockReportResults, stockReportFooter } from '../reports/island.tsx'
import { stockReportSearch } from '../reports/search.ts'
import { STOCK_REPORTS, reportQuery } from '../reports/shared.ts'
import type { ReportColumn, ReportProps, StockReport } from '../reports/shared.ts'
import { StockReportHelp } from './stock-reports-help.tsx'

type Column = Omit<ReportColumn, 'label'> & { label: string }
const COLUMNS: Record<StockReport, Column[]> = {
  analysis: [
    { key: 'dateText', label: 'analysis.col.date', kind: 'date', sort: 'date' },
    { key: 'pickingName', label: 'analysis.col.picking', kind: 'identifier', sort: 'pickingName' },
    { key: 'product', label: 'analysis.col.product', priority: 'primary', sort: 'product' },
    { key: 'kindText', label: 'analysis.col.kind' },
    { key: 'stateText', label: 'analysis.col.state', kind: 'status' },
    { key: 'demandText', label: 'analysis.col.demand', kind: 'number' },
    { key: 'quantityText', label: 'analysis.col.quantity', kind: 'number' },
    { key: 'uomName', label: 'valuation.col.uom' },
    { key: 'valueText', label: 'analysis.col.value', kind: 'currency', priority: 'secondary', sort: 'value' },
    { key: 'remainingText', label: 'analysis.col.remaining', kind: 'number', sort: 'remaining' },
    { key: 'remainingValueText', label: 'analysis.col.remainingValue', kind: 'currency' },
  ],
  aging: [
    { key: 'code', label: 'aging.col.code', kind: 'identifier', sort: 'code' },
    { key: 'name', label: 'aging.col.name', priority: 'primary', sort: 'name' },
    { key: 'warehouse', label: 'aging.col.warehouse' },
    { key: 'quantityText', label: 'aging.col.quantity', kind: 'number', sort: 'quantity' },
    { key: 'uomName', label: 'valuation.col.uom' },
    { key: 'age30Text', label: 'aging.col.age30', kind: 'number' },
    { key: 'age60Text', label: 'aging.col.age60', kind: 'number' },
    { key: 'age90Text', label: 'aging.col.age90', kind: 'number' },
    { key: 'ageOlderText', label: 'aging.col.ageOlder', kind: 'number', sort: 'ageOlder' },
    { key: 'oldestText', label: 'aging.col.oldest', kind: 'date', sort: 'oldest' },
    { key: 'valueText', label: 'aging.col.value', kind: 'currency', priority: 'secondary', sort: 'value' },
  ],
  history: [
    { key: 'dateText', label: 'history.col.date', kind: 'date', sort: 'doneAt' },
    { key: 'pickingName', label: 'history.col.picking', kind: 'identifier', sort: 'pickingName' },
    { key: 'product', label: 'history.col.product', priority: 'primary', sort: 'product' },
    { key: 'lot', label: 'history.col.lot', kind: 'identifier' },
    { key: 'from', label: 'history.col.from' },
    { key: 'to', label: 'history.col.to' },
    { key: 'quantityText', label: 'history.col.quantity', kind: 'number', sort: 'quantity' },
    { key: 'uomName', label: 'valuation.col.uom' },
    { key: 'kindText', label: 'history.col.kind' },
  ],
}
const SPECS = {
  analysis: moveAnalysisListSearch,
  aging: agingListSearch,
  history: moveHistoryListSearch,
} as const
const NEEDS = {
  analysis: 'stock.listMoveAnalysis',
  aging: 'stock.listStockAging',
  history: 'stock.listMoveHistory',
} as const

const labels = (report: StockReport, _: Translator): ReportProps['labels'] => ({
  title: _(`stock_backend.${report}.title`),
  warehouse: _('stock_backend.valuation.warehouse'),
  allWarehouses: _('stock_backend.valuation.allWarehouses'),
  noMatches: _(`stock_backend.${report}.noMatches`),
  noMatchesHint: _('stock_backend.valuation.noMatchesHint'),
  denied: _(`stock_backend.${report}.denied`),
  offline: _('stock_backend.valuation.offline'),
  loadError: _(`stock_backend.${report}.loadError`),
  emptyHint: _(`stock_backend.${report}.emptyHint`),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  region: _(`stock_backend.${report}.title`),
  empty: _(`stock_backend.${report}.empty`),
  loading: _('backend.relation.loading'),
  retry: _('backend.relation.retry'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
})

const helpFrame = (report: StockReport, _: Translator, frame: Frame) => ({
  ...frame,
  chrome: null,
  topbar: false,
  ...(frame.applications
    ? { applications: { ...frame.applications, helpLabel: _(`stock_backend.${report}.help`) } }
    : {}),
})

function reportScreen(report: StockReport, _: Translator, frame: Frame, url: URL) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = reportQuery(report, url)
  const source = new URL(`${STOCK_REPORTS[report].path}/data`, url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: ReportProps = {
    key: `${report}:${query.href}`,
    report,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(report, _),
    columns: COLUMNS[report].map((column) => ({ ...column, label: _(`stock_backend.${column.label}`) })),
    search: stockReportSearch(report, _, parseListState(SPECS[report], url).state, query.href),
  }
  const part = (name: string, controller: typeof stockReportControls) =>
    html`${trustedMarkup(renderIsland(`stock.report-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  return shell(
    _,
    _(`stock_backend.${report}.title`),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_(`stock_backend.${report}.title`)}
        controls={part('controls', stockReportControls)}
        body={part('results', stockReportResults)}
        footer={part('footer', stockReportFooter)}
      />
      <StockReportHelp report={report} lang={lang} />
    </>,
    helpFrame(report, _, frame),
  )
}

/** A role that may not read stock value meets its own locked page rather than an empty list. */
function lockedScreen(report: StockReport, _: Translator, frame: Frame) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  return shell(
    _,
    _(`stock_backend.${report}.title`),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_(`stock_backend.${report}.title`)}
        body={
          <EmptyState
            visual="locked"
            title={_(`stock_backend.${report}.locked`)}
            message={
              _.resolves(`stock_backend.${report}.lockedHint`)
                ? _(`stock_backend.${report}.lockedHint`)
                : _('stock_backend.valuation.lockedHint')
            }
          />
        }
      />
      <StockReportHelp report={report} lang={lang} />
    </>,
    helpFrame(report, _, frame),
  )
}

const reportRoute =
  (report: StockReport) =>
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const allowed = await ctx.allows(NEEDS[report], url, req)
    return adminPage(ctx, url, req, {
      title: `stock_backend.${report}.title`,
      ...(allowed ? {} : { status: 403 }),
      body: (_, frame) => (allowed ? reportScreen(report, _, frame, url) : lockedScreen(report, _, frame)),
    })
  }

export const moveAnalysisRoute = reportRoute('analysis')
export const agingRoute = reportRoute('aging')
export const moveHistoryRoute = reportRoute('history')
