import { tr } from './i18n.mjs'
import { catalogColors, statusKinds, taskTypeIcons } from './catalog-contract.mjs'
export { catalogColors, statusKinds, taskTypeIcons }
export const defaultProjectStatuses = [
  {
    id: 'planned',
    get title() {
      return tr('flow.ui.planned')
    },
    color: 'neutral',
    kind: 'todo',
  },
  {
    id: 'active',
    get title() {
      return tr('flow.ui.in.progress')
    },
    color: 'blue',
    kind: 'progress',
  },
  {
    id: 'paused',
    get title() {
      return tr('flow.ui.paused')
    },
    color: 'yellow',
    kind: 'review',
  },
  {
    id: 'completed',
    get title() {
      return tr('flow.ui.done')
    },
    color: 'green',
    kind: 'done',
  },
]
export const projectStatuses = (p) => p?.projectStatuses ?? defaultProjectStatuses
export const taskColumns = (data, projectId) => {
  const p = data.projects?.find((p) => p.id === projectId)
  return p?.taskStatusIds
    ? data.columns
        .filter((c) => p.taskStatusIds.includes(c.id))
        .sort((a, b) => p.taskStatusIds.indexOf(a.id) - p.taskStatusIds.indexOf(b.id))
    : data.columns.filter((c) => !c.projectId)
}
export const taskTags = (data, projectId, task) => {
  if (task?.catalogs && task.catalogs.projectId === projectId) {
    const options = new Map(task.catalogs.tags.map((tag) => [tag.id, tag]))
    for (const tag of task.tagDefinitions ?? [])
      if ((task.tags ?? task.tagIds ?? []).includes(tag.id) && !options.has(tag.id))
        options.set(tag.id, { ...tag, archived: true })
    return [...options.values()]
  }
  const p = data.projects?.find((p) => p.id === projectId)
  return p?.taskLabelIds
    ? data.tags.filter((t) => p.taskLabelIds.includes(t.id))
    : data.tags.filter((t) => !t.projectId && t.domain !== 'project')
}
export const taskFields = (data, task) =>
  task?.catalogs && task.catalogs.projectId === task.projectId ? task.catalogs.fields : data.fields
export const taskTypeDefinition = (data, task) =>
  task?.typeDefinition &&
  (task.type == null
    ? task.typeId === task.typeDefinition.id
    : [task.typeDefinition.id, task.typeDefinition.code].includes(task.type))
    ? task.typeDefinition
    : data.types?.find(
        (type) => type.id === (task?.type ?? task?.typeId) || (task?.type != null && type.code === task.type),
      )
export const projectTags = (data, p) =>
  p?.projectLabelIds
    ? data.tags.filter((t) => p.projectLabelIds.includes(t.id))
    : data.tags.filter((t) => !t.projectId && t.domain === 'project')
export const taskStatusDefinition = (data, task) =>
  task?.statusDefinition && task.statusDefinition.id === task.status
    ? task.statusDefinition
    : data?.columns?.find((c) => c.id === task?.status)
export const statusKind = (data, task) => taskStatusDefinition(data, task)?.kind ?? task?.status
export const isDone = (data, task) => statusKind(data, task) === 'done'
export const statusForKind = (data, projectId, kind) =>
  taskColumns(data, projectId).find((c) => c.kind === kind)?.id ?? kind
export function validateCatalog(items, { statuses = false, requireGroups = statuses } = {}) {
  if (!Array.isArray(items) || items.length > 30 || (statuses && !items.length))
    return tr('flow.ui.the.list.needs.between') + (statuses ? '1' : '0') + tr('flow.ui.and.30.items')
  const ids = new Set(),
    names = new Set()
  for (const item of items) {
    if (!item || typeof item !== 'object') return tr('flow.ui.invalid.configuration.entry')
    const name = String(item.title ?? '')
      .trim()
      .toLocaleLowerCase('vi')
    if (
      typeof item.id !== 'string' ||
      !item.id ||
      item.id.length > 100 ||
      ids.has(item.id) ||
      !name ||
      names.has(name) ||
      !catalogColors.includes(item.color) ||
      (statuses && !statusKinds.includes(item.kind))
    )
      return tr('flow.ui.each.entry.needs.a.unique.name.a.color.and.a.valid.status.group')
    ids.add(item.id)
    names.add(name)
  }
  if (requireGroups && statusKinds.some((kind) => !items.some((x) => x.kind === kind)))
    return tr('flow.ui.keep.at.least.one.status.in.each.group.not.started.in.progress.awaiting.acceptan')
  return null
}
