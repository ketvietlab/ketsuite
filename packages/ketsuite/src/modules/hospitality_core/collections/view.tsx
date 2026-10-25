import { effect, html, signal } from '@ketvietlab/ketjs-view'
import type { IslandMountContext, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Badge,
  Button,
  EmptyState,
  KetTable,
  LinkButton,
  Link,
  ListChrome,
  Menu,
  Notice,
  Stack,
  Text,
  readRowAnchor,
  rememberRowAnchor,
  restoreRowAnchor,
  rowAnchorHref,
  takeRowAnchor,
} from '@ketvietlab/design-system'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import type {
  CollectionBrowser,
  CollectionPage,
  CollectionQuery,
  PagedAnswer,
  PagedCollectionStore,
  PagedQuery,
  PagedStore,
} from '../../../ui/client/paged-collection-store.ts'

export type Column = {
  key: string
  label: string
  field: string
  kind?: 'text' | 'money' | 'date' | 'number' | 'state'
  sortable?: boolean
  hrefField?: string
  linkValues?: readonly string[]
  /** A state's badge tone by its raw value; unnamed states stay neutral. */
  tones?: Readonly<Record<string, 'neutral' | 'info' | 'positive' | 'warning' | 'danger'>>
  /**
   * What an empty cell says (`words["empty.<key>"]`), or, naming another field of the row, one text per value of
   * that field (`words["empty.<key>.<value>"]`). Without either an empty cell reads "—".
   */
  emptyField?: string
}
export type HospitalityCollectionProps = {
  key: string
  id: string
  source: string
  path: string
  recordParam?: string
  recordIdField?: string
  recordQuery?: Record<string, string>
  recordKind?: string
  recordPath: string
  createHref: string | null
  query: CollectionQuery
  defaultSort: string
  defaultDirection?: 'asc' | 'desc'
  lang: string
  allowed: boolean
  columns: Column[]
  sorts?: {
    label: string
    choices: { id: string; field: string; direction: 'asc' | 'desc'; label: string }[]
  }
  states: Array<{ id: string; label: string }>
  properties: Array<{ id: string; name: string }>
  words: Record<string, string>
}

export const collectionCreateHref = (
  props: HospitalityCollectionProps,
  query: CollectionQuery,
): string | null => {
  if (!props.createHref) return null
  if (props.recordKind)
    return recordModalHref(collectionHref(props, query), { kind: props.recordKind, id: 'new' })
  const destination = new URL(props.createHref, 'http://collection.local'),
    current = new URL(collectionHref(props, query), 'http://collection.local')
  const reserved = new Set(['create', 'step', 'dialog', 'record', 'recordDialog', 'tab'])
  for (const key of [...destination.searchParams.keys()])
    if (!reserved.has(key)) destination.searchParams.delete(key)
  for (const [key, value] of current.searchParams)
    if (!reserved.has(key)) destination.searchParams.append(key, value)
  return destination.pathname + destination.search
}
const queryNames = [
  'q',
  'state',
  'sort',
  'direction',
  'property',
  'roomType',
  'floor',
  'from',
  'to',
  'page',
  'pageSize',
]
const positive = (value: string | null, fallback: number) =>
  value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : fallback
