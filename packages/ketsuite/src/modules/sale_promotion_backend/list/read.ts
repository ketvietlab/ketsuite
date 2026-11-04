import {
  json,
  text,
  withHeaders,
  type Row,
  type Route,
  type ServeContext,
  type Translator,
} from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { searchFilterLabels } from '../../backend/search-filter.ts'
import { formatDateTime } from '../../../ui/format.ts'
import { rewardSummary, rewardTerms, usageText } from '../../loyalty_sale/reward-summary.ts'
import { LIST_PATH, queryFromUrl, type Props, type Answer } from './shared.ts'
export const kinds = ['promotion', 'promo_code', 'buy_x_get_y', 'coupons', 'next_order_coupons', 'loyalty']
export function searchConfig(url: URL, _: Translator, cards = false): Props['search'] {
  const chosen = cards
    ? [url.searchParams.get('state')]
    : [
        url.searchParams.get('programType'),
        url.searchParams.get('active') === 'false'
          ? 'archived'
          : url.searchParams.get('active') === 'true'
            ? 'active'
            : null,
      ]
  const filters = (cards ? ['active', 'used', 'expired', 'cancelled'] : [...kinds, 'active', 'archived']).map(
    (id) => ({ id, label: _('sale_promotion_backend.' + id), active: chosen.includes(id) }),
  )
  return {
    name: 'sale-promotion-filter',
    query: url.searchParams.get('q') ?? '',
    presentation: 'expanded',
    applyOnInput: true,
    capabilities: { groupBy: false, favorites: false, customFilters: false },
    facets: filters.filter((row) => row.active).map((row) => ({ ...row, type: 'filter' as const })),
    filters,
    groupBy: [],
    favorites: [],
    customFilterFields: [],
    labels: searchFilterLabels(_, {
      searchPlaceholder: _('sale_promotion_backend.' + (cards ? 'cards' : 'title')),
    }),
  }
}
export function listLabels(_: Translator): Props['labels'] {
  return {
    empty: _('sale_promotion_backend.empty'),
    emptyHint: _('sale_promotion_backend.emptyHint'),
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
        'programType',
        'startDate',
        'endDate',
        'reward',
        'appliesUntil',
        'usage',
        'exportCsv',
        'state',
        'active',
        'archived',
        'code',
        'partnerName',
        'balance',
        'expiresOn',
        'used',
        'expired',
        'cancelled',
        'empty',
        'emptyHint',
        'noMatches',
        'noMatchesHint',
        'offline',
      ].map((key) => [key, _('sale_promotion_backend.' + key)]),
    ),
  }
}
/** The reward and usage lines of one program as getProgram returns it, for the top of its page. */
export function programSummary(_: Translator, record: Row, productName: string | null) {
  const row = { ...rewardTerms(record, record, record, productName), uses: record.uses, cards: record.cards }
  return { reward: rewardSummary(_, row), usage: usageText(row) }
}

