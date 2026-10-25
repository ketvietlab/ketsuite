import { html, signal } from '@ketvietlab/ketjs-view'
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
  Stack,
  Text,
  rowAnchorHref,
} from '@ketvietlab/design-system'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import type { PagedStore } from '../../../ui/client/paged-collection-store.ts'
import {
  RESERVATION_BOOK_STATUSES,
  RESERVATION_BOOK_VIEWS,
  RESERVATION_BOOK_WINDOWS,
  reservationBookHref,
  reservationBookQueryFromUrl,
  reservationBookToday,
} from '../reservation-book-query.ts'
import type { ReservationBookQuery } from '../reservation-book-query.ts'
import {
  attachCollectionStore,
  collectionBrowser,
  followCollectionLink,
  mountCollectionResults,
  mountCollectionSearch,
  sharedCollectionStore,
} from './view.tsx'

/**
 * The reservation book (`/admin/hospitality/reservations`, HOS-UI-003): three islands on one paged store reading
 * one page of one query at a time from `hospitality_core.searchReservations`, as the accepted mock
 * (design/shared/hospitality-reservation-book.mjs, HOS-DEC-030). The server renders only their frame from the
 * URL; rows, counts and pages come from the read.
 */
export type ReservationBookProps = {
  key: string
  id: string
  source: string
  /** The book's own URL with the reader's company, branch and language. */
  path: string
  recordPath: string
  createHref: string | null
  lang: string
  allowed: boolean
  properties: Array<{ id: string; name: string; businessDate: string }>
  sources: string[]
  query: ReservationBookQuery
  words: Record<string, string>
}
type BookRow = {
  id: string
  code: string
  guest: string
  property: { id: string }
  roomType: { id: string; name: string }
  room: string | null
  arrival: string
  departure: string
  nights: number
  adults: number
  children: number
  source: { id: string }
  status: { id: string }
  guarantee: { kind: string }
  total: { amount: string; currency: string }
}
type BookAnswer = {
  query: ReservationBookQuery
  rows: Array<Record<string, unknown>>
  total: number
  page: number
  pages: number
  counts: { status: Record<string, number>; view: Record<string, number> }
  bookIsEmpty: boolean
  partial: boolean
}
type BookStore = PagedStore<ReservationBookQuery, BookAnswer>

// The badge a booking wears in its row, by its desk status.
const TONES: Record<string, 'info' | 'positive' | 'warning' | 'danger' | 'neutral'> = {
  arriving: 'warning',
  in_house: 'positive',
  departing: 'warning',
  confirmed: 'info',
  checked_out: 'neutral',
  cancelled: 'neutral',
  no_show: 'danger',
}
const FAILED = ['failed', 'offline', 'denied']

/** A message with `{name}` values; a count of one takes the `.one` wording where the language has one. */
const say = (props: ReservationBookProps, key: string, values: Record<string, string | number> = {}) =>
  ((String(values.count) === '1' ? props.words[`${key}.one`] : undefined) ?? props.words[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_, name: string) => String(values[name] ?? ''),
  )
const number = (props: ReservationBookProps, value: number) =>
  value.toLocaleString(props.lang === 'en' ? 'en' : 'vi')
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export const reservationBookLink = (props: ReservationBookProps, query: ReservationBookQuery) =>
  reservationBookHref(props.path, query, props.properties)
const at = (props: ReservationBookProps, store: BookStore, change: Partial<ReservationBookQuery>) =>
  reservationBookLink(props, { ...store.query(), page: 1, ...change })
const period = (props: ReservationBookProps, query: ReservationBookQuery) => {
  if (query.from === null || query.days === null) return say(props, 'allDays')
  const last = shift(query.from, query.days - 1)
  return `${dayMonth(query.from)}–${dayMonth(last)}/${last.slice(0, 4)}`
}
// A booking link from the book starts at the property it shows.
const withProperty = (href: string, query: ReservationBookQuery) => {
  const target = new URL(href, 'http://book.local')
  if (query.propertyId) target.searchParams.set('propertyId', query.propertyId)
  else target.searchParams.delete('propertyId')
  return target.pathname + target.search
}
const filtered = (query: ReservationBookQuery) =>
  Boolean(
    query.propertyId || query.source || query.q.trim() || query.status !== 'all' || query.view !== 'all',
  )
const describe = (props: ReservationBookProps, value: BookAnswer) => {
  if (!value.total) return say(props, 'noResults')
  const first = (value.page - 1) * value.query.pageSize + 1
  return say(props, 'describe', {
    first: number(props, first),
    last: number(props, first + value.rows.length - 1),
    total: number(props, value.total),
  })
}

