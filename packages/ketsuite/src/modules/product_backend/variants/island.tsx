import { savedFilterMenu } from '../filters/menu.tsx'
// The Variants list (`/admin/product/variants`), as one client island over one paged read:
// `stock_backend.searchProductVariants` where stock answers, `product_backend.searchVariants`
// otherwise (design system: "Collections are client islands").
//
// The server renders the frame and the loading state; the first client render is the same
// markup, so hydration adopts it, and the island then reads the first page. The query lives
// in the URL (`q`, `type`, `category`, `status`, `sort`, `dir`, `page`): following a facet, a
// menu choice, a sort header or the pager, or searching, is a `pushState` and one read, never
// a page load. Typing filters after a pause: the first pause pushes, later ones replace, so
// Back returns to the list as it was before the search. Recent answers are kept, so Back shows
// its page at once and reads it again behind it. A row opens the page of the product the SKU
// belongs to, with a way back that names the row.
import { batch, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Badge,
  Button,
  EmptyState,
  KetTable,
  LinkButton,
  ListChrome,
  Menu,
  Notice,
  Stack,
  Text,
  rememberRowAnchor,
  restoreRowAnchor,
  rowAnchorHref,
  takeRowAnchor,
} from '@ketvietlab/design-system'
import type { KetTableLabels } from '@ketvietlab/design-system'
import { VARIANT_LIST_PATH } from './shape.ts'
import type { VariantAnswer, VariantRow } from './shape.ts'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'

export { VARIANT_LIST_PATH }

const TEMPLATE_PATH = '/admin/product/templates'

export type VariantListLabels = KetTableLabels & {
  use?: string
  useAll?: string
  useSale?: string
  usePurchase?: string
  useNotSold?: string
  useTracked?: string
  exportCsv?: string
  search: string
  searchPlaceholder: string
  searchSubmit: string
  status: string
  active: string
  archived: string
  all: string
  type: string
  typeAll: string
  goods: string
  service: string
  combo?: string
  tag: string
  tagAll: string
  category: string
  categoryAll: string
  code: string
  name: string
  barcode: string
  price: string
  cost: string
  onHand: string
  available: string
  sortAsc: string
  sortDesc: string
  noMatch: string
  noMatchHint: string
  goTemplates: string
  pager: string
  clearFilters: string
  retryHint: string
  offline: string
  deniedTitle: string
  deniedMessage: string
  missingRow: string
  /** "{from}–{to} of {total} variants", for the live region. */
  announce: string
  announceNone: string
}

export type VariantListProps = IslandProps & {
  /** The list's URL as the server rendered it. */
  href: string
  lang: string
  pageSize: number
  /** The read behind the list: stock's where the viewer may read it, the catalogue's otherwise. */
  read: string
  labels: VariantListLabels
}

/** The island's identity: a new URL from the shell is a new list. */
export const VARIANT_LIST_KEY = ['href']

type Phase = 'loading' | 'ready' | 'failed' | 'offline' | 'denied'

/** How long typing pauses before the list filters. */
const TYPING_PAUSE = 250
/** A read slower than this dims the rows on screen. */
const DIM_AFTER = 150
/** How many recent answers Back can show at once. */
const CACHE_SIZE = 20
const RETRY_NAME = 'variants-retry'
const QUERY_KEYS = ['use', 'q', 'type', 'category', 'tag', 'status', 'sort', 'dir'] as const

class FunctionError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

const fill = (text: string, values: Record<string, string>): string =>
  text.replace(/\{(\w+)\}/gu, (_, key: string) => values[key] ?? '')

const urlOf = (href: string): URL => new URL(href, 'https://variants.invalid')
const pathOf = (url: URL): string => `${url.pathname}${url.search}`

/** The list's URL with these parameters changed; `null` removes one. A new query starts on page 1. */
export const variantHref = (href: string, changes: Record<string, string | null>): string => {
  const url = urlOf(href)
  for (const [key, value] of Object.entries(changes)) {
    url.searchParams.delete(key)
    if (value !== null && value !== '') url.searchParams.set(key, value)
  }
  if (!('page' in changes)) url.searchParams.delete('page')
  return pathOf(url)
}

