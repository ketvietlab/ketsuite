import { effect, type IslandController } from '@ketvietlab/ketjs-view'
import {
  createSearchFilterView,
  Button,
  KetTable,
  ListChrome,
  Menu,
  Notice,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import { STOCK_REPORTS, reportHref, reportQuery } from './shared.ts'
import type { ReportAnswer, ReportProps, ReportQuery, ReportRow } from './shared.ts'

function createBundle(props: ReportProps) {
  const { report, labels } = props
  const { path, listKey } = STOCK_REPORTS[report]
  const id = (part: string) => `stock-${report}-${part}`
  const browser =
    typeof window === 'undefined'
      ? undefined
      : {
          href: () => location.href,
          online: () => navigator.onLine,
          fetch: window.fetch.bind(window),
          push: (href: string) => history.pushState(history.state, '', href),
          replace: (href: string) => history.replaceState(history.state, '', href),
        }
  const href = (q: ReportQuery) =>
    reportHref(report, q.href, { q: q.q || null, page: q.page > 1 ? String(q.page) : null })
  const range = (answer: ReportAnswer) =>
    `${answer.total ? (answer.page - 1) * answer.query.pageSize + 1 : 0}–${Math.min(answer.total, answer.page * answer.query.pageSize)} / ${answer.total}`
  const store = createPagedCollectionStore<ReportQuery, ReportAnswer>({
    source: props.source,
    query: props.query,
    href,
    announce: range,
    browser,
  })
  const failed = () => ['failed', 'offline', 'denied'].includes(store.phase())
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(`#${id('retry')}`)) {
      event.preventDefault()
      store.retry()
      return
    }
    const link = target?.closest<HTMLAnchorElement>('a[href]')
    if (!link || link.target || link.hasAttribute('download')) return
    const next = new URL(link.href),
      current = new URL(location.href)
    if (
      next.origin !== current.origin ||
      next.pathname !== path ||
      ['record', 'create', 'dialog'].some((key) => next.searchParams.has(key)) ||
      ['lang', 'company', 'branch'].some(
        (key) => next.searchParams.get(key) !== current.searchParams.get(key),
      )
    )
      return
    event.preventDefault()
    store.navigate(reportQuery(report, next))
  }
  const hold = (ctx: Parameters<NonNullable<IslandController['mount']>>[0]) => {
    const held = bundles.get(props.key)
    if (held) {
      held.refs++
      ctx.lifetime.addEventListener(
        'abort',
        () => {
          if (--held.refs === 0) {
            held.bundle.dispose()
            bundles.delete(props.key)
          }
        },
        { once: true },
      )
    }
    ;(ctx.root as unknown as HTMLElement).addEventListener('click', click, { signal: ctx.lifetime })
  }
  let typing = false
  let shape = ''
  const search = createSearchFilterView(
    { id: id('search'), config: props.search },
    {
      apply: async (input, signal) => {
        const response = await fetch(
          '/_ket/fn/stock_backend.applySearchFilter' + new URL(props.source, location.href).search,
          {
            method: 'POST',
            credentials: 'same-origin',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...input, listKey, returnTo: href(store.query()) }),
          },
        )
        const payload = await response.json()
        if (!response.ok || payload.ok === false) throw new Error(labels.loadError)
        if (signal.aborted) return
        const nextShape = JSON.stringify([input.facets, input.groupBy, input.customFilters, input.favoriteId])
        store.navigate(
          reportQuery(report, new URL(payload.value?.href ?? payload.href, location.href)),
          typing && shape === nextShape ? 'replace' : 'push',
        )
        typing = true
        shape = nextShape
      },
    },
  )
  const warehouses = () => {
    const choices = store.value()?.warehouses ?? []
    if (!choices.length) return null
    const active = choices.find((choice) => choice.active)
    return Menu({
      id: id('warehouse'),
      label: `${labels.warehouse}: ${active?.name ?? labels.allWarehouses}`,
      size: 'compact',
      selectionMode: 'single',
      items: choices.map((choice) => ({
        id: choice.id || 'all',
        label: choice.name,
        href: choice.href,
        checked: choice.active,
      })),
    })
  }
  const controls: IslandController = {
    view: () => (
      <IslandRegion marker={`${report}-controls`}>
        {ListChrome({ query: search.view(), filterMenus: warehouses() })}
      </IslandRegion>
    ),
    mount: (ctx) => {
      hold(ctx)
      const root = (ctx.root as unknown as HTMLElement).querySelector('[data-ui="search-filter"]')
      search.mount?.({ ...ctx, root: (root ?? ctx.root) as typeof ctx.root })
      const release = effect(() => {
        const answer = store.value()
        if (answer) search.update?.({ id: id('search'), config: answer.search })
      })
      ctx.lifetime.addEventListener('abort', release, { once: true })
    },
    dispose: () => search.dispose?.(),
  }
  const results: IslandController = {
    view: () => {
      const answer = store.value()
      return (
        <IslandRegion marker={`${report}-results`} busy={store.phase() === 'loading'}>
          <Stack
            items={[
              failed() ? (
                <Notice
                  tone="danger"
                  title={
                    labels[
                      store.phase() === 'denied'
                        ? 'denied'
                        : store.phase() === 'offline'
                          ? 'offline'
                          : 'loadError'
                    ]
                  }
                  message=""
                  actions={<Button id={id('retry')} label={labels.retry!} variant="secondary" />}
                />
              ) : null,
              failed() && !answer ? null : (
                <KetTable<ReportRow>
                  columns={props.columns.map((column) => ({
                    key: column.key,
                    label: column.label,
                    ...(column.priority ? { priority: column.priority } : {}),
                    kind: column.kind ?? 'text',
                    cell: (row: ReportRow) => String(row[column.key] || '—'),
                    ...(column.sort && answer?.sorts[column.sort]
                      ? {
                          sortHref: answer.sorts[column.sort]!.href,
                          sortDirection: answer.sorts[column.sort]!.direction,
                        }
                      : {}),
                  }))}
                  groups={answer?.groups}
                  rows={answer?.groups?.length ? [] : (answer?.rows ?? [])}
                  id={(row) => row.id}
                  {...(report !== 'aging' ? { rowHref: (row: ReportRow) => row.href ?? '' } : {})}
                  responsive="stack"
                  busy={store.dimmed()}
                  loading={!answer && !failed() ? { rows: 8 } : undefined}
                  labels={{
                    ...labels,
                    ...(answer && !answer.isEmpty
                      ? { empty: labels.noMatches!, emptyHint: labels.noMatchesHint! }
                      : {}),
                  }}
                />
              ),
              <PoliteStatus>
                <Text visuallyHidden>{store.announcement()}</Text>
              </PoliteStatus>,
            ]}
          />
        </IslandRegion>
      )
    },
    mount: (ctx) => {
      hold(ctx)
      window.addEventListener(
        'popstate',
        () => {
          typing = false
          store.navigate(reportQuery(report, new URL(location.href)), 'none')
        },
        { signal: ctx.lifetime },
      )
      window.addEventListener('online', () => store.retry(), { signal: ctx.lifetime })
      window.addEventListener('offline', () => store.retry(), { signal: ctx.lifetime })
      document.addEventListener(
        'ket:records-changed',
        (event) => {
          const detail = (event as CustomEvent).detail
          if (!detail?.kind || String(detail.kind).startsWith('stock.')) {
            event.preventDefault()
            store.invalidate()
          }
        },
        { signal: ctx.lifetime },
      )
      void store.load()
    },
  }
  const footer: IslandController = {
    view: () => {
      const answer = store.value()
      return (
        <IslandRegion marker={`${report}-footer`}>
          {answer && !failed()
            ? ListChrome({
                status: answer.totals.join(' · '),
                pager: {
                  label: labels.title!,
                  summary: range(answer),
                  previousHref: answer.previous,
                  nextHref: answer.next,
                  previousLabel: labels.previousPage!,
                  nextLabel: labels.nextPage!,
                },
              })
            : null}
        </IslandRegion>
      )
    },
    mount: hold,
  }
  return { controls, results, footer, dispose: () => store.dispose() }
}
const bundles = new Map<string, { bundle: ReturnType<typeof createBundle>; refs: number }>()
const bundle = (props: ReportProps) => {
  if (typeof window === 'undefined') return createBundle(props)
  if (!bundles.has(props.key)) bundles.set(props.key, { bundle: createBundle(props), refs: 0 })
  return bundles.get(props.key)!.bundle
}
export const stockReportControls = (props: ReportProps) => bundle(props).controls
export const stockReportResults = (props: ReportProps) => bundle(props).results
export const stockReportFooter = (props: ReportProps) => bundle(props).footer
