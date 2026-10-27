// One page of a collection held in memory, for the collection islands (design system:
// "Collections are client islands"; the islands are ../../ui/client/row-list-island.tsx).
//
// A list that reads its whole authorised collection and narrows it (row-list.ts) answers
// the islands' read with this. The browser sends the list's own URL; this applies it and
// answers with one page of rows as the table draws them, the count behind each preset,
// every link the list shows (sort headers, pager, group toggles and group pagers) and the
// search bar for the query as applied. The list-state codec runs only here, so the island
// never guesses how a query is spelled.
import { encodeListState, parseListState } from '@ketvietlab/ketjs'
import type { ListState, Route, ServeContext } from '@ketvietlab/ketjs'
import type { KetTableGroup, KetTableRow, SearchFilterConfig } from '@ketvietlab/design-system'
import type { TableGroup } from '../../ui/index.ts'
import { COLLECTION_PAGE_SIZE } from '../../ui/collection-state.ts'
import { applyRowListState, rowListGroups } from './row-list.ts'
import type { AnyRow, RowListSpec } from './row-list.ts'
import { listSearchFilterConfig, loadListFavorites } from './search-filter.ts'
import type { ListSearchFilterOptions } from './search-filter.ts'

type Req = Parameters<Route>[1]

/** What the islands' read answers: one page of one query, and every link the list shows. */
export type RowListAnswer = {
  /** The query as applied: unknown values dropped, the page clamped. */
  query: { q: string; page: number }
  /** The list's URL for that query; the island writes it back when it differs. */
  href: string
  total: number
  page: number
  pages: number
  pageSize: number
  /** The page's rows, each as the table draws it (`KetTableColumn.format` reads them). */
  rows: KetTableRow[]
  /** The table's groups, when the reader grouped; their open leaves carry their own rows. */
  groups: KetTableGroup[] | null
  /** Rows each facet or preset would show, with the rest of the query applied. */
  counts: Record<string, number>
  /** Nothing recorded yet, as opposed to nothing matching. */
  isEmpty: boolean
  /** Per sortable field, the link that sorts by it (the current one turns it around). */
  sort: Record<string, string>
  /** The order in force, for the header that shows it. */
  sorted: { key: string; dir: 'asc' | 'desc' } | null
  previous: string | null
  next: string | null
  /** The list with no query at all. */
  clear: string
  /** The search bar for this query, for a list that has one. */
  search?: SearchFilterConfig
  /** Choices over URL parameters the list's own read narrows by (a company, a role), for the controls. */
  menus?: RowListMenu[]
}

/** One choice over one URL parameter: following an item chooses it, following the chosen one clears it. */
export type RowListMenu = {
  id: string
  label: string
  items: Array<{ id: string; label: string; href: string; active: boolean }>
}

/** A menu of `options` over `param` of the list URL `target`; choosing returns to the first page. */
export const rowListMenu = (
  target: URL,
  param: string,
  label: string,
  options: ReadonlyArray<Record<string, unknown>>,
): RowListMenu => {
  const current = target.searchParams.get(param) ?? ''
  return {
    id: param,
    label,
    items: options.map((option) => {
      const id = String(option.id)
      const next = new URL(target)
      next.searchParams.delete('page')
      if (current === id) next.searchParams.delete(param)
      else next.searchParams.set(param, id)
      return {
        id,
        label: String(option.name ?? id),
        href: `${next.pathname}${next.search}`,
        active: current === id,
      }
    }),
  }
}

/** What a list's search bar is called and calls; the spec, state and saved searches come from the read. */
export type RowListSearchOptions = Pick<
  ListSearchFilterOptions,
  'name' | 'bodyId' | 'functions' | 'labels' | 'fieldLabel' | 'presetLabel' | 'fieldChoices'
>

/** The parameters that open something over the list rather than say what it lists. */
const OVERLAY_PARAMS = ['record', 'tab', 'dialog', 'dialogId']

/** The list URL a read was asked about, less what opens over it. */
export const rowListTarget = (url: URL, href: unknown, path: string): URL | null => {
  if (typeof href !== 'string' || !href.startsWith('/')) return null
  const target = new URL(href, url)
  if (target.origin !== url.origin || target.pathname !== path) return null
  for (const key of OVERLAY_PARAMS) target.searchParams.delete(key)
  target.hash = ''
  return target
}

/**
 * The search bar for a list URL: the query it holds and the reader's saved searches. Typed
 * text narrows the list as it is typed and stays in the field rather than becoming a chip.
 */
export const rowListBar = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  spec: RowListSpec,
  target: URL,
  search: RowListSearchOptions,
  state: ListState = parseListState(spec, target).state,
): Promise<SearchFilterConfig> => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const favorites = await loadListFavorites(ctx, url, req, spec, state)
  const config = listSearchFilterConfig(_, {
    ...search,
    spec,
    state,
    favorites,
    applyInput: { listKey: spec.key, returnTo: `${target.pathname}${target.search}` },
  })
  return {
    ...config,
    applyOnInput: true,
    query: state.q ?? '',
    facets: config.facets.filter((facet) => facet.type !== 'field'),
  }
}

