// HTTP-only Atlas simulation. Production uses its typed transactional domain.
import { createHash, randomUUID } from 'node:crypto'
import { accessFor } from '@ketvietlab/flow-client/access-model.mjs'
import { taskColumns, taskTags } from '@ketvietlab/flow-client/project-catalogs.mjs'
import { appliesTo, validateCustomFields } from '@ketvietlab/flow-client/custom-fields.mjs'
import { taskAssigneeIds } from '@ketvietlab/flow-client/task-assignees.mjs'

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const ranks = { viewer: 1, member: 2, editor: 2, admin: 3, owner: 4 }
const writable = (data, project, user = data.user.id) =>
  project &&
  !project.archived &&
  !data.workspaces.find((w) => w.id === project.workspaceId)?.archived &&
  (ranks[accessFor(data, project, user).role] ?? 0) >= 2
const own = (data, task) => ({
  task: structuredClone(task),
  comments: structuredClone(data.comments.filter((c) => c.taskId === task.id)),
  history: structuredClone(data.history.filter((h) => h.taskId === task.id)),
  files: structuredClone((data.files ?? []).filter((f) => f.taskId === task.id)),
})

export function createAtlasTaskRelocation() {
  const receipts = new Map()
  return (data, name, args, { fail, guard, readonly }) => {
    if (
      ![
        'flow.issue.relocation.options',
        'flow.issue.relocation.preview',
        'flow.issue.copyTo',
        'flow.issue.transfer',
      ].includes(name)
    )
      return undefined
    const ok = (value) => ({ ok: true, value: { ok: true, ...value } })
    const mode =
      name === 'flow.issue.copyTo' ? 'copy' : name === 'flow.issue.transfer' ? 'transfer' : args.mode
    const task = data.tasks.find((t) => t.id === args.id)
    if (!task) return fail('not_found', 'Task unavailable')
    if (!['copy', 'transfer'].includes(mode)) return fail('validation', 'Invalid relocation mode')
    const source = data.projects.find((p) => p.id === task.projectId)
    const readable = source && accessFor(data, source, data.user.id).role
    if (!readable || (mode === 'transfer' && (readonly || !writable(data, source))))
      return fail('forbidden', 'Source access required')
    if (source.archived || task.archived) return fail('archived', 'Source archived')
    const destination = args.targetProjectId && data.projects.find((p) => p.id === args.targetProjectId)
    if (args.targetProjectId && (readonly || !writable(data, destination)))
      return fail('forbidden', 'Destination access required')
    const types = destination
      ? data.types.filter((t) => !t.archived && (!t.projectId || t.projectId === destination.id))
      : []
    const fields = destination ? data.fields.filter((f) => appliesTo(f, destination.id)) : []
    const columns = destination ? taskColumns(data, destination.id).filter((c) => !c.archived) : []
    if (name.endsWith('.options')) {
      const candidates = data.projects
        .filter(
          (p) =>
            !readonly &&
            writable(data, p) &&
            (mode === 'copy' || p.id !== task.projectId) &&
            !p.archived &&
            (!args.cursor || p.id > args.cursor) &&
            (!args.query || p.title.toLowerCase().includes(args.query.toLowerCase())),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 101)
      const projects = []
      let last
      for (const p of candidates.slice(0, 100)) {
        last = p
        if (!readonly && writable(data, p) && (mode === 'copy' || p.id !== task.projectId))
          projects.push({ id: p.id, title: p.title, workspaceId: p.workspaceId })
        if (projects.length === 50) break
      }
      if (mode === 'transfer' && destination?.id === task.projectId)
        return fail('validation', 'Choose another project')
      return ok({
        projects,
        nextCursor: last && (last.id !== candidates.at(-1)?.id || candidates.length > 100) ? last.id : null,
        catalogs: destination ? { columns, types, fields } : null,
      })
    }
    if (!destination) return fail('validation', 'Choose a destination')
    const receiptKey = `${data.company.id}:${data.user.id}:${args.idempotencyKey}`
    const signature = digest([name, args])
    const receipt = receipts.get(receiptKey)
    if (!name.endsWith('.preview') && receipt) {
      const original = data.projects.find((p) => p.id === args.sourceProjectId)
      if (
        !original ||
        !(mode === 'copy' ? accessFor(data, original, data.user.id).role : writable(data, original))
      )
        return fail('forbidden', 'Source access required')
      if (receipt.signature !== signature) return fail('replay', 'Intent changed')
      return structuredClone(receipt.result)
    }
    if (mode === 'transfer' && task.projectId === destination.id)
      return fail('validation', 'Choose another project')
    if (mode === 'transfer' && data.tasks.some((t) => t.parentId === task.id))
      return fail('validation', 'Move children first')
    if (mode === 'transfer' && (data.formResponses ?? []).some((r) => r.taskId === task.id))
      return fail('validation', 'Form response cannot be moved')
    const column =
      columns.find((c) => c.id === args.columnId) ??
      (!args.columnId && columns.find((c) => c.kind === 'todo'))
    if (!column) return fail('validation', 'Invalid destination status')
    const original = data.types.find((t) => t.id === task.type)
    const matches = types.filter((t) => t.id === task.type || (original?.code && t.code === original.code))
    const type =
      args.typeId !== undefined
        ? types.find((t) => t.id === args.typeId)
        : matches.length === 1
          ? matches[0]
          : null
    if (args.typeId && !type) return fail('validation', 'Invalid destination type')
    const mapping = args.fieldMap ?? {},
      values = {},
      used = new Set()
    if (
      !mapping ||
      typeof mapping !== 'object' ||
      Array.isArray(mapping) ||
      Object.keys(mapping).some((id) => !Object.hasOwn(task.customFields ?? {}, id))
    )
      return fail('validation', 'Invalid field mapping')
    let fieldsDropped = 0
    for (const [id, value] of Object.entries(task.customFields ?? {})) {
      const targetId = Object.hasOwn(mapping, id) ? mapping[id] : fields.some((f) => f.id === id) ? id : null
      if (targetId == null) {
        fieldsDropped++
        continue
      }
      const f = fields.find((f) => f.id === targetId),
        previous = data.fields.find((f) => f.id === id)
      if (!f || !previous || f.kind !== previous.kind || used.has(targetId))
        return fail('validation', 'Incompatible field mapping')
      used.add(targetId)
      values[targetId] = value
    }
    const error = validateCustomFields(fields, values, destination.id, column.kind === 'done')
    if (error) return fail('validation', error)
    const tags = (task.tags ?? []).filter((id) =>
      taskTags(data, destination.id).some((t) => t.id === id || t.title === id),
    )
    const assignees = taskAssigneeIds(data, task).filter((id) => accessFor(data, destination, id).role)
    const followers = (task.followerIds ?? []).filter((id) => accessFor(data, destination, id).role)
    const impact = {
      fieldsCarried: Object.keys(values).length,
      fieldsDropped,
      labelsDropped: (task.tags ?? []).length - tags.length,
      assigneesDropped: taskAssigneeIds(data, task).length - assignees.length,
      followersDropped:
        mode === 'copy'
          ? (task.followerIds ?? []).length
          : (task.followerIds ?? []).length - followers.length,
      notificationsRemoved:
        mode === 'copy'
          ? 0
          : data.inbox.filter(
              (i) =>
                i.taskId === task.id && i.recipientId && !accessFor(data, destination, i.recipientId).role,
            ).length,
      dependenciesCleared:
        (task.blockedBy ?? []).length + data.tasks.filter((t) => t.blockedBy?.includes(task.id)).length,
      parentCleared: !!task.parentId,
      epicCleared: !!task.epic,
      sprintCleared: !!task.sprint && task.sprint !== 'Backlog',
      typeCleared: !!task.type && !type,
      filesExcluded: mode === 'copy' ? (data.files ?? []).filter((f) => f.taskId === task.id).length : 0,
      contentExcluded: mode === 'copy',
    }
    const impactDigest = digest([
      mode,
      task,
      destination,
      column,
      type,
      fields,
      values,
      tags,
      assignees,
      followers,
      impact,
      data.grants,
      data.members,
      data.teams,
    ])
    const preview = {
      sourceVersion: task.version,
      sourceProjectId: task.projectId,
      impact,
      impactDigest,
      columnId: column.id,
      typeId: type?.id ?? null,
    }
    if (name.endsWith('.preview')) return ok(preview)
    if (!args.idempotencyKey) return fail('validation', 'Operation key required')
    if (
      args.expectedVersion !== task.version ||
      args.sourceProjectId !== task.projectId ||
      args.impactDigest !== impactDigest
    )
      return fail('conflict', 'Preview expired')
    const refusal = guard(task)
    if (refusal) return refusal
    const patch = {
      projectId: destination.id,
      status: column.id,
      type: type?.id ?? null,
      customFields: values,
      tags,
      assigneeIds: assignees,
      assignee: assignees.map((id) => data.members.find((m) => m.id === id)?.name ?? id).join(', '),
      parentId: null,
      epic: null,
      sprint: 'Backlog',
      blockedBy: [],
      version: mode === 'copy' ? 1 : task.version + 1,
      sequence:
        Math.max(0, ...data.tasks.filter((t) => t.projectId === destination.id).map((t) => t.sequence ?? 0)) +
        1,
    }
    let resultTask
    if (mode === 'copy') {
      resultTask = {
        ...structuredClone(task),
        ...patch,
        id: `${destination.code ?? 'COPY'}-${randomUUID().slice(0, 8)}`,
        title: args.title?.trim() || task.title,
        description: '',
        descriptionDoc: null,
        checklist: [],
        followerIds: [],
        followed: false,
        attachments: [],
      }
      data.tasks.push(resultTask)
    } else {
      Object.assign(task, patch, { followerIds: followers, followed: followers.includes(data.user.id) })
      for (const t of data.tasks) t.blockedBy = (t.blockedBy ?? []).filter((id) => id !== task.id)
      for (const f of data.files ?? []) if (f.taskId === task.id) f.projectId = destination.id
      data.inbox = data.inbox.filter(
        (i) => i.taskId !== task.id || !i.recipientId || accessFor(data, destination, i.recipientId).role,
      )
      resultTask = task
    }
    data.taskOrderRevision = (data.taskOrderRevision ?? 0) + 1
    const result = ok({
      id: resultTask.id,
      version: resultTask.version,
      impact,
      record: own(data, resultTask),
    })
    receipts.set(receiptKey, { signature, result: structuredClone(result) })
    return result
  }
}