const storeFor = (props: ReservationBookProps) =>
  sharedCollectionStore(props.key, () =>
    createPagedCollectionStore<ReservationBookQuery, BookAnswer>({
      source: props.source,
      query: props.query,
      href: (query) => reservationBookLink(props, query),
      announce: (value) => describe(props, value),
      browser: collectionBrowser(),
    }),
  )
const isBookNavigation = (next: URL, current: URL) =>
  next.origin === current.origin &&
  next.pathname === current.pathname &&
  !['record', 'create', 'dialog'].some((name) => next.searchParams.has(name)) &&
  ['company', 'companies', 'branch', 'branches', 'lang'].every(
    (name) =>
      JSON.stringify(next.searchParams.getAll(name)) === JSON.stringify(current.searchParams.getAll(name)),
  )
const follow = (props: ReservationBookProps, store: BookStore) => (event: MouseEvent) =>
  followCollectionLink(event, isBookNavigation, (next) =>
    store.navigate(reservationBookQueryFromUrl(next, props.properties)),
  )

export const reservationBookControls = (props: ReservationBookProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const query = store.query()
    const value = FAILED.includes(store.phase()) ? null : store.value()
    // Before the first answer a count holds its place; after a failed one it is left out rather than guessed.
    const counted = (group: 'status' | 'view', id: string) =>
      value ? number(props, value.counts[group][id] ?? 0) : store.phase() === 'loading' ? '…' : undefined
    const property = props.properties.find((item) => item.id === query.propertyId)
    const all = query.days === null
    // A menu that shows its choice is named for both, so the name a reader says is the one they see.
    const shown = {
      property: property?.name ?? say(props, 'allProperties'),
      status: say(props, `status.${query.status}`),
      source: query.source ? say(props, `provider.${query.source}`) : say(props, 'allSources'),
      days: all ? say(props, 'allDays') : say(props, 'daysOption', { count: query.days! }),
    }
    const today = reservationBookToday(query, props.properties)
    const go = (change: Partial<ReservationBookQuery>) => at(props, store, change)
    const counts = counted('status', 'all')
    return (
      <ListChrome
        filtersLabel={say(props, 'filters')}
        filtersToggle={{
          label: say(props, 'filtersToggle'),
          count: [query.propertyId, query.status !== 'all', query.source, query.view !== 'all'].filter(
            Boolean,
          ).length,
        }}
        search={{
          id: `${props.id}-search`,
          action: props.path.split('?')[0]!,
          name: 'q',
          value: query.q,
          label: say(props, 'search'),
          placeholder: say(props, 'searchPlaceholder'),
          submitLabel: say(props, 'searchSubmit'),
          hidden: Object.fromEntries(new URL(go({ q: '' }), 'http://book.local').searchParams),
        }}
        filterMenus={[
          <Menu
            id={`${props.id}-property`}
            label={`${say(props, 'property')}: ${shown.property}`}
            selectionMode="single"
            trigger={html`<span>${shown.property}</span>`}
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
          // Status counts ignore the status filter, so each choice says what it would show.
          <Menu
            id={`${props.id}-status`}
            label={`${say(props, 'status')}: ${shown.status}`}
            selectionMode="single"
            trigger={html`<span>${shown.status}</span>`}
            items={RESERVATION_BOOK_STATUSES.map((id) => {
              const count = id === 'all' ? counts : counted('status', id)
              return {
                id: `status-${id}`,
                label:
                  count === undefined
                    ? say(props, `status.${id}`)
                    : `${say(props, `status.${id}`)} · ${count}`,
                href: go({ status: id }),
                checked: id === query.status,
              }
            })}
          />,
          <Menu
            id={`${props.id}-source`}
            label={`${say(props, 'source')}: ${shown.source}`}
            selectionMode="single"
            trigger={html`<span>${shown.source}</span>`}
            items={[
              {
                id: 'source-all',
                label: say(props, 'allSources'),
                href: go({ source: null }),
                checked: !query.source,
              },
              ...props.sources.map((id) => ({
                id: `source-${id}`,
                label: say(props, `provider.${id}`),
                href: go({ source: id }),
                checked: id === query.source,
              })),
            ]}
          />,
        ]}
        // Counts arrive with the rows; until then each facet holds its place.
        facets={RESERVATION_BOOK_VIEWS.map((id) => ({
          id,
          label: say(props, `view.${id}`),
          href: go({ view: id }),
          active: id === query.view,
          count: counted('view', id),
        }))}
        // As the room plan: back to today, how many days, then the window and its steps. Column headers own
        // sorting; the toolbar keeps search and filters.
        actions={
          <Inline
            gap="compact"
            blockAlign="center"
            items={[
              <LinkButton
                label={say(props, 'today')}
                href={go({ from: today, days: query.days ?? 14 })}
                variant="secondary"
              />,
              <Menu
                id={`${props.id}-days`}
                label={`${say(props, 'days')}: ${shown.days}`}
                selectionMode="single"
                trigger={html`<span>${shown.days}</span>`}
                items={[
                  ...RESERVATION_BOOK_WINDOWS.map((days) => ({
                    id: `days-${days}`,
                    label: say(props, 'daysOption', { count: days }),
                    href: go({ days, from: query.from ?? today }),
                    checked: days === query.days,
                  })),
                  {
                    id: 'days-all',
                    label: say(props, 'allDays'),
                    href: go({ days: null, from: null }),
                    checked: all,
                  },
                ]}
              />,
            ]}
          />
        }
        pager={{
          label: say(props, 'window'),
          summary: period(props, query),
          // A book with no property to show has no day to step from.
          previousHref: query.from === null || all ? null : go({ from: shift(query.from, -query.days!) }),
          nextHref: query.from === null || all ? null : go({ from: shift(query.from, query.days!) }),
          previousLabel: all
            ? say(props, 'previousRange')
            : say(props, 'previousWindow', { count: query.days! }),
          nextLabel: all ? say(props, 'nextRange') : say(props, 'nextWindow', { count: query.days! }),
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
      root.addEventListener('click', follow(props, store), { signal: lifetime })
      mountCollectionSearch(root, lifetime, store, `${props.id}-search`, (query) => {
        for (const name of ['create', 'walk-in']) {
          const link = root.ownerDocument.getElementById(`${props.id}-${name}`)
          if (link instanceof HTMLAnchorElement)
            link.href = withProperty(link.getAttribute('href') ?? link.href, query)
        }
      })
    },
  }
}

/** A row opens its reservation's page with the way back to the same query and row. */
export const reservationBookRecordHref = (
  props: ReservationBookProps,
  query: ReservationBookQuery,
  id: string,
) => {
  const scope = new URLSearchParams(
    [...new URL(props.path, 'http://book.local').searchParams].filter(([name]) =>
      ['company', 'companies', 'branch', 'branches'].includes(name),
    ),
  )
  scope.set('lang', props.lang)
  scope.set('returnTo', rowAnchorHref(reservationBookLink(props, query), id))
  return `${props.recordPath}/${encodeURIComponent(id)}?${scope}`
}

export const reservationBookResults = (props: ReservationBookProps) => {
  const store = storeFor(props)
  const maxBlockSize = signal<string | null>(null)
  const lines = (title: string, detail: string) => (
    <Stack
      gap="none"
      items={[
        <Text variant="bodyMd">{title}</Text>,
        <Text variant="bodySm" tone="muted">
          {detail}
        </Text>,
      ]}
    />
  )
  // A sortable header cycles: ascending, descending, then back to the desk's own order.
  const sortable = (field: 'arrival' | 'total', label: string) => {
    const query = store.query()
    const direction = query.sort === field ? 'asc' : query.sort === `-${field}` ? 'desc' : null
    const next = direction === 'asc' ? (`-${field}` as const) : direction === 'desc' ? 'relevance' : field
    return {
      sortHref: at(props, store, { sort: next }),
      sortLabel: say(props, 'sortedBy', {
        label,
        order: say(props, `sort.${next}`).toLocaleLowerCase(props.lang),
      }),
      sortDirection: direction,
    } as const
  }
  const people = (row: BookRow) =>
    [
      say(props, 'adults', { count: row.adults }),
      row.children ? say(props, 'children', { count: row.children }) : null,
    ]
      .filter(Boolean)
      .join(' · ')
  const propertyName = (row: BookRow) =>
    props.properties.find((item) => item.id === row.property.id)?.name ?? ''
  const view = (): TemplateResult => {
    const value = store.value(),
      query = store.query(),
      phase = props.allowed ? store.phase() : 'denied',
      failed = FAILED.includes(phase)
    // A phone stacks each row into who, when, which room and in what state; the unit, source and total stay on
    // the reservation's page (`tertiary`, KetTable stack contract).
    const table = (
      <KetTable
        maxBlockSize={maxBlockSize()}
        columns={[
          {
            key: 'reservation',
            label: say(props, 'column.reservation'),
            priority: 'primary',
            cell: (row: BookRow) => lines(row.code, row.guest),
          },
          {
            key: 'status',
            label: say(props, 'column.status'),
            priority: 'primary',
            cell: (row: BookRow) => (
              <Badge
                label={say(props, `rowStatus.${row.status.id}`)}
                tone={TONES[row.status.id] ?? 'neutral'}
              />
            ),
          },
          {
            key: 'stay',
            label: say(props, 'column.stay'),
            kind: 'date',
            ...sortable('arrival', say(props, 'column.stay')),
            cell: (row: BookRow) =>
              `${dayMonth(row.arrival)}–${dayMonth(row.departure)} · ${say(props, 'nights', { count: row.nights })}`,
          },
          {
            key: 'room',
            label: say(props, 'column.room'),
            cell: (row: BookRow) =>
              row.room ?? (
                <Text variant="bodySm" tone="muted">
                  {say(props, 'unroomed')}
                </Text>
              ),
          },
          {
            key: 'unit',
            label: say(props, 'column.unit'),
            priority: 'tertiary',
            wrap: true,
            width: 'wide',
            cell: (row: BookRow) => lines(row.roomType.name, `${propertyName(row)} · ${people(row)}`),
          },
          {
            key: 'source',
            label: say(props, 'column.source'),
            priority: 'tertiary',
            cell: (row: BookRow) =>
              lines(say(props, `provider.${row.source.id}`), say(props, `guarantee.${row.guarantee.kind}`)),
          },
          {
            key: 'total',
            label: say(props, 'column.total'),
            kind: 'currency',
            align: 'end',
            priority: 'tertiary',
            ...sortable('total', say(props, 'column.total')),
            cell: (row: BookRow) => (
              <FormattedMoney value={row.total.amount} currency={row.total.currency} locale={props.lang} />
            ),
          },
        ]}
        rows={(value?.rows ?? []) as BookRow[]}
        id={(row: BookRow) => row.id}
        rowHref={(row: BookRow) => reservationBookRecordHref(props, query, row.id)}
        currentRow={store.currentRow()}
        responsive="stack"
        busy={store.dimmed()}
        // Two-line cells keep their height in the skeleton, so the first answer does not shift the page.
        loading={
          !value && !failed
            ? { rows: query.pageSize, lines: { reservation: 2, unit: 2, source: 2 } }
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
    const empty = (answer: BookAnswer) => {
      if (answer.bookIsEmpty)
        return (
          <EmptyState
            title={say(props, 'emptyBook')}
            message={say(props, 'emptyBookHint')}
            actions={
              props.createHref ? (
                <LinkButton
                  label={say(props, 'create')}
                  href={withProperty(props.createHref, query)}
                  variant="secondary"
                />
              ) : undefined
            }
          />
        )
      const all = query.days === null
      // A search may match bookings that a filter or a view leaves out; then the filters, not the words, empty it.
      const narrowed =
        Boolean(query.propertyId || query.source) || query.status !== 'all' || query.view !== 'all'
      const where = all
        ? say(props, 'whereBook')
        : say(props, 'whereWindow', { period: period(props, query) })
      return (
        <EmptyState
          title={
            filtered(query)
              ? say(props, 'noResults')
              : say(props, 'emptyWindow', { period: period(props, query) })
          }
          message={
            query.q.trim()
              ? say(props, narrowed ? 'emptySearchFiltered' : 'emptySearch', { q: query.q.trim(), where })
              : filtered(query)
                ? say(props, 'filteredMessage')
                : say(props, 'windowMessage')
          }
          actions={
            <Inline
              gap="compact"
              items={[
                all ? null : (
                  <LinkButton
                    label={say(props, 'allDates')}
                    href={at(props, store, { days: null, from: null })}
                    variant="secondary"
                  />
                ),
                filtered(query) ? (
                  <LinkButton
                    label={say(props, 'clear')}
                    href={at(props, store, {
                      propertyId: null,
                      source: null,
                      status: 'all',
                      view: 'all',
                      q: '',
                    })}
                    variant="secondary"
                  />
                ) : null,
              ].filter((item) => item !== null)}
            />
          }
        />
      )
    }
    // A guest-name search that matched more guest records than the read follows says so above the rows, rather
    // than passing a shortened list off as complete.
    const content =
      value && !value.total ? (
        empty(value)
      ) : value?.partial ? (
        <Stack
          items={[
            <Notice
              tone="warning"
              title={say(props, 'partial')}
              message={say(props, 'partialHint', { q: query.q.trim() })}
            />,
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
        fromUrl: (url) => reservationBookQueryFromUrl(url, props.properties),
        follow: follow(props, store),
      })
    },
  }
}

export const reservationBookFooter = (props: ReservationBookProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const value = store.value()
    if (!value || value.pages <= 1 || FAILED.includes(store.phase())) return html`<div hidden></div>`
    const first = (value.page - 1) * value.query.pageSize + 1
    const page = (to: number) => reservationBookLink(props, { ...store.query(), page: to })
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