export function collectionQueryFromUrl(
  url: URL,
  props: Pick<
    HospitalityCollectionProps,
    'defaultSort' | 'defaultDirection' | 'states' | 'columns' | 'sorts'
  >,
): CollectionQuery {
  const p = url.searchParams
  const state = p.get('state') ?? 'all'
  const sort = p.get('sort') ?? props.defaultSort
  return {
    q: (p.get('q') ?? '').trim().slice(0, 200),
    state: props.states.some((item) => item.id === state) ? state : 'all',
    sort:
      props.columns.some((column) => column.sortable && column.field === sort) ||
      props.sorts?.choices.some((choice) => choice.field === sort)
        ? sort
        : props.defaultSort,
    direction:
      p.get('direction') === 'asc' || p.get('direction') === 'desc'
        ? (p.get('direction') as 'asc' | 'desc')
        : (props.defaultDirection ?? 'asc'),
    propertyId: p.get('property') || null,
    roomTypeId: p.get('roomType') || null,
    floorId: p.get('floor') || null,
    from:
      p.get('from') && Number.isFinite(Date.parse(p.get('from')!))
        ? new Date(p.get('from')!).toISOString()
        : null,
    to:
      p.get('to') && Number.isFinite(Date.parse(p.get('to')!)) ? new Date(p.get('to')!).toISOString() : null,
    page: positive(p.get('page'), 1),
    pageSize: Math.min(100, positive(p.get('pageSize'), 25)),
  }
}
export function collectionHref(props: HospitalityCollectionProps, query: CollectionQuery): string {
  const url = new URL(props.path, 'http://collection.local')
  for (const name of queryNames) url.searchParams.delete(name)
  for (const [key, value] of Object.entries({
    q: query.q.trim(),
    state: query.state === 'all' ? '' : query.state,
    sort: query.sort === props.defaultSort ? '' : query.sort,
    direction: query.direction === (props.defaultDirection ?? 'asc') ? '' : query.direction,
    property: query.propertyId ?? '',
    roomType: query.roomTypeId ?? '',
    floor: query.floorId ?? '',
    from: query.from ?? '',
    to: query.to ?? '',
    page: query.page > 1 ? String(query.page) : '',
    pageSize: query.pageSize === 25 ? '' : String(query.pageSize),
  })) {
    if (value) url.searchParams.set(key, value)
  }
  return url.pathname + (url.search ? url.search : '')
}
const stores = new Map<string, { store: { dispose: () => void }; refs: number }>()
const words = (props: HospitalityCollectionProps, key: string) => props.words[key] ?? key
const range = (page: CollectionPage, props: HospitalityCollectionProps) => {
  if (!page.total) return words(props, 'noResults')
  const number = (value: number) => value.toLocaleString(props.lang === 'en' ? 'en' : 'vi')
  const first = (page.page - 1) * page.query.pageSize + 1
  return `${number(first)}–${number(first + page.rows.length - 1)} / ${number(page.total)}`
}
/** The browser half of a paged store: its location, connectivity, transport and history. */
export const collectionBrowser = (): CollectionBrowser | undefined =>
  typeof window === 'undefined'
    ? undefined
    : {
        href: () => location.href,
        online: () => navigator.onLine,
        fetch: window.fetch.bind(window),
        push: (href: string) => history.pushState(history.state, '', href),
        replace: (href: string) => history.replaceState(history.state, '', href),
      }
/** One store per list key in the browser, shared by that list's islands; a server render makes its own. */
export function sharedCollectionStore<S extends { dispose: () => void }>(key: string, create: () => S): S {
  if (typeof window === 'undefined') return create()
  if (!stores.has(key)) stores.set(key, { store: create(), refs: 0 })
  return stores.get(key)!.store as S
}
const storeFor = (props: HospitalityCollectionProps) =>
  sharedCollectionStore(props.key, () =>
    createPagedCollectionStore<CollectionQuery, CollectionPage>({
      source: props.source,
      query: props.query,
      href: (query) => collectionHref(props, query),
      announce: (page) => range(page, props),
      browser: collectionBrowser(),
    }),
  )
const attach = (props: Pick<HospitalityCollectionProps, 'key'>, lifetime: AbortSignal) =>
  attachCollectionStore(props.key, lifetime)
/** An island holds its list's store while mounted; the last one out disposes it. */
export function attachCollectionStore(key: string, lifetime: AbortSignal) {
  const held = stores.get(key)!
  held.refs++
  lifetime.addEventListener(
    'abort',
    () => {
      held.refs--
      if (held.refs === 0) {
        held.store.dispose()
        if (stores.get(key) === held) stores.delete(key)
      }
    },
    { once: true },
  )
}
export const isHospitalityCollectionNavigation = (
  props: Pick<HospitalityCollectionProps, 'recordParam'>,
  next: URL,
  current: URL,
): boolean =>
  next.origin === current.origin &&
  next.pathname === current.pathname &&
  !['record', 'create', 'dialog', ...(props.recordParam ? [props.recordParam] : [])].some((name) =>
    next.searchParams.has(name),
  ) &&
  ['company', 'companies', 'branch', 'branches', 'lang'].every(
    (name) =>
      JSON.stringify(next.searchParams.getAll(name)) === JSON.stringify(current.searchParams.getAll(name)),
  )

