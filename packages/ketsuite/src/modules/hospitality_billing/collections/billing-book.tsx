import { html, signal } from '@ketvietlab/ketjs-view'
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
  Stack,
  Text,
  rowAnchorHref,
} from '@ketvietlab/design-system'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import type { PagedStore } from '../../../ui/client/paged-collection-store.ts'
import {
  attachCollectionStore,
  collectionBrowser,
  followCollectionLink,
  mountCollectionResults,
  mountCollectionSearch,
  sharedCollectionStore,
} from '../../hospitality_core/collections/view.tsx'
import {
  BILLING_BOOK_PERIODS,
  BILLING_BOOK_SORTS,
  BILLING_BOOK_VIEWS,
  billingBookHref,
  billingBookQueryFromUrl,
} from '../billing-book-query.ts'
import type { BillingBookQuery, BillingBookSort } from '../billing-book-query.ts'
import type { BillingBookRow } from '../functions/billing-book.ts'

/**
 * The billing list (`/admin/hospitality/billing`, HOS-UI-020): three islands on one paged store reading one page of
 * one query at a time from `hospitality_billing.searchBilling`, as the accepted mock (`billing` in
 * design/shared/hospitality-collection-book.mjs, HOS-DEC-033). The book is billing's work of a period, weighed
 * whole on the server, so its facets count all of it and it orders by what is still owed.
 */
export type BillingBookProps = {
  key: string
  id: string
  source: string
  /** The list's own URL with the reader's company, branch and language. */
  path: string
  recordPath: string
  /** The folio register, for an empty book; null for a reader who may not read it. */
  foliosHref: string | null
  lang: string
  allowed: boolean
  /** The next steps the reader may take; one they may not reads as opening the folio. */
  may: { rule: boolean; invoice: boolean; payment: boolean }
  properties: Array<{ id: string; name: string }>
  query: BillingBookQuery
  words: Record<string, string>
}
type BillingAnswer = {
  query: BillingBookQuery
  rows: Array<Record<string, unknown>>
  total: number
  page: number
  pages: number
  counts: { view: Record<string, number> }
  isEmpty: boolean
  partial: boolean
}
type BillingStore = PagedStore<BillingBookQuery, BillingAnswer>

const FAILED = ['failed', 'offline', 'denied']
const TONES = {
  unverified: 'danger',
  'missing-rule': 'danger',
  uninvoiced: 'info',
  owing: 'warning',
  paid: 'positive',
} as const

