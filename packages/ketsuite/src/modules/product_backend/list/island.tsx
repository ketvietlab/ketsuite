// The product list, as three client islands over one paged read (design system:
// "Collections are client islands"; the read is ./read.ts): the query controls in the
// page's controls slot, the rows in its body and the pager in its footer, sharing one store.
//
// The server renders the frame and the loading state; the first client render is the
// same markup, so hydration adopts it, and the results island then reads the first page. The
// query lives in the URL: the read parses it and answers with every link the list shows,
// so following a filter, a sort header, a group toggle or the pager is a `pushState` and
// one read, never a page load. Back reads the URL and writes nothing.
import { batch, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, JSXChild } from '@ketvietlab/ketjs-view'
import {
  Badge,
  CardGrid,
  ConfirmDialog,
  ContentCard,
  EmptyState,
  Inline,
  KetTable,
  LinkButton,
  ListChrome,
  Notice,
  Button,
  Stack,
  Text,
  Thumbnail,
  attachClientModalInteractions,
  createSearchFilterView,
  rememberRowAnchor,
  restoreRowAnchor,
  rowAnchorHref,
  searchFilterRuleLabel,
  takeRowAnchor,
} from '@ketvietlab/design-system'
import type {
  KetTableLabels,
  KetTableServerProps,
  SearchFacet,
  SearchFilterApplyInput,
  SearchFilterConfig,
  SearchFilterOperator,
  SearchGroupByOption,
} from '@ketvietlab/design-system'
import type { ListState } from '@ketvietlab/ketjs'
import type { ProductListAnswer, ProductListFavorite, ProductListGroup, ProductListRow } from './read.ts'
import type { ProductListLabels } from './messages.ts'
import { productImageUrl } from '../../../ui/client/product-image.ts'
import { HiddenPostForm, IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'

export type ProductListProps = IslandProps & {
  /** The read this viewer may call: stock's when it answers the list, product's otherwise. */
  read: string
  /** The list's URL as the server rendered it. */
  href: string
  timezone: string
  lang: string
  pageSize: number
  labels: ProductListLabels & KetTableLabels & { typeGoods: string; typeService: string; create: string }
  /** The search bar for the URL the server rendered; the island keeps it in step after that. */
  search: SearchFilterConfig
  createHref?: string | null
  /** Where selected rows are archived or deleted, and which the viewer may do; absent for neither. */
  bulk?: { action: string; archive: boolean; delete: boolean } | null
  /** Whether the viewer may see product images; without it a row shows no picture, not a broken one. */
  images?: boolean
}

/** The island's identity: a new read or URL from the shell is a new list. */
export const PRODUCT_LIST_KEY = ['read', 'href']
const LIST_PATH = '/admin/product/templates'
const BULK_FORM = 'product-template-bulk'
const SEARCH_ID = 'product-template-filter'
const RETRY_ID = 'product-list-retry'
const CACHE_SIZE = 20
const DIM_AFTER = 150

type Phase = 'loading' | 'ready' | 'failed' | 'offline' | 'denied'
type Column = KetTableServerProps<ProductListRow>['columns'][number]
type TableGroup = NonNullable<KetTableServerProps<ProductListRow>['groups']>[number]

const format = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))

const viewOf = (href: string): 'list' | 'kanban' =>
  new URL(href, 'http://ket.local').searchParams.get('view') === 'kanban' ? 'kanban' : 'list'

const withView = (href: string, view: 'list' | 'kanban'): string => {
  const url = new URL(href, 'http://ket.local')
  if (view === 'list') url.searchParams.delete('view')
  else url.searchParams.set('view', view)
  return `${url.pathname}${url.search}`
}

const pageOf = (href: string): number => {
  const page = Number(new URL(href, 'http://ket.local').searchParams.get('page') ?? 1)
  return Number.isInteger(page) && page > 0 ? page : 1
}

const flatten = (options: readonly SearchGroupByOption[]): SearchGroupByOption[] =>
  options.flatMap((option) => (option.options?.length ? flatten(option.options) : [option]))

const truthy = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true'