const text = (value: unknown): string => (value == null ? '' : String(value))

/** A list with no query: what `encodeListState` writes for it is only the URL's other parameters. */
const EMPTY_STATE: ListState = {
  presets: [],
  filters: [],
  groupBy: [],
  sort: [],
  openGroups: [],
  groupPages: {},
  page: 1,
  includeArchived: false,
}

/**
 * One page of `rows` for the list URL `target`: searched, narrowed, sorted, grouped or
 * paged as `spec` reads the URL, and with the bar when `search` names one.
 */
export const rowListAnswer = async <R extends AnyRow>(
  ctx: ServeContext,
  url: URL,
  req: Req,
  options: {
    spec: RowListSpec
    rows: readonly R[]
    target: URL
    view: (row: R) => KetTableRow
    search?: RowListSearchOptions
    /** How a group's value reads in the reader's language. */
    groupLabel?: (key: string, value: unknown) => string
    pageSize?: number
    /** URL parameters the caller narrowed `rows` by before (`rowListMenu`); clearing drops them too. */
    filters?: readonly string[]
  },
): Promise<RowListAnswer> => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const { spec, target } = options
  const pageSize = options.pageSize ?? COLLECTION_PAGE_SIZE
  const parsed = parseListState(spec, target).state
  const filtered = applyRowListState(spec, parsed, options.rows)
  const grouped = parsed.groupBy.length > 0
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = grouped ? 1 : Math.min(Math.max(1, parsed.page || 1), pages)
  const applied: ListState = { ...parsed, page }
  // The URL holds the query with its defaults left out: the spec's own order is no `sort`.
  const defaultOrder = JSON.stringify(spec.defaultSort ?? [])
  const hrefOf = (state: ListState) =>
    encodeListState(JSON.stringify(state.sort) === defaultOrder ? { ...state, sort: [] } : state, target)
  const label =
    options.groupLabel ??
    ((key: string, value: unknown) => {
      const message = `${spec.key}.group.${key}.${text(value)}`
      return _.resolves(message) ? _(message) : text(value) || _('backend.chrome.groupEmpty')
    })
  const asGroups = (nodes: readonly TableGroup<R>[]): KetTableGroup[] =>
    nodes.map((node) => ({
      id: node.id,
      label: node.label,
      count: node.count,
      open: node.open,
      href: node.href,
      ...(node.pager ? { pager: node.pager } : {}),
      ...(node.rows ? { rows: node.rows.map(options.view) } : {}),
      ...(node.children ? { children: asGroups(node.children) } : {}),
    }))
  // A preset's count ignores its own group, which is what choosing it would replace.
  const counts = Object.fromEntries(
    (spec.presets ?? []).map((preset) => {
      const others = applied.presets.filter(
        (key) => spec.presets?.find((candidate) => candidate.key === key)?.group !== preset.group,
      )
      return [
        preset.key,
        applyRowListState(spec, { ...applied, presets: [...others, preset.key] }, options.rows).length,
      ]
    }),
  )
  const order = applied.sort[0] ?? spec.defaultSort?.[0] ?? null
  const sort = Object.fromEntries(
    (spec.sortable ?? []).map((field) => [
      field.key,
      hrefOf({
        ...applied,
        sort: [{ key: field.key, dir: order?.key === field.key && order.dir === 'asc' ? 'desc' : 'asc' }],
        page: 1,
        groupPages: {},
      }),
    ]),
  )
  // Clearing drops the query and keeps what the URL says besides it (its language, its columns).
  const bare = new URL(target)
  for (const key of options.filters ?? []) bare.searchParams.delete(key)
  const cleared = encodeListState(EMPTY_STATE, bare)
  return {
    query: { q: applied.q ?? '', page },
    href: hrefOf(applied),
    total: filtered.length,
    page,
    pages,
    pageSize,
    rows: grouped ? [] : filtered.slice((page - 1) * pageSize, page * pageSize).map(options.view),
    groups: grouped ? asGroups(rowListGroups(spec, applied, filtered, target, label)) : null,
    counts,
    // Rows the caller already narrowed (`filters`) that leave nobody match nothing; they are not "none yet".
    isEmpty:
      options.rows.length === 0 && !(options.filters ?? []).some((key) => target.searchParams.has(key)),
    sort,
    sorted: order ? { key: order.key, dir: order.dir } : null,
    previous: !grouped && page > 1 ? hrefOf({ ...applied, page: page - 1 }) : null,
    next: !grouped && page < pages ? hrefOf({ ...applied, page: page + 1 }) : null,
    clear: cleared,
    ...(options.search
      ? {
          search: await rowListBar(
            ctx,
            url,
            req,
            spec,
            new URL(hrefOf(applied), target),
            options.search,
            applied,
          ),
        }
      : {}),
  }
}
