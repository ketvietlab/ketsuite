// A collection as three client islands over one paged read (design system: "Collections are
// client islands"): the query controls in the page's controls slot, the rows in its body and
// the pager in its footer, sharing one store. The read is a same-origin POST that takes the
// list's URL and answers `RowListAnswer` (modules/backend/row-list-read.ts builds one for a
// collection held in memory).
//
// The server renders the frame and the loading state; the first client render is the same
// markup, so hydration adopts it, and the results island then reads the first page. The query
// lives in the URL: following a facet, a sort header, a group toggle or the pager is a
// `pushState` and one read, never a page load. Typing narrows after a pause; the first pause
// pushes and later ones replace, so Back returns to the list as it was before the search. Back
// reads the URL and writes nothing. A row opens either a record modal over the list, which the
// shell's record runtime owns (a save there announces `ket:records-changed` and the list reads
// itself again), or a page that returns to the row.
import { batch, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, JSXChild } from '@ketvietlab/ketjs-view'
import {
  BULK_CLEAR_COMMAND,
  Button,
  EmptyState,
  KetTable,
  LinkButton,
  ListChrome,
  Menu,
  Notice,
  Stack,
  Text,
  createKetTableView,
  createSearchFilterView,
  rememberRowAnchor,
  restoreRowAnchor,
  rowAnchorHref,
  takeRowAnchor,
} from '@ketvietlab/design-system'
import type {
  KetTableColumn,
  KetTableLabels,
  KetTableRow,
  SearchFilterApplyInput,
  SearchFilterConfig,
} from '@ketvietlab/design-system'
import type { RowListAnswer, RowListMenu } from '../../modules/backend/row-list-read.ts'
import { ketTableCellRenderers } from './ket-table-view.tsx'
import { IslandRegion, PoliteStatus } from './island-markup.tsx'

/** A table column, and the field its header sorts by when the list sorts by it. */
export type RowListColumn = KetTableColumn & { sortKey?: string }

export type RowListLabels = KetTableLabels & {
  /** "{from}–{to} / {total}", beside the pager. */
  range: string
  pages: string
  previous: string
  next: string
  /** "{from}–{to} of {total} roles", read out after each change. */
  announce: string
  announceNone: string
  failed: string
  offline: string
  retryHint: string
  deniedTitle: string
  deniedMessage: string
  noMatch: string
  /** "Nothing matches “{q}”", when the reader searched. */
  noMatchQuery: string
  noMatchHint: string
  clearFilters: string
  /** "{column}, sort ascending": what following a header does. */
  sortAsc: string
  sortDesc: string
  create?: string
  columns?: string
}

/** The list's query controls: the shared search bar, or a search field with one choice of facets. */
export type RowListControls =
  | { kind: 'bar'; config: SearchFilterConfig }
  | {
      kind: 'search'
      label: string
      placeholder: string
      submitLabel: string
      /** One choice over one URL parameter (`null` is the default, which the URL omits), each with its count. */
      facets?: {
        param: string
        label: string
        options: Array<{ id: string; value: string | null; label: string }>
      }
    }

export type RowListProps = IslandProps & {
  /** Where a page is read: a same-origin POST of `{ href }` answering `{ ok, value: RowListAnswer }`. */
  read: string
  /** The list's URL as the server rendered it. */
  href: string
  /** Names the islands' regions (`data-<marker>`, `-controls`, `-footer`) and their element ids. */
  marker: string
  lang: string
  columns: RowListColumn[]
  labels: RowListLabels
  controls: RowListControls
  /**
   * What a row opens: a record modal over the list (`?record=<record>:<id>`), or a page
   * (`path` with `{id}`) whose way back is this list, at that row, under `returnPath`.
   */
  open:
    | { kind: 'record'; record: string; tab?: string | null }
    | { kind: 'page'; path: string; returnPath?: string | null }
  createHref?: string | null
  /** Offer a menu that shows or hides the columns after the first (`?columns=`). */
  chooseColumns?: boolean
  /** Parameters that name the list rather than its query; a URL that changes one is another page. */
  pin?: string[]
  /**
   * Rows are checked into the server-rendered bulk form `formId` (`ListPage` `selection`), which posts
   * natively. The check marks live in the store, so a re-render keeps them and a new page clears them;
   * the form's `returnTo` follows the list's URL.
   */
  selection?: { formId: string; fieldName?: string } | null
}

