import { flowExtensions } from './extensions.mjs'

// A finite compatibility vocabulary, never a server-side collection writer.
const entities = Object.freeze({
  projects: 'project',
  pages: 'page',
  sprints: 'sprint',
  epics: 'epic',
  columns: 'column',
  types: 'type',
  tags: 'tag',
  fields: 'field',
  files: 'attachment',
  views: 'view',
})
const actions = Object.freeze({
  project: ['archive', 'restore'],
  page: ['archive', 'restore', 'move'],
  sprint: ['start', 'close', 'archive', 'restore'],
  epic: ['archive', 'restore'],
  column: ['archive', 'restore'],
  type: ['archive', 'restore'],
  tag: ['archive', 'restore'],
  field: ['archive', 'restore'],
  attachment: ['archive', 'restore'],
  view: ['archive', 'restore'],
})
const organization = new Set([
  'company.save',
  'workspace.save',
  'workspace.archive',
  'member.invite',
  'member.update',
  'invitation.resend',
  'invitation.revoke',
  'team.save',
  'team.member',
  'access.grant',
  'access.revoke',
  'project.move',
  'project.access',
  'project.favorite',
  'document.share',
])
const operations = new Set(['form.save', 'form.submit', 'inbox.read', 'view.save', 'preferences.save'])

export function resolveFlowCommand(name, input = {}) {
  const args = { ...input }
  if (name === 'flow.document.command') return { name: 'flow.page.share', input: args }
  if (name === 'flow.entity.save' || name === 'flow.entity.action') {
    const entity = entities[args.collection]
    if (entity && (name.endsWith('.save') || actions[entity]?.includes(args.action))) {
      const verb = name.endsWith('.save') ? 'save' : args.action
      if (args.entityId != null) args.id = args.entityId
      delete args.collection
      delete args.entityId
      delete args.action
      if (entity !== 'page') delete args.parentId
      if (entity === 'view') args.expectedRevision ??= input.expectedRevision
      return { name: `flow.${entity}.${verb}`, input: args }
    }
  } else if (name === 'flow.organization.command' && organization.has(args.action)) {
    let verb = args.action
    if (verb === 'workspace.save') verb = args.id ? 'workspace.update' : 'workspace.create'
    if (verb === 'workspace.archive') {
      verb = 'workspace.update'
      args.archived = true
    }
    if (verb === 'document.share') verb = 'page.share'
    delete args.action
    return { name: `flow.${verb}`, input: args }
  } else if (name === 'flow.operations.command' && operations.has(args.action)) {
    const verb = args.action
    delete args.action
    return { name: `flow.${verb}`, input: args }
  } else if (
    ![
      'flow.entity.save',
      'flow.entity.action',
      'flow.organization.command',
      'flow.operations.command',
    ].includes(name)
  )
    return { name, input: args }
  for (const extension of flowExtensions()) {
    const resolved = extension.resolveCommand?.(name, args)
    if (resolved) return resolved
  }
  throw new Error('Unsupported Flow command')
}

// The actor's own records: these hold no shared revision, so they never go stale for others.
const personalActions = new Set(['project.favorite', 'preferences.save', 'inbox.read'])

