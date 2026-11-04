import { json, text } from '@ketvietlab/ketjs'
import type { Row, Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { searchFilterLabels } from '../../backend/search-filter.ts'
import { formatMoney } from '../../../ui/format.ts'
import { LIST_PATH, queryFromUrl, type Props, type Answer } from './shared.ts'

const FILTERS = ['mine', 'over'] as const
const chosen = (url: URL) => FILTERS.filter((id) => url.searchParams.get(id) === '1')

export function searchConfig(url: URL, _: Translator): Props['search'] {
  const filters = FILTERS.map((id) => ({ id, label: _('sale_backend.customers.' + id), active: false }))
  const active: string[] = chosen(url)
  return {
    name: 'sale-customer-filter',
    query: url.searchParams.get('q') ?? '',
    presentation: 'expanded',
    applyOnInput: true,
    capabilities: { groupBy: false, favorites: false, customFilters: false },
    facets: filters
      .filter((item) => active.includes(item.id))
      .map((item) => ({ ...item, type: 'filter' as const })),
    filters: filters.map((item) => ({ ...item, active: active.includes(item.id) })),
    groupBy: [],
    favorites: [],
    customFilterFields: [],
    labels: searchFilterLabels(_, { searchPlaceholder: _('sale_backend.customers.title') }),
  }
}

export function listLabels(_: Translator): Props['labels'] {
  return {
    empty: _('sale_backend.customers.empty'),
    emptyHint: _('sale_backend.customers.emptyHint'),
    region: _('backend.table.results'),
    selectAll: _('backend.table.selectAll'),
    selectRow: _('backend.table.selectRow'),
    sortedAscending: _('backend.table.sortAscending'),
    sortedDescending: _('backend.table.sortDescending'),
    previousPage: _('backend.chrome.previous'),
    nextPage: _('backend.chrome.next'),
    loading: _('backend.relation.loading'),
    loadError: _('backend.error.failed.title'),
    retry: _('backend.relation.retry'),
    denied: _('backend.error.forbidden.title'),
    ...Object.fromEntries(
      [
        'title',
        'name',
        'kind',
        'phone',
        'salespersonName',
        'paymentTermName',
        'exposure',
        'creditLimit',
        'orderCount',
        'overBadge',
        'noMatches',
        'noMatchesHint',
        'offline',
      ].map((key) => [key, _('sale_backend.customers.' + key)]),
    ),
  }
}

export const customerRead =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (req.headers.origin) {
      try {
        if (new URL(String(req.headers.origin)).host !== String(req.headers.host))
          return text('Forbidden', { status: 403 })
      } catch {
        return text('Forbidden', { status: 403 })
      }
    }
    const input = await readForm(req)
    let target: URL
    try {
      target = new URL(input.href ?? '', url)
    } catch {
      return text('Invalid URL', { status: 400 })
    }
    if (
      !input.href ||
      target.origin !== url.origin ||
      target.pathname !== LIST_PATH ||
      ['company', 'branch', 'lang'].some((key) => target.searchParams.get(key) !== url.searchParams.get(key))
    )
      return text('Invalid collection scope', { status: 400 })
    if (!(await ctx.allows('sale.listCustomers', target, req))) return text('Forbidden', { status: 403 })
    let query = queryFromUrl(target)
    const filters = chosen(target)
    const read = (page: number) =>
      ctx.call(
        'sale.listCustomers',
        {
          search: query.q,
          mine: filters.includes('mine'),
          over: filters.includes('over'),
          limit: query.pageSize,
          offset: (page - 1) * query.pageSize,
        },
        target,
        req,
      ) as Promise<{ rows: Row[]; total: number; currency: string }>
    let result = await read(query.page)
    const pages = Math.max(1, Math.ceil(result.total / query.pageSize)),
      page = Math.min(pages, query.page)
    if (page !== query.page) result = await read(page)
    const hrefAt = (n: number) => {
      const next = new URL(query.href, url)
      if (n === 1) next.searchParams.delete('page')
      else next.searchParams.set('page', String(n))
      return next.pathname + next.search
    }
    query = { ...query, page, href: hrefAt(page) }
    target = new URL(query.href, url)
    const _ = ctx.translate(target.searchParams.get('lang') === 'en' ? 'en' : 'vi')
    const rows = result.rows.map((row) => {
      const detail = new URL(LIST_PATH + '/' + encodeURIComponent(String(row.id)), target)
      for (const key of ['lang', 'company', 'branch'])
        if (target.searchParams.has(key)) detail.searchParams.set(key, target.searchParams.get(key)!)
      detail.searchParams.set('returnTo', query.href)
      return {
        id: String(row.id),
        name: String(row.name ?? ''),
        kind: _('sale_backend.customers.kind.' + String(row.kind)),
        phone: String(row.phone ?? ''),
        salespersonName: String(row.salespersonName || '—'),
        paymentTermName: String(row.paymentTermName || '—'),
        exposure: formatMoney(_, row.exposure, result.currency),
        creditLimit: row.creditLimit == null ? '—' : formatMoney(_, row.creditLimit, result.currency),
        over: row.over === true,
        orderCount: String(row.orderCount ?? 0),
        detailHref: detail.pathname + detail.search,
      }
    })
    const answer: Answer = {
      query,
      rows,
      total: result.total,
      page,
      pages,
      counts: {},
      search: searchConfig(target, _),
      isEmpty: !result.total && !query.q && !filters.length,
      sort: {},
      previous: page > 1 ? hrefAt(page - 1) : undefined,
      next: page < pages ? hrefAt(page + 1) : undefined,
    }
    return json({ ok: true, value: answer })
  }