/** The islands' identity: a new read or URL from the shell is a new list. */
export const ROW_LIST_KEY = ['read', 'href']

/** The props each island declares (`defineIsland`). */
export const ROW_LIST_PROPS = {
  read: 'text',
  href: 'text',
  marker: 'text',
  lang: 'text',
  columns: 'json',
  labels: 'json',
  controls: 'json',
  open: 'json',
  createHref: 'text?',
  chooseColumns: 'bool?',
  pin: 'json?',
  selection: 'json?',
} as const

type Phase = 'loading' | 'ready' | 'failed' | 'offline' | 'denied'

const TYPING_PAUSE = 250
const DIM_AFTER = 150
const CACHE_SIZE = 20
const LOADING_ROWS = 6

class ReadError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/gu, (match, key: string) => (key in values ? String(values[key]) : match))

const urlOf = (href: string): URL => new URL(href, 'https://list.invalid')
const pathOf = (url: URL): string => `${url.pathname}${url.search}`

/** The list's own URL: what it lists, less a record or dialog opened over it. */
const listHrefOf = (url: URL): string => {
  const list = new URL(url)
  for (const key of ['record', 'tab', 'dialog', 'dialogId']) list.searchParams.delete(key)
  return pathOf(list)
}

/** The list's URL with these parameters changed; `null` removes one. A new query starts on page 1. */
export const rowListHref = (href: string, changes: Record<string, string | null>): string => {
  const url = urlOf(href)
  for (const [key, value] of Object.entries(changes))
    if (value === null || value === '') url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  if (!('page' in changes)) url.searchParams.delete('page')
  return pathOf(url)
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

const readPage = async (path: string, href: string, signal: AbortSignal): Promise<RowListAnswer> => {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ href }),
    signal,
  })
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; value?: RowListAnswer }
  if (!response.ok || payload.ok === false || !payload.value) throw new ReadError(response.status)
  return payload.value
}

const callFunction = async <T,>(name: string, input: unknown, signal: AbortSignal): Promise<T> => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; value?: T }
  if (!response.ok || payload.ok === false) throw new ReadError(response.status)
  return (payload.value ?? payload) as T
}

