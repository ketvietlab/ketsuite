import type { IslandProps } from '@ketvietlab/ketjs-view'
import type { Row } from '@ketvietlab/ketjs'
import type { KetTableLabels } from '@ketvietlab/design-system'
import type { PagedAnswer, PagedQuery } from '../../../ui/client/paged-collection-store.ts'
export const TEAM_PATH = '/admin/sales/teams'
export type TeamRow = Row & {
  id: string
  name: string
  leaderName: string
  memberCount: number
  monthlyTarget: string
  active: boolean
  editHref: string
}
export type TeamQuery = PagedQuery & { href: string }
export type TeamAnswer = PagedAnswer<TeamQuery> & {
  rows: TeamRow[]
  isEmpty: boolean
  counts: { active: number; archived: number; all: number }
  previous?: string
  next?: string
}
export type TeamProps = IslandProps & {
  key: string
  query: TeamQuery
  source: string
  labels: KetTableLabels & Record<string, string>
}
export type TeamModalData = {
  lang: 'vi' | 'en'
  record: {
    id: string
    name: string
    leaderId: string
    memberIds: string[]
    monthlyTarget: string
    active: boolean
    revisionId: string
  }
  display: { leaderName: string; memberNames: string; monthlyTarget: string }
  choices: { salespeople: Array<{ id: string; name: string }> }
  permissions: { edit: boolean; lifecycle: boolean }
}

export function teamQuery(url: URL, pageSize?: number): TeamQuery {
  const clean = new URL(TEAM_PATH, url)
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
export const teamHref = (href: string, patch: Record<string, string | null>) => {
  const url = new URL(href, 'http://ket.local')
  for (const [key, value] of Object.entries(patch))
    value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  return teamQuery(url).href
}
