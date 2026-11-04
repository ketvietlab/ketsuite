import type { IslandController } from '@ketvietlab/ketjs-view'
import { Badge, Button, KetTable, ListChrome, Notice, Stack, Text } from '@ketvietlab/design-system'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import { POLICY_PATH, POLICY_SETTINGS, policyHref, policyQuery } from './shared.ts'
import type { PolicyAnswer, PolicyProps, PolicyQuery, PolicyRow } from './shared.ts'

function createBundle(props: PolicyProps) {
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
  const href = (q: PolicyQuery) =>
    policyHref(q.href, { q: q.q || null, page: q.page > 1 ? String(q.page) : null })
  const range = (answer: PolicyAnswer) =>
    `${answer.total ? (answer.page - 1) * answer.query.pageSize + 1 : 0}–${Math.min(answer.total, answer.page * answer.query.pageSize)} / ${answer.total}`
  const store = createPagedCollectionStore<PolicyQuery, PolicyAnswer>({
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
    if (target?.closest('#sale-policy-retry')) {
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
      next.pathname !== POLICY_PATH ||
      ['record', 'create', 'dialog'].some((key) => next.searchParams.has(key)) ||
      ['lang', 'company', 'branch'].some(
        (key) => next.searchParams.get(key) !== current.searchParams.get(key),
      )
    )
      return
    event.preventDefault()
    store.navigate(policyQuery(next))
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
        <IslandRegion marker="sale-policy-controls">
          {ListChrome({
            search: {
              id: 'sale-policy-search',
              action: POLICY_PATH,
              name: 'q',
              value: query.q,
              label: labels.search!,
              placeholder: labels.search!,
              submitLabel: labels.searchSubmit!,
              hidden: Object.fromEntries(
                ['lang', 'company', 'branch', 'setting', 'dir'].flatMap((key) =>
                  url.searchParams.has(key) ? [[key, url.searchParams.get(key)!]] : [],
                ),
              ),
            },
            filtersLabel: labels.setting,
            facets: (['all', ...POLICY_SETTINGS] as const).map((key) => ({
              id: key,
              label: labels[`setting.${key}`]!,
              href: policyHref(href(query), { setting: key === 'all' ? null : key, page: null }),
              active: (url.searchParams.get('setting') ?? 'all') === key,
              count: answer && !failed() ? answer.counts[key] : undefined,
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
          if (input instanceof HTMLInputElement && input.id === 'sale-policy-search')
            store.search(input.value)
        },
        { signal: ctx.lifetime },
      )
      root.addEventListener(
        'submit',
        (event) => {
          const form = event.target
          if (!(form instanceof HTMLFormElement) || !form.querySelector('#sale-policy-search')) return
          event.preventDefault()
          const next = policyHref(href(store.query()), {
            q: String(new FormData(form).get('q') ?? ''),
            page: null,
          })
          store.navigate(policyQuery(new URL(next, location.href)))
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
        <IslandRegion marker="sale-policy-results" busy={store.phase() === 'loading'}>
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
                  actions={<Button id="sale-policy-retry" label={labels.retry!} variant="secondary" />}
                />
              ) : null,
              failed() && !answer ? null : (
                <KetTable<PolicyRow>
                  columns={['defaultCode', 'name', 'categoryName', 'type', 'policy', 'setting'].map(
                    (key) => ({
                      key,
                      label: labels[key]!,
                      priority: key === 'name' ? ('primary' as const) : undefined,
                      ...(key === 'defaultCode' ? { kind: 'identifier' as const } : {}),
                      ...(key === 'setting' ? { kind: 'status' as const } : {}),
                      cell: (row: PolicyRow) =>
                        key === 'type' ? (
                          labels[`type.${row.type === 'goods' ? 'goods' : 'service'}`]!
                        ) : key === 'policy' ? (
                          labels[`policy.${row.policy}`]!
                        ) : key === 'setting' ? (
                          <Badge
                            label={labels[`setting.${row.setting}`]!}
                            tone={row.setting === 'own' ? 'info' : 'neutral'}
                          />
                        ) : (
                          String(row[key] ?? '') || '—'
                        ),
                      ...(key === 'defaultCode'
                        ? {
                            sortHref: policyHref(href(query), {
                              dir: url.searchParams.get('dir') === 'desc' ? null : 'desc',
                              page: null,
                            }),
                            sortDirection:
                              url.searchParams.get('dir') === 'desc' ? ('desc' as const) : ('asc' as const),
                          }
                        : {}),
                    }),
                  )}
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
      window.addEventListener('popstate', () => store.navigate(policyQuery(new URL(location.href)), 'none'), {
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
        <IslandRegion marker="sale-policy-footer">
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
const bundle = (props: PolicyProps) => {
  if (typeof window === 'undefined') return createBundle(props)
  if (!bundles.has(props.key)) bundles.set(props.key, { bundle: createBundle(props), refs: 0 })
  return bundles.get(props.key)!.bundle
}
export const policyControls = (props: PolicyProps) => bundle(props).controls
export const policyResults = (props: PolicyProps) => bundle(props).results
export const policyFooter = (props: PolicyProps) => bundle(props).footer