const createRowListStore = (props: RowListProps, release: () => void) => {
  const labels = props.labels
  const listPath = urlOf(props.href).pathname
  const pinned = Object.fromEntries(
    (props.pin ?? []).map((key) => [key, urlOf(props.href).searchParams.get(key)]),
  )
  const number = new Intl.NumberFormat(props.lang === 'en' ? 'en-GB' : 'vi-VN')
  const barId = `${props.marker}-filter`
  const searchId = `${props.marker}-search`
  const retryId = `${props.marker}-retry`

  const href = signal(props.href)
  const result = signal<RowListAnswer | null>(null)
  const phase = signal<Phase>('loading')
  const dimmed = signal(false)
  const currentRow = signal<string | undefined>(undefined)
  const checked = signal<readonly string[]>([])
  let checkedAnchor: string | null = null
  const cache = new Map<string, RowListAnswer>()
  let controller: AbortController | undefined
  let lifetime: AbortSignal | undefined
  let rowsRoot: HTMLElement | undefined
  let dimTimer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  let anchor: ReturnType<typeof takeRowAnchor> = null
  /** The entry the reader's typing pushed: later pauses replace it, so Back skips them. */
  let typing = false

  /** Whether a URL is this list, with some query, rather than another page or a record over it. */
  const isList = (url: URL): boolean =>
    url.pathname === listPath &&
    !url.searchParams.has('record') &&
    Object.entries(pinned).every(([key, value]) => url.searchParams.get(key) === value)

  const bar =
    props.controls.kind === 'bar'
      ? createSearchFilterView(
          { id: barId, config: props.controls.config },
          {
            apply: async (input: SearchFilterApplyInput, signal: AbortSignal) => {
              const config = props.controls.kind === 'bar' ? props.controls.config : null
              const manager = config?.manager
              const answer = await callFunction<{ href: string }>(
                String(manager?.applyFunction ?? ''),
                { ...input, ...(manager?.applyInput ?? {}), returnTo: href() },
                signal,
              )
              if (signal.aborted) return
              const typed = structureOf(input) === structure
              navigate(answer.href, typed && typing ? 'replace' : 'push')
              typing = typed
            },
          },
        )
      : null
  let structure = props.controls.kind === 'bar' ? configStructure(props.controls.config) : ''

  const bulkForm = (): HTMLFormElement | null =>
    props.selection && typeof document.getElementById === 'function'
      ? (document.getElementById(props.selection.formId) as HTMLFormElement | null)
      : null

  /** Uncheck every row, the boxes the reader toggled included, and let the bulk bar recount. */
  const clearChecked = () => {
    if (!props.selection) return
    checked.set([])
    checkedAnchor = null
    if (!rowsRoot) return
    for (const box of rowsRoot.querySelectorAll<HTMLInputElement>(
      '[data-ui="kt-row-select"], [data-ui="kt-select-all"]',
    ))
      box.checked = false
    const root = rowsRoot
    queueMicrotask(() => root.dispatchEvent(new Event('change', { bubbles: true })))
  }

  /** The bulk form returns to the list as it is now, not as the server first rendered it. */
  const followForm = () => {
    const field = bulkForm()?.elements.namedItem('returnTo') as HTMLInputElement | null | undefined
    if (field && 'value' in field) field.value = href()
  }

  const remember = (key: string, answer: RowListAnswer) => {
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
      const answer = await readPage(props.read, asked, controller.signal)
      if (identity !== sequence || lifetime?.aborted) return
      remember(asked, answer)
      batch(() => {
        // A page past the end comes back clamped; the URL says so without a new entry.
        if (answer.href !== asked && answer.page !== (Number(urlOf(asked).searchParams.get('page')) || 1)) {
          history.replaceState(history.state, '', `${answer.href}${location.hash}`)
          href.set(answer.href)
          remember(answer.href, answer)
        }
        // A new read replaces the page, and the rows checked on the last one with it.
        if (result() !== answer) clearChecked()
        result.set(answer)
        dimmed.set(false)
        phase.set('ready')
      })
      followForm()
      if (bar && answer.search) {
        structure = configStructure(answer.search)
        bar.update?.({ id: barId, config: answer.search })
      }
      if (anchor && rowsRoot)
        requestAnimationFrame(() => {
          if (anchor && rowsRoot) restoreRowAnchor(rowsRoot, anchor)
          anchor = null
        })
    } catch (error) {
      if (controller.signal.aborted || identity !== sequence || lifetime?.aborted) return
      batch(() => {
        dimmed.set(false)
        phase.set(
          error instanceof ReadError && error.status === 403
            ? 'denied'
            : typeof navigator !== 'undefined' && navigator.onLine === false
              ? 'offline'
              : 'failed',
        )
      })
    } finally {
      if (identity === sequence) clearTimeout(dimTimer)
    }
  }

  /**
   * The search field shows the query in force. A render sets its attribute, which no longer moves the
   * text once the reader has typed; a query that came from a link or from Back puts it in the field.
   */
  const showQuery = () => {
    if (props.controls.kind !== 'search' || typeof document.getElementById !== 'function') return
    const field = document.getElementById(searchId) as HTMLInputElement | null
    const q = urlOf(href()).searchParams.get('q') ?? ''
    if (field && field.value.trim() !== q) field.value = q
  }

  const navigate = (next: string, mode: 'push' | 'replace' = 'push') => {
    if (mode === 'push') typing = false
    batch(() => {
      currentRow.set(undefined)
      href.set(next)
    })
    anchor = null
    if (mode === 'replace') history.replaceState(history.state, '', next)
    else history.pushState(null, '', next)
    showQuery()
    void load()
  }

  /** A query from typing: its first pause pushes, later ones replace that entry. */
  const search = (q: string) => {
    if (q === (urlOf(href()).searchParams.get('q') ?? '')) return
    const wasTyping = typing
    navigate(rowListHref(href(), { q: q || null }), wasTyping ? 'replace' : 'push')
    typing = true
  }

  /** What following a row's link opens. */
  const rowHref = (row: KetTableRow): string => {
    const id = String(row.id)
    if (props.open.kind === 'record') {
      const url = urlOf(href())
      url.searchParams.set('record', `${props.open.record}:${id}`)
      if (props.open.tab) url.searchParams.set('tab', props.open.tab)
      else url.searchParams.delete('tab')
      url.searchParams.delete('dialog')
      return pathOf(url)
    }
    const page = urlOf(props.open.path.replace('{id}', encodeURIComponent(id)))
    const back = urlOf(href())
    const returnTo = `${props.open.returnPath ?? back.pathname}${back.search}`
    // The page's way back names this row, so the list returns to it.
    page.searchParams.set('returnTo', rowAnchorHref(returnTo, id))
    return pathOf(page)
  }

  // The columns after the first may be hidden (`?columns=` names the ones shown).
  const shownColumns = (): RowListColumn[] => {
    const asked = urlOf(href()).searchParams.get('columns')
    if (!props.chooseColumns || asked === null) return props.columns
    const keep = new Set(asked.split(',').filter(Boolean))
    return props.columns.filter((column, index) => index === 0 || keep.has(column.key))
  }

  const columnsMenu = (): JSXChild => {
    if (!props.chooseColumns || !labels.columns) return null
    const shown = new Set(shownColumns().map((column) => column.key))
    return Menu({
      id: `${props.marker}-columns`,
      label: labels.columns,
      size: 'compact',
      selectionMode: 'multiple',
      items: props.columns.slice(1).map((column) => {
        const next = new Set(shown)
        if (next.has(column.key)) next.delete(column.key)
        else next.add(column.key)
        return {
          id: column.key,
          label: column.label,
          checked: shown.has(column.key),
          href: rowListHref(href(), {
            columns: props.columns
              .filter((item) => next.has(item.key))
              .map((item) => item.key)
              .join(','),
            page: urlOf(href()).searchParams.get('page'),
          }),
        }
      }),
    })
  }

  /** The choices the read offers over its own parameters (a company, a role); one may be chosen. */
  const menus = (answer: RowListAnswer | null): JSXChild[] =>
    (answer?.menus ?? []).map((menu: RowListMenu) => {
      const chosen = menu.items.find((item) => item.active)
      return Menu({
        id: `${props.marker}-menu-${menu.id}`,
        label: chosen ? `${menu.label}: ${chosen.label}` : menu.label,
        size: 'compact',
        selectionMode: 'single',
        items: menu.items.map((item) => ({
          id: item.id,
          label: item.label,
          checked: item.active,
          href: item.href,
        })),
      })
    })

  const tableColumns = (answer: RowListAnswer | null): KetTableColumn[] =>
    shownColumns().map(({ sortKey, ...column }) => {
      const link = sortKey ? answer?.sort[sortKey] : undefined
      if (!link) return column
      const sorted = answer?.sorted
      const direction = sorted && sorted.key === sortKey ? sorted.dir : null
      // The header's name says what following it does.
      return {
        ...column,
        sortHref: link,
        sortDirection: direction,
        sortLabel: fill(direction === 'asc' ? labels.sortDesc : labels.sortAsc, { column: column.label }),
      }
    })

  const table = (answer: RowListAnswer | null): JSXChild => {
    if (!answer)
      return KetTable<KetTableRow>({
        columns: tableColumns(null).map(({ format: _format, ...column }) => ({ ...column, cell: () => '' })),
        rows: [],
        id: (row) => String(row.id),
        loading: { rows: LOADING_ROWS },
        responsive: 'stack',
        labels,
      })
    return createKetTableView(
      {
        id: `${props.marker}-table`,
        config: {
          columns: tableColumns(answer),
          rows: answer.rows,
          total: answer.total,
          idField: 'id',
          locale: props.lang === 'en' ? 'en' : 'vi',
          groupBy: answer.groups ? ['group'] : [],
          ...(answer.groups ? { groups: answer.groups } : {}),
          pager: false,
          labels,
          ...(props.selection ? { selection: props.selection } : {}),
        },
      },
      ketTableCellRenderers,
      {
        rowHref,
        busy: dimmed(),
        currentRow: currentRow() ?? null,
        responsive: 'stack',
        ...(props.selection
          ? {
              selectionState: {
                ids: checked(),
                anchor: checkedAnchor,
                onChange: (ids: string[], anchor: string | null) => {
                  checkedAnchor = anchor
                  checked.set(ids)
                },
              },
            }
          : {}),
      },
    ).view()
  }

  const empty = (answer: RowListAnswer): JSXChild =>
    answer.isEmpty
      ? EmptyState({
          visual: 'start',
          title: labels.empty,
          message: labels.emptyHint,
          actions:
            props.createHref && labels.create
              ? LinkButton({ label: labels.create, href: props.createHref, variant: 'primary' })
              : undefined,
        })
      : EmptyState({
          visual: 'search',
          title: labels.noMatch,
          message: answer.query.q ? fill(labels.noMatchQuery, { q: answer.query.q }) : labels.noMatchHint,
          actions: LinkButton({ label: labels.clearFilters, href: answer.clear, variant: 'secondary' }),
        })

  const failure = (): JSXChild => {
    const kind = phase()
    // A refused read says so in the list's place, not in a notice above it.
    if (kind !== 'failed' && kind !== 'offline') return null
    return Notice({
      tone: kind === 'failed' ? 'danger' : 'warning',
      title: kind === 'failed' ? labels.failed : labels.offline,
      message: labels.retryHint,
      actions: Button({ label: labels.retry, type: 'button', variant: 'secondary', id: retryId }),
    })
  }

  const range = (answer: RowListAnswer) => {
    const from = answer.total ? (answer.page - 1) * answer.pageSize + 1 : 0
    const to = answer.groups ? answer.total : Math.min(answer.page * answer.pageSize, answer.total)
    return { from: number.format(from), to: number.format(to), total: number.format(answer.total) }
  }

  const announcement = (answer: RowListAnswer | null): string => {
    if (!answer || phase() !== 'ready') return ''
    return answer.total ? fill(labels.announce, range(answer)) : labels.announceNone
  }

  const facets = (answer: RowListAnswer | null) => {
    if (props.controls.kind !== 'search' || !props.controls.facets) return undefined
    const { param, options } = props.controls.facets
    const current = urlOf(href()).searchParams.get(param)
    // After a failure the figures are not known; a stale count would read as current.
    const counted = answer && (phase() === 'ready' || phase() === 'loading') ? answer.counts : null
    return options.map((option) => ({
      id: option.id,
      label: option.label,
      href: rowListHref(href(), { [param]: option.value }),
      active: (current ?? null) === option.value,
      ...(counted && option.id in counted ? { count: counted[option.id] } : {}),
    }))
  }

  /** Every link in the list stays in it; a row's link leaves for its page and is remembered. */
  const onClick = (event: Event) => {
    const target = event.target as Element
    if (target.closest(`#${retryId}`)) {
      event.preventDefault()
      void load()
      return
    }
    const link = target.closest<HTMLAnchorElement>('a[href]')
    const mouse = event as MouseEvent
    if (!link || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey || mouse.button !== 0)
      return
    const next = new URL(link.href, location.href)
    if (next.origin !== location.origin) return
    if (!isList(next)) {
      // A page opened from a row comes back to that row.
      if (props.open.kind === 'page' && link.closest('[data-ui="kt-row"]')) rememberRowAnchor(link)
      return
    }
    // preventDefault alone keeps the shell from following the link; the click still
    // bubbles so the document closes an open filter popover or menu.
    event.preventDefault()
    navigate(pathOf(next))
  }

  const controls: IslandController = {
    view: () => {
      const url = urlOf(href())
      const answer = phase() === 'denied' ? null : result()
      if (props.controls.kind === 'bar')
        return (
          <IslandRegion marker={`${props.marker}-controls`}>
            {ListChrome({ query: bar!.view(), filterMenus: <>{[...menus(answer), columnsMenu()]}</> })}
          </IslandRegion>
        )
      const pinnedHidden = Object.fromEntries(
        [...url.searchParams].filter(([key]) => key !== 'q' && key !== 'page'),
      )
      return (
        <IslandRegion marker={`${props.marker}-controls`}>
          {ListChrome({
            search: {
              id: searchId,
              action: listPath,
              name: 'q',
              value: url.searchParams.get('q') ?? '',
              label: props.controls.label,
              placeholder: props.controls.placeholder,
              submitLabel: props.controls.submitLabel,
              hidden: pinnedHidden,
            },
            ...(props.controls.facets
              ? { filtersLabel: props.controls.facets.label, facets: facets(answer) }
              : {}),
            filterMenus: <>{[...menus(answer), columnsMenu()]}</>,
          })}
        </IslandRegion>
      )
    },
    mount: (context) => {
      const element = context.root as unknown as HTMLElement
      if (bar) {
        // The bar is a controller of its own inside this island, mounted on its own element.
        const barRoot = element.querySelector('[data-ui="search-filter"]') as typeof context.root | null
        bar.mount?.({ ...context, root: barRoot ?? context.root })
      }
      element.addEventListener('click', onClick, { signal: context.lifetime })
      if (props.controls.kind !== 'search') return
      // Typing narrows after a pause; the text stays in the field, the URL follows it.
      let pause: ReturnType<typeof setTimeout> | undefined
      context.lifetime.addEventListener('abort', () => clearTimeout(pause))
      element.addEventListener(
        'input',
        (event) => {
          const field = event.target as HTMLInputElement
          if (field.id !== searchId) return
          clearTimeout(pause)
          pause = setTimeout(() => search(field.value.trim()), TYPING_PAUSE)
        },
        { signal: context.lifetime },
      )
      element.addEventListener(
        'submit',
        (event) => {
          const form = event.target as HTMLFormElement
          const field = form.querySelector<HTMLInputElement>(`#${searchId}`)
          if (!field) return
          event.preventDefault()
          clearTimeout(pause)
          search(field.value.trim())
        },
        { signal: context.lifetime },
      )
    },
    dispose: () => bar?.dispose?.(),
  }

  const results: IslandController = {
    view: () => {
      const answer = phase() === 'denied' ? null : result()
      return (
        <IslandRegion marker={props.marker} busy={phase() === 'loading'}>
          {Stack({
            items: [
              failure(),
              phase() === 'denied'
                ? EmptyState({ visual: 'locked', title: labels.deniedTitle, message: labels.deniedMessage })
                : !answer && phase() !== 'loading'
                  ? null
                  : answer && !answer.total
                    ? empty(answer)
                    : table(answer),
            ].filter(Boolean),
          })}
          <PoliteStatus>{Text({ children: announcement(answer), visuallyHidden: true })}</PoliteStatus>
        </IslandRegion>
      )
    },
    mount: (context) => {
      const active = context.lifetime
      lifetime = active
      rowsRoot = context.root as unknown as HTMLElement
      // The shell mounts a page's islands before it moves the address there: until it does, the list is
      // the one the server rendered, and the address (with any row it returns to) is the page being left.
      const here = new URL(location.href)
      const arrived = isList(here)
      anchor = props.open.kind === 'page' && arrived ? takeRowAnchor() : null
      currentRow.set(anchor?.id)
      href.set(arrived ? listHrefOf(here) : props.href)
      rowsRoot.addEventListener('click', onClick, { signal: active })
      // "Clear selection" in the bulk bar is a command to the form these rows are checked into.
      if (props.selection) {
        const formId = props.selection.formId
        document.addEventListener(
          'click',
          (event) => {
            const target = event.target as Element | null
            const command = typeof target?.closest === 'function' ? target.closest('button') : null
            if (command?.name === BULK_CLEAR_COMMAND && command.getAttribute('form') === formId)
              clearChecked()
          },
          { signal: active },
        )
      }
      document.addEventListener(
        'ket:popstate',
        (event) => {
          const next = new URL(location.href)
          // A record over the list, or another page, is the shell's to open.
          if (!isList(next)) return
          event.preventDefault()
          typing = false
          // Back from a record lands on the query already shown, or already being read after a save.
          const asked = listHrefOf(next)
          if (asked === href() && (phase() === 'ready' || phase() === 'loading')) return
          href.set(asked)
          showQuery()
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
      // A saved record: the list reads itself again, so the shell need not re-fetch the page.
      document.addEventListener(
        'ket:records-changed',
        (event) => {
          event.preventDefault()
          void load()
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

  const footer: IslandController = {
    view: () => {
      const answer = phase() === 'denied' ? null : result()
      return (
        <IslandRegion marker={`${props.marker}-footer`}>
          {answer && !answer.groups && answer.pages > 1
            ? ListChrome({
                pager: {
                  label: labels.pages,
                  summary: fill(labels.range, range(answer)),
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

type RowListStore = ReturnType<typeof createRowListStore>

// The server renders each island once per request; the browser shares one store between
// the three islands of a list, keyed as the islands are (ROW_LIST_KEY).
const stores = new Map<string, RowListStore>()
const storeOf = (props: RowListProps): RowListStore => {
  if (typeof document === 'undefined') return createRowListStore(props, () => {})
  const key = `${props.read}\n${props.href}`
  const known = stores.get(key)
  if (known) return known
  const made: RowListStore = createRowListStore(props, () => {
    if (stores.get(key) === made) stores.delete(key)
  })
  stores.set(key, made)
  return made
}

/** The list's query controls, in the page's controls slot. */
export const rowListControls = (props: RowListProps): IslandController => storeOf(props).controls
/** The list's rows and their states, in the page's body. */
export const rowList = (props: RowListProps): IslandController => storeOf(props).results
/** The list's pager, in the page's footer. */
export const rowListFooter = (props: RowListProps): IslandController => storeOf(props).footer