/** Capture optimistic versions once; a failed HTTP attempt reuses the intent. */
export function prepareFlowCommand(name, input, data) {
  const args = { ...input }
  const personal = personalActions.has(args.action)
  if (
    !personal &&
    (name === 'flow.organization.command' || (name === 'flow.entity.save' && args.collection === 'projects'))
  )
    args.expectedRevision ??= data.organizationRevision
  if (name === 'flow.operations.command' && !personal) args.expectedRevision ??= data.operationsRevision
  const id = args.entityId ?? args.id
  const list = args.collection === 'types' ? 'taskTypes' : args.collection
  let held
  if (name.startsWith('flow.issue.') && id) held = data.tasks?.find((t) => t.id === id)
  else if (list && id) held = data[list]?.find((x) => x.id === id)
  else if (name === 'flow.organization.command' && id) {
    const domain = args.action.split('.')[0]
    const collection = {
      workspace: 'workspaces',
      team: 'teams',
      member: 'members',
      invitation: 'invitations',
      project: 'projects',
      access: 'grants',
    }[domain]
    held = data[collection]?.find((x) => x.id === id)
  } else if (name === 'flow.operations.command' && id)
    held = data[args.action.startsWith('form.') ? 'forms' : 'views']?.find((x) => x.id === id)
  if (args.action === 'company.save') held = data.company
  if (held) args.expectedVersion ??= held.version
  if (name === 'flow.entity.save' && args.collection === 'fields') {
    if (args.required === 'true' || args.required === 'false') args.required = args.required === 'true'
    if (typeof args.options === 'string')
      args.options = args.options
        .split('\n')
        .map((option) => option.trim())
        .filter(Boolean)
  }
  if ((name === 'flow.entity.save' || name === 'flow.entity.action') && args.collection === 'views')
    args.expectedRevision ??= data.operationsRevision
  if (name === 'flow.entity.save' && args.collection === 'epics' && args.owner !== undefined) {
    const owners =
      data.members?.filter(
        (m) => (m.id === args.owner || m.name === args.owner) && m.status === 'active' && m.role !== 'guest',
      ) ?? []
    if (owners.length !== 1) throw new Error('Ambiguous or unavailable epic owner')
    args.ownerId = owners[0].id
    delete args.owner
  }
  if (
    (name === 'flow.entity.save' && ['projects', 'sprints', 'epics'].includes(args.collection)) ||
    ['flow.project.save', 'flow.sprint.save', 'flow.epic.save'].includes(name)
  )
    for (const key of ['start', 'end']) if (args[key] === '') args[key] = null
  if (name === 'flow.issue.save') {
    for (const [old, field] of [
      ['status', 'columnId'],
      ['type', 'typeId'],
      ['epic', 'epicId'],
      ['tags', 'tagIds'],
      ['blockedBy', 'blockerIds'],
      ['customFields', 'fieldValues'],
    ]) {
      if (args[old] !== undefined) {
        args[field] = args[old]
        delete args[old]
      }
    }
    if (args.points !== undefined) args.points = Number(args.points)
    for (const key of ['startDate', 'dueDate', 'parentId', 'epicId', 'typeId'])
      if (args[key] === '') args[key] = null
    if (args.typeId)
      args.typeId = data.types?.find((t) => t.id === args.typeId || t.code === args.typeId)?.id ?? args.typeId
    delete args.dependency
  }
  if (name === 'flow.issue.follow' && held && args.follow === undefined && args.following === undefined)
    args.follow = !held.following
  if (['flow.issue.assignSprint', 'flow.issue.save'].includes(name) && 'sprint' in args) {
    args.sprintId =
      args.sprint === 'Backlog'
        ? null
        : data.sprints?.find(
            (s) => s.projectId === held?.projectId && (s.title === args.sprint || s.id === args.sprint),
          )?.id
    delete args.sprint
  }
  let prepared = args
  for (const extension of flowExtensions())
    prepared = extension.prepareCommand?.(name, prepared, data) ?? prepared
  return prepared
}

// Only Atlas uses the reverse adapter. Production never imports fixture code.
export function atlasFlowCommand(name, input, data = {}) {
  if (name === 'flow.field.save') {
    input = { ...input }
    if (typeof input.required === 'boolean') input.required = String(input.required)
    if (Array.isArray(input.options)) input.options = input.options.join('\n')
    if (input.appliesTo === null) input.appliesTo = 'all'
  }
  if (name === 'flow.epic.save' && Object.hasOwn(input, 'ownerId')) {
    const owner = data.members?.find((m) => m.id === input.ownerId)
    input = { ...input, owner: owner?.name ?? '' }
    delete input.ownerId
  }
  if (name === 'flow.page.share') return { name: 'flow.document.command', input }
  if (['flow.workspace.create', 'flow.workspace.update'].includes(name))
    return {
      name: 'flow.organization.command',
      input: { ...input, action: input.archived ? 'workspace.archive' : 'workspace.save' },
    }
  if (name === 'flow.issue.save' || name === 'flow.issue.assignSprint') {
    const args = { ...input }
    if ('sprintId' in args && data.sprints) {
      args.sprint = args.sprintId ? data.sprints.find((s) => s.id === args.sprintId)?.title : 'Backlog'
      delete args.sprintId
    }
    if ('fieldValues' in args) {
      args.customFields = args.fieldValues
      delete args.fieldValues
    }
    if ('columnId' in args) {
      args.status = args.columnId
      delete args.columnId
    }
    if ('typeId' in args) {
      args.type = args.typeId
      delete args.typeId
    }
    if ('epicId' in args) {
      args.epic = args.epicId
      delete args.epicId
    }
    if ('tagIds' in args) {
      args.tags = args.tagIds
      delete args.tagIds
    }
    if ('blockerIds' in args) {
      args.blockedBy = args.blockerIds
      delete args.blockerIds
    }
    return { name, input: args }
  }
  const verb = name.slice('flow.'.length)
  if (organization.has(verb)) return { name: 'flow.organization.command', input: { ...input, action: verb } }
  if (operations.has(verb)) return { name: 'flow.operations.command', input: { ...input, action: verb } }
  const [domain, action] = verb.split('.')
  const collection = Object.keys(entities).find((x) => entities[x] === domain)
  if (collection && (action === 'save' || actions[domain]?.includes(action)))
    return {
      name: action === 'save' ? 'flow.entity.save' : 'flow.entity.action',
      input: { ...input, collection, entityId: input.id, ...(action === 'save' ? {} : { action }) },
    }
  for (const extension of flowExtensions()) {
    const resolved = extension.atlasCommand?.(name, input)
    if (resolved) return resolved
  }
  return { name, input }
}
