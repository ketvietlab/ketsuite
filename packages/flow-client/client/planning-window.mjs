import { signal } from '@ketvietlab/ketjs-view'

/** Independent, bounded task previews. A route/bootstrap replacement is an
 * epoch boundary: even a transport that ignores abort cannot install stale rows. */
export function createPlanningWindows(ctx) {
  const pages = signal({}),
    requests = new Map()
  let epoch = 0
  const key = (input) =>
    JSON.stringify([
      ctx.scope(),
      input.sprintId ?? '',
      !!input.backlog,
      !!input.unfinishedOnly,
      input.epicId ?? '',
      !!input.milestonesOnly,
      input.risk ?? '',
      input.workspaceId ?? '',
    ])
  const state = (input) => pages()[key(input)]
  const reset = () => {
    epoch++
    for (const request of requests.values()) request.abort()
    requests.clear()
    pages.set({})
  }
  const load = async (input, { restart = false } = {}) => {
    const id = key(input),
      prior = restart ? undefined : state(input)
    if (requests.has(id) || (prior?.loaded && !prior.cursor && !prior.error)) return
    const controller = new AbortController(),
      generation = epoch,
      scope = ctx.scope()
    requests.set(id, controller)
    pages.set({ ...pages.peek(), [id]: { ...prior, loading: true, error: null } })
    try {
      const page = await ctx.read(
        {
          ...input,
          projectId: ctx.projectId(),
          limit: 10,
          ...(prior?.cursor ? { cursor: prior.cursor } : {}),
        },
        controller.signal,
      )
      if (controller.signal.aborted || generation !== epoch || scope !== ctx.scope()) return
      const items = [...new Map([...(prior?.items ?? []), ...page.tasks].map((t) => [t.id, t])).values()]
      ctx.accept(page.tasks)
      pages.set({
        ...pages.peek(),
        [id]: {
          items,
          total: page.total,
          cursor: page.cursor,
          ...(page.projectCounts
            ? {
                projectCounts: page.projectCounts,
                projects: page.projects,
                projectTotal: page.projectTotal,
                today: page.today,
              }
            : {}),
          ...(page.report ? { report: page.report } : {}),
          ...(page.metrics ? { metrics: page.metrics } : {}),
          loaded: true,
          loading: false,
          error: null,
        },
      })
    } catch (error) {
      if (controller.signal.aborted || generation !== epoch || scope !== ctx.scope()) return
      pages.set({ ...pages.peek(), [id]: { ...prior, loading: false, error } })
      if (['forbidden', 'unauthenticated'].includes(error.code)) ctx.refused(error)
    } finally {
      if (requests.get(id) === controller) requests.delete(id)
    }
  }
  return { state, load, reset, dispose: reset }
}