/** A message with `{name}` values. */
const say = (props: BillingBookProps, key: string, values: Record<string, string | number> = {}) =>
  (props.words[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
const number = (props: BillingBookProps, value: number) =>
  value.toLocaleString(props.lang === 'en' ? 'en' : 'vi')

export const billingBookLink = (props: BillingBookProps, query: BillingBookQuery) =>
  billingBookHref(props.path, query)
const at = (props: BillingBookProps, store: BillingStore, change: Partial<BillingBookQuery>) =>
  billingBookLink(props, { ...store.query(), page: 1, ...change })
const describe = (props: BillingBookProps, value: BillingAnswer) => {
  if (!value.total) return say(props, 'noResults')
  const first = (value.page - 1) * value.query.pageSize + 1
  return say(props, 'describe', {
    first: number(props, first),
    last: number(props, first + value.rows.length - 1),
    total: number(props, value.total),
  })
}

const storeFor = (props: BillingBookProps) =>
  sharedCollectionStore(props.key, () =>
    createPagedCollectionStore<BillingBookQuery, BillingAnswer>({
      source: props.source,
      query: props.query,
      href: (query) => billingBookLink(props, query),
      announce: (value) => describe(props, value),
      browser: collectionBrowser(),
    }),
  )
const isListNavigation = (next: URL, current: URL) =>
  next.origin === current.origin &&
  next.pathname === current.pathname &&
  !['record', 'dialog', 'legacy', 'filter', 'group', 'groups', 'favorite'].some((name) =>
    next.searchParams.has(name),
  ) &&
  ['company', 'companies', 'branch', 'branches', 'lang'].every(
    (name) =>
      JSON.stringify(next.searchParams.getAll(name)) === JSON.stringify(current.searchParams.getAll(name)),
  )
const follow = (props: BillingBookProps, store: BillingStore) => (event: MouseEvent) =>
  followCollectionLink(event, isListNavigation, (next) =>
    store.navigate(billingBookQueryFromUrl(next, props.properties)),
  )

export const billingBookControls = (props: BillingBookProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const query = store.query()
    const value = FAILED.includes(store.phase()) ? null : store.value()
    // Before the first answer a count holds its place; after a failed one it is left out rather than guessed.
    const counted = (id: string) =>
      value ? number(props, value.counts.view[id] ?? 0) : store.phase() === 'loading' ? '…' : undefined
    const property = props.properties.find((item) => item.id === query.propertyId)
    const shown = property?.name ?? say(props, 'allProperties')
    const period = say(props, `period.${query.period}`)
    const go = (change: Partial<BillingBookQuery>) => at(props, store, change)
    return (
      <ListChrome
        filtersLabel={say(props, 'filters')}
        filtersToggle={{
          label: say(props, 'filtersToggle'),
          // The period always has a value; only a period other than the last 7 days counts as a filter.
          count: [query.propertyId, query.period !== 7, query.view !== 'all'].filter(Boolean).length,
        }}
        search={{
          id: `${props.id}-search`,
          action: props.path.split('?')[0]!,
          name: 'q',
          value: query.q,
          label: say(props, 'search'),
          placeholder: say(props, 'searchPlaceholder'),
          submitLabel: say(props, 'searchSubmit'),
          hidden: Object.fromEntries(new URL(go({ q: '' }), 'http://billing.local').searchParams),
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
          // A period has no "every period": the book is the work of one.
          <Menu
            id={`${props.id}-period`}
            label={`${say(props, 'period')}: ${period}`}
            selectionMode="single"
            trigger={html`<span>${period}</span>`}
            items={BILLING_BOOK_PERIODS.map((days) => ({
              id: `period-${days}`,
              label: say(props, `period.${days}`),
              href: go({ period: days }),
              checked: days === query.period,
            }))}
          />,
        ]}
        // Facets overlap and count the whole book for the period, property and search, not the facet chosen.
        facets={BILLING_BOOK_VIEWS.map((id) => ({
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

/** The folio's page, or one of its steps, with the way back to the same query and row. */
export const billingBookRecordHref = (
  props: BillingBookProps,
  query: BillingBookQuery,
  row: BillingBookRow,
  dialog: 'invoice' | 'payment' | null = null,
) => {
  const scope = new URLSearchParams(
    [...new URL(props.path, 'http://billing.local').searchParams].filter(([name]) =>
      ['company', 'companies', 'branch', 'branches'].includes(name),
    ),
  )
  if (dialog) scope.set('dialog', dialog)
  scope.set('lang', props.lang)
  scope.set('returnTo', rowAnchorHref(billingBookLink(props, query), row.id))
  return `${props.recordPath}/${encodeURIComponent(row.id)}?${scope}`
}

/** A row's next step as the reader may take it: the rule opens over this list, the rest on the folio's page. */
export const billingBookNext = (props: BillingBookProps, query: BillingBookQuery, row: BillingBookRow) => {
  if (row.next === 'rule' && row.rule && props.may.rule) {
    const url = new URL(billingBookLink(props, query), 'http://billing.local')
    url.searchParams.set('record', `hospitality.billingRule:${row.rule}`)
    return { label: say(props, 'next.rule'), href: `${url.pathname}${url.search}` }
  }
  if ((row.next === 'invoice' || row.next === 'payment') && props.may[row.next])
    return { label: say(props, `next.${row.next}`), href: billingBookRecordHref(props, query, row, row.next) }
  return { label: say(props, 'next.view'), href: billingBookRecordHref(props, query, row) }
}

export const billingBookResults = (props: BillingBookProps) => {
  const store = storeFor(props)
  const maxBlockSize = signal<string | null>(null)
  const muted = (children: string) => (
    <Text variant="bodySm" tone="muted">
      {children}
    </Text>
  )
  const lines = (title: string, detail: string) => (
    <Stack gap="none" items={[<Text variant="bodyMd">{title}</Text>, muted(detail)]} />
  )
  // A sortable header cycles through its orders as the list names them, then back to what needs doing first.
  const sortable = (field: 'title' | 'total' | 'balance', label: string) => {
    const query = store.query()
    const orders = BILLING_BOOK_SORTS.filter((id) => id.replace(/^-/, '') === field)
    const position = orders.indexOf(query.sort)
    const next: BillingBookSort = position === -1 ? orders[0]! : (orders[position + 1] ?? 'attention')
    return {
      sortHref: at(props, store, { sort: next }),
      sortLabel: say(props, 'sortedBy', {
        label,
        order: say(props, `sort.${next}`).toLocaleLowerCase(props.lang),
      }),
      sortDirection: position === -1 ? null : query.sort.startsWith('-') ? 'desc' : 'asc',
    } as const
  }
  // An invoice not posted, or reversed or cancelled since, says so under its number.
  const invoice = (row: BillingBookRow) => {
    if (!row.invoice) return muted(say(props, row.billing === 'unverified' ? 'dueUnknown' : 'invoiceNone'))
    const note = { draft: 'invoiceDraft', void: 'invoiceVoid', posted: null }[row.invoice.status]
    return note ? lines(row.invoice.name, say(props, note)) : <Text variant="bodyMd">{row.invoice.name}</Text>
  }
  // What the evidence cannot say is not zero.
  const owed = (row: BillingBookRow) =>
    row.due ? (
      <FormattedMoney value={row.due.amount} currency={row.due.currency} locale={props.lang} />
    ) : (
      muted(say(props, 'dueUnknown'))
    )
  const view = (): TemplateResult => {
    const value = store.value(),
      query = store.query(),
      phase = props.allowed ? store.phase() : 'denied',
      failed = FAILED.includes(phase)
    // A phone stacks each row into the folio, its state, invoice, what it owes and its next step; the folio total
    // stays on the folio's page (`tertiary`, KetTable stack contract).
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
            cell: (row: BillingBookRow) => lines(row.code, row.guest),
          },
          {
            key: 'state',
            label: say(props, 'column.state'),
            priority: 'primary',
            cell: (row: BillingBookRow) => (
              <Badge label={say(props, `billing.${row.billing}`)} tone={TONES[row.billing]} size="small" />
            ),
          },
          {
            key: 'total',
            label: say(props, 'column.total'),
            kind: 'currency',
            align: 'end',
            priority: 'tertiary',
            ...sortable('total', say(props, 'column.total')),
            cell: (row: BillingBookRow) => (
              <FormattedMoney value={row.total.amount} currency={row.total.currency} locale={props.lang} />
            ),
          },
          { key: 'invoice', label: say(props, 'column.invoice'), priority: 'primary', cell: invoice },
          {
            key: 'balance',
            label: say(props, 'column.balance'),
            kind: 'currency',
            align: 'end',
            priority: 'primary',
            ...sortable('balance', say(props, 'column.balance')),
            cell: owed,
          },
          {
            key: 'next',
            label: say(props, 'column.next'),
            priority: 'primary',
            wrap: true,
            cell: (row: BillingBookRow) => {
              const next = billingBookNext(props, query, row)
              return <LinkButton label={next.label} href={next.href} variant="secondary" />
            },
          },
        ]}
        rows={(value?.rows ?? []) as BillingBookRow[]}
        id={(row: BillingBookRow) => row.id}
        rowHref={(row: BillingBookRow) => billingBookRecordHref(props, query, row)}
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
    const empty = (answer: BillingAnswer) =>
      answer.isEmpty ? (
        <EmptyState
          title={say(props, 'emptyBook')}
          message={say(props, 'emptyBookHint')}
          actions={
            props.foliosHref ? (
              <LinkButton label={say(props, 'folios')} href={props.foliosHref} variant="secondary" />
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
    // A book past the read's bound says so above the rows rather than passing them off as the whole period.
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
        fromUrl: (url) => billingBookQueryFromUrl(url, props.properties),
        follow: follow(props, store),
      })
    },
  }
}

export const billingBookFooter = (props: BillingBookProps) => {
  const store = storeFor(props)
  const view = (): TemplateResult => {
    const value = store.value()
    if (!value || value.pages <= 1 || FAILED.includes(store.phase())) return html`<div hidden></div>`
    const first = (value.page - 1) * value.query.pageSize + 1
    const page = (to: number) => billingBookLink(props, { ...store.query(), page: to })
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
