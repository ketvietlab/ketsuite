import { signal } from '@ketvietlab/ketjs-view'

/** A composer owns one project read. Late responses cannot repopulate a closed
 * form, a different project, or a different Company's draft. */
export function createTaskOptions({ call, companyId, accept = () => {}, refused = () => {} }) {
  const state = signal({ companyId: '', projectId: '', loading: false, value: null, error: null })
  let controller,
    ticket = 0
  const close = () => {
    controller?.abort()
    ticket++
    state.set({ companyId: '', projectId: '', loading: false, value: null, error: null })
  }
  const load = async (projectId) => {
    controller?.abort()
    const number = ++ticket,
      company = companyId()
    state.set({ companyId: company, projectId, loading: !!projectId, value: null, error: null })
    if (!projectId || !company) return
    controller = new AbortController()
    try {
      const value = await call(
        'flow.project.taskOptions',
        { companyId: company, projectId },
        { signal: controller.signal },
      )
      if (number !== ticket || company !== companyId()) return
      if (value.projectId !== projectId) throw new Error('Invalid project options response')
      accept(value)
      state.set({ companyId: company, projectId, value, loading: false, error: null })
    } catch (error) {
      if (number !== ticket || company !== companyId() || error.name === 'AbortError') return
      state.set({ companyId: company, projectId, value: null, loading: false, error: error.message })
      if (['forbidden', 'unauthenticated', 'revoked'].includes(error.code)) refused(error)
    }
  }
  return {
    state,
    load,
    close,
    dispose: close,
    prepare(projectId) {
      const held = state.peek()
      if (held.projectId !== projectId || held.companyId !== companyId()) return load(projectId)
    },
    retry: () => load(state.peek().projectId),
  }
}
