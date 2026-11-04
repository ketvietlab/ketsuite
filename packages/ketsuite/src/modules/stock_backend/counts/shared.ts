import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { SearchFilterConfig, KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'

export const COUNTS_PATH = '/admin/stock/counts'
export type CountRow = Row & {
  id: string
  name: string
  dateText: string
  warehouse: string
  /** K62: "Whole warehouse" or how many products a partial count covers. */
  scopeText: string
  linesText: string
  /** "—" while a blind count hides its differences (K34). */
  differingText: string
  state: string
  stateText: string
  /** The order's record modal on this list. */
  href: string
}
export type CountQuery = PagedQuery & { href: string; warehouse: string | null }
export type CountWarehouse = { id: string; name: string; href: string; active: boolean }
export type CountAnswer = PagedAnswer<CountQuery> & {
  rows: CountRow[]
  isEmpty: boolean
  counts: { all: number }
  search: SearchFilterConfig
  warehouses: CountWarehouse[]
  sorts: Record<string, { href: string; direction?: 'asc' | 'desc' }>
  previous?: string
  next?: string
}
export type CountProps = IslandProps & {
  key: string
  query: CountQuery
  source: string
  search: SearchFilterConfig
  labels: KetTableLabels & Record<string, string>
}
export function countQuery(url: URL, pageSize?: number): CountQuery {
  const clean = new URL(COUNTS_PATH, url)
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
export const countHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return countQuery(url).href
}
