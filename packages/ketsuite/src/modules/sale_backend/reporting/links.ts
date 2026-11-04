import { encodeListState } from '@ketvietlab/ketjs'
import type { FilterNode, ListState } from '@ketvietlab/ketjs'
import { periodDays } from '../../sale/analysis.ts'

export const OVERVIEW_PATH = '/admin/sales'
export const ANALYSIS_PATH = '/admin/sales/analysis'

/** What a figure narrows the sales order list to (D19); `teamId: ''` is the orders outside every team. */
export type OrderNarrowing = {
  period?: string
  userId?: string
  teamId?: string
  partnerId?: string
  templateId?: string
  presets?: string[]
}

const rule = (field: string, operator: string, value?: unknown): FilterNode =>
  ({ kind: 'rule', field, operator, ...(value === undefined ? {} : { value }) }) as FilterNode

/**
 * The sales order list filtered as a figure counts it. The filters are the list's own, so the reader
 * sees them in its bar and can lift any of them; a period is the order dates from its first local
 * midnight to the next period's.
 */
export function ordersHref(url: URL, narrowing: OrderNarrowing): string {
  const filters: FilterNode[] = []
  const days = narrowing.period ? periodDays(narrowing.period) : null
  if (days) filters.push(rule('dateOrder', 'between', [`${days.start}T00:00`, `${days.end}T00:00`]))
  if (narrowing.userId !== undefined)
    filters.push(narrowing.userId ? rule('userId', 'equals', narrowing.userId) : rule('userId', 'isNotSet'))
  if (narrowing.teamId !== undefined)
    filters.push(narrowing.teamId ? rule('teamId', 'equals', narrowing.teamId) : rule('teamId', 'isNotSet'))
  if (narrowing.partnerId) filters.push(rule('partnerId', 'equals', narrowing.partnerId))
  if (narrowing.templateId) filters.push(rule('templateId', 'equals', narrowing.templateId))
  const state: ListState = {
    presets: narrowing.presets ?? [],
    filters,
    groupBy: [],
    sort: [],
    openGroups: [],
    groupPages: {},
    page: 1,
    includeArchived: false,
  }
  return encodeListState(state, withScope(url, '/admin/sales/orders'))
}

/** This screen's company, branch and language, as query values. */
export function scopeOf(url: URL): Record<string, string> {
  return Object.fromEntries(
    ['lang', 'company', 'branch'].flatMap((key) =>
      url.searchParams.has(key) ? [[key, url.searchParams.get(key)!]] : [],
    ),
  )
}

/** A path on this screen's company, branch and language. */
export function withScope(url: URL, path: string, query: Record<string, string | null> = {}): string {
  const target = new URL(path, 'http://ket.local')
  for (const [key, value] of Object.entries(scopeOf(url))) target.searchParams.set(key, value)
  for (const [key, value] of Object.entries(query))
    value == null ? target.searchParams.delete(key) : target.searchParams.set(key, value)
  return `${target.pathname}${target.search}`
}
