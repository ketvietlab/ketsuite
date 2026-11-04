import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { SearchFilterConfig, KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'

export const VALUATION_PATH = '/admin/stock/valuation'
export type ValuationRow = Row & {
  id: string
  code: string
  name: string
  quantityText: string
  uomName: string
  averageCostText: string
  valueText: string
}
export type ValuationQuery = PagedQuery & { href: string; warehouse: string | null }
export type ValuationWarehouse = { id: string; name: string; href: string; active: boolean }
export type ValuationAnswer = PagedAnswer<ValuationQuery> & {
  rows: ValuationRow[]
  isEmpty: boolean
  counts: { all: number }
  search: SearchFilterConfig
  warehouses: ValuationWarehouse[]
  /** Sum of the value of every row the filter keeps, not only this page. */
  totalText: string
  sorts: Record<string, { href: string; direction?: 'asc' | 'desc' }>
  previous?: string
  next?: string
}
export type ValuationProps = IslandProps & {
  key: string
  query: ValuationQuery
  source: string
  search: SearchFilterConfig
  labels: KetTableLabels & Record<string, string>
}
export function valuationQuery(url: URL, pageSize?: number): ValuationQuery {
  const clean = new URL(VALUATION_PATH, url)
  for (const key of ['lang', 'company', 'branch', 'q', 'sort', 'preset', 'filter', 'favorite', 'warehouse']) {
    for (const value of url.searchParams.getAll(key)) clean.searchParams.append(key, value)
  }
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
export const valuationHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return valuationQuery(url).href
}
