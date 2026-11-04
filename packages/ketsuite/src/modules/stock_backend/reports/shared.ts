import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { SearchFilterConfig, KetTableLabels } from '@ketvietlab/design-system'
import type { TableGroup } from '../../../ui/index.ts'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'

/**
 * K63's read-only stock reports, the moves analysis and the stock aging. Both are a paged list a warehouse
 * narrows, grouped and filtered by the search bar, with value totals for every row the filter keeps; one
 * island renders either from the columns its page hands it.
 */
export const STOCK_REPORTS = {
  analysis: { path: '/admin/stock/analysis', listKey: 'stock.move-analysis' },
  aging: { path: '/admin/stock/aging', listKey: 'stock.aging' },
  history: { path: '/admin/stock/moves', listKey: 'stock.move-history' },
} as const
export type StockReport = keyof typeof STOCK_REPORTS

export type ReportColumn = {
  key: string
  label: string
  kind?: 'identifier' | 'number' | 'currency' | 'date' | 'status' | 'text'
  priority?: 'primary' | 'secondary'
  /** The field the server sorts the column by, when it sorts. */
  sort?: string
}
export type ReportRow = Row & { id: string; href?: string }
export type ReportQuery = PagedQuery & { href: string; warehouse: string | null }
export type ReportWarehouse = { id: string; name: string; href: string; active: boolean }
export type ReportAnswer = PagedAnswer<ReportQuery> & {
  rows: ReportRow[]
  groups?: TableGroup<ReportRow>[]
  isEmpty: boolean
  counts: { all: number }
  search: SearchFilterConfig
  warehouses: ReportWarehouse[]
  /** Sums over every row the filter keeps, not only this page, already labelled. */
  totals: string[]
  sorts: Record<string, { href: string; direction?: 'asc' | 'desc' }>
  previous?: string
  next?: string
}
export type ReportProps = IslandProps & {
  key: string
  report: StockReport
  query: ReportQuery
  source: string
  search: SearchFilterConfig
  columns: ReportColumn[]
  labels: KetTableLabels & Record<string, string>
}

const KEPT = [
  'lang',
  'company',
  'branch',
  'q',
  'sort',
  'preset',
  'filter',
  'favorite',
  'group',
  'open',
  'groupPage',
  'warehouse',
]

export function reportQuery(report: StockReport, url: URL, pageSize?: number): ReportQuery {
  const clean = new URL(STOCK_REPORTS[report].path, url)
  for (const key of KEPT)
    for (const value of url.searchParams.getAll(key)) clean.searchParams.append(key, value)
  const positive = (value: unknown, fallback: number) =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback
  const page = positive(url.searchParams.get('page'), 1)
  const size = Math.min(100, positive(pageSize ?? url.searchParams.get('pageSize'), 50))
  if (page > 1) clean.searchParams.set('page', String(page))
  if (size !== 50) clean.searchParams.set('pageSize', String(size))
  return {
    href: `${clean.pathname}${clean.search}`,
    q: clean.searchParams.get('q') ?? '',
    warehouse: clean.searchParams.get('warehouse') || null,
    page,
    pageSize: size,
  }
}
export const reportHref = (report: StockReport, href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return reportQuery(report, url).href
}
