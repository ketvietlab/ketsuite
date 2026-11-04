import { effect, type IslandController } from '@ketvietlab/ketjs-view'
import {
  createSearchFilterView,
  Badge,
  Button,
  KetTable,
  ListChrome,
  Notice,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import { LANDED_COSTS_PATH, landedCostHref, landedCostQuery } from './shared.ts'
import type { LandedCostAnswer, LandedCostProps, LandedCostQuery, LandedCostRow } from './shared.ts'

/** Displayed column → the field the server sorts it by. */
const COLUMNS = [
  ['name', 'name'],
  ['dateText', 'date'],
  ['vendor', 'vendor'],
  ['receipts', null],
  ['totalText', 'total'],
  ['stateText', null],
] as const
const TONES: Record<string, 'neutral' | 'positive' | 'warning' | 'danger'> = {
  draft: 'neutral',
  posted: 'positive',
  cancel: 'danger',
}

function createBundle(props: LandedCostProps) {
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
  const href = (q: LandedCostQuery) =>
    landedCostHref(q.href, { q: q.q || null, page: q.page > 1 ? String(q.page) : null })
  const range = (answer: LandedCostAnswer) =>
    `${answer.total ? (answer.page - 1) * answer.query.pageSize + 1 : 0}–${Math.min(answer.total, answer.page * answer.query.pageSize)} / ${answer.total}`
  const store = createPagedCollectionStore<LandedCostQuery, LandedCostAnswer>({
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
    if (target?.closest('#landed-cost-retry')) {
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
      next.pathname !== LANDED_COSTS_PATH ||
      ['record', 'create', 'dialog'].some((key) => next.searchParams.has(key)) ||
      ['lang', 'company', 'branch'].some(
        (key) => next.searchParams.get(key) !== current.searchParams.get(key),
      )
    )
      return
    event.preventDefault()
    store.navigate(landedCostQuery(next))
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
    { id: 'landed-cost-search', config: props.search },
    {
      apply: async (input, signal) => {
        const response = await fetch(
          '/_ket/fn/stock_backend.applySearchFilter' + new URL(props.source, location.href).search,
          {
            method: 'POST',
            credentials: 'same-origin',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...input, listKey: 'stock.landed-costs', returnTo: href(store.query()) }),
          },
        )
        const payload = await response.json()
        if (!response.ok || payload.ok === false) throw new Error(labels.loadError)
        if (signal.aborted) return
        const nextShape = JSON.stringify([input.facets, input.groupBy, input.customFilters, input.favoriteId])
        store.navigate(
          landedCostQuery(new URL(payload.value?.href ?? payload.href, location.href)),
          typing && shape === nextShape ? 'replace' : 'push',
        )
        typing = true
        shape = nextShape
      },
    },
  )
  const controls: IslandController = {
    view: () => (
      <IslandRegion marker="landed-cost-controls">{ListChrome({ query: search.view() })}</IslandRegion>
    ),
    mount: (ctx) => {
      hold(ctx)
      const root = (ctx.root as unknown as HTMLElement).querySelector('[data-ui="search-filter"]')
      search.mount?.({ ...ctx, root: (root ?? ctx.root) as typeof ctx.root })
      const release = effect(() => {
        const answer = store.value()
        if (answer) search.update?.({ id: 'landed-cost-search', config: answer.search })
      })
      ctx.lifetime.addEventListener('abort', release, { once: true })
    },
    dispose: () => search.dispose?.(),
  }
  const results: IslandController = {
    view: () => {
      const answer = store.value()
      return (
        <IslandRegion marker="landed-cost-results" busy={store.phase() === 'loading'}>
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
                  actions={<Button id="landed-cost-retry" label={labels.retry!} variant="secondary" />}
                />
              ) : null,
              failed() && !answer ? null : (
                <KetTable<LandedCostRow>
                  columns={COLUMNS.map(([key, sort]) => ({
                    key,
                    label: labels[key]!,
                    priority:
                      key === 'name'
                        ? ('primary' as const)
                        : key === 'vendor'
                          ? ('secondary' as const)
                          : undefined,
                    kind:
                      key === 'name'
                        ? ('identifier' as const)
                        : key === 'totalText'
                          ? ('currency' as const)
                          : key === 'dateText'
                            ? ('date' as const)
                            : key === 'stateText'
                              ? ('status' as const)
                              : ('text' as const),
                    cell: (row: LandedCostRow) =>
                      key === 'stateText' ? (
                        <Badge label={row.stateText} tone={TONES[row.state] ?? 'neutral'} />
                      ) : (
                        String(row[key] || '—')
                      ),
                    ...(sort && answer?.sorts[sort]
                      ? { sortHref: answer.sorts[sort]!.href, sortDirection: answer.sorts[sort]!.direction }
                      : {}),
                  }))}
                  rowHref={(row) => row.href}
                  rows={answer?.rows ?? []}
                  id={(row) => row.id}
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
          store.navigate(landedCostQuery(new URL(location.href)), 'none')
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
        <IslandRegion marker="landed-cost-footer">
          {answer && !failed() && !answer.isEmpty ? (
            <Text tone="muted">{`${labels.sum}: ${answer.sumText}`}</Text>
          ) : null}
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
const bundle = (props: LandedCostProps) => {
  if (typeof window === 'undefined') return createBundle(props)
  if (!bundles.has(props.key)) bundles.set(props.key, { bundle: createBundle(props), refs: 0 })
  return bundles.get(props.key)!.bundle
}
export const landedCostControls = (props: LandedCostProps) => bundle(props).controls
export const landedCostResults = (props: LandedCostProps) => bundle(props).results
export const landedCostFooter = (props: LandedCostProps) => bundle(props).footer
