import { effect } from '@ketvietlab/ketjs-view'
import type { IslandController } from '@ketvietlab/ketjs-view'
import {
  Badge,
  Button,
  KetTable,
  ListChrome,
  Notice,
  Stack,
  Text,
  createSearchFilterView,
} from '@ketvietlab/design-system'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import { LIST_PATH, queryFromUrl } from './shared.ts'
import type { PricelistRow } from '../screens/shared.ts'
import type { Answer, Props, Query } from './shared.ts'

function createBundle(props: Props) {
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
  const range = (answer: Answer) =>
    `${answer.total ? (answer.page - 1) * answer.query.pageSize + 1 : 0}–${Math.min(answer.total, answer.page * answer.query.pageSize)} / ${answer.total}`
  const store = createPagedCollectionStore<Query, Answer>({
    source: props.source,
    query: props.query,
    href: (q) => q.href,
    announce: range,
    browser,
  })
  let typing = false
  const configStructure = (config: Props['search']) => {
    const custom = new Set((config.customFilters ?? []).map((rule) => rule.id))
    return JSON.stringify([
      config.facets.filter((f) => f.type === 'filter' && !custom.has(f.id)).map((f) => f.id),
      config.facets.filter((f) => f.type === 'groupBy').map((f) => f.id),
      (config.customFilters ?? []).map((rule) => [rule.field, rule.operator, rule.value]),
      config.facets.find((f) => f.type === 'favorite')?.id ?? null,
    ])
  }
  let structure = configStructure(props.search)
  const search = createSearchFilterView(
    { id: 'pricing-pricelist-filter', config: props.search },
    {
      apply: async (input, signal) => {
        const response = await fetch('/_ket/fn/pricing_backend.applySearchFilter', {
          method: 'POST',
          credentials: 'same-origin',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...input,
            ...props.search.manager?.applyInput,
            returnTo: store.query().href,
          }),
        })
        const reply = await response.json()
        if (!response.ok || reply.ok === false) throw new Error('Search refused')
        if (signal.aborted) return
        const href = (reply.value ?? reply).href
        const nextStructure = JSON.stringify([
          input.filters,
          input.groupBy,
          input.customFilters.map((rule) => [rule.field, rule.operator, rule.value]),
          input.favoriteId,
        ])
        const typed = structure === nextStructure
        store.navigate(queryFromUrl(new URL(href, location.href)), typing && typed ? 'replace' : 'push')
        typing = typed
        structure = nextStructure
      },
    },
  )
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
    if (target?.closest('#pricing-list-retry')) {
      event.preventDefault()
      void store.load(true)
      return
    }
    const link = target?.closest<HTMLAnchorElement>('a[href]')
    if (!link || link.target || link.hasAttribute('download')) return
    const next = new URL(link.href),
      current = new URL(location.href)
    if (
      next.origin !== current.origin ||
      next.pathname !== LIST_PATH ||
      ['create', 'dialog'].some((key) => next.searchParams.has(key)) ||
      ['company', 'branch', 'lang'].some(
        (key) => next.searchParams.get(key) !== current.searchParams.get(key),
      )
    )
      return
    event.preventDefault()
    typing = false
    store.navigate(queryFromUrl(next))
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
  let stopSearch: (() => void) | undefined
  const controls: IslandController = {
    view: () => (
      <IslandRegion marker="pricing-list-controls">{ListChrome({ query: search.view() })}</IslandRegion>
    ),
    mount: (ctx) => {
      hold(ctx)
      const root = (ctx.root as unknown as HTMLElement).querySelector('[data-ui="search-filter"]')
      search.mount?.({ ...ctx, root: (root ?? ctx.root) as typeof ctx.root })
      let previous: Answer | null = null
      stopSearch = effect(() => {
        const answer = store.value()
        if (answer && answer !== previous) {
          previous = answer
          structure = configStructure(answer.search)
          search.update?.({ id: 'pricing-pricelist-filter', config: answer.search })
        }
      })
    },
    dispose: () => stopSearch?.(),
  }
  const results: IslandController = {
    view: () => {
      const answer = store.value(),
        phase = store.phase(),
        failed = ['failed', 'offline', 'denied'].includes(phase)
      return (
        <IslandRegion marker="pricing-list" busy={phase === 'loading'}>
          <Stack
            items={[
              failed ? (
                <Notice
                  tone="danger"
                  title={
                    props.labels[
                      phase === 'denied' ? 'denied' : phase === 'offline' ? 'offline' : 'loadError'
                    ]
                  }
                  message=""
                  actions={<Button id="pricing-list-retry" label={props.labels.retry} variant="secondary" />}
                />
              ) : null,
              failed && !answer ? null : (
                <KetTable
                  columns={['name', 'currency', 'state', 'sequence'].map((key) => ({
                    key,
                    label: props.labels[key],
                    priority: key === 'name' ? ('primary' as const) : undefined,
                    cell: (row: PricelistRow) =>
                      key === 'state' ? (
                        <Badge label={props.labels[row.state]} tone="neutral" />
                      ) : (
                        row[key as keyof typeof row]
                      ),
                    sortHref: answer?.sort[key]?.href,
                    sortDirection: answer?.sort[key]?.direction,
                  }))}
                  rows={answer?.rows ?? []}
                  groups={answer?.groups}
                  id={(row) => row.id}
                  rowHref={(row) => row.detailHref}
                  responsive="stack"
                  busy={store.dimmed()}
                  loading={!answer && !failed ? { rows: 10 } : undefined}
                  labels={{
                    ...props.labels,
                    ...(answer && !answer.isEmpty
                      ? { empty: props.labels.noMatches, emptyHint: props.labels.noMatchesHint }
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
          store.navigate(queryFromUrl(new URL(location.href)), 'none')
        },
        { signal: ctx.lifetime },
      )
      window.addEventListener('online', () => void store.load(true), { signal: ctx.lifetime })
      window.addEventListener('offline', () => void store.load(true), { signal: ctx.lifetime })
      void store.load()
    },
  }
  const footer: IslandController = {
    view: () => {
      const answer = store.value()
      return (
        <IslandRegion marker="pricing-list-footer">
          {answer && !answer.groups && !['failed', 'offline', 'denied'].includes(store.phase())
            ? ListChrome({
                pager: {
                  label: props.labels.title,
                  summary: range(answer),
                  previousHref: answer.previous,
                  nextHref: answer.next,
                  previousLabel: props.labels.previousPage,
                  nextLabel: props.labels.nextPage,
                },
              })
            : null}
        </IslandRegion>
      )
    },
    mount: hold,
  }
  return {
    controls,
    results,
    footer,
    dispose: () => {
      stopSearch?.()
      search.dispose?.()
      store.dispose()
    },
  }
}
const bundles = new Map<string, { bundle: ReturnType<typeof createBundle>; refs: number }>()
function bundle(props: Props) {
  if (typeof window === 'undefined') return createBundle(props)
  if (!bundles.has(props.key)) bundles.set(props.key, { bundle: createBundle(props), refs: 0 })
  return bundles.get(props.key)!.bundle
}
export const pricelistControls = (props: Props) => bundle(props).controls
export const pricelistResults = (props: Props) => bundle(props).results
export const pricelistFooter = (props: Props) => bundle(props).footer
