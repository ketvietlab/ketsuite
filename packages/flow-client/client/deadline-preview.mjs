import { signal } from '@ketvietlab/ketjs-view'

/** One eight-record deadline preview, independent of the bootstrap task window. */
export function createDeadlinePreview(ctx) {
  const state = signal(null)
  let controller = null,
    generation = 0,
    snapshot = null
  const reset = () => {
    generation++
    controller?.abort()
    controller = null
    snapshot = null
    state.set(null)
  }
  const load = async (id) => {
    const data = ctx.data(),
      counts = data?.deadlineCounts
    if (!counts || !ctx.read) return
    controller?.abort()
    const request = new AbortController(),
      turn = ++generation,
      scope = ctx.scope()
    controller = request
    state.set({ id, loading: true, error: null, tasks: [] })
    try {
      const result = await ctx.read(
        {
          workspaceId: ctx.workspaceId(),
          unfinishedOnly: true,
          sort: 'due',
          limit: 8,
          ...(id === 'overdue' ? { dueBefore: counts.today } : { dueFrom: id, dueTo: id }),
        },
        request.signal,
      )
      if (request.signal.aborted || turn !== generation || scope !== ctx.scope() || data !== ctx.data())
        return
      state.set({ id, loading: false, error: null, tasks: result.tasks, total: result.total })
    } catch (error) {
      if (request.signal.aborted || turn !== generation || scope !== ctx.scope() || data !== ctx.data())
        return
      state.set({ id, loading: false, error, tasks: [] })
      if (['forbidden', 'unauthenticated'].includes(error.code)) ctx.refused?.(error)
    } finally {
      if (controller === request) controller = null
    }
  }
  return {
    state,
    load,
    reset,
    dispose: reset,
    prepare(id) {
      if (snapshot === ctx.data()) return
      reset()
      snapshot = ctx.data()
      void load(id)
    },
  }
}
