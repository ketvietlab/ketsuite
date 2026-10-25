import { effect, html, signal } from '@ketvietlab/ketjs-view'
import type { IslandMountContext, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Badge,
  Button,
  EmptyState,
  FormattedMoney,
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
import {
  FOLIO_BOOK_SORTS,
  FOLIO_BOOK_VIEWS,
  folioBookHref,
  folioBookQueryFromUrl,
} from '../folio-book-query.ts'
import type { FolioBookQuery, FolioBookSort } from '../folio-book-query.ts'
import type { FolioBookRow } from '../functions/folio-book.ts'
import { createPageEvidenceReader } from './page-evidence.ts'
import {
  attachCollectionStore,
  collectionBrowser,
  followCollectionLink,
  mountCollectionResults,
  mountCollectionSearch,
  sharedCollectionStore,
} from './view.tsx'

/**
 * The folio register (`/admin/hospitality/folios`, HOS-UI-016): three islands on one paged store reading one page of
 * one query at a time from `hospitality_core.searchFolios`, as the accepted mock (`folios` in
 * design/shared/hospitality-collection-book.mjs, HOS-DEC-032). What each folio still owes and its invoice are
 * billing's answer for the rows shown, `hospitality_billing.getFolioDues`, asked after them when the reader may.
 */
export type FolioBookProps = {
  key: string
  id: string
  source: string
  /** `hospitality_billing.getFolioDues` for a reader of billing; without it the list has no balance or invoice. */
  dueSource: string | null
  /** The list's own URL with the reader's company, branch and language. */
  path: string
  recordPath: string
  staysHref: string | null
  lang: string
  allowed: boolean
  properties: Array<{ id: string; name: string }>
  query: FolioBookQuery
  words: Record<string, string>
}
type FolioAnswer = {
  query: FolioBookQuery
  rows: Array<Record<string, unknown>>
  total: number
  page: number
  pages: number
  counts: { view: Record<string, number> }
  isEmpty: boolean
  partial: boolean
}
type FolioStore = PagedStore<FolioBookQuery, FolioAnswer>
export type FolioDue = {
  id: string
  due: string | null
  currency: string | null
  known: boolean
  invoice: { name: string; status: 'posted' | 'draft' | 'void' } | null
}

const FAILED = ['failed', 'offline', 'denied']

/** A message with `{name}` values. */
const say = (props: FolioBookProps, key: string, values: Record<string, string | number> = {}) =>
  (props.words[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
const number = (props: FolioBookProps, value: number) =>
  value.toLocaleString(props.lang === 'en' ? 'en' : 'vi')

export const folioBookLink = (props: FolioBookProps, query: FolioBookQuery) =>
  folioBookHref(props.path, query)
const at = (props: FolioBookProps, store: FolioStore, change: Partial<FolioBookQuery>) =>
  folioBookLink(props, { ...store.query(), page: 1, ...change })
const describe = (props: FolioBookProps, value: FolioAnswer) => {
  if (!value.total) return say(props, 'noResults')
  const first = (value.page - 1) * value.query.pageSize + 1
  return say(props, 'describe', {
    first: number(props, first),
    last: number(props, first + value.rows.length - 1),
    total: number(props, value.total),
  })
}

const storeFor = (props: FolioBookProps) =>
  sharedCollectionStore(props.key, () =>
    createPagedCollectionStore<FolioBookQuery, FolioAnswer>({
      source: props.source,
      query: props.query,
      href: (query) => folioBookLink(props, query),
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
const follow = (props: FolioBookProps, store: FolioStore) => (event: MouseEvent) =>
  followCollectionLink(event, isListNavigation, (next) =>
    store.navigate(folioBookQueryFromUrl(next, props.properties)),
  )

/** Billing's answer for the folios on screen (`collections/page-evidence.ts`). */
export const createFolioDueReader = (options: { source: string; fetch: typeof fetch }) =>
  createPageEvidenceReader<FolioDue>({
    ...options,
    missing: (id) => ({ id, due: null, currency: null, known: false, invoice: null }),
  })

export const folioBookControls = (props: FolioBookProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const query = store.query()
    const value = FAILED.includes(store.phase()) ? null : store.value()
    // Before the first answer a count holds its place; after a failed one it is left out rather than guessed.
    const counted = (id: string) =>
      value ? number(props, value.counts.view[id] ?? 0) : store.phase() === 'loading' ? '…' : undefined
    const property = props.properties.find((item) => item.id === query.propertyId)
    const shown = property?.name ?? say(props, 'allProperties')
    const go = (change: Partial<FolioBookQuery>) => at(props, store, change)
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
          hidden: Object.fromEntries(new URL(go({ q: '' }), 'http://folios.local').searchParams),
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
        // View counts follow the search and ignore the view. Column headers own sorting.
        facets={FOLIO_BOOK_VIEWS.map((id) => ({
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
      mountCollectionSearch(root, lifetime, store, `${props.id}-search`)
    },
  }
}

/** A row opens the folio's page, with the way back to the same query and row. */
export const folioBookRecordHref = (props: FolioBookProps, query: FolioBookQuery, row: FolioBookRow) => {
  const scope = new URLSearchParams(
    [...new URL(props.path, 'http://folios.local').searchParams].filter(([name]) =>
      ['company', 'companies', 'branch', 'branches'].includes(name),
    ),
  )
  scope.set('lang', props.lang)
  scope.set('returnTo', rowAnchorHref(folioBookLink(props, query), row.id))
  return `${props.recordPath}/${encodeURIComponent(row.id)}?${scope}`
}

export const folioBookResults = (props: FolioBookProps) => {
  const store = storeFor(props)
  const maxBlockSize = signal<string | null>(null)
  const reader = props.dueSource
    ? createFolioDueReader({ source: props.dueSource, fetch: (...args) => globalThis.fetch(...args) })
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
  // A sortable header cycles through its orders as the list names them, then back to the folios opened last.
  const sortable = (field: 'title' | 'total', label: string) => {
    const query = store.query()
    const orders = FOLIO_BOOK_SORTS.filter((id) => id.replace(/^-/, '') === field)
    const position = orders.indexOf(query.sort)
    const next: FolioBookSort = position === -1 ? orders[0]! : (orders[position + 1] ?? '-opened')
    return {
      sortHref: at(props, store, { sort: next }),
      sortLabel: say(props, 'sortedBy', {
        label,
        order: say(props, `sort.${next}`).toLocaleLowerCase(props.lang),
      }),
      sortDirection: position === -1 ? null : query.sort.startsWith('-') ? 'desc' : 'asc',
    } as const
  }
  const propertyName = (row: FolioBookRow) =>
    props.properties.find((item) => item.id === row.property.id)?.name ?? ''
  // The rooms a folio's stays sleep in, or slept in last: a group's first two and how many more.
  const rooms = (row: FolioBookRow) => {
    if (!row.rooms.length) return muted(say(props, 'unroomed'))
    const named = row.rooms.slice(0, 2).join(', ')
    const more = row.rooms.length > 2 ? ` ${say(props, 'moreRooms', { count: row.rooms.length - 2 })}` : ''
    return <Text variant="bodyMd">{`${named}${more} · ${propertyName(row)}`}</Text>
  }
  // Billing's two answers per row: what the folio still owes, and its invoice. Evidence the folio lacks is not
  // zero, and an invoice not posted, or reversed or cancelled since, says so under its number.
  const answer = (row: FolioBookRow, loading: string) => {
    const due = reader!.dues().get(row.id)
    if (!due) return { due: null, shown: <Skeleton label={say(props, loading)} lines={1} decorative /> }
    if (due === 'failed') return { due: null, shown: muted(say(props, 'dueFailed')) }
    return { due, shown: null }
  }
  const owed = (row: FolioBookRow) => {
    const { due, shown } = answer(row, 'dueLoading')
    if (!due) return shown
    if (!due.known || due.due === null) return muted(say(props, 'dueUnknown'))
    return Number(due.due) > 0 ? (
      <FormattedMoney value={due.due} currency={due.currency ?? row.total.currency} locale={props.lang} />
    ) : (
      muted(say(props, 'paid'))
    )
  }
  const invoice = (row: FolioBookRow) => {
    const { due, shown } = answer(row, 'invoiceLoading')
    if (!due) return shown
    if (!due.invoice) return muted(say(props, due.known ? 'invoiceNone' : 'dueUnknown'))
    const note = { draft: 'invoiceDraft', void: 'invoiceVoid', posted: null }[due.invoice.status]
    return note ? lines(due.invoice.name, say(props, note)) : <Text variant="bodyMd">{due.invoice.name}</Text>
  }
  const view = (): TemplateResult => {
    const value = store.value(),
      query = store.query(),
      phase = props.allowed ? store.phase() : 'denied',
      failed = FAILED.includes(phase)
    // A phone stacks each row into the folio, its state, room and what it owes; the total and the invoice stay on
    // the folio's page (`tertiary`, KetTable stack contract).
    const table = (
      <KetTable
        maxBlockSize={maxBlockSize()}
        columns={[
          {
            key: 'folio',
            label: say(props, 'column.folio'),
            priority: 'primary',
            wrap: true,
            width: 'wide',
            ...sortable('title', say(props, 'column.folio')),
            cell: (row: FolioBookRow) => lines(row.code, row.guest),
          },
          {
            key: 'state',
            label: say(props, 'column.state'),
            priority: 'primary',
            cell: (row: FolioBookRow) => (
              <Badge
                label={say(props, `state.${row.state}`)}
                tone={row.state === 'closed' ? 'positive' : 'info'}
                size="small"
              />
            ),
          },
          { key: 'room', label: say(props, 'column.room'), priority: 'primary', cell: rooms },
          {
            key: 'total',
            label: say(props, 'column.total'),
            kind: 'currency',
            align: 'end',
            priority: 'tertiary',
            ...sortable('total', say(props, 'column.total')),
            cell: (row: FolioBookRow) => (
              <FormattedMoney value={row.total.amount} currency={row.total.currency} locale={props.lang} />
            ),
          },
          ...(reader
            ? [
                {
                  key: 'balance',
                  label: say(props, 'column.balance'),
                  kind: 'currency' as const,
                  align: 'end' as const,
                  priority: 'primary' as const,
                  cell: owed,
                },
                {
                  key: 'invoice',
                  label: say(props, 'column.invoice'),
                  priority: 'tertiary' as const,
                  cell: invoice,
                },
              ]
            : []),
        ]}
        rows={(value?.rows ?? []) as FolioBookRow[]}
        id={(row: FolioBookRow) => row.id}
        rowHref={(row: FolioBookRow) => folioBookRecordHref(props, query, row)}
        currentRow={store.currentRow()}
        responsive="stack"
        busy={store.dimmed()}
        // Two-line cells keep their height in the skeleton, so the first answer does not shift the page.
        loading={!value && !failed ? { rows: query.pageSize, lines: { folio: 2 } } : undefined}
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
    const empty = (answer: FolioAnswer) =>
      answer.isEmpty ? (
        <EmptyState
          title={say(props, 'emptyRegister')}
          message={say(props, 'emptyRegisterHint')}
          actions={
            props.staysHref ? (
              <LinkButton label={say(props, 'stays')} href={props.staysHref} variant="secondary" />
            ) : undefined
          }
        />
      ) : (
        <EmptyState
          title={say(props, 'noResults')}
          message={
            query.q.trim() ? say(props, 'emptySearch', { q: query.q.trim() }) : say(props, 'filteredMessage')
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
    // A guest name matched past the read's bound says so above the rows rather than passing them off as all.
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
        fromUrl: (url) => folioBookQueryFromUrl(url, props.properties),
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

export const folioBookFooter = (props: FolioBookProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const value = store.value()
    if (!value || value.pages <= 1 || FAILED.includes(store.phase())) return html`<div hidden></div>`
    const first = (value.page - 1) * value.query.pageSize + 1
    const page = (to: number) => folioBookLink(props, { ...store.query(), page: to })
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
