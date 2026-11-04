import { json, text, parseListState, encodeListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator, Row } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { applyRowListState, rowListGroups } from '../../backend/row-list.ts'
import { listSearchFilterConfig, loadListFavorites } from '../../backend/search-filter.ts'
import { pricelistListSearch } from '../search.ts'
import { LIST_PATH, queryFromUrl } from './shared.ts'
import type { Answer, Props } from './shared.ts'

export async function searchConfig(ctx: ServeContext, url: URL, req: Parameters<Route>[1], _: Translator) {
  const state = parseListState(pricelistListSearch, url).state
  const config = listSearchFilterConfig(_, {
    name: 'pricing-pricelist-filter',
    bodyId: 'pricing-pricelist-list',
    spec: pricelistListSearch,
    state,
    favorites: await loadListFavorites(ctx, url, req, pricelistListSearch, state),
    labels: { searchPlaceholder: _('pricing_backend.title') },
    fieldChoices: {
      state: ['active', 'archived'].map((value) => ({ value, label: _(`pricing_backend.state.${value}`) })),
    },
    functions: {
      apply: 'pricing_backend.applySearchFilter',
      saveFavorite: 'pricing_backend.saveSearchFavorite',
      deleteFavorite: 'pricing_backend.deleteSearchFavorite',
      setDefaultFavorite: 'pricing_backend.setDefaultSearchFavorite',
    },
    applyInput: { listKey: pricelistListSearch.key, returnTo: `${url.pathname}${url.search}` },
  })
  return {
    ...config,
    applyOnInput: true,
    query: state.q ?? '',
    facets: config.facets.filter((facet) => facet.type !== 'field'),
  }
}
export function listLabels(_: Translator): Props['labels'] {
  return {
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
    empty: _('pricing_backend.empty'),
    emptyHint: _('pricing_backend.emptyHint'),
    title: _('pricing_backend.title'),
    name: _('pricing_backend.col.name'),
    currency: _('pricing_backend.col.currency'),
    state: _('pricing_backend.col.state'),
    sequence: _('pricing_backend.col.sequence'),
    active: _('pricing_backend.state.active'),
    archived: _('pricing_backend.state.archived'),
    denied: _('backend.error.forbidden.title'),
    offline: _('pricing_backend.list.offline'),
    noMatches: _('pricing_backend.list.noMatches'),
    noMatchesHint: _('pricing_backend.list.noMatchesHint'),
  }
}

/** The legacy domain read remains server-side; only a bounded page crosses the browser boundary. */
export const pricelistRead =
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
      return text('Invalid collection URL', { status: 400 })
    }
    if (!input.href || target.origin !== url.origin || target.pathname !== LIST_PATH)
      return text('Invalid collection URL', { status: 400 })
    // Scope is selected by the authenticated request, never widened by the JSON body.
    for (const name of ['company', 'branch', 'lang']) {
      if (target.searchParams.get(name) !== url.searchParams.get(name))
        return text('Invalid scope', { status: 400 })
    }
    if (!(await ctx.allows('pricing.listPricelists', target, req))) return text('Forbidden', { status: 403 })
    let query = queryFromUrl(target)
    target = new URL(query.href, url)
    let state: ReturnType<typeof parseListState>['state']
    try {
      state = parseListState(pricelistListSearch, target).state
    } catch {
      return text('Invalid filters', { status: 400 })
    }
    const _ = ctx.translate(target.searchParams.get('lang') === 'en' ? 'en' : 'vi')
    const source = ((await ctx.call('pricing.listPricelists', {}, target, req)) as Row[])
      .map((row) => {
        const detail = new URL(`${LIST_PATH}/${encodeURIComponent(String(row.id))}`, target)
        for (const name of ['lang', 'company', 'branch'])
          if (target.searchParams.has(name)) detail.searchParams.set(name, target.searchParams.get(name)!)
        detail.searchParams.set('returnTo', query.href)
        return {
          id: String(row.id),
          name: String(row.name),
          currency: String(row.currency),
          state: row.active ? 'active' : 'archived',
          sequence: String(row.sequence),
          detailHref: `${detail.pathname}${detail.search}`,
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
    const filtered = applyRowListState(pricelistListSearch, state, source)
    const total = filtered.length,
      pages = Math.max(1, Math.ceil(total / query.pageSize)),
      page = Math.min(query.page, pages)
    const hrefAt = (n: number) => {
      const next = new URL(query.href, url)
      if (n === 1) next.searchParams.delete('page')
      else next.searchParams.set('page', String(n))
      return `${next.pathname}${next.search}`
    }
    query = { ...query, page, href: hrefAt(page) }
    target = new URL(query.href, url)
    for (const row of filtered) {
      const detail = new URL(row.detailHref, url)
      detail.searchParams.set('returnTo', query.href)
      row.detailHref = `${detail.pathname}${detail.search}`
    }
    const groups = state.groupBy.length
      ? rowListGroups(pricelistListSearch, state, filtered, target, (key, value) =>
          key === 'state'
            ? _(`pricing_backend.state.${value}`)
            : String(value ?? _('backend.chrome.groupEmpty')),
        )
      : undefined
    const value: Answer = {
      query,
      rows: groups ? [] : filtered.slice((page - 1) * query.pageSize, page * query.pageSize),
      total,
      page,
      pages,
      counts: {
        state: Object.fromEntries(
          ['active', 'archived'].map((s) => [s, source.filter((row) => row.state === s).length]),
        ),
      },
      search: await searchConfig(ctx, target, req, _),
      groups,
      isEmpty: source.length === 0,
      sort: Object.fromEntries(
        ['name', 'sequence'].map((key) => [
          key,
          {
            href: encodeListState(
              {
                ...state,
                sort: [
                  { key, dir: state.sort[0]?.key === key && state.sort[0]?.dir === 'asc' ? 'desc' : 'asc' },
                ],
              },
              new URL(hrefAt(1), url),
            ),
            direction: state.sort[0]?.key === key ? state.sort[0].dir : undefined,
          },
        ]),
      ),
      previous: page > 1 ? hrefAt(page - 1) : undefined,
      next: page < pages ? hrefAt(page + 1) : undefined,
    }
    return json({ ok: true, value })
  }