const dayText = (_: Translator, value: unknown) =>
  value
    ? formatDateTime(_.locale, new Date(`${String(value).slice(0, 10)}T00:00:00Z`), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—'

/** The kind and state chips of the program list, as listPrograms takes them. */
const programFilter = (target: URL) => ({
  ...(kinds.includes(target.searchParams.get('programType') ?? '')
    ? { programType: target.searchParams.get('programType') }
    : {}),
  ...(['true', 'false'].includes(target.searchParams.get('active') ?? '')
    ? { active: target.searchParams.get('active') === 'true' }
    : {}),
})

/** The cells the program list adds to a listPrograms row; the CSV export writes the same text. */
const programColumns = (_: Translator, row: Row) => ({
  code: String(row.code ?? ''),
  reward: rewardSummary(_, row),
  appliesUntil: dayText(_, row.endDate),
  usage: usageText(row),
})

const PROGRAM_COLUMNS = ['name', 'programType', 'code', 'reward', 'appliesUntil', 'usage', 'state']

// A cell that starts like a formula is written as text, so a spreadsheet does not run it.
const csvCell = (value: unknown) => {
  const text = String(value ?? '')
  return '"' + (/^(?:'|\s*[=+@-])/u.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'
}

/** Every program the list's search and filters match, with the columns the list shows. */
export const promotionExport =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('loyalty_sale.listPrograms', url, req))) return text('Forbidden', { status: 403 })
    const target = new URL(url)
    target.pathname = LIST_PATH
    const _ = ctx.translate(ctx.localeOf(url, req))
    const query = queryFromUrl(target)
    const rows: Row[] = []
    for (let page = 1, pages = 1; page <= pages; page++) {
      const result = (await ctx.call(
        'loyalty_sale.listPrograms',
        { ...programFilter(target), search: query.q, page, pageSize: 100 },
        target,
        req,
      )) as { rows: Row[]; pages: number }
      rows.push(...result.rows)
      pages = result.pages
    }
    const key = (name: string) => 'sale_promotion_backend.' + name
    const csv =
      '\uFEFF' +
      [
        PROGRAM_COLUMNS.map((column) => _(key(column))),
        ...rows.map((row) => {
          const cells: Row = {
            ...row,
            ...programColumns(_, row),
            programType: _(key(String(row.programType))),
            state: _(key(row.active ? 'active' : 'archived')),
          }
          return PROGRAM_COLUMNS.map((column) => cells[column])
        }),
      ]
        .map((line) => line.map(csvCell).join(','))
        .join('\r\n')
    return withHeaders(text(csv), {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="promotions.csv"',
      'cache-control': 'no-store',
    })
  }

export const promotionRead =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (req.headers.origin) {
      try {
        if (new URL(String(req.headers.origin)).host !== String(req.headers.host))
          return text('Forbidden', { status: 403 })
      } catch {
        return text('Forbidden', { status: 403 })
      }
    }
    const cards = Boolean(params.id),
      path = cards ? LIST_PATH + '/' + encodeURIComponent(String(params.id)) + '/cards' : LIST_PATH
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
      target.pathname !== path ||
      ['company', 'branch', 'lang'].some((key) => target.searchParams.get(key) !== url.searchParams.get(key))
    )
      return text('Invalid collection scope', { status: 400 })
    const fn = cards ? 'loyalty_sale.listProgramCards' : 'loyalty_sale.listPrograms'
    if (!(await ctx.allows(fn, target, req))) return text('Forbidden', { status: 403 })
    let query = queryFromUrl(target)
    const result = (await ctx.call(
      fn,
      {
        ...(cards
          ? {
              id: params.id,
              ...(target.searchParams.get('state') ? { state: target.searchParams.get('state') } : {}),
            }
          : {
              ...programFilter(target),
            }),
        search: query.q,
        page: query.page,
        pageSize: query.pageSize,
      },
      target,
      req,
    )) as {
      rows: Row[]
      total: number
      page: number
      pages: number
      isEmpty: boolean
      counts: Record<string, number>
    } | null
    if (!result) return text('Not found', { status: 404 })
    const hrefAt = (page: number) => {
      const next = new URL(query.href, url)
      if (page === 1) next.searchParams.delete('page')
      else next.searchParams.set('page', String(page))
      return next.pathname + next.search
    }
    query = { ...query, page: result.page, href: hrefAt(result.page) }
    const _ = ctx.translate(ctx.localeOf(target, req))
    const rows = result.rows.map((row) => {
      const detail = new URL(LIST_PATH + '/' + encodeURIComponent(String(row.id)), target)
      for (const key of ['company', 'branch', 'lang'])
        if (target.searchParams.has(key)) detail.searchParams.set(key, target.searchParams.get(key)!)
      detail.searchParams.set('returnTo', query.href)
      return {
        ...row,
        id: String(row.id),
        detailHref: cards ? '' : detail.pathname + detail.search,
        ...(cards
          ? {}
          : {
              programType: _('sale_promotion_backend.' + row.programType),
              state: row.active ? 'active' : 'archived',
              ...programColumns(_, row),
            }),
      }
    })
    const answer: Answer = {
      ...result,
      query,
      rows,
      search: searchConfig(target, _, cards),
      sort: {},
      previous: result.page > 1 ? hrefAt(result.page - 1) : undefined,
      next: result.page < result.pages ? hrefAt(result.page + 1) : undefined,
    }
    return json({ ok: true, value: answer })
  }