/** The read's input, from the list's URL. */
export const variantInput = (href: string, pageSize: number) => {
  const url = urlOf(href)
  return {
    q: url.searchParams.get('q') ?? '',
    use: url.searchParams.get('use') ?? 'all',
    type: url.searchParams.get('type') ?? 'all',
    tagId: url.searchParams.get('tag') ?? '',
    categoryId: url.searchParams.get('category') ?? '',
    status: url.searchParams.get('status') ?? 'active',
    sort: url.searchParams.get('sort') ?? 'name',
    dir: url.searchParams.get('dir') ?? 'asc',
    page: Number(url.searchParams.get('page')) || 1,
    pageSize,
  }
}

export const variantList = (props: VariantListProps): IslandController => {
  const labels = props.labels
  const locale = props.lang === 'en' ? 'en-GB' : 'vi-VN'
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'VND' })
  const href = signal(props.href)
  const result = signal<VariantAnswer | null>(null)
  const phase = signal<Phase>('loading')
  const dimmed = signal(false)
  const currentRow = signal<string | undefined>(undefined)
  const missingRow = signal(false)
  const cache = new Map<string, VariantAnswer>()
  let controller: AbortController | undefined
  let lifetime: AbortSignal | undefined
  let root: HTMLElement | undefined
  let anchor: ReturnType<typeof takeRowAnchor> = null
  let dimTimer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  /** The entry the reader's typing pushed: later pauses replace it, so Back skips them. */
  let typed = false

  const remember = (key: string, answer: VariantAnswer) => {
    cache.delete(key)
    cache.set(key, answer)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  }

  const load = async () => {
    controller?.abort()
    controller = new AbortController()
    const identity = ++sequence
    const asked = href()
    const cached = cache.get(asked)
    batch(() => {
      if (cached) result.set(cached)
      phase.set('loading')
    })
    clearTimeout(dimTimer)
    // A cached page is on screen at once and read again behind it, undimmed.
    if (!cached) dimTimer = setTimeout(() => identity === sequence && dimmed.set(true), DIM_AFTER)
    try {
      const input = variantInput(asked, props.pageSize)
      const answer = await callFunction<VariantAnswer>(props.read, input, controller.signal)
      if (identity !== sequence || lifetime?.aborted) return
      remember(asked, answer)
      batch(() => {
        // A page past the end comes back clamped; the URL says so without a new entry.
        if (answer.page !== input.page) {
          const corrected = variantHref(asked, { page: answer.page > 1 ? String(answer.page) : null })
          history.replaceState(history.state, '', corrected)
          href.set(corrected)
          remember(corrected, answer)
        }
        result.set(answer)
        dimmed.set(false)
        phase.set('ready')
      })
      if (anchor && root)
        requestAnimationFrame(() => {
          if (anchor && root) missingRow.set(!restoreRowAnchor(root, anchor))
          anchor = null
        })
    } catch (error) {
      if (controller.signal.aborted || identity !== sequence || lifetime?.aborted) return
      batch(() => {
        dimmed.set(false)
        phase.set(
          error instanceof FunctionError && error.status === 403
            ? 'denied'
            : typeof navigator !== 'undefined' && navigator.onLine === false
              ? 'offline'
              : 'failed',
        )
      })
    } finally {
      if (identity === sequence) clearTimeout(dimTimer)
    }
  }

  const navigate = (next: string, mode: 'push' | 'replace' = 'push') => {
    if (mode === 'replace') history.replaceState(history.state, '', next)
    else history.pushState(history.state, '', next)
    batch(() => {
      href.set(next)
      currentRow.set(undefined)
      missingRow.set(false)
    })
    anchor = null
    void load()
  }

  /** A query from typing: its first pause pushes, later ones replace that entry. */
  const search = (q: string) => {
    if (q === (urlOf(href()).searchParams.get('q') ?? '')) return
    navigate(variantHref(href(), { q: q || null }), typed ? 'replace' : 'push')
    typed = true
  }

  const facet = (status: 'active' | 'archived' | 'all', count?: number) => {
    const current = urlOf(href()).searchParams.get('status') ?? 'active'
    return {
      id: status,
      label: labels[status],
      href: variantHref(href(), { status: status === 'active' ? null : status }),
      active: current === status,
      ...(count === undefined ? {} : { count }),
    }
  }

  // A choice, not a toggle: each menu's trigger names the value in force.
  const typeMenu = (answer: VariantAnswer | null): JSXChild => {
    const asked = urlOf(href()).searchParams.get('type')
    const current = asked === 'goods' || asked === 'service' || asked === 'combo' ? asked : 'all'
    const name = (type: 'all' | 'goods' | 'service' | 'combo') =>
      type === 'goods'
        ? labels.goods
        : type === 'service'
          ? labels.service
          : type === 'combo'
            ? (labels.combo ?? 'Combo')
            : labels.typeAll
    return Menu({
      id: 'product-variants-type',
      label: `${labels.type}: ${name(current)}`,
      size: 'compact',
      selectionMode: 'single',
      count: current === 'all' ? 0 : 1,
      items: (['all', 'goods', 'service', 'combo'] as const).map((type) => ({
        id: type,
        label:
          type === 'all' || !answer
            ? name(type)
            : `${name(type)} (${number.format(answer.counts[type] ?? 0)})`,
        href: variantHref(href(), { type: type === 'all' ? null : type }),
        checked: type === current,
      })),
    })
  }

  const useMenu = (): JSXChild => {
    const current = urlOf(href()).searchParams.get('use') ?? 'all'
    const names: Record<string, string> = {
      all: labels.useAll ?? labels.all,
      sale: labels.useSale ?? 'Can be sold',
      purchase: labels.usePurchase ?? 'Can be purchased',
      notSold: labels.useNotSold ?? 'Not sold',
      tracked: labels.useTracked ?? 'Tracked by lot',
    }
    return Menu({
      id: 'product-variants-use',
      label: `${labels.use ?? 'Use'}: ${names[current] ?? names.all}`,
      size: 'compact',
      selectionMode: 'single',
      items: Object.entries(names).map(([id, label]) => ({
        id,
        label,
        href: variantHref(href(), { use: id === 'all' ? null : id, page: null }),
        checked: current === id,
      })),
    })
  }
  const categoryMenu = (answer: VariantAnswer | null): JSXChild => {
    const current = urlOf(href()).searchParams.get('category') ?? ''
    const choices = answer?.categories ?? []
    if (!choices.length && !current) return null
    const chosen = choices.find((choice) => choice.id === current)
    return Menu({
      id: 'product-variants-category',
      label: `${labels.category}: ${chosen?.name ?? labels.categoryAll}`,
      size: 'compact',
      selectionMode: 'single',
      count: current ? 1 : 0,
      items: [
        {
          id: 'all',
          label: labels.categoryAll,
          href: variantHref(href(), { category: null }),
          checked: !current,
        },
        ...choices.map((choice) => ({
          id: choice.id,
          label: choice.name,
          href: variantHref(href(), { category: choice.id }),
          checked: choice.id === current,
        })),
      ],
    })
  }

  const tagMenu = (answer: VariantAnswer | null): JSXChild => {
    const current = urlOf(href()).searchParams.get('tag') ?? ''
    const choices = answer?.tags ?? []
    if (!choices.length && !current) return null
    const chosen = choices.find((choice) => choice.id === current)
    return Menu({
      id: 'product-variants-tag',
      label: `${labels.tag}: ${chosen?.name ?? labels.tagAll}`,
      size: 'compact',
      selectionMode: 'single',
      count: current ? 1 : 0,
      items: [
        {
          id: 'all',
          label: labels.tagAll,
          href: variantHref(href(), { tag: null }),
          checked: !current,
        },
        ...choices.map((choice) => ({
          id: choice.id,
          label: choice.name,
          href: variantHref(href(), { tag: choice.id }),
          checked: choice.id === current,
        })),
      ],
    })
  }

  const recordHref = (row: VariantRow): string => {
    const url = new URL(`${TEMPLATE_PATH}/${encodeURIComponent(row.templateId)}`, 'http://ket.local')
    if (props.lang === 'en') url.searchParams.set('lang', 'en')
    // The page's way back names this row, so the list returns to it.
    url.searchParams.set('returnTo', rowAnchorHref(href(), row.id))
    return `${url.pathname}${url.search}`
  }

  const sortable = (key: 'code' | 'name', label: string) => {
    const url = urlOf(href())
    const sort = url.searchParams.get('sort') === 'code' ? 'code' : 'name'
    const dir: 'asc' | 'desc' = url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
    const direction: 'asc' | 'desc' | null = sort === key ? dir : null
    const next: 'asc' | 'desc' = direction === 'asc' ? 'desc' : 'asc'
    return {
      sortHref: variantHref(href(), {
        sort: key === 'name' ? null : key,
        dir: next === 'asc' ? null : next,
      }),
      sortDirection: direction,
      // The header's name says what following it does.
      sortLabel: fill(next === 'desc' ? labels.sortDesc : labels.sortAsc, { column: label }),
    }
  }

  const amount = (value: string | null): JSXChild =>
    value === null ? '—' : Text({ children: money.format(Number(value)), variant: 'bodyMd', numeric: true })
  const quantity = (value: number | null): string => (value === null ? '—' : number.format(value))

  const table = (answer: VariantAnswer | null): JSXChild => {
    const columns = [
      {
        key: 'name',
        label: labels.name,
        priority: 'primary' as const,
        width: 'wide' as const,
        wrap: true,
        ...sortable('name', labels.name),
        // The values tell a variant from its siblings; only a variant not selling is badged,
        // since the status facet already says which rows are shown.
        cell: (row: VariantRow) =>
          row.values || !row.active
            ? Stack({
                gap: 'none',
                items: [
                  row.name,
                  ...(row.values ? [Text({ children: row.values, variant: 'bodySm', tone: 'muted' })] : []),
                  ...(row.active ? [] : [Badge({ label: labels.archived, tone: 'neutral', size: 'small' })]),
                ],
              })
            : row.name,
      },
      {
        key: 'code',
        label: labels.code,
        kind: 'identifier' as const,
        ...sortable('code', labels.code),
        cell: (row: VariantRow) => row.code ?? '—',
      },
      {
        key: 'barcode',
        label: labels.barcode,
        kind: 'identifier' as const,
        priority: 'tertiary' as const,
        cell: (row: VariantRow) => row.barcode ?? '—',
      },
      {
        key: 'price',
        label: labels.price,
        align: 'end' as const,
        kind: 'currency' as const,
        cell: (row: VariantRow) => amount(row.price),
      },
      ...(answer?.money
        ? [
            {
              key: 'cost',
              label: labels.cost,
              align: 'end' as const,
              kind: 'currency' as const,
              priority: 'secondary' as const,
              cell: (row: VariantRow) => amount(row.cost),
            },
          ]
        : []),
      ...(answer?.stock
        ? [
            {
              key: 'onHand',
              label: labels.onHand,
              align: 'end' as const,
              kind: 'number' as const,
              priority: 'secondary' as const,
              cell: (row: VariantRow) => quantity(row.onHand),
            },
            {
              key: 'available',
              label: labels.available,
              align: 'end' as const,
              kind: 'number' as const,
              cell: (row: VariantRow) => quantity(row.available),
            },
          ]
        : []),
    ]
    if (!answer)
      return KetTable<VariantRow>({ columns, rows: [], id: (row) => row.id, loading: { rows: 6 }, labels })
    return KetTable<VariantRow>({
      columns,
      rows: answer.rows,
      id: (row) => row.id,
      rowHref: recordHref,
      rowName: (row) => [row.name, row.values].filter(Boolean).join(' · '),
      currentRow: currentRow(),
      busy: dimmed(),
      labels,
      layout: 'fixed',
      responsive: 'stack',
    })
  }

  const notices = (): JSXChild[] => {
    const kind = phase()
    const shown: JSXChild[] = []
    if (kind === 'failed' || kind === 'offline')
      shown.push(
        Notice({
          tone: kind === 'failed' ? 'danger' : 'warning',
          title: kind === 'failed' ? labels.loadError : labels.offline,
          message: labels.retryHint,
          actions: Button({ label: labels.retry, type: 'button', variant: 'secondary', name: RETRY_NAME }),
        }),
      )
    if (missingRow()) shown.push(Notice({ tone: 'info', title: labels.missingRow, message: '' }))
    return shown
  }

  const body = (): JSXChild[] => {
    const answer = result()
    // A refused read says so in the list's place, not in a notice above it.
    if (phase() === 'denied')
      return [EmptyState({ visual: 'locked', title: labels.deniedTitle, message: labels.deniedMessage })]
    if (!answer && phase() !== 'loading') return []
    if (answer?.isEmpty)
      return [
        EmptyState({
          visual: 'start',
          title: labels.empty,
          message: labels.emptyHint,
          actions: LinkButton({ label: labels.goTemplates, href: TEMPLATE_PATH, variant: 'secondary' }),
        }),
      ]
    if (answer && answer.total === 0)
      return [
        EmptyState({
          visual: 'search',
          title: labels.noMatch,
          message: labels.noMatchHint,
          actions: LinkButton({
            label: labels.clearFilters,
            href: variantHref(href(), { q: null, type: null, category: null, tag: null, status: null }),
            variant: 'secondary',
          }),
        }),
      ]
    return [table(answer)]
  }

  const announcement = (answer: VariantAnswer | null): string => {
    if (!answer || phase() !== 'ready') return ''
    if (!answer.total) return labels.announceNone
    const from = (answer.page - 1) * answer.query.pageSize + 1
    const to = Math.min(answer.page * answer.query.pageSize, answer.total)
    return fill(labels.announce, {
      from: number.format(from),
      to: number.format(to),
      total: number.format(answer.total),
    })
  }

  const view = (): TemplateResult => {
    const url = urlOf(href())
    const answer = phase() === 'denied' ? null : result()
    // After a failure the figures are not known; a stale count would read as current.
    const counted = answer && (phase() === 'ready' || phase() === 'loading') ? answer : null
    return (
      <IslandRegion marker="product-variant-list">
        {Stack({
          items: [
            ListChrome({
              actions: labels.exportCsv
                ? LinkButton({
                    label: labels.exportCsv,
                    href: (() => {
                      const target = urlOf(href())
                      target.pathname = '/admin/product/variants/export'
                      return pathOf(target)
                    })(),
                    variant: 'secondary',
                  })
                : null,
              search: {
                id: 'product-variants-search',
                action: VARIANT_LIST_PATH,
                name: 'q',
                value: url.searchParams.get('q') ?? '',
                label: labels.search,
                placeholder: labels.searchPlaceholder,
                submitLabel: labels.searchSubmit,
                hidden: Object.fromEntries(
                  QUERY_KEYS.filter((key) => key !== 'q').flatMap((key) => {
                    const value = url.searchParams.get(key)
                    return value ? [[key, value]] : []
                  }),
                ),
              },
              filtersLabel: labels.status,
              filterMenus: [
                typeMenu(counted),
                categoryMenu(counted),
                tagMenu(counted),
                useMenu(),
                savedFilterMenu(href(), counted?.favorites ?? [], props.lang),
              ],
              facets: [
                facet('active', counted?.counts.active),
                facet('archived', counted?.counts.archived),
                facet('all', counted ? counted.counts.active + counted.counts.archived : undefined),
              ],
              ...(answer && answer.pages > 1
                ? {
                    pager: {
                      label: labels.pager,
                      summary: `${answer.page} / ${answer.pages}`,
                      previousHref:
                        answer.page > 1
                          ? variantHref(href(), { page: answer.page > 2 ? String(answer.page - 1) : null })
                          : null,
                      nextHref:
                        answer.page < answer.pages
                          ? variantHref(href(), { page: String(answer.page + 1) })
                          : null,
                      previousLabel: labels.previousPage,
                      nextLabel: labels.nextPage,
                    },
                  }
                : {}),
            }),
            // An empty item would still take a gap: absent parts are left out, not blank.
            ...notices(),
            ...body(),
          ],
        })}
        <PoliteStatus>{Text({ children: announcement(answer), visuallyHidden: true })}</PoliteStatus>
      </IslandRegion>
    )
  }

  return {
    view,
    mount: ({ root: host, lifetime: signal }) => {
      lifetime = signal
      root = host as unknown as HTMLElement
      anchor = takeRowAnchor()
      currentRow.set(anchor?.id)
      const element = root
      element.addEventListener(
        'click',
        (event) => {
          const target = event.target as Element
          if (target.closest(`[name="${RETRY_NAME}"]`)) {
            event.preventDefault()
            void load()
            return
          }
          const link = target.closest<HTMLAnchorElement>('a[href]')
          const mouse = event as MouseEvent
          if (!link || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey || mouse.button !== 0)
            return
          const next = new URL(link.href, location.href)
          if (next.origin !== location.origin) return
          // A row opens its product's page, which is the shell's to load; it remembers the row.
          if (next.pathname.startsWith(`${TEMPLATE_PATH}/`)) {
            rememberRowAnchor(link)
            return
          }
          if (next.pathname !== VARIANT_LIST_PATH || next.searchParams.has('record')) return
          // preventDefault alone keeps the shell away; the click still reaches open popups.
          event.preventDefault()
          typed = false
          navigate(pathOf(next))
        },
        { signal },
      )
      // Typing filters after a pause; the text stays in the field, the URL follows it.
      let typing: ReturnType<typeof setTimeout> | undefined
      signal.addEventListener('abort', () => clearTimeout(typing))
      element.addEventListener(
        'input',
        (event) => {
          const field = event.target as HTMLInputElement
          if (
            field.name !== 'q' ||
            !field.form ||
            new URL(field.form.action, location.href).pathname !== VARIANT_LIST_PATH
          )
            return
          clearTimeout(typing)
          typing = setTimeout(() => search(field.value.trim()), TYPING_PAUSE)
        },
        { signal },
      )
      element.addEventListener(
        'submit',
        (event) => {
          const form = event.target as HTMLFormElement
          if (new URL(form.action, location.href).pathname !== VARIANT_LIST_PATH) return
          event.preventDefault()
          clearTimeout(typing)
          search(String(new FormData(form).get('q') ?? '').trim())
        },
        { signal },
      )
      document.addEventListener(
        'ket:popstate',
        (event) => {
          const next = new URL(location.href)
          if (next.pathname !== VARIANT_LIST_PATH || next.searchParams.has('record')) return
          event.preventDefault()
          typed = false
          const asked = pathOf(next)
          if (asked === href() && (phase() === 'ready' || phase() === 'loading')) return
          href.set(asked)
          void load()
        },
        { signal },
      )
      document.addEventListener(
        'ket:records-changed',
        (event) => {
          event.preventDefault()
          cache.clear()
          void load()
        },
        { signal },
      )
      window.addEventListener(
        'online',
        () => {
          if (phase() === 'offline') void load()
        },
        { signal },
      )
      void load()
    },
  }
}

const callFunction = async <T,>(name: string, input: unknown, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; value?: T }
  if (!response.ok || payload.ok === false) throw new FunctionError(response.status)
  return (payload.value ?? payload) as T
}
