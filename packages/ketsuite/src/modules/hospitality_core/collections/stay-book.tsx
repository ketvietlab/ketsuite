import { effect, html, signal } from '@ketvietlab/ketjs-view'
import type { IslandMountContext, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Badge,
  Button,
  EmptyState,
  FormattedMoney,
  Inline,
  KetTable,
  LinkButton,
  ListChrome,
  Menu,
  Notice,
  Skeleton,
  Stack,
  Text,
  rowAnchorHref,
} from '@ketvietlab/design-system'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import type { PagedStore } from '../../../ui/client/paged-collection-store.ts'
import { STAY_BOOK_VIEWS, stayBookHref, stayBookQueryFromUrl } from '../stay-book-query.ts'
import type { StayBookQuery, StayBookSort } from '../stay-book-query.ts'
import {
  attachCollectionStore,
  collectionBrowser,
  followCollectionLink,
  mountCollectionResults,
  mountCollectionSearch,
  sharedCollectionStore,
} from './view.tsx'
import { createPageEvidenceReader } from './page-evidence.ts'

/**
 * The guests in house (`/admin/hospitality/stays`, HOS-UI-010): three islands on one paged store reading one page
 * of one query at a time from `hospitality_core.searchStays`, as the accepted mock
 * (design/shared/hospitality-stay-book.mjs, HOS-DEC-031). What each stay still owes is billing's answer for the
 * rows shown, `hospitality_billing.getStayDues`, asked after them when the reader may read it.
 */
export type StayBookProps = {
  key: string
  id: string
  source: string
  /** `hospitality_billing.getStayDues` for a reader of billing; without it the list has no balance column. */
  dueSource: string | null
  /** The list's own URL with the reader's company, branch and language. */
  path: string
  recordPath: string
  stayPath: string
  arrivalsHref: string | null
  lang: string
  allowed: boolean
  properties: Array<{ id: string; name: string; businessDate: string }>
  query: StayBookQuery
  words: Record<string, string>
}
type StayRow = {
  id: string
  code: string
  reservation: { id: string } | null
  guest: string
  vip: boolean
  loyalty: string | null
  property: { id: string }
  roomType: { id: string; name: string }
  room: string | null
  arrival: string
  departure: string
  nights: number
  nightsStayed: number
  departsIn: number
  checkOut: string
  lateCheckout: string | null
  adults: number
  children: number
  request: string | null
}
type StayAnswer = {
  query: StayBookQuery
  rows: Array<Record<string, unknown>>
  total: number
  page: number
  pages: number
  counts: { view: Record<string, number> }
  houseIsEmpty: boolean
  partial: boolean
}
type StayStore = PagedStore<StayBookQuery, StayAnswer>
export type StayDue = {
  id: string
  due: string | null
  currency: string | null
  known: boolean
  shared: number
}

const FAILED = ['failed', 'offline', 'denied']

/** A message with `{name}` values; a count of one takes the `.one` wording where the language has one. */
const say = (props: StayBookProps, key: string, values: Record<string, string | number> = {}) =>
  ((String(values.count) === '1' ? props.words[`${key}.one`] : undefined) ?? props.words[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_, name: string) => String(values[name] ?? ''),
  )
const number = (props: StayBookProps, value: number) =>
  value.toLocaleString(props.lang === 'en' ? 'en' : 'vi')
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

export const stayBookLink = (props: StayBookProps, query: StayBookQuery) => stayBookHref(props.path, query)
const at = (props: StayBookProps, store: StayStore, change: Partial<StayBookQuery>) =>
  stayBookLink(props, { ...store.query(), page: 1, ...change })
const describe = (props: StayBookProps, value: StayAnswer) => {
  if (!value.total) return say(props, 'noResults')
  const first = (value.page - 1) * value.query.pageSize + 1
  return say(props, 'describe', {
    first: number(props, first),
    last: number(props, first + value.rows.length - 1),
    total: number(props, value.total),
  })
}

const storeFor = (props: StayBookProps) =>
  sharedCollectionStore(props.key, () =>
    createPagedCollectionStore<StayBookQuery, StayAnswer>({
      source: props.source,
      query: props.query,
      href: (query) => stayBookLink(props, query),
      announce: (value) => describe(props, value),
      browser: collectionBrowser(),
    }),
  )
