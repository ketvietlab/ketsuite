import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'
export const COMBO_PATH = '/admin/product/combos'
export type ComboRow = Row & {
  id: string
  name: string
  active: boolean
  itemCount: number
  productCount: number
  editHref: string
}
export type ComboQuery = PagedQuery & { href: string }
export type ComboAnswer = PagedAnswer<ComboQuery> & {
  rows: ComboRow[]
  isEmpty: boolean
  counts: { active: number; archived: number; all: number }
  previous?: string
  next?: string
}
export type ComboProps = IslandProps & {
  key: string
  query: ComboQuery
  source: string
  labels: KetTableLabels & Record<string, string>
}
export type ComboModalData = {
  lang: 'vi' | 'en'
  record: {
    id: string
    name: string
    active: boolean
    revisionId: string
    items: Array<{ id: string; productId: string; extraPrice: string }>
  }
  choices: Array<{ value: string; label: string }>
  permissions: { edit: boolean; lifecycle: boolean }
  usage: { products: number; names: string[] }
}

export function comboQuery(url: URL, pageSize?: number): ComboQuery {
  const clean = new URL(COMBO_PATH, url)
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
export const comboHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return comboQuery(url).href
}
