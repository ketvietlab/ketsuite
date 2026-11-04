import { effect, type IslandController } from '@ketvietlab/ketjs-view'
import {
  createSearchFilterView,
  Button,
  KetTable,
  ListChrome,
  Notice,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import { REPLENISHMENT_PATH, replenishmentHref, replenishmentQuery } from './shared.ts'
import type {
  ReplenishmentAnswer,
  ReplenishmentProps,
  ReplenishmentQuery,
  ReplenishmentRow,
} from './shared.ts'

function createBundle(props: ReplenishmentProps) {
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
  const href = (q: ReplenishmentQuery) =>
    replenishmentHref(q.href, { q: q.q || null, page: q.page > 1 ? String(q.page) : null })
  const range = (answer: ReplenishmentAnswer) =>
    `${answer.total ? (answer.page - 1) * answer.query.pageSize + 1 : 0}–${Math.min(answer.total, answer.page * answer.query.pageSize)} / ${answer.total}`
  const store = createPagedCollectionStore<ReplenishmentQuery, ReplenishmentAnswer>({
    source: props.source,
    query: props.query,
    href,
    announce: range,
    browser,
  })
  const labels = props.labels
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
    if (target?.closest('#replenishment-retry')) {
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
      next.pathname !== REPLENISHMENT_PATH ||
      ['record', 'create', 'dialog'].some((key) => next.searchParams.has(key)) ||
      ['lang', 'company', 'branch'].some(
        (key) => next.searchParams.get(key) !== current.searchParams.get(key),
      )
    )
      return
    event.preventDefault()
    store.navigate(replenishmentQuery(next))
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
    { id: 'replenishment-search', config: props.search },
    {
      apply: async (input, signal) => {
        const response = await fetch(
          '/_ket/fn/stock_backend.applySearchFilter' + new URL(props.source, location.href).search,
          {
            method: 'POST',
            credentials: 'same-origin',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...input, listKey: 'stock.replenishment', returnTo: href(store.query()) }),
          },
        )
        const payload = await response.json()
        if (!response.ok || payload.ok === false) throw new Error(labels.loadError)
        if (signal.aborted) return
        const nextShape = JSON.stringify([input.facets, input.groupBy, input.customFilters, input.favoriteId])
        store.navigate(
          replenishmentQuery(new URL(payload.value?.href ?? payload.href, location.href)),
          typing && shape === nextShape ? 'replace' : 'push',
        )
        typing = true
        shape = nextShape
      },
    },
  )
  const controls: IslandController = {
    view: () => <IslandRegion marker="replenishment-controls">{search.view()}</IslandRegion>,
    mount: (ctx) => {
      hold(ctx)
      const root = (ctx.root as unknown as HTMLElement).querySelector('[data-ui="search-filter"]')
      search.mount?.({ ...ctx, root: (root ?? ctx.root) as typeof ctx.root })
      const release = effect(() => {
        const answer = store.value()
        if (answer) search.update?.({ id: 'replenishment-search', config: answer.search })
      })
      ctx.lifetime.addEventListener('abort', release, { once: true })
    },
    dispose: () => search.dispose?.(),
  }
  const results: IslandController = {
    view: () => {
      const answer = store.value()
      return (
        <IslandRegion marker="replenishment-results" busy={store.phase() === 'loading'}>
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
                  actions={<Button id="replenishment-retry" label={labels.retry!} variant="secondary" />}
                />
              ) : null,
              failed() && !answer ? null : (
                <KetTable<ReplenishmentRow>
                  columns={[
                    'product',
                    'location',
                    'sourceName',
                    'leadDays',
                    'forecasted',
                    'onOrder',
                    'minQuantity',
                    'maxQuantity',
                    'toOrder',
                    'replenishmentUom',
                    'triggerLabel',
                  ].map((key) => ({
                    key,
                    label: labels[key]!,
                    priority:
                      key === 'product'
                        ? ('primary' as const)
                        : key === 'sourceName'
                          ? ('secondary' as const)
                          : undefined,
                    cell: (row: ReplenishmentRow) => String(row[key] ?? '—'),
                    ...(answer?.sorts[key]
                      ? { sortHref: answer.sorts[key]!.href, sortDirection: answer.sorts[key]!.direction }
                      : {}),
                  }))}
                  groups={answer?.groups}
                  rows={answer?.groups?.length ? [] : (answer?.rows ?? [])}
                  id={(row) => row.id}
                  rowHref={(row) => row.editHref}
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
          store.navigate(replenishmentQuery(new URL(location.href)), 'none')
        },
        {
          signal: ctx.lifetime,
        },
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
        <IslandRegion marker="replenishment-footer">
          {answer && !failed()
            ? ListChrome({
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
const bundle = (props: ReplenishmentProps) => {
  if (typeof window === 'undefined') return createBundle(props)
  if (!bundles.has(props.key)) bundles.set(props.key, { bundle: createBundle(props), refs: 0 })
  return bundles.get(props.key)!.bundle
}
export const replenishmentControls = (props: ReplenishmentProps) => bundle(props).controls
export const replenishmentResults = (props: ReplenishmentProps) => bundle(props).results
export const replenishmentFooter = (props: ReplenishmentProps) => bundle(props).footer
