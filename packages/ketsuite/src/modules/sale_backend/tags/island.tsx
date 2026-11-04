import type { IslandController } from '@ketvietlab/ketjs-view'
import { Badge, Button, KetTable, ListChrome, Notice, Stack, Text } from '@ketvietlab/design-system'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import { TAG_PATH, tagHref, tagQuery } from './shared.ts'
import type { TagAnswer, TagProps, TagQuery, TagRow } from './shared.ts'

function createBundle(props: TagProps) {
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
  const href = (q: TagQuery) => tagHref(q.href, { q: q.q || null, page: q.page > 1 ? String(q.page) : null })
  const range = (answer: TagAnswer) =>
    `${answer.total ? (answer.page - 1) * answer.query.pageSize + 1 : 0}–${Math.min(answer.total, answer.page * answer.query.pageSize)} / ${answer.total}`
  const store = createPagedCollectionStore<TagQuery, TagAnswer>({
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
    if (target?.closest('#sale-tag-retry')) {
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
      next.pathname !== TAG_PATH ||
      ['record', 'create', 'dialog'].some((key) => next.searchParams.has(key)) ||
      ['lang', 'company', 'branch'].some(
        (key) => next.searchParams.get(key) !== current.searchParams.get(key),
      )
    )
      return
    event.preventDefault()
    store.navigate(tagQuery(next))
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
  const controls: IslandController = {
    view: () => {
      const query = store.query(),
        url = new URL(href(query), 'http://ket.local'),
        answer = store.value()
      return (
        <IslandRegion marker="sale-tag-controls">
          {ListChrome({
            search: {
              id: 'sale-tag-search',
              action: TAG_PATH,
              name: 'q',
              value: query.q,
              label: labels.search!,
              placeholder: labels.search!,
              submitLabel: labels.searchSubmit!,
              hidden: Object.fromEntries(
                ['lang', 'company', 'branch', 'status', 'sort', 'dir'].flatMap((key) =>
                  url.searchParams.has(key) ? [[key, url.searchParams.get(key)!]] : [],
                ),
              ),
            },
            filtersLabel: labels.status,
            facets: ['active', 'archived', 'all'].map((key) => ({
              id: key,
              label: labels[key]!,
              href: tagHref(href(query), { status: key === 'active' ? null : key, page: null }),
              active: (url.searchParams.get('status') ?? 'active') === key,
              count: answer && !failed() ? answer.counts[key as keyof typeof answer.counts] : undefined,
            })),
          })}
        </IslandRegion>
      )
    },
    mount: (ctx) => {
      hold(ctx)
      const root = ctx.root as unknown as HTMLElement
      root.addEventListener(
        'input',
        (event) => {
          const input = event.target
          if (input instanceof HTMLInputElement && input.id === 'sale-tag-search') store.search(input.value)
        },
        { signal: ctx.lifetime },
      )
      root.addEventListener(
        'submit',
        (event) => {
          const form = event.target
          if (!(form instanceof HTMLFormElement) || !form.querySelector('#sale-tag-search')) return
          event.preventDefault()
          const next = tagHref(href(store.query()), {
            q: String(new FormData(form).get('q') ?? ''),
            page: null,
          })
          store.navigate(tagQuery(new URL(next, location.href)))
        },
        { signal: ctx.lifetime },
      )
    },
  }
  const results: IslandController = {
    view: () => {
      const answer = store.value(),
        query = store.query(),
        url = new URL(href(query), 'http://ket.local')
      return (
        <IslandRegion marker="sale-tag-results" busy={store.phase() === 'loading'}>
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
                  actions={<Button id="sale-tag-retry" label={labels.retry!} variant="secondary" />}
                />
              ) : null,
              failed() && !answer ? null : (
                <KetTable<TagRow>
                  columns={['name', 'orderCount'].map((key) => ({
                    key,
                    label: labels[key]!,
                    priority: key === 'name' ? ('primary' as const) : undefined,
                    cell: (row: TagRow) =>
                      key === 'name' ? (
                        row.active ? (
                          row.name
                        ) : (
                          <Stack items={[row.name, <Badge label={labels.archived!} />]} />
                        )
                      ) : key === 'orderCount' ? (
                        String(row.orderCount)
                      ) : (
                        String(row[key] || '—')
                      ),
                    ...(key === 'name' || key === 'orderCount'
                      ? {
                          sortHref: tagHref(href(query), {
                            sort: key === 'name' ? null : 'orders',
                            dir:
                              url.searchParams.get('sort') === (key === 'name' ? null : 'orders') &&
                              url.searchParams.get('dir') !== 'desc'
                                ? 'desc'
                                : null,
                            page: null,
                          }),
                          sortDirection:
                            (url.searchParams.get('sort') ?? 'name') === (key === 'name' ? 'name' : 'orders')
                              ? url.searchParams.get('dir') === 'desc'
                                ? ('desc' as const)
                                : ('asc' as const)
                              : undefined,
                        }
                      : {}),
                  }))}
                  rows={answer?.rows ?? []}
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
      window.addEventListener('popstate', () => store.navigate(tagQuery(new URL(location.href)), 'none'), {
        signal: ctx.lifetime,
      })
      window.addEventListener('online', () => store.retry(), { signal: ctx.lifetime })
      window.addEventListener('offline', () => store.retry(), { signal: ctx.lifetime })
      document.addEventListener(
        'ket:records-changed',
        (event) => {
          const detail = (event as CustomEvent).detail
          if (!detail?.kind || String(detail.kind).startsWith('sale.')) {
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
        <IslandRegion marker="sale-tag-footer">
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
const bundle = (props: TagProps) => {
  if (typeof window === 'undefined') return createBundle(props)
  if (!bundles.has(props.key)) bundles.set(props.key, { bundle: createBundle(props), refs: 0 })
  return bundles.get(props.key)!.bundle
}
export const tagControls = (props: TagProps) => bundle(props).controls
export const tagResults = (props: TagProps) => bundle(props).results
export const tagFooter = (props: TagProps) => bundle(props).footer
