/** One destination contract for the project picker, directory and Spotlight. */
export function savedViewDestination(view) {
  const allowed = view.projectId ? ['board', 'project-issues'] : ['my-work', 'all-issues']
  const route = allowed.includes(view.sourceRoute)
    ? view.sourceRoute
    : view.projectId
      ? 'project-issues'
      : 'all-issues'
  return {
    route,
    params: {
      project: view.projectId ?? '',
      view: view.id,
      q: view.query ?? '',
      status: view.status ?? 'all',
      ...(view.workspaceId ? { workspace: view.workspaceId } : {}),
      ...(view.sort ? { sort: view.sort } : {}),
      ...(view.group ? { group: view.group } : {}),
    },
  }
}
