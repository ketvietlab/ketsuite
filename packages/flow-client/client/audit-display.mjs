import { tr } from './i18n.mjs'
export function auditChange(change, data, catalogs = {}) {
  const definitions = (key) => [...(catalogs[key] ?? []), ...(data[key] ?? [])]
  const labels = {
    title: 'title',
    status: 'status',
    type: 'type',
    dueDate: 'due.date',
    startDate: 'start.date',
    assignee: 'assignee.02be53',
    assigneeIds: 'assignee.02be53',
    priority: 'priority',
    sprint: 'sprint',
    epic: 'epic',
    blockedBy: 'dependencies',
    description: 'description',
    descriptionDoc: 'description',
    customFields: 'custom.fields',
    tags: 'labels',
    points: 'work.volume',
    visibility: 'visibility',
    readerIds: 'member',
    archived: 'archive',
    parentId: 'parent.document',
    liveDoc: 'content',
    content: 'content',
  }
  const label = labels[change.field] ? tr('flow.ui.' + labels[change.field]) : change.field
  if (['liveDoc', 'content', 'description', 'descriptionDoc'].includes(change.field))
    return tr('flow.review.updated', [label])
  const value = (v) => {
    if (v == null || v === '') return '—'
    if (typeof v === 'boolean') return tr(v ? 'flow.ui.yes' : 'flow.ui.no')
    if (Array.isArray(v)) return v.length ? v.map(value).join(', ') : '—'
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 120)
    return (
      data.members?.find((m) => m.id === v)?.name ??
      definitions('columns').find((c) => c.id === v)?.label ??
      definitions('tags').find((c) => c.id === v)?.title ??
      definitions('types').find((c) => c.id === v)?.title ??
      data.epics?.find((e) => e.id === v)?.title ??
      data.sprints?.find((s) => s.id === v)?.title ??
      String(v)
    )
  }
  if (change.field === 'customFields') {
    const before = change.before && typeof change.before === 'object' ? change.before : {}
    const after = change.after && typeof change.after === 'object' ? change.after : {}
    return (
      [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((id) => JSON.stringify(before[id]) !== JSON.stringify(after[id]))
        .map(
          (id) =>
            `${definitions('fields').find((field) => field.id === id)?.title ?? id}: ${value(before[id])} → ${value(after[id])}`,
        )
        .join('; ') || label
    )
  }
  return `${label}: ${value(change.before)} → ${value(change.after)}`
}
