/** Canonical client route; compatibility applies only to persisted read values. */
export const projectDefaultView = (value: unknown) =>
  value === 'project-issues' || value === 'list' ? 'project-issues' : 'board'