const follow = (event: MouseEvent, props: HospitalityCollectionProps, store: PagedCollectionStore) =>
  followCollectionLink(
    event,
    (next, current) => isHospitalityCollectionNavigation(props, next, current),
    (next) => store.navigate(collectionQueryFromUrl(next, props)),
  )
/**
 * A plain click on a link to another query of the same list reads that query in place (closing the menus it
 * came from) instead of loading a page. Returns whether it did.
 */
export function followCollectionLink(
  event: MouseEvent,
  isNavigation: (next: URL, current: URL) => boolean,
  navigate: (next: URL) => void,
): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return false
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
  if (!link) return false
  const next = new URL(link.href, location.href),
    current = new URL(location.href)
  if (!isNavigation(next, current)) return false
  event.preventDefault()
  for (
    let menu = link.closest('details[open]');
    menu;
    menu = menu.parentElement?.closest('details[open]') ?? null
  )
    menu.removeAttribute('open')
  navigate(next)
  return true
}
export const hospitalityCollectionControls = (props: HospitalityCollectionProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const query = store.query(),
      count = ['failed', 'offline', 'denied'].includes(store.phase()) ? null : store.value()?.counts.state
    const at = (change: Partial<CollectionQuery>) => collectionHref(props, { ...query, page: 1, ...change })
    const property = props.properties.find((item) => item.id === query.propertyId)
    return (
      <ListChrome
        pager={collectionPager(props, store)}
        filtersLabel={words(props, 'filters')}
        search={{
          id: `${props.id}-search`,
          action: props.path.split('?')[0]!,
          name: 'q',
          value: query.q,
          label: props.words.searchPlaceholder ?? words(props, 'search'),
          placeholder: props.words.searchPlaceholder ?? words(props, 'search'),
          submitLabel: words(props, 'search'),
          hidden: Object.fromEntries(new URL(at({ q: '' }), 'http://collection.local').searchParams),
        }}
        filterMenus={
          <>
            {props.properties.length ? (
              <Menu
                id={`${props.id}-property`}
                label={`${words(props, 'property')}: ${property?.name ?? words(props, 'allProperties')}`}
                selectionMode="single"
                items={[
                  {
                    id: 'all',
                    label: words(props, 'allProperties'),
                    href: at({ propertyId: null }),
                    checked: !query.propertyId,
                  },
                  ...props.properties.map((item) => ({
                    id: item.id,
                    label: item.name,
                    href: at({ propertyId: item.id }),
                    checked: query.propertyId === item.id,
                  })),
                ]}
              />
            ) : undefined}
            {props.sorts ? (
              <Menu
                id={`${props.id}-sort`}
                label={`${props.sorts.label}: ${props.sorts.choices.find((choice) => choice.field === query.sort && choice.direction === query.direction)?.label ?? props.sorts.label}`}
                selectionMode="single"
                items={props.sorts.choices.map((choice) => ({
                  id: choice.id,
                  label: choice.label,
                  href: at({ sort: choice.field, direction: choice.direction }),
                  checked: choice.field === query.sort && choice.direction === query.direction,
                }))}
              />
            ) : null}
          </>
        }
        viewsLabel={words(props, 'state')}
        views={props.states.map((state) => ({
          id: state.id,
          label: state.label,
          href: at({ state: state.id }),
          active: state.id === query.state,
          ...(count ? { count: count[state.id] ?? 0 } : {}),
        }))}
        facets={
          query.q || query.state !== 'all' || query.propertyId
            ? [
                {
                  id: 'clear',
                  label: words(props, 'clear'),
                  href: at({
                    q: '',
                    state: 'all',
                    propertyId: null,
                    roomTypeId: null,
                    floorId: null,
                    from: null,
                    to: null,
                  }),
                },
              ]
            : undefined
        }
      />
    )
  }
  return {
    view,
    mount: (context: IslandMountContext) => {
      if (!(context.root instanceof HTMLElement)) return
      const root: HTMLElement = context.root
      const { lifetime } = context
      attach(props, lifetime)
      root.addEventListener('click', (event) => follow(event, props, store), { signal: lifetime })
      mountCollectionSearch(root, lifetime, store, `${props.id}-search`, (query) => {
        const create = root.ownerDocument.getElementById(`${props.id}-create`),
          href = collectionCreateHref(props, query)
        if (create instanceof HTMLAnchorElement && href) create.href = href
      })
    },
  }
}
/**
 * A list's search field: typing reads after a pause, Enter reads at once, and the field follows the query when
 * Back or a link changes it. `sync` runs with every query too, for links that carry it.
 */
