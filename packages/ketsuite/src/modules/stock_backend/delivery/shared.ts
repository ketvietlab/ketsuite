import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { SearchFilterConfig, KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'

/** K48: the shipping screens, after the forecast in the Stock menu; carriers sit in its configuration. */
export const DELIVERY_PATHS = {
  overview: '/admin/stock/delivery',
  dispatch: '/admin/stock/delivery/dispatch',
  shipments: '/admin/stock/shipments',
  statements: '/admin/stock/delivery-statements',
  carriers: '/admin/stock/carriers',
} as const
export type DeliveryList = 'dispatch' | 'shipments' | 'statements' | 'carriers'
export const DELIVERY_LISTS: readonly DeliveryList[] = ['dispatch', 'shipments', 'statements', 'carriers']
export type DeliveryTone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger'

export type DeliveryColumn = {
  key: string
  label: string
  kind?: 'identifier' | 'text' | 'currency' | 'date' | 'status' | 'number'
  priority?: 'primary' | 'secondary'
  /** The field the server sorts the column by. */
  sort?: string
}
export type DeliveryRow = Row & {
  id: string
  /** The row's own page: a parcel, a statement, a delivery or a carrier's record. */
  href: string
  status: string
  statusText: string
  tone: DeliveryTone
}
export type DeliveryQuery = PagedQuery & { href: string }
export type DeliveryAnswer = PagedAnswer<DeliveryQuery> & {
  rows: DeliveryRow[]
  isEmpty: boolean
  counts: { all: number }
  search: SearchFilterConfig
  sorts: Record<string, { href: string; direction?: 'asc' | 'desc' }>
  /** What the rows that match come to, where the list adds up money. */
  sumText?: string
  previous?: string
  next?: string
}
/** What ticking rows does: a function taking their ids, and how its answer reads. */
export type DeliveryBulk = { fn: string; label: string; done: string }
export type DeliveryProps = IslandProps & {
  key: string
  list: DeliveryList
  path: string
  query: DeliveryQuery
  source: string
  search: SearchFilterConfig
  columns: DeliveryColumn[]
  labels: KetTableLabels & Record<string, string>
  bulk?: DeliveryBulk | null
}

const QUERY_KEYS = ['lang', 'company', 'branch', 'q', 'sort', 'preset', 'filter', 'favorite']
export function deliveryQuery(path: string, url: URL, pageSize?: number): DeliveryQuery {
  const clean = new URL(path, url)
  for (const key of QUERY_KEYS)
    for (const value of url.searchParams.getAll(key)) clean.searchParams.append(key, value)
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
export const deliveryHref = (path: string, href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return deliveryQuery(path, url).href
}

/** The reader's language, company and branch, as every stock link keeps them. */
export const scopeQuery = (url: URL) =>
  new URLSearchParams([...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)))
export const scoped = (url: URL, path: string) => {
  const query = scopeQuery(url).toString()
  return `${path}${query ? `${path.includes('?') ? '&' : '?'}${query}` : ''}`
}
export const shipmentHref = (url: URL, id: unknown) =>
  scoped(url, `${DELIVERY_PATHS.shipments}/${encodeURIComponent(String(id))}`)
export const statementHref = (url: URL, id: unknown) =>
  scoped(url, `${DELIVERY_PATHS.statements}/${encodeURIComponent(String(id))}`)
export const transferHref = (url: URL, id: unknown) =>
  scoped(url, `/admin/stock/transfers/${encodeURIComponent(String(id))}`)

export const SHIPMENT_TONES: Record<string, DeliveryTone> = {
  draft: 'neutral',
  booked: 'info',
  shipping: 'info',
  delivered: 'positive',
  failed: 'danger',
  returned: 'warning',
  cancel: 'neutral',
}
export const DISPATCH_TONES: Record<string, DeliveryTone> = {
  toHandOver: 'positive',
  toBook: 'info',
  noShipment: 'warning',
  waiting: 'neutral',
}
export const STATEMENT_TONES: Record<string, DeliveryTone> = {
  draft: 'neutral',
  posted: 'warning',
  paid: 'positive',
  cancel: 'neutral',
}
export const CARRIER_TONES: Record<string, DeliveryTone> = { active: 'positive', archived: 'neutral' }
