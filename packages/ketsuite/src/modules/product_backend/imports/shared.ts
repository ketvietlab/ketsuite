import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'
export const IMPORT_PATH = '/admin/product/imports'
export type ImportQuery = PagedQuery & { href: string }
export type ImportRow = Row & {
  id: string
  name: string
  actorName: string
  timezone: string
  occurredAt: string
  editHref: string
}
export type ImportAnswer = PagedAnswer<ImportQuery> & { rows: ImportRow[]; previous?: string; next?: string }
export type ImportProps = IslandProps & {
  key: string
  query: ImportQuery
  source: string
  labels: KetTableLabels & Record<string, string>
}
export type ImportModalData = {
  lang: 'vi' | 'en'
  timezone: string
  record: Row & { id: string; name: string; data: string }
  items: Array<Row & { href: string }>
  permissions: { create: boolean }
  download: string
}
export function importQuery(url: URL, pageSize?: number): ImportQuery {
  const clean = new URL(IMPORT_PATH, url)
  for (const key of ['lang', 'company', 'branch', 'q', 'templateId']) {
    const value = url.searchParams.get(key)
    if (value) clean.searchParams.set(key, value)
  }
  const positive = (value: unknown, fallback: number) =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback
  const page = positive(url.searchParams.get('page'), 1),
    size = Math.min(100, positive(pageSize ?? url.searchParams.get('pageSize'), 30))
  if (page > 1) clean.searchParams.set('page', String(page))
  if (size !== 30) clean.searchParams.set('pageSize', String(size))
  return { href: clean.pathname + clean.search, q: clean.searchParams.get('q') ?? '', page, pageSize: size }
}
export const importHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return importQuery(url).href
}
