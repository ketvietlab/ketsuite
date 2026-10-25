import { accessFor } from '@ketvietlab/flow-client/access-model.mjs'

/** Who may be assigned in a project, read from the whole fixture directory. Only the Atlas
 * server holds every person's grants; the product asks `flow.member.options` instead. */
export function assignableUsers(data, projectId) {
  const project = data.projects.find((p) => p.id === projectId)
  if (!project) return []
  return (data.members ?? [])
    .filter((m) => m.status === 'active' && (!data.grants || accessFor(data, project, m.id).role))
    .map((m) => ({ id: m.id, name: m.name, email: m.email, avatarUrl: m.avatarUrl }))
}
