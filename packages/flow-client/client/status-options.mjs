import { signal } from '@ketvietlab/ketjs-view'

export function createStatusOptions({ call, companyId, onItems = () => {}, onRefusal = () => {} }) {
  const state = signal({ id: '', projectId: '', items: [], loading: false, error: null })
  let controller,
    ticket = 0
  const cancel = () => {
    controller?.abort()
    ticket++
  }
  const close = (id) => {
    if (state.peek().id !== id) return
    cancel()
    state.set({ id: '', projectId: '', items: [], loading: false, error: null })
  }
  const load = async () => {
    cancel()
    const number = ticket,
      before = state.peek(),
      company = companyId()
    if (!before.id || !company) return
    controller = new AbortController()
    state.set({ ...before, items: [], loading: true, error: null })
    try {
      const result = await call(
        'flow.project.statusOptions',
        { companyId: company, projectId: before.projectId },
        { signal: controller.signal },
      )
      if (number !== ticket || company !== companyId() || state.peek().id !== before.id) return
      onItems(result.items)
      state.set({ ...before, items: result.items, loading: false, error: null })
    } catch (error) {
      if (
        number !== ticket ||
        company !== companyId() ||
        state.peek().id !== before.id ||
        error.name === 'AbortError'
      )
        return
      state.set({ ...before, items: [], loading: false, error: error.message })
      if (['forbidden', 'unauthenticated', 'revoked'].includes(error.code)) onRefusal(error)
    }
  }
  return {
    state,
    open: (id, projectId) => {
      cancel()
      state.set({ id, projectId, items: [], loading: false, error: null })
      void load()
    },
    close,
    retry: load,
    dispose: cancel,
  }
}
