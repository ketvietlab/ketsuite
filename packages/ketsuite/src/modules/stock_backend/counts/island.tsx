import { effect, type IslandController } from '@ketvietlab/ketjs-view'
import {
  createSearchFilterView,
  Badge,
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
import { COUNTS_PATH, countHref, countQuery } from './shared.ts'
import type { CountAnswer, CountProps, CountQuery, CountRow } from './shared.ts'

/** Displayed column → the field the server sorts it by. */
const COLUMNS = [
  ['name', 'name'],
  ['warehouse', 'warehouse'],
  ['scopeText', null],
  ['dateText', 'date'],
  ['linesText', 'lines'],
  ['differingText', null],
  ['stateText', null],
] as const
const TONES: Record<string, 'neutral' | 'positive' | 'warning' | 'danger'> = {
  counting: 'neutral',
  review: 'warning',
  done: 'positive',
  cancel: 'danger',
}

function createBundle(props: CountProps) {
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
  const href = (q: CountQuery) =>
    countHref(q.href, { q: q.q || null, page: q.page > 1 ? String(q.page) : null })
  const range = (answer: CountAnswer) =>
    `${answer.total ? (answer.page - 1) * answer.query.pageSize + 1 : 0}–${Math.min(answer.total, answer.page * answer.query.pageSize)} / ${answer.total}`
  const store = createPagedCollectionStore<CountQuery, CountAnswer>({
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
    if (target?.closest('#count-retry')) {
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
      next.pathname !== COUNTS_PATH ||
      ['record', 'create', 'dialog'].some((key) => next.searchParams.has(key)) ||
      ['lang', 'company', 'branch'].some(
        (key) => next.searchParams.get(key) !== current.searchParams.get(key),
      )
    )
      return
    event.preventDefault()
    store.navigate(countQuery(next))
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
    { id: 'count-search', config: props.search },
    {
      apply: async (input, signal) => {
        const response = await fetch(
          '/_ket/fn/stock_backend.applySearchFilter' + new URL(props.source, location.href).search,
          {
            method: 'POST',
            credentials: 'same-origin',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...input, listKey: 'stock.counts', returnTo: href(store.query()) }),
          },
        )
        const payload = await response.json()
        if (!response.ok || payload.ok === false) throw new Error(labels.loadError)
        if (signal.aborted) return
        const nextShape = JSON.stringify([input.facets, input.groupBy, input.customFilters, input.favoriteId])
        store.navigate(
          countQuery(new URL(payload.value?.href ?? payload.href, location.href)),
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
      id: 'count-warehouse',
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
      <IslandRegion marker="count-controls">
        {ListChrome({ query: search.view(), filterMenus: warehouses() })}
      </IslandRegion>
    ),
    mount: (ctx) => {
      hold(ctx)
      const root = (ctx.root as unknown as HTMLElement).querySelector('[data-ui="search-filter"]')
      search.mount?.({ ...ctx, root: (root ?? ctx.root) as typeof ctx.root })
      const release = effect(() => {
        const answer = store.value()
        if (answer) search.update?.({ id: 'count-search', config: answer.search })
      })
      ctx.lifetime.addEventListener('abort', release, { once: true })
    },
    dispose: () => search.dispose?.(),
  }
  const results: IslandController = {
    view: () => {
      const answer = store.value()
      return (
        <IslandRegion marker="count-results" busy={store.phase() === 'loading'}>
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
                  actions={<Button id="count-retry" label={labels.retry!} variant="secondary" />}
                />
              ) : null,
              failed() && !answer ? null : (
                <KetTable<CountRow>
                  columns={COLUMNS.map(([key, sort]) => ({
                    key,
                    label: labels[key]!,
                    priority:
                      key === 'name'
                        ? ('primary' as const)
                        : key === 'warehouse'
                          ? ('secondary' as const)
                          : undefined,
                    kind:
                      key === 'name'
                        ? ('identifier' as const)
                        : key === 'linesText' || key === 'differingText'
                          ? ('number' as const)
                          : key === 'dateText'
                            ? ('date' as const)
                            : key === 'stateText'
                              ? ('status' as const)
                              : ('text' as const),
                    cell: (row: CountRow) =>
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
          store.navigate(countQuery(new URL(location.href)), 'none')
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
        <IslandRegion marker="count-footer">
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
const bundle = (props: CountProps) => {
  if (typeof window === 'undefined') return createBundle(props)
  if (!bundles.has(props.key)) bundles.set(props.key, { bundle: createBundle(props), refs: 0 })
  return bundles.get(props.key)!.bundle
}
export const countControls = (props: CountProps) => bundle(props).controls
export const countResults = (props: CountProps) => bundle(props).results
export const countFooter = (props: CountProps) => bundle(props).footer