export function mountCollectionSearch<Q extends PagedQuery, P extends PagedAnswer<Q>>(
  root: HTMLElement,
  lifetime: AbortSignal,
  store: PagedStore<Q, P>,
  searchId: string,
  sync?: (query: Q) => void,
) {
  root.addEventListener(
    'input',
    (event) => {
      const input = event.target
      if (
        input instanceof HTMLInputElement &&
        input.id === searchId &&
        !(event instanceof InputEvent && event.isComposing)
      )
        store.search(input.value)
    },
    { signal: lifetime },
  )
  root.addEventListener(
    'compositionend',
    (event) => {
      const input = event.target
      if (input instanceof HTMLInputElement && input.id === searchId) store.search(input.value)
    },
    { signal: lifetime },
  )
  root.addEventListener(
    'submit',
    (event) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement) || !form.querySelector(`#${searchId}`)) return
      event.preventDefault()
      const input = form.querySelector<HTMLInputElement>('input[name="q"]')!
      store.navigate({ ...store.query(), q: input.value.trim(), page: 1 })
    },
    { signal: lifetime },
  )
  const stop = effect(() => {
    const query = store.query(),
      input = root.querySelector<HTMLInputElement>(`#${searchId}`)
    if (input && !store.searching() && input.value !== query.q) input.value = query.q
    sync?.(query)
  })
  lifetime.addEventListener('abort', stop, { once: true })
}
const field = (row: Record<string, unknown>, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : null),
      row,
    )
export const collectionDecimal = (value: unknown, lang: string): string => {
  const text = String(value),
    match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return text
  const integer = BigInt(match[2]!).toLocaleString(lang === 'en' ? 'en' : 'vi')
  const fraction = match[3]?.replace(/0+$/, '')
  return `${match[1]}${integer}${fraction ? (lang === 'en' ? '.' : ',') + fraction : ''}`
}
export function collectionRecordHref(
  props: HospitalityCollectionProps,
  query: CollectionQuery,
  row: Record<string, unknown>,
): string {
  if (props.recordKind)
    return recordModalHref(collectionHref(props, query), {
      kind: props.recordKind,
      id: String(row[props.recordIdField ?? 'id']),
    })
  if (props.recordParam) {
    const url = new URL(collectionHref(props, query), 'http://collection.local')
    url.searchParams.set(props.recordParam, String(row[props.recordIdField ?? 'id']))
    url.searchParams.set('returnTo', rowAnchorHref(collectionHref(props, query), String(row.id)))
    for (const [key, value] of Object.entries(props.recordQuery ?? {})) url.searchParams.set(key, value)
    return url.pathname + url.search
  }
  const scope = new URLSearchParams(
    [...new URL(props.path, 'http://collection.local').searchParams].filter(([name]) =>
      ['company', 'companies', 'branch', 'branches'].includes(name),
    ),
  )
  scope.set('lang', props.lang)
  scope.set('returnTo', rowAnchorHref(collectionHref(props, query), String(row.id)))
  return `${props.recordPath}/${encodeURIComponent(String(row.id))}?${scope}`
}
export function collectionCellHref(
  props: HospitalityCollectionProps,
  query: CollectionQuery,
  row: Record<string, unknown>,
  hrefField: string,
): string | null {
  const raw = field(row, hrefField)
  if (typeof raw !== 'string' || !raw.startsWith('/admin/hospitality/') || /[\\\r\n]/.test(raw)) return null
  const target = new URL(raw, 'http://collection.local')
  if (!target.pathname.startsWith('/admin/hospitality/')) return null
  const owner = new URL(props.path, 'http://collection.local')
  if (target.pathname === owner.pathname) {
    const current = new URL(collectionHref(props, query), 'http://collection.local')
    for (const [key, value] of current.searchParams)
      if (!target.searchParams.has(key)) target.searchParams.append(key, value)
  }
  for (const key of ['company', 'companies', 'branch', 'branches']) {
    target.searchParams.delete(key)
    for (const value of owner.searchParams.getAll(key)) target.searchParams.append(key, value)
  }
  target.searchParams.set('lang', props.lang)
  target.searchParams.set('returnTo', rowAnchorHref(collectionHref(props, query), String(row.id)))
  return target.pathname + target.search + target.hash
}