const isListNavigation = (next: URL, current: URL) =>
  next.origin === current.origin &&
  next.pathname === current.pathname &&
  !['record', 'create', 'dialog', 'edit', 'filter', 'group', 'groups', 'favorite', 'preview'].some((name) =>
    next.searchParams.has(name),
  ) &&
  ['company', 'companies', 'branch', 'branches', 'lang'].every(
    (name) =>
      JSON.stringify(next.searchParams.getAll(name)) === JSON.stringify(current.searchParams.getAll(name)),
  )
const follow = (props: StayBookProps, store: StayStore) => (event: MouseEvent) =>
  followCollectionLink(event, isListNavigation, (next) =>
    store.navigate(stayBookQueryFromUrl(next, props.properties)),
  )

/** Billing's answer for the stays on screen (`collections/page-evidence.ts`). */
export const createStayDueReader = (options: { source: string; fetch: typeof fetch }) =>
  createPageEvidenceReader<StayDue>({
    ...options,
    missing: (id) => ({ id, due: null, currency: null, known: false, shared: 1 }),
  })

export const stayBookControls = (props: StayBookProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const query = store.query()
    const value = FAILED.includes(store.phase()) ? null : store.value()
    // Before the first answer a count holds its place; after a failed one it is left out rather than guessed.
    const counted = (id: string) =>
      value ? number(props, value.counts.view[id] ?? 0) : store.phase() === 'loading' ? '…' : undefined
    const property = props.properties.find((item) => item.id === query.propertyId)
    const shown = property?.name ?? say(props, 'allProperties')
    const go = (change: Partial<StayBookQuery>) => at(props, store, change)
    return (
      <ListChrome
        filtersLabel={say(props, 'filters')}
        filtersToggle={{
          label: say(props, 'filtersToggle'),
          count: [query.propertyId, query.view !== 'all'].filter(Boolean).length,
        }}
        search={{
          id: `${props.id}-search`,
          action: props.path.split('?')[0]!,
          name: 'q',
          value: query.q,
          label: say(props, 'search'),
          placeholder: say(props, 'searchPlaceholder'),
          submitLabel: say(props, 'searchSubmit'),
          hidden: Object.fromEntries(new URL(go({ q: '' }), 'http://stays.local').searchParams),
        }}
        filterMenus={[
          // A menu that shows its choice is named for both, so the name a reader says is the one they see.
          <Menu
            id={`${props.id}-property`}
            label={`${say(props, 'property')}: ${shown}`}
            selectionMode="single"
            trigger={html`<span>${shown}</span>`}
            items={[
              {
                id: 'property-all',
                label: say(props, 'allProperties'),
                href: go({ propertyId: null }),
                checked: !property,
              },
              ...props.properties.map((item) => ({
                id: `property-${item.id}`,
                label: item.name,
                href: go({ propertyId: item.id }),
                checked: item.id === query.propertyId,
              })),
            ]}
          />,
        ]}
        // View counts ignore the view, so each facet says what it would show. Column headers own sorting.
        facets={STAY_BOOK_VIEWS.map((id) => ({
          id,
          label: say(props, `view.${id}`),
          href: go({ view: id }),
          active: id === query.view,
          count: counted(id),
        }))}
      />
    )
  }
  return {
    view,
    mount: (context: IslandMountContext) => {
      if (!(context.root instanceof HTMLElement)) return
      const root: HTMLElement = context.root
      const { lifetime } = context
      attachCollectionStore(props.key, lifetime)
      root.addEventListener('click', follow(props, store), { signal: lifetime })
      // The header's walk-in starts at the property the list shows.
      mountCollectionSearch(root, lifetime, store, `${props.id}-search`, (query) => {
        const link = root.ownerDocument.getElementById(`${props.id}-walk-in`)
        if (!(link instanceof HTMLAnchorElement)) return
        const target = new URL(link.getAttribute('href') ?? link.href, 'http://stays.local')
        if (query.propertyId) target.searchParams.set('propertyId', query.propertyId)
        else target.searchParams.delete('propertyId')
        link.href = target.pathname + target.search
      })
    },
  }
}

