import { effect, signal, type IslandController } from '@ketvietlab/ketjs-view'
import {
  createSearchFilterView,
  Badge,
  Button,
  Inline,
  KetTable,
  ListChrome,
  Notice,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'
import { createPagedCollectionStore } from '../../../ui/client/paged-collection-store.ts'
import { deliveryHref, deliveryQuery } from './shared.ts'
import type { DeliveryAnswer, DeliveryProps, DeliveryQuery, DeliveryRow } from './shared.ts'

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))

/**
 * K48: a shipping list — the delivery queue, the parcels, the carriers' statements or the carriers — read
 * page by page from its data route, searched and filtered, its rows opening their own page. A list with a
 * bulk step ticks rows and runs it on their ids: making draft parcels, or handing parcels over.
 */
function createBundle(props: DeliveryProps) {
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
  const href = (q: DeliveryQuery) =>
    deliveryHref(props.path, q.href, { q: q.q || null, page: q.page > 1 ? String(q.page) : null })
  const range = (answer: DeliveryAnswer) =>
    `${answer.total ? (answer.page - 1) * answer.query.pageSize + 1 : 0}–${Math.min(answer.total, answer.page * answer.query.pageSize)} / ${answer.total}`
  const store = createPagedCollectionStore<DeliveryQuery, DeliveryAnswer>({
    source: props.source,
    query: props.query,
    href,
    announce: range,
    browser,
  })
  const labels = props.labels
  const marker = `delivery-${props.list}`
  const form = `${marker}-bulk`
  const failed = () => ['failed', 'offline', 'denied'].includes(store.phase())
  const selection = signal<{ ids: string[]; anchor: string | null }>({ ids: [], anchor: null })
  const running = signal(false)
  const outcome = signal<{ tone: 'positive' | 'warning' | 'danger'; title: string; message: string } | null>(
    null,
  )
  const runBulk = async () => {
    const ids = selection().ids
    if (!props.bulk || !ids.length || running()) return
    running.set(true)
    outcome.set(null)
    try {
      const response = await fetch(
        `/_ket/fn/${props.bulk.fn}${new URL(props.source, location.href).search}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids }),
        },
      )
      const payload = await response.json().catch(() => null)
      const value = (payload?.value ?? payload) as {
        ok?: boolean
        done?: { name?: string }[]
        skipped?: { name?: string; reason?: string }[]
        errors?: { message?: string; messageKey?: string }[]
      } | null
      if (!response.ok || !value || value.ok === false) {
        outcome.set({
          tone: 'danger',
          title: labels.loadError!,
          message: String(value?.errors?.[0]?.message ?? ''),
        })
        return
      }
      const skipped = value.skipped ?? []
      outcome.set({
        tone: skipped.length ? 'warning' : 'positive',
        title: fill(props.bulk.done, { done: (value.done ?? []).length }),
        message: skipped.length
          ? fill(labels.bulkSkipped!, {
              count: skipped.length,
              items: skipped
                .map((row) => `${row.name ?? ''} (${labels[`skip.${row.reason}`] ?? row.reason})`)
                .join(', '),
            })
          : '',
      })
      selection.set({ ids: [], anchor: null })
      // The table's `checked` binding writes the attribute, which no longer drives a box the reader
      // ticked, and the reloaded rows keep their boxes: clear the live state too.
      const boxes = [...document.querySelectorAll<HTMLInputElement>(`input[form="${form}"]`)]
      const all = boxes[0]?.closest('table')?.querySelector<HTMLInputElement>('[data-ui="kt-select-all"]')
      for (const box of all ? [...boxes, all] : boxes) {
        box.checked = false
        box.indeterminate = false
      }
      store.invalidate()
    } finally {
      running.set(false)
    }
  }
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
    if (target?.closest(`#${marker}-retry`)) {
      event.preventDefault()
      store.retry()
      return
    }
    if (target?.closest(`#${marker}-run`)) {
      event.preventDefault()
      void runBulk()
      return
    }
    const link = target?.closest<HTMLAnchorElement>('a[href]')
    if (!link || link.target || link.hasAttribute('download')) return
    const next = new URL(link.href),
      current = new URL(location.href)
    if (
      next.origin !== current.origin ||
      next.pathname !== props.path ||
      ['record', 'create', 'dialog'].some((key) => next.searchParams.has(key)) ||
      ['lang', 'company', 'branch'].some(
        (key) => next.searchParams.get(key) !== current.searchParams.get(key),
      )
    )
      return
    event.preventDefault()
    store.navigate(deliveryQuery(props.path, next))
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
    { id: `${marker}-search`, config: props.search },
    {
      apply: async (input, signal) => {
        const response = await fetch(
          '/_ket/fn/stock_backend.applySearchFilter' + new URL(props.source, location.href).search,
          {
            method: 'POST',
            credentials: 'same-origin',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...input,
              listKey: `stock.delivery-${props.list}`,
              returnTo: href(store.query()),
            }),
          },
        )
        const payload = await response.json()
        if (!response.ok || payload.ok === false) throw new Error(labels.loadError)
        if (signal.aborted) return
        const nextShape = JSON.stringify([input.facets, input.groupBy, input.customFilters, input.favoriteId])
        store.navigate(
          deliveryQuery(props.path, new URL(payload.value?.href ?? payload.href, location.href)),
          typing && shape === nextShape ? 'replace' : 'push',
        )
        typing = true
        shape = nextShape
      },
    },
  )
  const controls: IslandController = {
    view: () => (
      <IslandRegion marker={`${marker}-controls`}>{ListChrome({ query: search.view() })}</IslandRegion>
    ),
    mount: (ctx) => {
      hold(ctx)
      const root = (ctx.root as unknown as HTMLElement).querySelector('[data-ui="search-filter"]')
      search.mount?.({ ...ctx, root: (root ?? ctx.root) as typeof ctx.root })
      const release = effect(() => {
        const answer = store.value()
        if (answer) search.update?.({ id: `${marker}-search`, config: answer.search })
      })
      ctx.lifetime.addEventListener('abort', release, { once: true })
    },
    dispose: () => search.dispose?.(),
  }
  const bulkBar = () => {
    if (!props.bulk) return null
    const count = selection().ids.length
    return (
      <Inline
        blockAlign="center"
        items={[
          <Text tone="muted">{fill(labels.selectionCount!, { n: count })}</Text>,
          <Button
            id={`${marker}-run`}
            label={props.bulk.label}
            variant="primary"
            disabled={!count || running()}
          />,
        ]}
      />
    )
  }
  const results: IslandController = {
    view: () => {
      const answer = store.value()
      const done = outcome()
      return (
        <IslandRegion marker={`${marker}-results`} busy={store.phase() === 'loading' || running()}>
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
                  actions={<Button id={`${marker}-retry`} label={labels.retry!} variant="secondary" />}
                />
              ) : null,
              done ? <Notice tone={done.tone} title={done.title} message={done.message} /> : null,
              answer && !answer.isEmpty ? bulkBar() : null,
              failed() && !answer ? null : (
                <KetTable<DeliveryRow>
                  columns={props.columns.map((column) => ({
                    key: column.key,
                    label: column.label,
                    ...(column.priority ? { priority: column.priority } : {}),
                    kind: column.kind ?? 'text',
                    cell: (row: DeliveryRow) =>
                      column.kind === 'status' ? (
                        <Badge label={row.statusText} tone={row.tone} />
                      ) : (
                        String(row[column.key] || '—')
                      ),
                    ...(column.sort && answer?.sorts[column.sort]
                      ? {
                          sortHref: answer.sorts[column.sort]!.href,
                          sortDirection: answer.sorts[column.sort]!.direction,
                        }
                      : {}),
                  }))}
                  rowHref={(row) => row.href}
                  rows={answer?.rows ?? []}
                  id={(row) => row.id}
                  responsive="stack"
                  busy={store.dimmed()}
                  loading={!answer && !failed() ? { rows: 8 } : undefined}
                  {...(props.bulk
                    ? {
                        selection: { formId: form, fieldName: 'selected' },
                        selectionState: {
                          ...selection(),
                          onChange: (ids: string[], anchorId: string | null) =>
                            selection.set({ ids, anchor: anchorId }),
                        },
                      }
                    : {})}
                  labels={{
                    ...labels,
                    ...(answer && !answer.isEmpty
                      ? { empty: labels.noMatches!, emptyHint: labels.noMatchesHint! }
                      : {}),
                  }}
                />
              ),
              <PoliteStatus>
                <Text visuallyHidden>{done ? `${done.title} ${done.message}` : store.announcement()}</Text>
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
          store.navigate(deliveryQuery(props.path, new URL(location.href)), 'none')
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
      // A row that left the page leaves the selection.
      const release = effect(() => {
        const ids = new Set((store.value()?.rows ?? []).map((row) => row.id))
        const held = selection()
        if (held.ids.some((id) => !ids.has(id)))
          selection.set({ ids: held.ids.filter((id) => ids.has(id)), anchor: held.anchor })
      })
      ctx.lifetime.addEventListener('abort', release, { once: true })
      void store.load()
    },
  }
  const footer: IslandController = {
    view: () => {
      const answer = store.value()
      return (
        <IslandRegion marker={`${marker}-footer`}>
          {answer && !failed() && !answer.isEmpty && answer.sumText ? (
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
const bundle = (props: DeliveryProps) => {
  if (typeof window === 'undefined') return createBundle(props)
  if (!bundles.has(props.key)) bundles.set(props.key, { bundle: createBundle(props), refs: 0 })
  return bundles.get(props.key)!.bundle
}
export const deliveryControls = (props: DeliveryProps) => bundle(props).controls
export const deliveryResults = (props: DeliveryProps) => bundle(props).results
export const deliveryFooter = (props: DeliveryProps) => bundle(props).footer
