import type { Row } from '@ketvietlab/ketjs'
import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'
export const SEARCH_PATH = '/admin/product/search'
export const SEARCH_PAGE_SIZE = 25
export const SEARCH_KINDS = [
  'template',
  'variant',
  'attribute',
  'unit',
  'category',
  'tag',
  'combo',
  'import',
] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]
export type SearchQuery = PagedQuery & { href: string }
export type SearchRow = Row & {
  id: string
  recordId: string
  name: string
  code: string
  kind: SearchKind
  href: string
}
export type SearchAnswer = PagedAnswer<SearchQuery> & {
  rows: SearchRow[]
  isEmpty: boolean
  previous?: string
  next?: string
}
export type SearchProps = IslandProps & {
  key: string
  query: SearchQuery
  source: string
  labels: KetTableLabels & Record<string, string>
}
export function searchQuery(url: URL): SearchQuery {
  const clean = new URL(SEARCH_PATH, url)
  for (const key of ['lang', 'company', 'branch']) {
    const value = url.searchParams.get(key)
    if (value) clean.searchParams.set(key, value)
  }
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
  if (q) clean.searchParams.set('q', q)
  const requested = Number(url.searchParams.get('page')),
    page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1
  if (page > 1) clean.searchParams.set('page', String(page))
  return { href: clean.pathname + clean.search, q, page, pageSize: SEARCH_PAGE_SIZE }
}
export const searchHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return searchQuery(url).href
}
