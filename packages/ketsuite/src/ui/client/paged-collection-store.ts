import { batch, signal } from '@ketvietlab/ketjs-view'

export type CollectionQuery = {
  q: string
  state: string
  sort: string
  direction: 'asc' | 'desc'
  propertyId: string | null
  roomTypeId: string | null
  floorId: string | null
  from: string | null
  to: string | null
  page: number
  pageSize: number
}
export type CollectionPage = {
  query: CollectionQuery
  rows: Array<Record<string, unknown>>
  total: number
  page: number
  pages: number
  counts: { state: Record<string, number> }
  isEmpty: boolean
}
/** What the store itself reads of a query and an answer; a list with its own filters extends both. */
export type PagedQuery = { q: string; page: number; pageSize: number }
export type PagedAnswer<Q extends PagedQuery = PagedQuery> = {
  query: Q
  rows: Array<Record<string, unknown>>
  total: number
  page: number
  pages: number
  counts: unknown
}
export type CollectionPhase = 'loading' | 'ready' | 'failed' | 'offline' | 'denied'
export type CollectionBrowser = {
  href: () => string
  online: () => boolean
  fetch: typeof fetch
  push: (href: string) => void
  replace: (href: string) => void
}
type Options<Q extends PagedQuery, P extends PagedAnswer<Q>> = {
  source: string
  query: Q
  href: (query: Q) => string
  announce: (page: P) => string
  browser?: CollectionBrowser
}

/** Pure until mounted. SSR and first hydration show exactly the same loading page. */
const queryKey = (query: PagedQuery) =>
  JSON.stringify(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)))

export function createPagedCollectionStore<
  Q extends PagedQuery = CollectionQuery,
  P extends PagedAnswer<Q> = CollectionPage & PagedAnswer<Q>,
>(options: Options<Q, P>) {
  const query = signal<Q>(options.query)
  const value = signal<P | null>(null)
  const phase = signal<CollectionPhase>('loading')
  const dimmed = signal(false)
  const announcement = signal('')
  const currentRow = signal<string | null>(null)
  const cache = new Map<string, P>()
  let sequence = 0
  let controller: AbortController | null = null
  let dimTimer: ReturnType<typeof setTimeout> | null = null
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const clearDim = () => {
    if (dimTimer !== null) clearTimeout(dimTimer)
    dimTimer = null
    dimmed.set(false)
  }
  const cancelSearch = () => {
    if (searchTimer !== null) clearTimeout(searchTimer)
    searchTimer = null
  }
  const apply = (answer: P, requested: Q) => {
    batch(() => {
      query.set(answer.query)
      value.set(answer)
      phase.set('ready')
      announcement.set(options.announce(answer))
      clearDim()
    })
    if (queryKey(answer.query) !== queryKey(requested)) options.browser?.replace(options.href(answer.query))
  }
  const load = async (fresh = false) => {
    const browser = options.browser
    if (!browser || disposed) return
    const requested = query()
    const key = queryKey(requested)
    const read = ++sequence
    controller?.abort()
    controller = new AbortController()
    clearDim()
    if (!fresh && cache.has(key)) {
      const answer = cache.get(key)!
      cache.delete(key)
      cache.set(key, answer)
      apply(answer, requested)
      return
    }
    phase.set('loading')
    announcement.set('')
    if (value())
      dimTimer = setTimeout(() => {
        if (read === sequence) dimmed.set(true)
      }, 150)
    try {
      const response = await browser.fetch(options.source, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requested),
      })
      if (!response.ok) throw Object.assign(new Error('collection read failed'), { status: response.status })
      const reply = (await response.json()) as { ok?: boolean; value?: P }
      if (read !== sequence || disposed) return
      if (!response.ok || !reply.ok || !reply.value) {
        throw Object.assign(new Error('collection read failed'), { status: response.status })
      }
      const answer = reply.value
      if (
        !Array.isArray(answer.rows) ||
        answer.rows.length > 100 ||
        !Number.isSafeInteger(answer.total) ||
        answer.total < 0 ||
        !answer.query ||
        !answer.counts
      ) {
        throw new Error('invalid collection response')
      }
      cache.set(queryKey(answer.query), answer)
      if (cache.size > 20) cache.delete(cache.keys().next().value!)
      apply(answer, requested)
    } catch (error) {
      if (read !== sequence || disposed || controller.signal.aborted) return
      clearDim()
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : 0
      const next = status === 401 || status === 403 ? 'denied' : browser.online() ? 'failed' : 'offline'
      batch(() => {
        phase.set(next)
        announcement.set('')
        if (next === 'denied') {
          value.set(null)
          cache.clear()
        }
      })
    }
  }
  const navigate = (next: Q, history: 'push' | 'replace' | 'none' = 'push') => {
    cancelSearch()
    query.set(next)
    currentRow.set(null)
    if (history === 'push') options.browser?.push(options.href(next))
    if (history === 'replace') options.browser?.replace(options.href(next))
    void load()
  }
  const search = (text: string) => {
    const first = searchTimer === null
    cancelSearch()
    const next: Q = { ...query(), q: text, page: 1 }
    query.set(next)
    currentRow.set(null)
    if (first) options.browser?.push(options.href(next))
    else options.browser?.replace(options.href(next))
    // An answer from before the keystroke must not erase the draft while the debounce is pending.
    ++sequence
    controller?.abort()
    clearDim()
    searchTimer = setTimeout(() => {
      searchTimer = null
      void load()
    }, 250)
  }
  return {
    query,
    value,
    phase,
    dimmed,
    announcement,
    currentRow,
    load,
    navigate,
    search,
    searching: () => searchTimer !== null,
    retry: () => {
      cache.clear()
      void load(true)
    },
    invalidate: () => {
      ++sequence
      controller?.abort()
      cache.clear()
      void load(true)
    },
    dispose: () => {
      disposed = true
      ++sequence
      controller?.abort()
      cancelSearch()
      clearDim()
      cache.clear()
    },
  }
}
export type PagedStore<Q extends PagedQuery, P extends PagedAnswer<Q>> = ReturnType<
  typeof createPagedCollectionStore<Q, P>
>
export type PagedCollectionStore = PagedStore<CollectionQuery, CollectionPage>
