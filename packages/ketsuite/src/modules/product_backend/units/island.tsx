// The Units of measure list (`/admin/product/uoms`), as one client island over one paged
// read, `product_backend.searchUnits` (design system: "Collections are client islands").
//
// The server renders the frame and the loading state; the first client render is the same
// markup, so hydration adopts it, and the island then reads the first page. The query lives
// in the URL (`q`, `status`, `kind`, `page`, and `closed` for a folded family): following a
// status, a kind, a family header or the pager, or searching, is a `pushState` and one read,
// never a page load. Typing filters after a pause: the first pause pushes, later ones replace,
// so Back returns to the list as it was before the search. Recent answers are kept, so Back
// shows its page at once and reads it again behind it. A row opens the unit's record modal
// (`record=product.uom:<id>`), which the shell's record runtime owns; a save there announces
// `ket:records-changed`, and the list reads itself again and keeps the shell from re-fetching.
import { batch, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Badge,
  Button,
  EmptyState,
  Inline,
  KetTable,
  LinkButton,
  ListChrome,
  Menu,
  Notice,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import type { KetTableLabels } from '@ketvietlab/design-system'
import { UNIT_LIST_PATH } from '../units.ts'
import type { UnitAnswer, UnitRow } from '../units.ts'
import { IslandRegion, PoliteStatus } from '../../../ui/client/island-markup.tsx'

export { UNIT_LIST_PATH }

export type UnitListLabels = KetTableLabels & {
  search: string
  searchPlaceholder: string
  searchSubmit: string
  status: string
  active: string
  archived: string
  all: string
  kind: string
  kindAll: string
  kindReference: string
  kindDerived: string
  name: string
  conversion: string
  root: string
  products: string
  packagings: string
  state: string
  reference: string
  locked: string
  noMatch: string
  noMatchHint: string
  create: string
  pager: string
  clearFilters: string
  retryHint: string
  offline: string
  deniedTitle: string
  deniedMessage: string
  /** "{from}–{to} of {total} units", for the live region. */
  announce: string
  announceNone: string
}

export type UnitListProps = IslandProps & {
  /** The list's URL as the server rendered it. */
  href: string
  lang: string
  pageSize: number
  labels: UnitListLabels
  createHref?: string | null
}

/** The island's identity: a new URL from the shell is a new list. */
export const UNIT_LIST_KEY = ['href']

type Phase = 'loading' | 'ready' | 'failed' | 'offline' | 'denied'
type Kind = 'all' | 'reference' | 'derived'

/** How long typing pauses before the list filters. */
const TYPING_PAUSE = 250
/** A read slower than this dims the rows on screen. */
const DIM_AFTER = 150
/** How many recent answers Back can show at once. */
const CACHE_SIZE = 20
const RETRY_NAME = 'units-retry'

class FunctionError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

const fill = (text: string, values: Record<string, string>): string =>
  text.replace(/\{(\w+)\}/gu, (_, key: string) => values[key] ?? '')

const urlOf = (href: string): URL => new URL(href, 'https://units.invalid')
const pathOf = (url: URL): string => `${url.pathname}${url.search}`

/** The list's URL with these parameters changed; `null` removes one. A new query starts on page 1. */
export const unitHref = (href: string, changes: Record<string, string | string[] | null>): string => {
  const url = urlOf(href)
  for (const [key, value] of Object.entries(changes)) {
    url.searchParams.delete(key)
    for (const one of value === null ? [] : Array.isArray(value) ? value : [value])
      if (one !== '') url.searchParams.append(key, one)
  }
  if (!('page' in changes)) url.searchParams.delete('page')
  return pathOf(url)
}

const recordHref = (href: string, id: string): string => {
  const url = urlOf(href)
  url.searchParams.set('record', `product.uom:${id}`)
  return pathOf(url)
}

export const unitList = (props: UnitListProps): IslandController => {
  const labels = props.labels
  const number = new Intl.NumberFormat(props.lang === 'en' ? 'en-GB' : 'vi-VN', { maximumFractionDigits: 3 })
  const href = signal(props.href)
  const result = signal<UnitAnswer | null>(null)
  const phase = signal<Phase>('loading')
  const dimmed = signal(false)
  const cache = new Map<string, UnitAnswer>()
  let controller: AbortController | undefined
  let lifetime: AbortSignal | undefined
  let dimTimer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  /** The entry the reader's typing pushed: later pauses replace it, so Back skips them. */
  let typed = false

  const remember = (key: string, answer: UnitAnswer) => {
    cache.delete(key)
    cache.set(key, answer)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  }

  const load = async () => {
    controller?.abort()
    controller = new AbortController()
    const identity = ++sequence
    const asked = href()
    const url = urlOf(asked)
    const cached = cache.get(asked)
    batch(() => {
      if (cached) result.set(cached)
      phase.set('loading')
    })
    clearTimeout(dimTimer)
    // A cached page is on screen at once and read again behind it, undimmed.
    if (!cached) dimTimer = setTimeout(() => identity === sequence && dimmed.set(true), DIM_AFTER)
    try {
      const answer = await callFunction<UnitAnswer>(
        'product_backend.searchUnits',
        {
          q: url.searchParams.get('q') ?? '',
          status: url.searchParams.get('status') ?? 'active',
          kind: url.searchParams.get('kind') ?? 'all',
          page: Number(url.searchParams.get('page')) || 1,
          pageSize: props.pageSize,
        },
        controller.signal,
      )
      if (identity !== sequence || lifetime?.aborted) return
      remember(asked, answer)
      batch(() => {
        // A page past the end comes back clamped; the URL says so without a new entry.
        if (answer.page !== (Number(url.searchParams.get('page')) || 1)) {
          const corrected = unitHref(asked, { page: answer.page > 1 ? String(answer.page) : null })
          history.replaceState(history.state, '', corrected)
          href.set(corrected)
          remember(corrected, answer)
        }
        result.set(answer)
        dimmed.set(false)
        phase.set('ready')
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
    href.set(next)
    void load()
  }

  /** A query from typing: its first pause pushes, later ones replace that entry. */
  const search = (q: string) => {
    if (q === (urlOf(href()).searchParams.get('q') ?? '')) return
    navigate(unitHref(href(), { q: q || null }), typed ? 'replace' : 'push')
    typed = true
  }

  const facet = (status: 'active' | 'archived' | 'all', count?: number) => {
    const current = urlOf(href()).searchParams.get('status') ?? 'active'
    return {
      id: status,
      label: labels[status],
      href: unitHref(href(), { status: status === 'active' ? null : status }),
      active: current === status,
      ...(count === undefined ? {} : { count }),
    }
  }

  const kindLabel = (kind: Kind): string =>
    kind === 'reference' ? labels.kindReference : kind === 'derived' ? labels.kindDerived : labels.kindAll

  // A choice, not a toggle: a menu whose trigger names the kind in force.
  const kindMenu = (): JSXChild => {
    const asked = urlOf(href()).searchParams.get('kind')
    const current: Kind = asked === 'reference' || asked === 'derived' ? asked : 'all'
    return Menu({
      id: 'product-uom-kind',
      label: `${labels.kind}: ${kindLabel(current)}`,
      size: 'compact',
      selectionMode: 'single',
      count: current === 'all' ? 0 : 1,
      items: (['all', 'reference', 'derived'] as const).map((kind) => ({
        id: kind,
        label: kindLabel(kind),
        href: unitHref(href(), { kind: kind === 'all' ? null : kind }),
        checked: kind === current,
      })),
    })
  }

  const conversion = (row: UnitRow): string =>
    row.referenceId
      ? `1 ${row.name} = ${number.format(Number(row.factor))} ${row.reference ?? ''}`.trim()
      : labels.reference

  const table = (answer: UnitAnswer | null): JSXChild => {
    const closed = new Set(urlOf(href()).searchParams.getAll('closed'))
    const columns = [
      {
        key: 'name',
        label: labels.name,
        priority: 'primary' as const,
        width: 'medium' as const,
        cell: (row: UnitRow) =>
          row.locked
            ? Inline({
                gap: 'compact',
                blockAlign: 'center',
                items: [row.name, Badge({ label: labels.locked, tone: 'info', size: 'small' })],
              })
            : row.name,
      },
      { key: 'conversion', label: labels.conversion, cell: conversion },
      {
        key: 'root',
        label: labels.root,
        align: 'end' as const,
        kind: 'number' as const,
        priority: 'tertiary' as const,
        cell: (row: UnitRow) => (row.referenceId ? `${number.format(row.rootQuantity)} ${row.family}` : '—'),
      },
      {
        key: 'products',
        label: labels.products,
        align: 'end' as const,
        kind: 'number' as const,
        cell: (row: UnitRow) => number.format(row.products),
      },
      {
        key: 'packagings',
        label: labels.packagings,
        align: 'end' as const,
        kind: 'number' as const,
        priority: 'tertiary' as const,
        cell: (row: UnitRow) => number.format(row.packagings),
      },
      {
        key: 'state',
        label: labels.state,
        kind: 'status' as const,
        cell: (row: UnitRow) =>
          Badge({
            label: row.active ? labels.active : labels.archived,
            tone: row.active ? 'positive' : 'neutral',
            size: 'small',
          }),
      },
    ]
    if (!answer)
      return KetTable<UnitRow>({ columns, rows: [], id: (row) => row.id, loading: { rows: 6 }, labels })
    // Families stay together on the page; a family header folds its units away.
    const families = new Map<string, { label: string; rows: UnitRow[] }>()
    for (const row of answer.rows) {
      const family = families.get(row.familyId) ?? { label: row.family, rows: [] }
      family.rows.push(row)
      families.set(row.familyId, family)
    }
    return KetTable<UnitRow>({
      columns,
      rows: answer.rows,
      id: (row) => row.id,
      rowHref: (row) => recordHref(href(), row.id),
      busy: dimmed(),
      labels,
      groups: [...families].map(([id, family]) => {
        const open = !closed.has(id)
        return {
          id,
          label: family.label,
          count: family.rows.length,
          open,
          href: unitHref(href(), {
            closed: open ? [...closed, id] : [...closed].filter((one) => one !== id),
            page: urlOf(href()).searchParams.get('page'),
          }),
          rows: open ? family.rows : [],
        }
      }),
    })
  }

  const failure = (): JSXChild[] => {
    const kind = phase()
    if (kind !== 'failed' && kind !== 'offline') return []
    return [
      Notice({
        tone: kind === 'failed' ? 'danger' : 'warning',
        title: kind === 'failed' ? labels.loadError : labels.offline,
        message: labels.retryHint,
        actions: Button({ label: labels.retry, type: 'button', variant: 'secondary', name: RETRY_NAME }),
      }),
    ]
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
          actions: props.createHref
            ? LinkButton({ label: labels.create, href: props.createHref, variant: 'primary' })
            : undefined,
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
            href: unitHref(href(), { q: null, kind: null, status: null }),
            variant: 'secondary',
          }),
        }),
      ]
    return [table(answer)]
  }

  const announcement = (answer: UnitAnswer | null): string => {
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
    const counted = answer && (phase() === 'ready' || phase() === 'loading') ? answer.counts : null
    return (
      <IslandRegion marker="product-uom-list">
        {Stack({
          items: [
            ListChrome({
              search: {
                id: 'product-uom-search',
                action: UNIT_LIST_PATH,
                name: 'q',
                value: url.searchParams.get('q') ?? '',
                label: labels.search,
                placeholder: labels.searchPlaceholder,
                submitLabel: labels.searchSubmit,
                hidden: Object.fromEntries(
                  ['status', 'kind'].flatMap((key) => {
                    const value = url.searchParams.get(key)
                    return value ? [[key, value]] : []
                  }),
                ),
              },
              filtersLabel: labels.status,
              filterMenus: kindMenu(),
              facets: [
                facet('active', counted?.active),
                facet('archived', counted?.archived),
                facet('all', counted ? counted.active + counted.archived : undefined),
              ],
              ...(answer && answer.pages > 1
                ? {
                    pager: {
                      label: labels.pager,
                      summary: `${answer.page} / ${answer.pages}`,
                      previousHref:
                        answer.page > 1
                          ? unitHref(href(), { page: answer.page > 2 ? String(answer.page - 1) : null })
                          : null,
                      nextHref:
                        answer.page < answer.pages
                          ? unitHref(href(), { page: String(answer.page + 1) })
                          : null,
                      previousLabel: labels.previousPage,
                      nextLabel: labels.nextPage,
                    },
                  }
                : {}),
            }),
            // An empty item would still take a gap: absent parts are left out, not blank.
            ...failure(),
            ...body(),
          ],
        })}
        <PoliteStatus>{Text({ children: announcement(answer), visuallyHidden: true })}</PoliteStatus>
      </IslandRegion>
    )
  }

  return {
    view,
    mount: ({ root, lifetime: signal }) => {
      lifetime = signal
      const element = root as unknown as HTMLElement
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
          // A unit's record is the shell's record runtime to open; other pages are the shell's.
          if (
            next.origin !== location.origin ||
            next.pathname !== UNIT_LIST_PATH ||
            next.searchParams.has('record')
          )
            return
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
            new URL(field.form.action, location.href).pathname !== UNIT_LIST_PATH
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
          if (new URL(form.action, location.href).pathname !== UNIT_LIST_PATH) return
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
          if (next.pathname !== UNIT_LIST_PATH || next.searchParams.has('record')) return
          event.preventDefault()
          typed = false
          // Back from a record lands on the query already shown, or already being read after a save.
          const asked = pathOf(next)
          if (asked === href() && (phase() === 'ready' || phase() === 'loading')) return
          href.set(asked)
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
      // A saved unit: the list reads itself again, so the shell need not re-fetch the page.
      document.addEventListener(
        'ket:records-changed',
        (event) => {
          event.preventDefault()
          void load()
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
