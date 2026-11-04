import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { SearchFilterConfig, KetTableLabels, KetTableServerProps } from '@ketvietlab/design-system'
import type { PagedQuery, PagedAnswer } from '../../../ui/client/paged-collection-store.ts'
type PromotionRow = Record<string, unknown> & { id: string; detailHref: string }
export const LIST_PATH = '/admin/sales/promotions'
export type Query = PagedQuery & { href: string }
export type Answer = PagedAnswer<Query> & {
  rows: PromotionRow[]
  search: SearchFilterConfig
  isEmpty: boolean
  groups?: KetTableServerProps<PromotionRow>['groups']
  sort: Record<string, { href: string; direction?: 'asc' | 'desc' }>
  previous?: string
  next?: string
}
export type Props = IslandProps & {
  key: string
  mode: 'programs' | 'cards'
  source: string
  query: Query
  search: SearchFilterConfig
  labels: KetTableLabels & Record<string, string>
}
const positive = (value: string | null, fallback: number) =>
  value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : fallback
export function queryFromUrl(url: URL): Query {
  const clean = new URL(url)
  for (const name of ['create', 'dialog', 'dialogId', 'returnTo']) clean.searchParams.delete(name)
  const page = positive(clean.searchParams.get('page'), 1)
  const pageSize = Math.min(100, positive(clean.searchParams.get('pageSize'), 25))
  if (page === 1) clean.searchParams.delete('page')
  else clean.searchParams.set('page', String(page))
  clean.searchParams.set('pageSize', String(pageSize))
  return { href: `${clean.pathname}${clean.search}`, q: clean.searchParams.get('q') ?? '', page, pageSize }
}
export function recordBack(url: URL): string {
  const target = url.searchParams.get('returnTo')
  if (target) {
    try {
      const back = new URL(target, url)
      if (back.origin === url.origin && back.pathname === LIST_PATH) return `${back.pathname}${back.search}`
    } catch {}
  }
  const back = new URL(LIST_PATH, url)
  for (const name of ['lang', 'company', 'branch'])
    if (url.searchParams.has(name)) back.searchParams.set(name, url.searchParams.get(name)!)
  return `${back.pathname}${back.search}`
}