/** A row opens the reservation the guest checked in from, with the way back to the same query and row. */
export const stayBookRecordHref = (props: StayBookProps, query: StayBookQuery, row: StayRow) => {
  const scope = new URLSearchParams(
    [...new URL(props.path, 'http://stays.local').searchParams].filter(([name]) =>
      ['company', 'companies', 'branch', 'branches'].includes(name),
    ),
  )
  scope.set('lang', props.lang)
  scope.set('returnTo', rowAnchorHref(stayBookLink(props, query), row.id))
  return row.reservation
    ? `${props.recordPath}/${encodeURIComponent(row.reservation.id)}?${scope}`
    : `${props.stayPath}/${encodeURIComponent(row.id)}?${scope}`
}

export const stayBookResults = (props: StayBookProps) => {
  const store = storeFor(props)
  const maxBlockSize = signal<string | null>(null)
  const reader = props.dueSource
    ? createStayDueReader({ source: props.dueSource, fetch: (...args) => globalThis.fetch(...args) })
    : null
  const muted = (children: string) => (
    <Text variant="bodySm" tone="muted">
      {children}
    </Text>
  )
  const lines = (title: string | TemplateResult, detail: string) => (
    <Stack
      gap="none"
      items={[typeof title === 'string' ? <Text variant="bodyMd">{title}</Text> : title, muted(detail)]}
    />
  )
  // A sortable header cycles: its first order, the other, then back to the order by room. The room header only
  // turns the order around.
  const sortable = (field: 'room' | 'departure', label: string) => {
    const query = store.query()
    const direction = query.sort === field ? 'asc' : query.sort === `-${field}` ? 'desc' : null
    const opposite = `-${field}` as StayBookSort
    const next: StayBookSort = query.sort === field ? opposite : query.sort === opposite ? 'room' : field
    return {
      sortHref: at(props, store, { sort: next }),
      sortLabel: say(props, 'sortedBy', {
        label,
        order: say(props, `sort.${next}`).toLocaleLowerCase(props.lang),
      }),
      sortDirection: direction,
    } as const
  }
  const people = (row: StayRow) =>
    [
      say(props, 'adults', { count: row.adults }),
      row.children ? say(props, 'children', { count: row.children }) : null,
      row.loyalty ? say(props, `tier.${row.loyalty}`) : null,
    ]
      .filter(Boolean)
      .join(' · ')
  const propertyName = (row: StayRow) =>
    props.properties.find((item) => item.id === row.property.id)?.name ?? ''
  // The day the guest leaves, in the desk's words; today is what the morning shift works through. A late checkout
  // rides in the badge, so the cell stays one line tall like its neighbours.
  const leaving = (row: StayRow) => {
    const time = row.lateCheckout ?? row.checkOut
    if (row.departsIn <= 0)
      return (
        <Badge
          label={say(props, row.lateCheckout ? 'leavesTodayLate' : 'leavesToday', { time })}
          tone="warning"
        />
      )
    return row.departsIn === 1
      ? say(props, 'leavesTomorrow', { time })
      : say(props, 'leavesOn', { date: dayMonth(row.departure), time })
  }
  // The folio's due once billing answers for the row, with the rooms sharing it when one purchase took several, so
  // a group's due is not read as each room's. Evidence the folio lacks is not zero.
  const owed = (row: StayRow) => {
    const due = reader!.dues().get(row.id)
    if (!due) return <Skeleton label={say(props, 'dueLoading')} lines={1} decorative />
    if (due === 'failed') return muted(say(props, 'dueFailed'))
    if (!due.known || due.due === null) return muted(say(props, 'dueUnknown'))
    const amount =
      Number(due.due) > 0 ? (
        <FormattedMoney value={due.due} currency={due.currency ?? 'VND'} locale={props.lang} />
      ) : (
        muted(say(props, 'paid'))
      )
    return due.shared > 1 ? lines(amount, say(props, 'sharedFolio', { count: due.shared })) : amount
  }
  const view = (): TemplateResult => {
    const value = store.value(),
      query = store.query(),
      phase = props.allowed ? store.phase() : 'denied',
      failed = FAILED.includes(phase)
    // A phone stacks each row into room, guest, departure and what is owed; the stay and the request stay on the
    // reservation's page (`tertiary`, KetTable stack contract).
    const table = (
      <KetTable
        maxBlockSize={maxBlockSize()}
        columns={[
          {
            key: 'room',
            label: say(props, 'column.room'),
            priority: 'primary',
            ...sortable('room', say(props, 'column.room')),
            cell: (row: StayRow) =>
              lines(row.room ?? muted(say(props, 'unroomed')), `${propertyName(row)} · ${row.roomType.name}`),
          },
          {
            key: 'guest',
            label: say(props, 'column.guest'),
            priority: 'primary',
            wrap: true,
            cell: (row: StayRow) =>
              lines(
                // The small badge sits inside the name's line, so a VIP row is as tall as any other.
                row.vip ? (
                  <Inline
                    gap="compact"
                    blockAlign="center"
                    items={[
                      <Text variant="bodyMd">{row.guest}</Text>,
                      <Badge label={say(props, 'vip')} tone="info" size="small" />,
                    ]}
                  />
                ) : (
                  row.guest
                ),
                people(row),
              ),
          },
          {
            key: 'stay',
            label: say(props, 'column.stay'),
            priority: 'tertiary',
            cell: (row: StayRow) =>
              lines(
                `${dayMonth(row.arrival)}–${dayMonth(row.departure)}`,
                say(props, 'nightsStayed', { count: row.nightsStayed, nights: row.nights }),
              ),
          },
          {
            key: 'departure',
            label: say(props, 'column.departure'),
            kind: 'date',
            priority: 'primary',
            ...sortable('departure', say(props, 'column.departure')),
            cell: leaving,
          },
          ...(reader
            ? [
                {
                  key: 'balance',
                  label: say(props, 'column.balance'),
                  kind: 'currency' as const,
                  align: 'end' as const,
                  cell: owed,
                },
              ]
            : []),
          {
            key: 'request',
            label: say(props, 'column.request'),
            priority: 'tertiary',
            wrap: true,
            cell: (row: StayRow) => row.request ?? muted(say(props, 'noRequest')),
          },
        ]}
        rows={(value?.rows ?? []) as StayRow[]}
        id={(row: StayRow) => row.id}
        rowHref={(row: StayRow) => stayBookRecordHref(props, query, row)}
        currentRow={store.currentRow()}
        responsive="stack"
        busy={store.dimmed()}
        // Two-line cells keep their height in the skeleton, so the first answer does not shift the page.
        loading={
          !value && !failed
            ? {
                rows: query.pageSize,
                lines: { room: 2, guest: 2, stay: 2, ...(reader ? { balance: 2 } : {}) },
              }
            : undefined
        }
        labels={{
          region: say(props, 'region'),
          loading: say(props, 'loading'),
          retry: say(props, 'retry'),
          loadError: say(props, 'error'),
          empty: say(props, 'noResults'),
          emptyHint: say(props, 'filteredMessage'),
          selectAll: say(props, 'selectAll'),
          selectRow: say(props, 'selectRow'),
          sortedAscending: say(props, 'ascending'),
          sortedDescending: say(props, 'descending'),
          previousPage: say(props, 'previousPage'),
          nextPage: say(props, 'nextPage'),
        }}
      />
    )
    const retry = <Button id={`${props.id}-retry`} label={say(props, 'retry')} variant="secondary" />
    const failure =
      phase === 'denied' ? (
        <Notice tone="warning" title={say(props, 'denied')} message={say(props, 'deniedHint')} />
      ) : phase === 'offline' ? (
        <Notice
          tone="warning"
          title={say(props, 'offline')}
          message={say(props, value ? 'offlineHintStale' : 'offlineHint')}
          actions={retry}
        />
      ) : (
        <Notice
          tone="danger"
          title={say(props, 'error')}
          message={say(props, value ? 'errorHintStale' : 'errorHint')}
          actions={retry}
        />
      )
    const empty = (answer: StayAnswer) => {
      if (answer.houseIsEmpty)
        return (
          <EmptyState
            title={say(props, 'emptyHouse')}
            message={say(props, 'emptyHouseHint')}
            actions={
              props.arrivalsHref ? (
                <LinkButton label={say(props, 'arrivals')} href={props.arrivalsHref} variant="secondary" />
              ) : undefined
            }
          />
        )
      // A search may match guests that a property or a view leaves out; then the filters, not the words, empty it.
      const narrowed = Boolean(query.propertyId) || query.view !== 'all'
      return (
        <EmptyState
          title={say(props, 'noResults')}
          message={
            query.q.trim()
              ? say(props, narrowed ? 'emptySearchFiltered' : 'emptySearch', { q: query.q.trim() })
              : say(props, 'filteredMessage')
          }
          actions={
            <LinkButton
              label={say(props, 'clear')}
              href={at(props, store, { propertyId: null, view: 'all', q: '' })}
              variant="secondary"
            />
          }
        />
      )
    }
    // A house past the read's bound says so above the rows rather than passing a cut list off as whole.
    const content =
      value && !value.total ? (
        empty(value)
      ) : value?.partial ? (
        <Stack
          items={[
            <Notice tone="warning" title={say(props, 'partial')} message={say(props, 'partialHint')} />,
            table,
          ]}
        />
      ) : (
        table
      )
    return html`<div id=${`${props.id}-results`} aria-busy=${phase === 'loading' || store.dimmed() ? 'true' : 'false'}><div role="status" aria-live="polite">${Text({ visuallyHidden: true, children: store.announcement() || (phase === 'loading' && !value ? say(props, 'loading') : '') })}</div>${Stack({ items: [failed ? failure : null, phase === 'denied' || (failed && !value) ? null : content].filter((item) => item !== null) })}</div>`
  }
  return {
    view,
    mount: (context: IslandMountContext) => {
      if (!(context.root instanceof HTMLElement)) return
      const root: HTMLElement = context.root
      const { lifetime } = context
      attachCollectionStore(props.key, lifetime)
      mountCollectionResults(root, lifetime, {
        store,
        maxBlockSize,
        retryId: `${props.id}-retry`,
        lost: say(props, 'lost'),
        allowed: props.allowed,
        rememberRows: true,
        fromUrl: (url) => stayBookQueryFromUrl(url, props.properties),
        follow: follow(props, store),
      })
      if (!reader) return
      // Each page asks billing for its rows again.
      const stop = effect(() => {
        const value = store.value()
        if (value) void reader.read(value.rows.map((row) => String(row.id)))
      })
      lifetime.addEventListener(
        'abort',
        () => {
          stop()
          reader.dispose()
        },
        { once: true },
      )
    },
  }
}