export const hospitalityCollectionResults = (props: HospitalityCollectionProps) => {
  const store = storeFor(props)
  const maxBlockSize = signal<string | null>(null)
  const recordHref = (row: Record<string, unknown>) => collectionRecordHref(props, store.query(), row)
  const view = (): TemplateResult => {
    const value = store.value(),
      phase = props.allowed ? store.phase() : 'denied',
      failed = ['failed', 'offline', 'denied'].includes(phase)
    const table = (
      <KetTable
        maxBlockSize={maxBlockSize()}
        columns={props.columns.map((column) => ({
          key: column.key,
          label: column.label,
          align: column.kind === 'money' || column.kind === 'number' ? 'end' : 'start',
          sortable: column.sortable,
          ...(column.sortable
            ? {
                sortHref: collectionHref(props, {
                  ...store.query(),
                  page: 1,
                  sort: column.field,
                  direction:
                    store.query().sort === column.field && store.query().direction === 'asc' ? 'desc' : 'asc',
                }),
                sortLabel: `${column.label}: ${words(props, store.query().sort === column.field && store.query().direction === 'asc' ? 'descending' : 'ascending')}`,
              }
            : {}),
          cell: (row: Record<string, unknown>) => collectionCell(props, store.query(), column, row),
        }))}
        rows={value?.rows ?? []}
        id={(row) => String(row.id)}
        rowHref={recordHref}
        currentRow={store.currentRow()}
        responsive="stack"
        busy={store.dimmed()}
        loading={!value && !failed ? { rows: store.query().pageSize } : undefined}
        labels={{
          region: words(props, 'results'),
          loading: words(props, 'loading'),
          retry: words(props, 'retry'),
          loadError: words(props, 'error'),
          empty: words(props, 'noResults'),
          emptyHint: words(props, 'filteredHint'),
          selectAll: words(props, 'selectAll'),
          selectRow: words(props, 'selectRow'),
          sortedAscending: words(props, 'ascending'),
          sortedDescending: words(props, 'descending'),
          previousPage: words(props, 'previous'),
          nextPage: words(props, 'next'),
        }}
      />
    )
    const retry = <Button id={`${props.id}-retry`} label={words(props, 'retry')} variant="secondary" />
    const failure =
      phase === 'denied' ? (
        <Notice tone="warning" title={words(props, 'denied')} message={words(props, 'deniedHint')} />
      ) : phase === 'offline' ? (
        <Notice
          tone="warning"
          title={words(props, 'offline')}
          message={words(props, 'offlineHint')}
          actions={retry}
        />
      ) : (
        <Notice
          tone="danger"
          title={words(props, 'error')}
          message={words(props, 'errorHint')}
          actions={retry}
        />
      )
    const empty =
      value && !value.total ? (
        <EmptyState
          title={words(props, value.isEmpty ? 'empty' : 'noResults')}
          message={words(props, value.isEmpty ? 'emptyHint' : 'filteredHint')}
          actions={
            value.isEmpty ? (
              props.createHref ? (
                <LinkButton
                  href={collectionCreateHref(props, store.query()) ?? props.createHref}
                  label={words(props, 'create')}
                  variant="primary"
                />
              ) : undefined
            ) : (
              <LinkButton
                href={collectionHref(props, {
                  ...props.query,
                  page: 1,
                  q: '',
                  state: 'all',
                  propertyId: null,
                })}
                label={words(props, 'clear')}
                variant="secondary"
              />
            )
          }
        />
      ) : (
        table
      )
    return html`<div aria-busy=${phase === 'loading' || store.dimmed() ? 'true' : 'false'}><div role="status" aria-live="polite">${Text({ visuallyHidden: true, children: store.announcement() || (phase === 'loading' && !value ? words(props, 'loading') : '') })}</div>${Stack({ items: [failed ? failure : null, phase === 'denied' || (failed && !value) ? null : empty].filter((item) => item !== null) })}</div>`
  }
  return {
    view,
    mount: (context: IslandMountContext) => {
      if (!(context.root instanceof HTMLElement)) return
      const root: HTMLElement = context.root
      const { lifetime } = context
      attach(props, lifetime)
      mountCollectionResults(root, lifetime, {
        store,
        maxBlockSize,
        retryId: `${props.id}-retry`,
        lost: words(props, 'lost'),
        allowed: props.allowed,
        rememberRows: !props.recordKind,
        fromUrl: (url) => collectionQueryFromUrl(url, props),
        follow: (event) => follow(event, props, store),
      })
    },
  }
}
/**
 * The results island's browser half: it sizes the table to the viewport, returns to the row a record was opened
 * from, reads in place on Back, retry and reconnect, and reads again when a record changes.
 */
