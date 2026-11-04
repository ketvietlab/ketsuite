import type { TableGroup } from '../../../ui/index.ts'
import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { SearchFilterConfig, KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'
export const FORECAST_PATH = '/admin/stock/forecast'
export type ForecastRow = Row & { id: string; product: string; editHref: string }
export type ForecastQuery = PagedQuery & { href: string }
export type ForecastAnswer = PagedAnswer<ForecastQuery> & {
  rows: ForecastRow[]
  isEmpty: boolean
  counts: { all: number }
  search: SearchFilterConfig
  groups?: TableGroup<ForecastRow>[]
  sorts: Record<string, { href: string; direction?: 'asc' | 'desc' }>
  previous?: string
  next?: string
}
export type ForecastProps = IslandProps & {
  key: string
  query: ForecastQuery
  source: string
  search: SearchFilterConfig
  labels: KetTableLabels & Record<string, string>
}
export function forecastQuery(url: URL, pageSize?: number): ForecastQuery {
  const clean = new URL(FORECAST_PATH, url)
  for (const key of [
    'lang',
    'company',
    'branch',
    'q',
    'sort',
    'preset',
    'filter',
    'group',
    'open',
    'groupPage',
    'favorite',
    'archived',
  ]) {
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
    page,
    pageSize: size,
  }
}
export const forecastHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return forecastQuery(url).href
}