/** The bar for an applied query: its facets, rules and saved searches, on the frame's static options. */
export const productSearchConfig = (
  base: SearchFilterConfig,
  state: ListState,
  favorites: readonly ProductListFavorite[],
  href: string,
): SearchFilterConfig => {
  const filterLabel = new Map(base.filters.map((option) => [option.id, option.label]))
  const groupLabel = new Map(flatten(base.groupBy).map((option) => [option.id, option.label]))
  const fields = new Map(base.customFilterFields.map((field) => [field.value, field]))
  const customFilters = state.filters.flatMap((filter, index) => {
    if (filter.kind !== 'rule') return []
    const field = fields.get(filter.field)
    return [
      {
        id: `rule:${index}`,
        field: filter.field,
        operator: filter.operator as SearchFilterOperator,
        value: Array.isArray(filter.value) ? filter.value.join(',') : String(filter.value ?? ''),
        label: searchFilterRuleLabel({
          fieldLabel: field?.label ?? filter.field,
          operator: filter.operator as SearchFilterOperator,
          value: filter.value,
          choices: field?.choices,
          operatorLabels: base.labels.operatorLabels,
        }),
      },
    ]
  })
  const groupId = (group: ListState['groupBy'][number]) =>
    `${group.key}${group.interval ? `:${group.interval}` : ''}`
  const facets: SearchFacet[] = [
    ...state.presets.map((key) => ({
      id: `preset:${key}`,
      type: 'filter' as const,
      label: filterLabel.get(`preset:${key}`) ?? key,
    })),
    ...(state.includeArchived
      ? [{ id: 'archived', type: 'filter' as const, label: filterLabel.get('archived') ?? 'archived' }]
      : []),
    ...customFilters.map(({ id, label }) => ({ id, type: 'filter' as const, label })),
    ...state.groupBy.map((group) => ({
      id: groupId(group),
      type: 'groupBy' as const,
      label: groupLabel.get(groupId(group)) ?? group.key,
    })),
    ...(state.favoriteId
      ? [
          {
            id: state.favoriteId,
            type: 'favorite' as const,
            label: favorites.find((favorite) => favorite.id === state.favoriteId)?.name ?? state.favoriteId,
          },
        ]
      : []),
  ]
  const active = (id: string) =>
    id === 'archived' ? state.includeArchived : state.presets.includes(id.replace(/^preset:/, ''))
  const grouped = new Set(state.groupBy.map(groupId))
  const mark = (options: readonly SearchGroupByOption[]): SearchGroupByOption[] =>
    options.map((option) =>
      option.options?.length
        ? { ...option, options: mark(option.options) }
        : { ...option, active: grouped.has(option.id) },
    )
  return {
    ...base,
    // Typed text stays in the field (`applyOnInput`); it is never a chip.
    query: state.q ?? '',
    facets,
    filters: base.filters.map((option) => ({ ...option, active: active(option.id) })),
    groupBy: mark(base.groupBy),
    favorites: favorites.map((favorite) => ({
      id: favorite.id,
      label: favorite.name,
      isDefault: favorite.isDefault,
      active: state.favoriteId === favorite.id,
    })),
    customFilters,
    // "Save this search" opens the save dialog over the list as it now is, not as it was served:
    // a filter applied in place changes the query without loading a page.
    ...(base.favoriteHref ? { favoriteHref: favoriteHrefOf(href) } : {}),
    ...(base.manager
      ? { manager: { ...base.manager, applyInput: { ...base.manager.applyInput, returnTo: href } } }
      : {}),
  }
}

const favoriteHrefOf = (href: string): string => {
  const next = new URL(href, 'http://ket.local')
  next.searchParams.set('modal', 'favorite')
  return `${next.pathname}${next.search}`
}

/** What the bar holds apart from its typed text, in the shape it sends. */
const structureOf = (input: {
  filters: readonly string[]
  groupBy: readonly string[]
  customFilters: ReadonlyArray<{ field: string; operator: string; value: string }>
  favoriteId: string | null
}): string =>
  JSON.stringify([
    [...input.filters].sort(),
    input.groupBy,
    input.customFilters.map((rule) => [rule.field, rule.operator, rule.value]),
    input.favoriteId,
  ])