export function mountCollectionResults<Q extends PagedQuery, P extends PagedAnswer<Q>>(
  root: HTMLElement,
  lifetime: AbortSignal,
  options: {
    store: PagedStore<Q, P>
    maxBlockSize: { set: (value: string | null) => void }
    retryId: string
    lost: string
    allowed: boolean
    /** Whether a row link leaves the page (a record page), so Back should find the row again. */
    rememberRows: boolean
    fromUrl: (url: URL) => Q
    follow: (event: MouseEvent) => boolean
  },
) {
  const { store, maxBlockSize } = options
  // The collection owns its viewport budget; the table owns its scroll region.
  const page = root.closest<HTMLElement>('[data-ui="list-page"]')
  const footer = page?.querySelector<HTMLElement>('[data-ui="list-page-footer"]')
  const measure = () => {
    if (lifetime.aborted || !page) return
    const style = getComputedStyle(page)
    const footerStyle = footer ? getComputedStyle(footer) : null
    const reserved =
      (footer?.offsetHeight ?? 0) +
      (parseFloat(style.paddingBottom) || 0) +
      (parseFloat(style.rowGap) || 0) +
      (parseFloat(footerStyle?.marginTop ?? '') || 0)
    const viewport = window.visualViewport?.height ?? window.innerHeight
    // On reflow with a tall toolbar, allow page scrolling rather than hiding controls.
    maxBlockSize.set(`${Math.max(160, Math.floor(viewport - root.getBoundingClientRect().top - reserved))}px`)
  }
  const observer = new ResizeObserver(measure)
  if (page) observer.observe(page)
  if (footer) observer.observe(footer)
  window.addEventListener('resize', measure, { signal: lifetime })
  window.visualViewport?.addEventListener('resize', measure, { signal: lifetime })
  lifetime.addEventListener('abort', () => observer.disconnect(), { once: true })
  measure()
  let pending = takeRowAnchor()
  if (pending) store.currentRow.set(pending.id)
  const restorePending = () => {
    const value = store.value()
    if (
      !value ||
      !pending ||
      store.phase() !== 'ready' ||
      Object.keys(value.query).some(
        (key) =>
          (value.query as Record<string, unknown>)[key] !== (store.query() as Record<string, unknown>)[key],
      )
    )
      return
    const anchor = pending
    pending = null
    requestAnimationFrame(() => {
      if (!lifetime.aborted && !restoreRowAnchor(root, anchor)) store.announcement.set(options.lost)
    })
  }
  const stop = effect(restorePending)
  // Fragment islands mount before the shell commits the destination URL.
  // Read the return anchor again after that commit, then wait for its page.
  document.addEventListener(
    'ket:navigation-complete',
    () => {
      pending = takeRowAnchor()
      if (pending) store.currentRow.set(pending.id)
      restorePending()
    },
    { signal: lifetime },
  )
  root.addEventListener(
    'click',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(`#${options.retryId}`)) {
        store.retry()
        return
      }
      if (options.follow(event)) return
      const link = target.closest<HTMLAnchorElement>('[data-ui="kt-row-link"]')
      if (
        link &&
        options.rememberRows &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.altKey
      )
        rememberRowAnchor(link)
    },
    { signal: lifetime },
  )
  window.addEventListener(
    'popstate',
    () => {
      const next = options.fromUrl(new URL(location.href))
      pending = readRowAnchor(new URL(location.href), history.state)
      store.navigate(next, 'none')
      store.currentRow.set(pending?.id ?? null)
    },
    { signal: lifetime },
  )
  window.addEventListener(
    'online',
    () => {
      if (store.phase() === 'offline') store.retry()
    },
    { signal: lifetime },
  )
  document.addEventListener(
    'ket:records-changed',
    (event) => {
      event.preventDefault()
      store.invalidate()
    },
    { capture: true, signal: lifetime },
  )
  lifetime.addEventListener('abort', stop, { once: true })
  if (options.allowed) void store.load()
}
/** One cell of a collection row: its value as the column reads it, a link, or a state badge. */
export const collectionCell = (
  props: HospitalityCollectionProps,
  query: CollectionQuery,
  column: Column,
  row: Record<string, unknown>,
) => {
  const raw = field(row, column.field)
  const empty =
    (column.emptyField
      ? props.words[`empty.${column.key}.${String(field(row, column.emptyField))}`]
      : props.words[`empty.${column.key}`]) ?? '—'
  const text =
    raw == null
      ? empty
      : column.kind === 'date' && Number.isFinite(Date.parse(String(raw)))
        ? new Intl.DateTimeFormat(props.lang === 'en' ? 'en-GB' : 'vi-VN', {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: String(field(row, 'property.timezone') ?? props.words.timezone ?? 'Asia/Ho_Chi_Minh'),
          }).format(new Date(String(raw)))
        : column.kind === 'money' || column.kind === 'number'
          ? collectionDecimal(raw, props.lang)
          : (props.words[`value.${column.field}.${String(raw)}`] ?? String(raw))
  const href =
    column.hrefField && (!column.linkValues || column.linkValues.includes(String(raw)))
      ? collectionCellHref(props, query, row, column.hrefField)
      : null
  return href ? (
    <Link href={href} label={text} />
  ) : column.kind === 'state' ? (
    <Badge label={props.words[`state.${text}`] ?? text} tone={column.tones?.[String(raw)]} />
  ) : (
    <Text variant="bodySm">{text}</Text>
  )
}
// One page has nowhere to go: no pager, as on the island books (the results still announce their range).
export const collectionPager = (
  props: HospitalityCollectionProps,
  store: Pick<PagedCollectionStore, 'value' | 'phase' | 'query'>,
) => {
  const value = store.value()
  if (!value || value.pages <= 1 || ['failed', 'offline', 'denied'].includes(store.phase())) return undefined
  const link = (page: number) => collectionHref(props, { ...store.query(), page })
  return {
    label: words(props, 'pager'),
    summary: range(value, props),
    previousHref: value.page > 1 ? link(value.page - 1) : null,
    nextHref: value.page < value.pages ? link(value.page + 1) : null,
    previousLabel: words(props, 'previous'),
    nextLabel: words(props, 'next'),
    pages: [
      { id: 'first', label: words(props, 'first'), href: value.page > 1 ? link(1) : null },
      {
        id: 'last',
        label: words(props, 'last'),
        href: value.page < value.pages ? link(value.pages) : null,
      },
    ],
  }
}
// Compatibility export for callers outside the canonical Hospitality page.
export const hospitalityCollectionFooter = (props: HospitalityCollectionProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const pager = collectionPager(props, store)
    return pager ? <ListChrome pager={pager} /> : <span hidden />
  }
  return {
    view,
    mount: (context: IslandMountContext) => {
      if (!(context.root instanceof HTMLElement)) return
      const root: HTMLElement = context.root
      const { lifetime } = context
      attach(props, lifetime)
      root.addEventListener('click', (event) => follow(event, props, store), { signal: lifetime })
    },
  }
}