export const stayBookFooter = (props: StayBookProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const value = store.value()
    if (!value || value.pages <= 1 || FAILED.includes(store.phase())) return html`<div hidden></div>`
    const first = (value.page - 1) * value.query.pageSize + 1
    const page = (to: number) => stayBookLink(props, { ...store.query(), page: to })
    // The design system styles a pager inside ListChrome, so the row pager rides in one too.
    return (
      <ListChrome
        pager={{
          label: say(props, 'pager'),
          summary: `${number(props, first)}–${number(props, first + value.rows.length - 1)} / ${number(props, value.total)}`,
          previousHref: value.page > 1 ? page(value.page - 1) : null,
          nextHref: value.page < value.pages ? page(value.page + 1) : null,
          previousLabel: say(props, 'previousPage'),
          nextLabel: say(props, 'nextPage'),
        }}
      />
    )
  }
  return {
    view,
    mount: (context: IslandMountContext) => {
      if (!(context.root instanceof HTMLElement)) return
      const root: HTMLElement = context.root
      const { lifetime } = context
      attachCollectionStore(props.key, lifetime)
      root.addEventListener(
        'click',
        (event) => {
          if (!follow(props, store)(event)) return
          // A new page starts at its first row, as a page load would.
          const results = root.ownerDocument.getElementById(`${props.id}-results`)
          if (results && results.getBoundingClientRect().top < 0) results.scrollIntoView({ block: 'start' })
        },
        { signal: lifetime },
      )
    },
  }
}
