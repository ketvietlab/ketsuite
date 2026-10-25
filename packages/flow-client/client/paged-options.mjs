import { signal } from '@ketvietlab/ketjs-view'

/** Search a bounded server window; never filter only a truncated local catalog. */
export function createPagedOptions({ scope, read, accept = () => {}, refused = () => {}, delay = 180 }) {
  const empty = () => ({
    open: false,
    query: '',
    items: [],
    total: 0,
    cursor: null,
    loading: false,
    error: null,
  })
  const state = signal(empty())
  let controller,
    timer,
    ticket = 0
  const cancel = () => {
    clearTimeout(timer)
    controller?.abort()
    ticket++
  }
  const close = () => {
    cancel()
    state.set(empty())
  }
  const load = async (more = false) => {
    cancel()
    const held = state.peek(),
      fence = scope(),
      number = ticket
    if (!held.open) return
    controller = new AbortController()
    state.set({ ...held, loading: true, error: null })
    try {
      const page = await read(
        { query: held.query, cursor: more ? (held.cursor ?? undefined) : undefined, limit: 25 },
        controller.signal,
      )
      if (number !== ticket || fence !== scope() || !state.peek().open) return
      const items = new Map((more ? held.items : []).map((item) => [item.id, item]))
      for (const item of page.items) items.set(item.id, item)
      accept(page.items)
      state.set({
        ...held,
        items: [...items.values()],
        total: page.total,
        cursor: page.cursor,
        loading: false,
        error: null,
      })
    } catch (error) {
      if (number !== ticket || fence !== scope() || error.name === 'AbortError') return
      const denied = ['forbidden', 'unauthenticated', 'revoked'].includes(error.code)
      state.set({
        ...held,
        ...(denied ? { items: [], total: 0, cursor: null } : {}),
        loading: false,
        error: error.message,
      })
      if (denied) refused(error)
    }
  }
  return {
    state,
    close,
    dispose: close,
    more: () => load(true),
    retry: () => load(),
    open() {
      close()
      state.set({ ...empty(), open: true })
      return load()
    },
    query(query) {
      cancel()
      state.set({ ...state.peek(), query, items: [], total: 0, cursor: null, loading: true, error: null })
      timer = setTimeout(() => void load(), delay)
    },
  }
}
