import { json, text } from '@ketvietlab/ketjs'
import type { Row, Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { searchFilterLabels } from '../../backend/search-filter.ts'
import { LIST_PATH, queryFromUrl, type Props, type Answer } from './shared.ts'
export function searchConfig(url: URL, _: Translator): Props['search'] {
  const filters = ['quotation', 'section', 'active', 'archived'].map((id) => ({
    id,
    label: _('sale_template.' + id),
    active: false,
  }))
  const chosen = [
    url.searchParams.get('kind'),
    url.searchParams.get('active') === 'false'
      ? 'archived'
      : url.searchParams.get('active') === 'true'
        ? 'active'
        : null,
  ]
  return {
    name: 'sale-template-filter',
    query: url.searchParams.get('q') ?? '',
    presentation: 'expanded',
    applyOnInput: true,
    capabilities: { groupBy: false, favorites: false, customFilters: false },
    facets: filters
      .filter((item) => chosen.includes(item.id))
      .map((item) => ({ ...item, type: 'filter' as const })),
    filters: filters.map((item) => ({ ...item, active: chosen.includes(item.id) })),
    groupBy: [],
    favorites: [],
    customFilterFields: [],
    labels: searchFilterLabels(_, { searchPlaceholder: _('sale_template.title') }),
  }
}
export function listLabels(_: Translator): Props['labels'] {
  return {
    empty: _('sale_template.empty'),
    emptyHint: _('sale_template.emptyHint'),
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
        'ownerName',
        'teamNames',
        'validityDays',
        'state',
        'active',
        'archived',
        'empty',
        'emptyHint',
        'noMatches',
        'noMatchesHint',
        'offline',
      ].map((key) => [key, _('sale_template.' + key)]),
    ),
  }
}
export const templateRead =
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
    if (!(await ctx.allows('sale_template.listTemplates', target, req)))
      return text('Forbidden', { status: 403 })
    let query = queryFromUrl(target)
    const args = {
      manage: true,
      search: query.q,
      ...(['section', 'quotation'].includes(target.searchParams.get('kind') ?? '')
        ? { kind: target.searchParams.get('kind') }
        : {}),
      ...(['true', 'false'].includes(target.searchParams.get('active') ?? '')
        ? { active: target.searchParams.get('active') === 'true' }
        : {}),
      limit: query.pageSize,
    }
    const read = (page: number) =>
      ctx.call(
        'sale_template.listTemplates',
        { ...args, offset: (page - 1) * query.pageSize },
        target,
        req,
      ) as Promise<{ rows: Row[]; total: number }>
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
        ...row,
        id: String(row.id),
        kind: _('sale_template.' + row.kind),
        teamNames: (row.teamNames as string[]).join(', ') || _('sale_template.allTeams'),
        validityDays: row.kind === 'section' ? '' : String(row.validityDays ?? '—'),
        state: row.active ? 'active' : 'archived',
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
      isEmpty:
        !result.total && !query.q && !target.searchParams.has('kind') && !target.searchParams.has('active'),
      sort: {},
      previous: page > 1 ? hrefAt(page - 1) : undefined,
      next: page < pages ? hrefAt(page + 1) : undefined,
    }
    return json({ ok: true, value: answer })
  }
