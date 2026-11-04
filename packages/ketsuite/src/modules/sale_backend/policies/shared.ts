import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'
export const POLICY_PATH = '/admin/sales/invoicing-policies'
export const POLICY_SETTINGS = ['default', 'own', 'service'] as const
export type PolicySetting = (typeof POLICY_SETTINGS)[number]
export type PolicyRow = Row & {
  id: string
  defaultCode: string
  name: string
  categoryName: string
  type: string
  policy: string
  setting: PolicySetting
  editHref: string
}
export type PolicyQuery = PagedQuery & { href: string }
export type PolicyAnswer = PagedAnswer<PolicyQuery> & {
  rows: PolicyRow[]
  isEmpty: boolean
  counts: Record<'all' | PolicySetting, number>
  previous?: string
  next?: string
}
export type PolicyProps = IslandProps & {
  key: string
  query: PolicyQuery
  source: string
  labels: KetTableLabels & Record<string, string>
}
export type PolicyModalData = {
  lang: 'vi' | 'en'
  record: {
    id: string
    name: string
    defaultCode: string
    categoryName: string
    type: string
    invoicePolicy: string
    setting: PolicySetting
    revisionId: string
  }
  /** The company default for goods (D20), named in the "follow the sales settings" choice. */
  goodsDefault: 'order' | 'delivery'
  permissions: { edit: boolean }
}

export function policyQuery(url: URL, pageSize?: number): PolicyQuery {
  const clean = new URL(POLICY_PATH, url)
  for (const key of ['lang', 'company', 'branch', 'q', 'setting', 'dir']) {
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
export const policyHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return policyQuery(url).href
}