const configStructure = (config: SearchFilterConfig): string => {
  const rules = new Set((config.customFilters ?? []).map((rule) => rule.id))
  return structureOf({
    filters: config.facets
      .filter((facet) => facet.type === 'filter' && !rules.has(facet.id))
      .map((facet) => facet.id),
    groupBy: config.facets.filter((facet) => facet.type === 'groupBy').map((facet) => facet.id),
    customFilters: config.customFilters ?? [],
    favoriteId: config.facets.find((facet) => facet.type === 'favorite')?.id ?? null,
  })
}

const createListStore = (props: ProductListProps, release: () => void) => {
  const labels = props.labels
  const lang = props.lang === 'en' ? 'en' : 'vi'
  const locale = lang === 'en' ? 'en-VN' : 'vi-VN'
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'VND' })
  const quantity = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })

  const href = signal(props.href)
  const result = signal<ProductListAnswer | null>(null)
  const phase = signal<Phase>('loading')
  const dimmed = signal(false)
  const selection = signal<{ ids: string[]; anchor: string | null }>({ ids: [], anchor: null })
  const confirming = signal<'archive' | 'delete' | null>(null)
  const currentRow = signal<string | undefined>(undefined)
  const missingRow = signal(false)
  const bulkError = signal(false)

  const cache = new Map<string, ProductListAnswer>()
  let controller: AbortController | undefined
  let lifetime: AbortSignal | undefined
  let root: HTMLElement | undefined
  let dimTimer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  let anchor: ReturnType<typeof takeRowAnchor> = null
  let structure = configStructure(props.search)
  /** The entry the reader's typing pushed: later keystrokes replace it, so Back skips them. */
  let typing = false
  let releaseModal: (() => void) | undefined
  let opener: HTMLElement | null = null

  const search = createSearchFilterView(
    { id: SEARCH_ID, config: props.search },
    {
      apply: async (input: SearchFilterApplyInput, signal: AbortSignal) => {
        const answer = await callFunction<{ href: string }>(
          String(props.search.manager?.applyFunction ?? 'product_backend.applySearchFilter'),
          { ...input, ...(props.search.manager?.applyInput ?? {}), returnTo: href() },
          signal,
        )
        if (signal.aborted) return
        const typed = structureOf(input) === structure
        navigate(answer.href, typed && typing ? 'replace' : 'push')
        typing = typed
      },
    },
  )

  const remember = (key: string, answer: ProductListAnswer) => {
    cache.delete(key)
    cache.set(key, answer)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  }

  const load = async () => {
    controller?.abort()
    controller = new AbortController()
    const identity = ++sequence
    const asked = href()
    const cached = cache.get(asked)
    batch(() => {
      if (cached) result.set(cached)
      phase.set('loading')
    })
    clearTimeout(dimTimer)
    // A cached page is on screen at once and read again behind it, undimmed.
    if (!cached) dimTimer = setTimeout(() => identity === sequence && dimmed.set(true), DIM_AFTER)
    try {
      const answer = await callFunction<ProductListAnswer>(
        props.read,
        { href: asked, pageSize: props.pageSize, timezone: props.timezone },
        controller.signal,
      )
      if (identity !== sequence || lifetime?.aborted) return
      remember(asked, answer)
      const kept = new Set(answer.rows.map((row) => row.id))
      batch(() => {
        // A page past the end comes back clamped; the URL says so without a new entry.
        if (answer.page !== pageOf(asked) && !answer.groups) {
          const corrected = `${answer.href}${location.hash}`
          history.replaceState(history.state, '', corrected)
          href.set(answer.href)
          remember(answer.href, answer)
        }
        result.set(answer)
        selection.set({ ids: selection().ids.filter((id) => kept.has(id)), anchor: selection().anchor })
        dimmed.set(false)
        phase.set('ready')
      })
      const config = productSearchConfig(props.search, answer.query, answer.favorites, answer.href)
      structure = configStructure(config)
      search.update?.({ id: SEARCH_ID, config })
      if (anchor && root)
        requestAnimationFrame(() => {
          if (anchor && root) missingRow.set(!restoreRowAnchor(root, anchor))
          anchor = null
        })
    } catch (error) {
      if (controller.signal.aborted || identity !== sequence || lifetime?.aborted) return
      batch(() => {
        dimmed.set(false)
        phase.set(
          error instanceof FunctionError && error.status === 403
            ? 'denied'
            : typeof navigator !== 'undefined' && !navigator.onLine
              ? 'offline'
              : 'failed',
        )
      })
    } finally {
      if (identity === sequence) clearTimeout(dimTimer)
    }
  }

  const navigate = (next: string, mode: 'push' | 'replace' = 'push') => {
    if (mode === 'push') typing = false
    batch(() => {
      selection.set({ ids: [], anchor: null })
      currentRow.set(undefined)
      missingRow.set(false)
      bulkError.set(false)
      href.set(next)
    })
    anchor = null
    if (mode === 'replace') history.replaceState(history.state, '', next)
    else history.pushState(null, '', next)
    void load()
  }

  const openConfirm = (action: 'archive' | 'delete', from: HTMLElement | null) => {
    opener = from
    confirming.set(action)
    // The dialog is in the DOM after this render; it owns focus until it closes.
    queueMicrotask(() => {
      releaseModal?.()
      releaseModal = attachClientModalInteractions(document)
    })
  }
  const closeConfirm = () => {
    releaseModal?.()
    releaseModal = undefined
    confirming.set(null)
    const back = opener
    opener = null
    if (back?.isConnected) back.focus()
  }

  const recordHref = (row: ProductListRow) => {
    const url = new URL(`/admin/product/templates/${encodeURIComponent(row.id)}`, 'http://ket.local')
    if (lang === 'en') url.searchParams.set('lang', 'en')
    // The page's way back names this row, so the list returns to it.
    url.searchParams.set('returnTo', rowAnchorHref(href(), row.id))
    return `${url.pathname}${url.search}`
  }

  const imageOf = (row: ProductListRow): string | null =>
    row.image && props.images !== false ? productImageUrl(row.image) : null

  const nameCell = (row: ProductListRow): JSXChild =>
    Inline({
      gap: 'compact',
      blockAlign: 'center',
      wrap: false,
      items: [
        Thumbnail({ src: imageOf(row), alt: '', size: 'small' }),
        Stack({
          gap: 'none',
          items: [
            Text({ children: row.name, variant: 'bodyMd' }),
            ...(row.code ? [Text({ children: row.code, variant: 'bodySm', tone: 'muted' })] : []),
          ],
        }),
      ],
    })
  const dash = () => Text({ children: '—', variant: 'bodyMd' })
  const typeLabel = (type: string) =>
    type === 'service' ? labels.typeService : type === 'goods' ? labels.typeGoods : type
  // As the product page words it: archived, kept but not sold, or on sale.
  const status = (row: ProductListRow) =>
    Badge({
      label: !row.active
        ? labels['status.archived']
        : row.saleOk
          ? labels['status.active']
          : labels['status.notForSale'],
      tone: row.active && row.saleOk ? 'positive' : 'neutral',
      size: 'small',
    })

  const columns = (answer: ProductListAnswer | null) => {
    const sort = answer?.query.sort[0]
    const sortable = (key: string, label: string): Partial<Column> => {
      const link = answer?.sort[key]
      if (!link) return {}
      const direction = sort?.key === key ? sort.dir : null
      // The header's name says what following it does.
      return {
        sortHref: link,
        sortDirection: direction,
        sortLabel: format(labels[direction === 'asc' ? 'sort.desc' : 'sort.asc'], { column: label }),
      }
    }
    const column = (
      key: string,
      label: string,
      cell: (row: ProductListRow) => JSXChild,
      extra: Partial<Column> = {},
      sortKey?: string,
    ): Column => ({ key, label, cell, ...extra, ...(sortKey ? sortable(sortKey, label) : {}) })
    return [
      column(
        'name',
        labels['col.product'],
        nameCell,
        { priority: 'primary', width: 'wide', wrap: true, kind: 'media' },
        'name',
      ),
      column(
        'type',
        labels['col.type'],
        (row) => Text({ children: typeLabel(row.type), variant: 'bodyMd' }),
        { priority: 'tertiary' },
        'type',
      ),
      column(
        'category',
        labels['col.category'],
        (row) => (row.category ? Text({ children: row.category, variant: 'bodyMd' }) : dash()),
        {
          wrap: true,
        },
      ),
      ...(answer?.stock
        ? [
            column(
              'available',
              labels['col.available'],
              (row) =>
                row.available === null
                  ? dash()
                  : Text({ children: quantity.format(row.available), variant: 'bodyMd', numeric: true }),
              { align: 'end', kind: 'number' },
              'available',
            ),
          ]
        : []),
      column(
        'listPrice',
        labels['col.price'],
        (row) => Text({ children: money.format(Number(row.listPrice)), variant: 'bodyMd', numeric: true }),
        { align: 'end', kind: 'currency' },
        'listPrice',
      ),
      ...(answer?.money
        ? [
            column(
              'margin',
              labels['col.margin'],
              (row) =>
                row.margin === null
                  ? dash()
                  : Text({ children: `${percent.format(row.margin)}%`, variant: 'bodyMd', numeric: true }),
              { align: 'end', priority: 'tertiary', kind: 'number', width: 'narrow' },
            ),
          ]
        : []),
      column(
        'variants',
        labels['col.variants'],
        (row) =>
          row.variants ? Text({ children: String(row.variants), variant: 'bodyMd', numeric: true }) : dash(),
        { align: 'end', priority: 'tertiary', kind: 'number', width: 'narrow' },
      ),
      column('status', labels['col.status'], status, { kind: 'status' }),
    ]
  }

  const groupName = (group: ProductListGroup): string =>
    group.value == null
      ? labels['group.none']
      : group.field === 'type'
        ? typeLabel(String(group.value))
        : group.name
          ? group.name
          : ['active', 'saleOk', 'purchaseOk'].includes(group.field)
            ? truthy(group.value)
              ? labels['group.yes']
              : labels['group.no']
            : String(group.value)

  const tableGroups = (groups: readonly ProductListGroup[]): TableGroup[] =>
    groups.map((group) => ({
      id: group.id,
      label: groupName(group),
      count: group.count,
      open: group.open,
      href: group.href,
      ...(group.rows ? { rows: group.rows } : {}),
      ...(group.groups ? { children: tableGroups(group.groups) } : {}),
      ...(group.pager
        ? {
            pager: {
              label: format(labels.range, {
                from: group.pager.from,
                to: group.pager.to,
                total: group.pager.total,
              }),
              ...(group.pager.previous ? { prev: group.pager.previous } : {}),
              ...(group.pager.next ? { next: group.pager.next } : {}),
            },
          }
        : {}),
    }))

  const table = (answer: ProductListAnswer | null) =>
    KetTable<ProductListRow>({
      rows: answer?.rows ?? [],
      columns: columns(answer),
      id: (row) => row.id,
      rowName: (row) => row.name,
      rowHref: recordHref,
      currentRow: currentRow(),
      ...(props.bulk
        ? {
            selection: { formId: BULK_FORM, fieldName: 'selected' },
            selectionState: {
              ...selection(),
              onChange: (ids: string[], anchorId: string | null) => selection.set({ ids, anchor: anchorId }),
            },
          }
        : {}),
      busy: dimmed() && Boolean(answer),
      loading: answer ? undefined : { rows: Math.min(props.pageSize, 10), lines: { name: 2 } },
      responsive: 'stack',
      ...(answer?.groups ? { groups: tableGroups(answer.groups) } : {}),
      labels,
    })

  const card = (row: ProductListRow) =>
    ContentCard({
      title: row.name,
      href: recordHref(row),
      selected: currentRow() === row.id,
      media: Thumbnail({ src: imageOf(row), alt: '' }),
      mediaPlacement: 'start',
      summary: [row.code, row.category, row.unit].filter(Boolean).join(' · ') || null,
      ...(row.available !== null
        ? {
            body: Text({
              children: format(labels['card.available'], { count: quantity.format(row.available) }),
              variant: 'bodySm',
              numeric: true,
            }),
          }
        : {}),
      meta: Inline({
        align: 'between',
        blockAlign: 'center',
        items: [
          Text({ children: money.format(Number(row.listPrice)), variant: 'headingLg', numeric: true }),
          status(row),
        ],
      }),
    })
  const cards = (rows: readonly ProductListRow[]) =>
    CardGrid({ items: rows, id: (row) => row.id, card, minimum: 'wide' })
  const cardGroups = (groups: readonly ProductListGroup[]): JSXChild =>
    Stack({
      items: groups.map((group) =>
        Stack({
          gap: 'compact',
          items: [
            LinkButton({
              label: `${format(labels[group.open ? 'group.close' : 'group.open'], { group: groupName(group) })} (${group.count})`,
              href: group.href,
              variant: 'tertiary',
            }),
            ...(group.open && group.groups ? [cardGroups(group.groups)] : []),
            ...(group.open && group.rows ? [cards(group.rows)] : []),
            ...(group.open && group.pager
              ? [
                  ListChrome({
                    pager: {
                      label: labels.pages,
                      summary: format(labels.range, {
                        from: group.pager.from,
                        to: group.pager.to,
                        total: group.pager.total,
                      }),
                      previousHref: group.pager.previous,
                      nextHref: group.pager.next,
                      previousLabel: labels.previous,
                      nextLabel: labels.next,
                    },
                  }),
                ]
              : []),
          ],
        }),
      ),
    })

  const empty = (answer: ProductListAnswer) => {
    const clear = new URL(LIST_PATH, 'http://ket.local')
    if (lang === 'en') clear.searchParams.set('lang', 'en')
    // An explicit empty query: clearing must not bring a default saved search back.
    clear.searchParams.set('q', '')
    return EmptyState({
      visual: answer.isEmpty ? 'start' : 'search',
      title: labels[answer.isEmpty ? 'empty.title' : 'filtered.title'],
      message: answer.isEmpty
        ? labels['empty.message']
        : answer.query.q
          ? format(labels['filtered.query'], { q: answer.query.q })
          : labels['filtered.message'],
      actions: answer.isEmpty
        ? props.createHref
          ? LinkButton({ label: labels.create, href: props.createHref, variant: 'primary' })
          : undefined
        : LinkButton({ label: labels['filtered.clear'], href: `${clear.pathname}${clear.search}` }),
    })
  }

  const range = (answer: ProductListAnswer) => {
    const from = answer.total ? (answer.page - 1) * answer.pageSize + 1 : 0
    const to = answer.groups ? answer.total : Math.min(answer.page * answer.pageSize, answer.total)
    return { from, to, total: answer.total }
  }

  const failure = () => {
    const kind = phase()
    // A refused read says so in the list's place, not in a notice above it.
    if (kind === 'ready' || kind === 'loading' || kind === 'denied') return null
    return Notice({
      tone: kind === 'failed' ? 'danger' : 'warning',
      title: labels[`${kind}.title`],
      message: labels.retryHint,
      actions: Button({ label: labels.retry, type: 'button', id: RETRY_ID }),
    })
  }

  const announce = (shown: ReturnType<typeof range> | null): string =>
    shown ? (shown.total ? format(labels.announce, shown) : labels.announceNone) : ''

  /** Every link in the list stays in it; a row's link leaves for its page and is remembered. */
  const onClick = (event: Event) => {
    const target = event.target as Element
    if (target.closest(`#${RETRY_ID}`)) {
      void load()
      return
    }
    if (
      confirming() &&
      target.closest('[data-ui="modal-close"], [data-ui="modal-backdrop"], [data-client-modal-close]')
    ) {
      event.preventDefault()
      closeConfirm()
      return
    }
    const link = target.closest<HTMLAnchorElement>('a[href]')
    const mouse = event as MouseEvent
    if (!link || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey || mouse.button !== 0)
      return
    const next = new URL(link.href, location.href)
    if (next.origin !== location.origin) return
    if (next.pathname.startsWith(`${LIST_PATH}/`)) {
      rememberRowAnchor(link)
      return
    }
    // The saved-search form and other route modals are the shell's pages.
    if (next.pathname !== LIST_PATH || next.searchParams.has('modal')) return
    // preventDefault alone keeps the shell from following the link; the click
    // still bubbles so the document closes an open filter popover or menu.
    event.preventDefault()
    navigate(`${next.pathname}${next.search}`)
  }

  const onSubmit = (event: Event) => {
    const form = event.target as HTMLFormElement
    if (form.id !== BULK_FORM) return
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null
    // The dialog's own confirm button posts the selection; the toolbar's asks first.
    if (submitter?.closest('[data-ui="dialog"]')) return
    event.preventDefault()
    const action =
      submitter?.value === 'delete' ? 'delete' : submitter?.value === 'archive' ? 'archive' : null
    if (action && selection().ids.length && phase() === 'ready') openConfirm(action, submitter)
  }

  // The page's controls slot: search, filters, views and, with rows selected, the bulk bar
  // with the form it posts and the dialog that asks first.
  const controls: IslandController = {
    view: () => {
      const view = viewOf(href())
      const selected = selection().ids.length
      const action = confirming()
      return (
        <IslandRegion marker="product-list-controls">
          {props.bulk ? (
            <HiddenPostForm id={BULK_FORM} action={props.bulk.action} fields={{ returnTo: href() }} />
          ) : null}
          {ListChrome({
            query: search.view(),
            viewsLabel: labels['view.label'],
            views: (['list', 'kanban'] as const).map((id) => ({
              id,
              label: labels[`view.${id}`],
              href: withView(href(), id),
              active: view === id,
            })),
            ...(props.bulk && view === 'list'
              ? {
                  bulkPresentation: 'replace' as const,
                  bulk: {
                    form: BULK_FORM,
                    selectedCount: selected,
                    summary: format(labels.selected, { count: selected }),
                    clearLabel: labels['bulk.clear'],
                    actions: (['archive', 'delete'] as const)
                      .filter((id) => props.bulk?.[id])
                      .map((id) => ({
                        id,
                        label: labels[`bulk.${id}`],
                        name: 'action',
                        value: id,
                        variant: id === 'delete' ? ('destructive' as const) : ('secondary' as const),
                        disabled: phase() !== 'ready',
                      })),
                  },
                }
              : {}),
          })}
          {action
            ? ConfirmDialog({
                id: 'product-list-confirm',
                mode: 'client',
                title: format(labels[`confirm.${action}.title`], { count: selected }),
                message: labels[`confirm.${action}.message`],
                closeHref: href(),
                closeLabel: labels['confirm.cancel'],
                confirmLabel: labels[`bulk.${action}`],
                confirmName: 'action',
                confirmValue: action,
                confirmForm: BULK_FORM,
                confirmVariant: action === 'delete' ? 'destructive' : 'primary',
              })
            : null}
        </IslandRegion>
      )
    },
    mount: (context) => {
      const element = context.root as unknown as HTMLElement
      // The bar is a controller of its own inside this island, mounted on its own element.
      const searchRoot = element.querySelector('[data-ui="search-filter"]') as typeof context.root | null
      search.mount?.({ ...context, root: searchRoot ?? context.root })
      element.addEventListener('click', onClick, { signal: context.lifetime })
      element.addEventListener('submit', onSubmit, { signal: context.lifetime })
    },
    dispose: () => {
      releaseModal?.()
      search.dispose?.()
    },
  }

  // The page's body: the rows or cards and what the list says about them. It reads the
  // pages and follows the shell's history for all three islands.
  const results: IslandController = {
    view: () => {
      const answer = phase() === 'denied' ? null : result()
      const view = viewOf(href())
      const shown = answer ? range(answer) : null
      return (
        <IslandRegion marker="product-list" busy={phase() === 'loading'}>
          {Stack({
            items: [
              ...(bulkError()
                ? [
                    Notice({
                      tone: 'danger',
                      title: labels['bulkError.title'],
                      message: labels['bulkError.delete'],
                    }),
                  ]
                : []),
              ...(missingRow()
                ? [Notice({ tone: 'info', title: labels['col.product'], message: labels.rowMissing })]
                : []),
              failure(),
              phase() === 'denied'
                ? EmptyState({
                    visual: 'locked',
                    title: labels['denied.title'],
                    message: labels['denied.message'],
                  })
                : !answer && phase() !== 'loading'
                  ? null
                  : answer && !answer.total
                    ? empty(answer)
                    : view === 'kanban' && answer
                      ? answer.groups
                        ? cardGroups(answer.groups)
                        : cards(answer.rows)
                      : table(answer),
            ].filter(Boolean),
          })}
          <PoliteStatus>{Text({ children: announce(shown), visuallyHidden: true })}</PoliteStatus>
        </IslandRegion>
      )
    },
    mount: (context) => {
      const active = context.lifetime
      lifetime = active
      root = context.root as unknown as HTMLElement
      anchor = takeRowAnchor()
      currentRow.set(anchor?.id)
      // The bulk route answers a refused delete with this flag; it is said once and dropped.
      const url = new URL(location.href)
      if (url.searchParams.get('bulkError') === 'delete') {
        bulkError.set(true)
        url.searchParams.delete('bulkError')
        history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
      }
      href.set(`${url.pathname}${url.search}`)
      root.addEventListener('click', onClick, { signal: active })
      document.addEventListener(
        'ket:popstate',
        (event) => {
          const next = new URL(location.href)
          // A route modal over the list (the saved-search form) is the shell's to close.
          if (next.pathname !== LIST_PATH || next.searchParams.has('modal')) return
          if (document.querySelector('[data-ui="modal-layer"][data-route-modal="true"]')) return
          event.preventDefault()
          if (confirming()) closeConfirm()
          typing = false
          batch(() => {
            selection.set({ ids: [], anchor: null })
            href.set(`${next.pathname}${next.search}`)
          })
          void load()
        },
        { signal: active },
      )
      // A saved record: the list reads itself again, so the shell need not re-fetch the page.
      document.addEventListener(
        'ket:records-changed',
        (event) => {
          event.preventDefault()
          void load()
        },
        { signal: active },
      )
      window.addEventListener(
        'online',
        () => {
          if (phase() === 'offline') void load()
        },
        { signal: active },
      )
      void load()
    },
    dispose: () => {
      controller?.abort()
      clearTimeout(dimTimer)
      sequence++
      release()
    },
  }

  // The page's footer: the pager, when the rows run to more than one page.
  const footer: IslandController = {
    view: () => {
      const answer = phase() === 'denied' ? null : result()
      const shown = answer ? range(answer) : null
      return (
        <IslandRegion marker="product-list-footer">
          {answer && !answer.groups && answer.pages > 1 && shown
            ? ListChrome({
                pager: {
                  label: labels.pages,
                  summary: format(labels.range, shown),
                  previousHref: answer.previous,
                  nextHref: answer.next,
                  previousLabel: labels.previous,
                  nextLabel: labels.next,
                },
              })
            : null}
        </IslandRegion>
      )
    },
    mount: (context) => {
      ;(context.root as unknown as HTMLElement).addEventListener('click', onClick, {
        signal: context.lifetime,
      })
    },
  }

  return { controls, results, footer }
}

type ProductListStore = ReturnType<typeof createListStore>

// The server renders each island once per request; the browser shares one store between
// the three islands of a list, keyed as the islands are (PRODUCT_LIST_KEY).
const stores = new Map<string, ProductListStore>()
const storeOf = (props: ProductListProps): ProductListStore => {
  if (typeof document === 'undefined') return createListStore(props, () => {})
  const key = `${props.read}\n${props.href}`
  const known = stores.get(key)
  if (known) return known
  const made: ProductListStore = createListStore(props, () => {
    if (stores.get(key) === made) stores.delete(key)
  })
  stores.set(key, made)
  return made
}

/** The list's query controls, in the page's controls slot. */
export const productListControls = (props: ProductListProps): IslandController => storeOf(props).controls
/** The list's rows or cards and their states, in the page's body. */
export const productList = (props: ProductListProps): IslandController => storeOf(props).results
/** The list's pager, in the page's footer. */
export const productListFooter = (props: ProductListProps): IslandController => storeOf(props).footer

class FunctionError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

const callFunction = async <T,>(name: string, input: unknown, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; value?: T }
  if (!response.ok || payload.ok === false) throw new FunctionError(response.status)
  return (payload.value ?? payload) as T
}
