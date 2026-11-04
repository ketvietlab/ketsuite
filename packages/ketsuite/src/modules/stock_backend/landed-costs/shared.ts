import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { SearchFilterConfig, KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'

export const LANDED_COSTS_PATH = '/admin/stock/landed-costs'
export type LandedCostRow = Row & {
  id: string
  name: string
  dateText: string
  vendor: string
  receipts: string
  totalText: string
  state: string
  stateText: string
  /** The cost's own page. */
  href: string
}
export type LandedCostQuery = PagedQuery & { href: string }
export type LandedCostAnswer = PagedAnswer<LandedCostQuery> & {
  rows: LandedCostRow[]
  isEmpty: boolean
  counts: { all: number }
  /** What the costs that match come to, posted or not, cancelled ones aside. */
  sumText: string
  search: SearchFilterConfig
  sorts: Record<string, { href: string; direction?: 'asc' | 'desc' }>
  previous?: string
  next?: string
}
export type LandedCostProps = IslandProps & {
  key: string
  query: LandedCostQuery
  source: string
  search: SearchFilterConfig
  labels: KetTableLabels & Record<string, string>
}
export function landedCostQuery(url: URL, pageSize?: number): LandedCostQuery {
  const clean = new URL(LANDED_COSTS_PATH, url)
  for (const key of ['lang', 'company', 'branch', 'q', 'sort', 'preset', 'filter', 'favorite']) {
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
export const landedCostHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return landedCostQuery(url).href
}

/** Adds amounts written in the company currency's decimals, exactly. */
export const sumAmounts = (amounts: readonly unknown[]) => {
  const texts = amounts.map((amount) => String(amount ?? '0'))
  const scale = Math.max(0, ...texts.map((text) => text.split('.')[1]?.length ?? 0))
  const minor = texts.reduce((total, text) => {
    const [whole = '0', fraction = ''] = text.split('.')
    return total + BigInt(`${whole}${fraction.padEnd(scale, '0')}`)
  }, 0n)
  const digits = minor.toString().padStart(scale + 1, '0')
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
}
