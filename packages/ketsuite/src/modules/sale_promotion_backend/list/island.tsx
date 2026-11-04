import { effect } from '@ketvietlab/ketjs-view'
import type { IslandController } from '@ketvietlab/ketjs-view'
import {
  Badge,
  Button,
  KetTable,
  LinkButton,
  ListChrome,
  Notice,
  Stack,
  Text,
  createSearchFilterView,
} from '@ketvietlab/design-system'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import { queryFromUrl } from './shared.ts'
type PromotionRow = Record<string, unknown> & { id: string; detailHref: string }
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
    { id: 'sale-promotion-filter', config: props.search },
    {
      apply: async (input, signal) => {
        if (signal.aborted) return
        const target = new URL(store.query().href, location.href)
        if (input.query) target.searchParams.set('q', input.query)
        else target.searchParams.delete('q')
        for (const key of ['programType', 'active', 'state']) target.searchParams.delete(key)
        const programType = [
          'promotion',
          'promo_code',
          'buy_x_get_y',
          'coupons',
          'next_order_coupons',
          'loyalty',
        ].find((type) => input.filters.includes(type))
        if (programType) target.searchParams.set('programType', programType)
        if (props.mode === 'cards') {
          const state = ['active', 'used', 'expired', 'cancelled'].find((value) =>
            input.filters.includes(value),
          )
          if (state) target.searchParams.set('state', state)
        }
        if (props.mode === 'programs') {
          if (input.filters.includes('archived')) target.searchParams.set('active', 'false')
          else if (input.filters.includes('active')) target.searchParams.set('active', 'true')
        }
        target.searchParams.delete('page')
        const href = target.pathname + target.search
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
    if (target?.closest('#sale-promotion-list-retry')) {
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
      next.pathname !== new URL(props.query.href, location.href).pathname ||
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
      <IslandRegion marker="sale-promotion-list-controls">
        {ListChrome({
          query: search.view(),
          // The export takes the list's own search and filters, every page of them.
          actions:
            props.mode === 'programs'
              ? LinkButton({
                  label: props.labels.exportCsv,
                  href: (() => {
                    const target = new URL(store.value()?.query.href ?? props.query.href, 'http://ket.local')
                    target.pathname += '/export'
                    target.searchParams.delete('page')
                    return target.pathname + target.search
                  })(),
                  variant: 'secondary',
                })
              : undefined,
        })}
      </IslandRegion>
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
          search.update?.({ id: 'sale-promotion-filter', config: answer.search })
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
        <IslandRegion marker="sale-promotion-list" busy={phase === 'loading'}>
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
                  actions={
                    <Button id="sale-promotion-list-retry" label={props.labels.retry} variant="secondary" />
                  }
                />
              ) : null,
              failed && !answer ? null : (
                <KetTable
                  columns={(props.mode === 'cards'
                    ? ['code', 'partnerName', 'balance', 'expiresOn', 'state']
                    : ['name', 'programType', 'code', 'reward', 'appliesUntil', 'usage', 'state']
                  ).map((key) => ({
                    key,
                    label: props.labels[key],
                    priority:
                      key === (props.mode === 'cards' ? 'code' : 'name') ? ('primary' as const) : undefined,
                    cell: (row: PromotionRow) =>
                      key === 'state' ? (
                        <Badge
                          label={props.labels[String(row.state)]}
                          tone={row.state === 'active' ? 'positive' : 'neutral'}
                        />
                      ) : (
                        String(row[key] ?? '')
                      ),
                    sortHref: answer?.sort[key]?.href,
                    sortDirection: answer?.sort[key]?.direction,
                  }))}
                  rows={answer?.rows ?? []}
                  groups={answer?.groups}
                  id={(row) => row.id}
                  rowHref={props.mode === 'programs' ? (row) => row.detailHref : undefined}
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
        <IslandRegion marker="sale-promotion-list-footer">
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
export const promotionControls = (props: Props) => bundle(props).controls
export const promotionResults = (props: Props) => bundle(props).results
export const promotionFooter = (props: Props) => bundle(props).footer
