import { signal } from '@ketvietlab/ketjs-view'
/** A single live picker read, scoped to the current Company/project. Responses
 * from a closed picker or a former Company never update the next picker. */
export function createMemberOptions({
  call,
  companyId,
  onItems = () => {},
  onRefusal = () => {},
  delay = 180,
}) {
  const state = signal({
    id: '',
    projectId: '',
    query: '',
    items: [],
    total: 0,
    cursor: null,
    loading: false,
    error: null,
  })
  let controller,
    timer,
    ticket = 0
  const cancel = () => {
    clearTimeout(timer)
    controller?.abort()
    ticket++
  }
  const close = (id) => {
    if (state.peek().id !== id) return
    cancel()
    state.set({ ...state.peek(), id: '', loading: false })
  }
  const load = async (more = false) => {
    clearTimeout(timer)
    controller?.abort()
    const number = ++ticket,
      before = state.peek(),
      company = companyId(),
      cursor = more ? before.cursor : null
    if (!before.id || !before.projectId || !company) return
    controller = new AbortController()
    state.set({ ...before, loading: true, error: null })
    try {
      const page = await call(
        'flow.member.options',
        {
          companyId: company,
          projectId: before.projectId,
          query: before.query,
          cursor: cursor ?? undefined,
          limit: 25,
        },
        { signal: controller.signal },
      )
      if (number !== ticket || company !== companyId() || state.peek().id !== before.id) return
      const held = more ? before.items : [],
        ids = new Set(held.map((u) => u.id))
      const items = [...held, ...page.items.filter((u) => !ids.has(u.id))]
      state.set({ ...before, items, total: page.total, cursor: page.cursor, loading: false, error: null })
      onItems(page.items)
    } catch (error) {
      if (
        number !== ticket ||
        company !== companyId() ||
        state.peek().id !== before.id ||
        error.name === 'AbortError'
      )
        return
      const refused = ['forbidden', 'unauthenticated'].includes(error.code)
      state.set({
        ...state.peek(),
        ...(refused ? { items: [], total: 0, cursor: null } : {}),
        loading: false,
        error: error.message,
      })
      if (refused) onRefusal(error)
    }
  }
  const open = (id, projectId) => {
    cancel()
    state.set({ id, projectId, query: '', items: [], total: 0, cursor: null, loading: false, error: null })
    void load()
  }
  const query = (text) => {
    cancel()
    state.set({ ...state.peek(), query: text, items: [], cursor: null, total: 0, loading: true, error: null })
    timer = setTimeout(() => void load(), delay)
  }
  return { state, open, close, query, retry: () => load(false), more: () => load(true), dispose: cancel }
}
