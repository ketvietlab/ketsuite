import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'
export const CATEGORY_PATH = '/admin/product/categories'
export type CategoryRow = Row & {
  id: string
  name: string
  path: string
  parentId: string | null
  active: boolean
  income: string
  expense: string
  productCount: number
  editHref: string
}
export type CategoryQuery = PagedQuery & { href: string }
export type CategoryAnswer = PagedAnswer<CategoryQuery> & {
  rows: CategoryRow[]
  isEmpty: boolean
  counts: { active: number; archived: number; all: number }
  previous?: string
  next?: string
}
export type CategoryProps = IslandProps & {
  key: string
  query: CategoryQuery
  source: string
  labels: KetTableLabels & Record<string, string>
}
export type CategoryModalData = {
  lang: 'vi' | 'en'
  record: {
    id: string
    name: string
    parentId: string
    incomeAccountId: string
    expenseAccountId: string
    active: boolean
    revision: string
    path: string
  }
  permissions: { general: boolean; accounts: boolean; lifecycle: boolean }
  parents: Array<{ value: string; label: string }>
  incomeAccounts: Array<{ value: string; label: string }>
  expenseAccounts: Array<{ value: string; label: string }>
  inherited: { income: string; expense: string }
  usage: { products: number; children: string[]; pricelists: string[] }
  canArchive: boolean
  canRestore: boolean
}
export function categoryQuery(url: URL, pageSize?: number): CategoryQuery {
  const clean = new URL(CATEGORY_PATH, url)
  for (const key of ['lang', 'company', 'branch', 'q', 'status', 'sort', 'dir']) {
    const value = url.searchParams.get(key)
    if (value) clean.searchParams.set(key, value)
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
export const categoryHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return categoryQuery(url).href
}
