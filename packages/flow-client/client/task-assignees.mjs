import { tr } from './i18n.mjs'
import { accessFor } from './access-model.mjs'
// IDs are authoritative; the legacy name is read only for old task payloads.
export const taskAssigneeIds = (data, task) =>
  Array.isArray(task?.assigneeIds)
    ? task.assigneeIds
    : [...(data.members ?? []).filter((m) => m.name === task?.assignee).map((m) => m.id)]
export const taskUsers = (data, task) =>
  taskAssigneeIds(data, task).map((id) => {
    const user = data.members?.find((m) => m.id === id) ?? task.assignees?.find((m) => m.id === id)
    return { id, name: user?.name ?? tr('flow.ui.user.no.longer.available'), avatarUrl: user?.avatarUrl }
  })
export const taskAssigneeNames = (data, task) =>
  taskUsers(data, task)
    .map((u) => u.name)
    .join(', ') || tr('flow.ui.unassigned.1f3799')
export const isAssignedTo = (data, task, id) => taskAssigneeIds(data, task).includes(id)
/** Whether the actor may take a task in this project. Others' eligibility is the
 * server's (`flow.member.options`); the client holds only the actor's grants. */
export function assignableSelf(data, projectId) {
  const project = data.projects.find((p) => p.id === projectId)
  return Boolean(project && accessFor(data, project, data.user.id).role)
}
// Group the exact set of assignees, once per task. No implicit primary assignee.
export const assigneeGroupKey = (task) =>
  task.assigneeIds?.length > 1
    ? 'users:' + JSON.stringify([...task.assigneeIds].sort())
    : task.assigneeIds?.length
      ? 'user:' + task.assigneeIds[0]
      : Array.isArray(task.assigneeIds)
        ? ''
        : (task.assignee ?? '')
