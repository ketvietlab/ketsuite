import { taskActivity } from './task-activity.ts'
import { announceDocumentPresence, listDocumentPresence, expireDocumentPresence } from './presence.ts'
import { readRiskTasks } from './risk-read.ts'
import { statusOptions } from './status-options.ts'
import { taskOptions } from './task-catalogs.ts'
import { refuse } from './policy.ts'
import { applyTaskImport, exportTasks, previewTaskImport } from './task-exchange.ts'
import { invitationDelivery } from './invitation-delivery.ts'
import { createFlowMailGuard, nativeNotifications } from './notifications.ts'
import { createMailTransportJobs } from '../../mail_transport/jobs.ts'
import type { FlowNotificationMail } from './notifications.ts'
import type { FlowInvitationMail } from './invitation-delivery.ts'
import { defineFn, defineModule } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, ModulePermissionsDef, Row } from '@ketvietlab/ketjs'
import {
  favoriteProject,
  moveProject,
  previewProjectMove,
  projectAccess,
  resendInvitation,
} from './project-actions.ts'
import { nativeFlowModels } from './models.ts'
import { models as quarantinedModels } from '../models.ts'
import { policyEffects } from './policy.ts'
import { result } from './command.ts'
import type { NativeServerExtension } from './command.ts'
import { bootstrap, listTasks, projectOptions, taskDetail } from './queries.ts'
import { expireUpload } from './upload-jobs.ts'
import { readMembers } from './member-read.ts'
import { readCatalog } from './catalog-read.ts'
import { readSprintReport } from './sprint-report.ts'
import { createWorkspace, projectArchive, saveProject, updateWorkspace } from './organization.ts'
import {
  archiveTask,
  assignSprint,
  bulkTasks,
  commentTask,
  followTask,
  linkTask,
  moveTask,
  saveTask,
} from './tasks.ts'
import { reorderTasks } from './task-order.ts'
import { previewTaskRelocation, relocateTask, taskRelocationOptions } from './task-relocation.ts'
import {
  deleteProject,
  listProjectDeletions,
  nativeDeletionJobs,
  previewProjectDeletion,
  retryProjectDeletion,
} from './project-deletion.ts'
import { archiveCatalog, saveCatalog } from './catalogs.ts'
import { previewAccess, readAccess } from './access-read.ts'
import { readTeam, readTeams } from './team-read.ts'
import { readGrants, readMemberImpact } from './grant-read.ts'
import { archiveDocument, reorderDocument, saveDocument, shareDocument } from './documents.ts'
import {
  acceptInvitation,
  grantAccess,
  inviteMember,
  readInvitations,
  revokeInvitation,
  saveCompanySettings,
  saveTeam,
  teamMember,
  updateMember,
} from './access.ts'
import { planAction, savePlan } from './planning.ts'
import {
  archiveView,
  listInbox,
  readInbox,
  saveForm,
  savePreferences,
  saveView,
  submitForm,
} from './operations.ts'
import {
  attachmentAction,
  completeAttachment,
  prepareAttachment,
  readAttachment,
  saveAttachments,
} from './attachments.ts'
import { search } from './search.ts'
import { commitLiveDocument, readLiveDocument } from './live-document.ts'

export type NativeFlowOptions = {
  /** Set false only when the host already mounts the public DS stylesheet. */
  designSystemStyles?: boolean
  extensions?: NativeServerExtension[]
  invitationMail?: FlowInvitationMail
  notificationMail?: FlowNotificationMail
}
const scope = { companyId: 'id?', workspaceId: 'id?', projectId: 'id?' }
const command = {
  ...scope,
  id: 'id?',
  idempotencyKey: 'text',
  expectedVersion: 'int?',
  expectedRevision: 'int?',
}
const readEffects = [
  ...new Set([
    ...policyEffects,
    'read:storage.Attachment',
    ...Object.keys(nativeFlowModels).map((name) => `read:flow.${name}`),
  ]),
]
const writeEffects = [
  ...readEffects,
  'write:storage.Attachment',
  ...Object.keys(nativeFlowModels).map((name) => `write:flow.${name}`),
]

/** Fresh Flow domain. Deployment composition opts in; legacy tables remain quarantined. */
export function createFlowModule(options: NativeFlowOptions = {}) {
  const mailDelivery = options.invitationMail ? invitationDelivery(options.invitationMail) : null
  const notifications = nativeNotifications(options.notificationMail)
  const unconfiguredMail: NativeServerExtension = {
    name: 'flow-invitation-configuration',
    effects: [],
    readEffects: [],
    projection: async () => ({ invitationDelivery: 'unconfigured' }),
  }
  const extensions = [
    ...(options.extensions ?? []),
    notifications.extension,
    mailDelivery?.extension ?? unconfiguredMail,
  ]
  const names = new Set<string>()
  for (const extension of extensions) {
    if (!extension.name || names.has(extension.name)) throw new Error('Duplicate native Flow extension')
    names.add(extension.name)
  }
  const extensionEffects = extensions.flatMap((x) => x.effects)
  const projectionEffects = extensions.flatMap((x) => x.readEffects ?? x.effects)
  const functions: Record<string, FnSpec> = {}
  const permissionFunctions: ModulePermissionsDef['functions'] = {}
  const add = (
    name: string,
    input: Record<string, string>,
    write: boolean,
    handler: (ctx: Ctx, args: Row) => Promise<unknown>,
    bundle = write ? 'operate' : 'view',
  ) => {
    const fields = { ...input }
    for (const extension of extensions) {
      for (const [field, type] of Object.entries(extension.inputFields?.[`flow.${name}`] ?? {})) {
        if (Object.hasOwn(fields, field)) throw new Error(`Duplicate Flow input field: ${name}.${field}`)
        fields[field] = type
      }
    }
    functions[name] = defineFn({
      input: fields,
      effects: [
        ...new Set([
          ...(write ? writeEffects : readEffects),
          ...(write ? extensionEffects : projectionEffects),
        ]),
      ],
      idempotent: write,
      handler: (ctx, args) =>
        result(() => {
          if (args.companyId && args.companyId !== ctx.scope.company) return refuse('forbidden')
          return handler(ctx, args)
        }),
    })
    permissionFunctions[`flow.${name}`] = {
      risk: write ? (['configure', 'initialize'].includes(bundle) ? 'configure' : 'operate') : 'read',
      bundles: [`flow.${bundle}`],
      owner: 'flow',
      policy: 'flow.native-company-and-scope',
    }
  }
  add(
    'workspace.bootstrap',
    {
      ...scope,
      route: 'text?',
      recordId: 'id?',
      query: 'text?',
      status: 'text?',
      sort: 'text?',
      dueFrom: 'date?',
      dueTo: 'date?',
      dueBefore: 'date?',
      includeUndated: 'bool?',
      shellOnly: 'bool?',
      inboxFilter: 'text?',
    },
    false,
    (ctx, args) => bootstrap(ctx, args, extensions),
  )
  add(
    'issue.list',
    {
      ...scope,
      route: 'text?',
      mine: 'bool?',
      archived: 'bool?',
      sprintId: 'id?',
      backlog: 'bool?',
      unfinishedOnly: 'bool?',
      epicId: 'id?',
      milestonesOnly: 'bool?',
      query: 'text?',
      status: 'text?',
      sort: 'text?',
      dueFrom: 'date?',
      dueTo: 'date?',
      dueBefore: 'date?',
      includeUndated: 'bool?',
      columnId: 'id?',
      cursor: 'text?',
      limit: 'int?',
    },
    false,
    (ctx, args) => listTasks(ctx, args, extensions),
  )
  add('risk.list', { ...scope, risk: 'text?', cursor: 'text?', limit: 'int?' }, false, readRiskTasks)
  add(
    'issue.activity',
    { ...scope, id: 'id', kind: 'text', cursor: 'text?', limit: 'int?' },
    false,
    taskActivity,
  )
  add('issue.detail', { ...scope, id: 'id' }, false, (ctx, args) => taskDetail(ctx, args, extensions))
  add('sprint.report', { ...scope, id: 'id', cursor: 'text?', limit: 'int?' }, false, readSprintReport)
  add(
    'project.options',
    { ...scope, query: 'text?', access: 'text?', manage: 'bool?', cursor: 'text?', limit: 'int?' },
    false,
    projectOptions,
  )
  add('project.statusOptions', { ...scope, projectId: 'id' }, false, statusOptions)
  add('project.taskOptions', { ...scope, projectId: 'id' }, false, taskOptions)
  add('project.list', { ...scope, cursor: 'text?', limit: 'int?' }, false, (ctx, args) =>
    projectOptions(ctx, { ...args, directory: true }),
  )
  add(
    'catalog.list',
    { companyId: 'id?', workspaceId: 'id?', kind: 'text', cursor: 'text?', limit: 'int?' },
    false,
    readCatalog,
  )
  add(
    'member.list',
    {
      ...scope,
      query: 'text?',
      teamId: 'id?',
      candidateForTeamId: 'id?',
      internal: 'bool?',
      active: 'bool?',
      ids: 'json?',
      cursor: 'text?',
      limit: 'int?',
    },
    false,
    readMembers,
  )
  add('team.list', { ...scope, query: 'text?', cursor: 'text?', limit: 'int?' }, false, readTeams)
  add('team.read', { ...scope, id: 'id' }, false, readTeam)
  add('invitation.list', { ...scope, cursor: 'text?', limit: 'int?' }, false, readInvitations)
  add(
    'access.list',
    {
      ...scope,
      scope: 'text',
      targetId: 'id',
      memberId: 'id?',
      query: 'text?',
      cursor: 'text?',
      limit: 'int?',
    },
    false,
    readAccess,
  )
  add(
    'member.options',
    {
      ...scope,
      projectId: 'id',
      query: 'text?',
      internal: 'bool?',
      roles: 'json?',
      ids: 'json?',
      exclude: 'json?',
      cursor: 'text?',
      limit: 'int?',
    },
    false,
    (ctx, args) => readMembers(ctx, args, true),
  )
  add(
    'grant.list',
    {
      ...scope,
      scope: 'text?',
      targetId: 'id?',
      subjectType: 'text?',
      subjectId: 'id?',
      cursor: 'text?',
      limit: 'int?',
    },
    false,
    readGrants,
  )
  add('member.impact', { ...scope, memberId: 'id' }, false, readMemberImpact, 'configure')
  add(
    'issue.export',
    { ...scope, projectId: 'id', cursor: 'text?', limit: 'int?', expectedRevision: 'int?' },
    false,
    exportTasks,
  )
  const exchangeInput = {
    ...command,
    projectId: 'id',
    schema: 'text',
    version: 'int',
    importId: 'text',
    mode: 'text',
    rows: 'json',
    mapping: 'json?',
  }
  add('issue.importPreview', exchangeInput, true, (ctx, args) => previewTaskImport(ctx, args, extensions))
  add('issue.importApply', { ...exchangeInput, previewDigest: 'text' }, true, (ctx, args) =>
    applyTaskImport(ctx, args, extensions),
  )

  add('search', { ...scope, query: 'text?', recent: 'json?' }, false, (ctx, args) =>
    search(ctx, args, extensions),
  )
  add(
    'workspace.initialize',
    { ...command, title: 'text', description: 'text?', access: 'text?', acceptanceEnabled: 'bool?' },
    true,
    (ctx, args) => createWorkspace(ctx, args, extensions),
    'initialize',
  )
  add(
    'workspace.create',
    { ...command, title: 'text', description: 'text?', access: 'text?', acceptanceEnabled: 'bool?' },
    true,
    (ctx, args) => createWorkspace(ctx, args, extensions),
    'configure',
  )
  add(
    'workspace.update',
    {
      ...command,
      title: 'text?',
      description: 'text?',
      access: 'text?',
      archived: 'bool?',
      acceptanceEnabled: 'bool?',
    },
    true,
    (ctx, args) => updateWorkspace(ctx, args, extensions),
    'configure',
  )
  add(
    'project.move.preview',
    { ...scope, targetWorkspaceId: 'id', preserve: 'bool?', cursor: 'text?', limit: 'int?' },
    false,
    previewProjectMove,
    'configure',
  )
  add(
    'access.preview',
    {
      ...scope,
      change: 'text',
      access: 'text',
      ownerId: 'id?',
      memberIds: 'json?',
      teamIds: 'json?',
      cursor: 'text?',
      limit: 'int?',
    },
    false,
    previewAccess,
    'configure',
  )
  add(
    'project.move',
    { ...command, targetWorkspaceId: 'id', preserve: 'bool' },
    true,
    (ctx, args) => moveProject(ctx, args, extensions),
    'configure',
  )
  add(
    'project.access',
    { ...command, access: 'text' },
    true,
    (ctx, args) => projectAccess(ctx, args, extensions),
    'configure',
  )
  add('project.favorite', command, true, (ctx, args) => favoriteProject(ctx, args, extensions))
  add('invitation.resend', command, true, (ctx, args) => resendInvitation(ctx, args, extensions), 'configure')
  add(
    'project.save',
    {
      ...command,
      title: 'text?',
      code: 'text?',
      description: 'text?',
      access: 'text?',
      ownerId: 'id?',
      start: 'date?',
      end: 'date?',
      outcome: 'text?',
      state: 'text?',
      tags: 'json?',
      memberIds: 'json?',
      teamIds: 'json?',
      projectStatuses: 'json?',
      projectLabels: 'json?',
      taskStatuses: 'json?',
      taskLabels: 'json?',
      defaultView: 'text?',
      sprintCadence: 'json?',
    },
    true,
    (ctx, args) => saveProject(ctx, args, extensions),
    'configure',
  )
  for (const archived of [true, false]) {
    add(
      `project.${archived ? 'archive' : 'restore'}`,
      command,
      true,
      (ctx, args) => projectArchive(ctx, args, extensions, archived),
      'configure',
    )
    add(
      `issue.${archived ? 'archive' : 'restore'}`,
      { ...command, ...(archived ? { reason: 'text?' } : {}) },
      true,
      (ctx, args) => archiveTask(ctx, args, extensions, archived),
    )
  }
  add('project.deletion.preview', { id: 'id' }, false, previewProjectDeletion, 'configure')
  add(
    'project.delete',
    {
      id: 'id',
      expectedVersion: 'int',
      confirmName: 'text',
      impactDigest: 'text',
      reason: 'text?',
      idempotencyKey: 'text',
    },
    true,
    (ctx, args) => deleteProject(ctx, args, extensions),
    'project-delete',
  )
  permissionFunctions['flow.project.delete']!.risk = 'sensitive'
  add(
    'project.deletion.list',
    { cursor: 'text?', limit: 'int?' },
    false,
    listProjectDeletions,
    'project-delete',
  )
  add(
    'project.deletion.retry',
    { id: 'id', idempotencyKey: 'text' },
    true,
    (ctx, args) => retryProjectDeletion(ctx, args, extensions),
    'project-delete',
  )
  functions['project.deletion.preview']!.effects = [
    ...functions['project.deletion.preview']!.effects!,
    'write:flow.ScopeRevision',
  ]
  for (const name of ['project.delete', 'project.deletion.retry'])
    functions[name]!.effects = [
      ...functions[name]!.effects!,
      'enqueue:flow.purgeNativeProject',
      'enqueue:flow.purgeNativeBlobs',
    ]
  const taskInput = {
    ...command,
    title: 'text?',
    description: 'text?',
    descriptionDoc: 'json?',
    points: 'decimal?',
    columnId: 'id?',
    typeId: 'id?',
    priority: 'text?',
    dueDate: 'date?',
    startDate: 'date?',
    parentId: 'id?',
    epicId: 'id?',
    sprintId: 'id?',
    assigneeIds: 'json?',
    tagIds: 'json?',
    fieldValues: 'json?',
    blockerIds: 'json?',
    checklist: 'json?',
    subtasks: 'json?',
    attachments: 'json?',
  }
  add('issue.save', taskInput, true, (ctx, args) => saveTask(ctx, args, extensions))
  const relocationInput = {
    ...command,
    id: 'id',
    expectedVersion: 'int',
    targetProjectId: 'id',
    columnId: 'id?',
    typeId: 'id?',
    fieldMap: 'json?',
  }
  add(
    'issue.relocation.options',
    { ...scope, id: 'id', mode: 'text', cursor: 'text?', query: 'text?', targetProjectId: 'id?' },
    false,
    taskRelocationOptions,
  )
  add(
    'issue.relocation.preview',
    {
      ...scope,
      id: 'id',
      targetProjectId: 'id',
      mode: 'text',
      columnId: 'id?',
      typeId: 'id?',
      fieldMap: 'json?',
    },
    false,
    previewTaskRelocation,
    'view',
  )
  add(
    'issue.copyTo',
    { ...relocationInput, sourceProjectId: 'id', impactDigest: 'text', title: 'text?' },
    true,
    (ctx, args) => relocateTask(ctx, args, 'copy', extensions),
    'view',
  )
  add(
    'issue.transfer',
    { ...relocationInput, sourceProjectId: 'id', impactDigest: 'text' },
    true,
    (ctx, args) => relocateTask(ctx, args, 'transfer', extensions),
  )
  add('issue.move', { ...command, columnId: 'id?', value: 'id?' }, true, (ctx, args) =>
    moveTask(ctx, args, extensions),
  )
  add(
    'issue.reorder',
    {
      ...command,
      ids: 'json?',
      expectedVersions: 'json?',
      expectedOrderRevision: 'int',
      targetId: 'id?',
      position: 'text',
      groupBy: 'text',
      groupValue: 'text',
    },
    true,
    (ctx, args) => reorderTasks(ctx, args, extensions),
  )
  add('issue.assignSprint', { ...command, sprintId: 'id?' }, true, (ctx, args) =>
    assignSprint(ctx, args, extensions),
  )
  add('issue.follow', { ...command, follow: 'bool?', following: 'bool?' }, true, (ctx, args) =>
    followTask(ctx, args, extensions),
  )
  add(
    'issue.comment',
    { ...command, taskId: 'id?', text: 'text?', body: 'text?', contentDoc: 'json?' },
    true,
    (ctx, args) => commentTask(ctx, args, extensions),
  )
  add('issue.dependency', { ...command, target: 'id', remove: 'bool?' }, true, (ctx, args) =>
    linkTask(ctx, args, extensions),
  )
  add('issue.linkChild', { ...command, target: 'id', expectedChildVersion: 'int' }, true, (ctx, args) =>
    linkTask(ctx, args, extensions, true),
  )
  add(
    'issue.bulk',
    { ...scope, ids: 'json', action: 'text', value: 'id', idempotencyKey: 'text' },
    true,
    (ctx, args) => bulkTasks(ctx, args, extensions),
  )
  for (const sprint of [true, false]) {
    const domain = sprint ? 'sprint' : 'epic'
    add(
      domain + '.save',
      {
        ...command,
        title: 'text?',
        description: 'text?',
        start: 'date?',
        end: 'date?',
        ...(!sprint ? { ownerId: 'id?', outcome: 'text?' } : {}),
      },
      true,
      (ctx, args) => savePlan(ctx, args, extensions, sprint),
      'configure',
    )
    for (const action of (sprint ? ['start', 'close', 'archive', 'restore'] : ['archive', 'restore']) as (
      | 'start'
      | 'close'
      | 'archive'
      | 'restore'
    )[])
      add(
        domain + '.' + action,
        { ...command, carryTo: 'text?' },
        true,
        (ctx, args) => planAction(ctx, args, extensions, sprint, action),
        'configure',
      )
  }
  for (const kind of ['column', 'type', 'tag', 'field'] as const) {
    add(
      `${kind}.save`,
      {
        ...command,
        title: 'text?',
        kind: 'text?',
        domain: 'text?',
        description: 'text?',
        appliesTo: 'text?',
        color: 'text?',
        icon: 'text?',
        sequence: 'int?',
        required: 'bool?',
        options: 'json?',
      },
      true,
      (ctx, args) => saveCatalog(ctx, args, extensions, kind),
      'configure',
    )
    for (const archived of [true, false])
      add(
        `${kind}.${archived ? 'archive' : 'restore'}`,
        command,
        true,
        (ctx, args) => archiveCatalog(ctx, args, extensions, kind, archived),
        'configure',
      )
  }
  add(
    'page.save',
    {
      ...command,
      title: 'text?',
      titleSource: 'text?',
      description: 'text?',
      blocks: 'json?',
      liveDoc: 'text?',
      parentId: 'id?',
      visibility: 'text?',
    },
    true,
    (ctx, args) => saveDocument(ctx, args, extensions),
    'author',
  )
  for (const archived of [true, false])
    add(
      `page.${archived ? 'archive' : 'restore'}`,
      command,
      true,
      (ctx, args) => archiveDocument(ctx, args, extensions, archived),
      'author',
    )
  add(
    'page.share',
    { ...command, visibility: 'text', readerIds: 'json' },
    true,
    (ctx, args) => shareDocument(ctx, args, extensions),
    'author',
  )
  add(
    'page.reorder',
    { ...command, targetId: 'id', position: 'text', expectedSiblingIds: 'json' },
    true,
    (ctx, args) => reorderDocument(ctx, args, extensions),
    'author',
  )
  add(
    'company.save',
    { ...command, title: 'text', acceptanceEnabled: 'bool?' },
    true,
    (ctx, args) => saveCompanySettings(ctx, args, extensions),
    'configure',
  )
  add(
    'team.save',
    { ...command, title: 'text', description: 'text?' },
    true,
    (ctx, args) => saveTeam(ctx, args, extensions),
    'configure',
  )
  add(
    'team.member',
    { ...command, memberId: 'id', remove: 'bool?' },
    true,
    (ctx, args) => teamMember(ctx, args, extensions),
    'configure',
  )
  add(
    'member.update',
    { ...command, role: 'text', revoke: 'bool?' },
    true,
    (ctx, args) => updateMember(ctx, args, extensions),
    'configure',
  )
  add(
    'access.grant',
    {
      ...command,
      scope: 'text',
      targetId: 'id',
      subjectType: 'text',
      subjectId: 'id?',
      subjectIds: 'json?',
      role: 'text',
    },
    true,
    (ctx, args) => grantAccess(ctx, args, extensions),
    'configure',
  )
  add('access.revoke', command, true, (ctx, args) => grantAccess(ctx, args, extensions, true), 'configure')
  add(
    'member.invite',
    { ...command, email: 'text', role: 'text?', name: 'text?' },
    true,
    (ctx, args) => inviteMember(ctx, args, extensions),
    'configure',
  )
  add('invitation.revoke', command, true, (ctx, args) => revokeInvitation(ctx, args, extensions), 'configure')
  add('invitation.accept', { ...scope, token: 'text', idempotencyKey: 'text' }, true, (ctx, args) =>
    acceptInvitation(ctx, args, extensions),
  )
  add(
    'form.save',
    {
      ...command,
      title: 'text',
      description: 'text?',
      fields: 'json',
      access: 'text',
      assigneeId: 'id',
      priority: 'text?',
      publish: 'bool?',
    },
    true,
    (ctx, args) => saveForm(ctx, args, extensions),
    'configure',
  )
  add('form.submit', { ...command, title: 'text', answers: 'json' }, true, (ctx, args) =>
    submitForm(ctx, args, extensions),
  )
  for (const archived of [true, false])
    add('view.' + (archived ? 'archive' : 'restore'), command, true, (ctx, args) =>
      archiveView(ctx, args, extensions, archived),
    )
  add(
    'view.save',
    {
      ...command,
      title: 'text',
      description: 'text?',
      query: 'text?',
      status: 'text?',
      visibility: 'text?',
      archive: 'bool?',
    },
    true,
    (ctx, args) => saveView(ctx, args, extensions),
  )
  add('preferences.save', { ...command, timezone: 'text?', notifications: 'text?' }, true, (ctx, args) =>
    savePreferences(ctx, args, extensions),
  )
  add('inbox.read', { ...command, ids: 'json' }, true, (ctx, args) => readInbox(ctx, args, extensions))
  add('inbox.list', { ...scope, filter: 'text?', cursor: 'text?', limit: 'int?' }, false, listInbox)
  add('attachment.save', { ...command, taskId: 'id', files: 'json' }, true, (ctx, args) =>
    saveAttachments(ctx, args, extensions),
  )
  for (const archived of [true, false])
    add('attachment.' + (archived ? 'archive' : 'restore'), command, true, (ctx, args) =>
      attachmentAction(ctx, args, extensions, archived),
    )
  functions['attachment.prepare'] = defineFn({
    exposure: 'internal',
    input: {
      taskId: 'id?',
      projectId: 'id?',
      id: 'id',
      name: 'text',
      storeKey: 'text',
      checksum: 'text',
      size: 'int',
      mimetype: 'text',
      idempotencyKey: 'text',
    },
    effects: [...writeEffects, ...extensionEffects, 'enqueue:flow.expireUpload'],
    handler: (ctx, args) => prepareAttachment(ctx, args, extensions),
  })
  functions['attachment.complete'] = defineFn({
    exposure: 'internal',
    input: { id: 'id' },
    effects: [...writeEffects, ...extensionEffects],
    handler: (ctx, args) => completeAttachment(ctx, args, extensions),
  })
  functions['attachment.read'] = defineFn({
    exposure: 'internal',
    input: { id: 'id' },
    effects: readEffects,
    handler: readAttachment,
  })
  for (const page of [true, false]) {
    const domain = page ? 'page' : 'issue'
    for (const write of [false, true]) {
      const name = `${domain}.document.${write ? 'write' : 'read'}`
      // A denial must throw, never become a truthy refusal envelope to LiveDoc.
      functions[name] = defineFn({
        input: { id: 'id' },
        effects: readEffects,
        handler: (ctx, args) => readLiveDocument(ctx, args, page, write),
      })
      permissionFunctions[`flow.${name}`] = {
        risk: write ? 'operate' : 'read',
        bundles: [write ? 'flow.author' : 'flow.view'],
        owner: 'flow',
        policy: 'flow.native-document-owner',
      }
    }
    functions[`${domain}.document.presence`] = defineFn({
      exposure: 'internal',
      input: { id: 'id', index: 'int', gone: 'bool?' },
      effects: [...writeEffects, ...extensionEffects, 'enqueue:flow.expireDocumentPresence'],
      handler: (ctx, args) => announceDocumentPresence(ctx, args, page, extensions),
    })
    functions[`${domain}.document.presence.list`] = defineFn({
      exposure: 'internal',
      input: { id: 'id' },
      effects: readEffects,
      handler: (ctx, args) => listDocumentPresence(ctx, args, page),
    })
    functions[`${domain}.document.commit`] = defineFn({
      exposure: 'internal',
      input: {
        id: 'id',
        storeKey: 'text',
        checksum: 'text',
        size: 'int',
        previewText: 'text?',
        ...(page ? { blocks: 'json' } : {}),
        expectedVersion: 'int',
      },
      effects: [...writeEffects, ...extensionEffects],
      handler: (ctx, args) => commitLiveDocument(ctx, args, page, extensions),
    })
  }
  const permissions: ModulePermissionsDef = {
    posture: 'permission-bearing',
    owner: 'flow',
    bundles: {
      'flow.initialize': { labels: { vi: 'Khởi tạo Flow cho công ty', en: 'Initialize Company Flow' } },
      'flow.view': { labels: { vi: 'Xem Flow', en: 'Read Flow' } },
      'flow.operate': { labels: { vi: 'Làm việc trong Flow', en: 'Work in Flow' }, includes: ['flow.view'] },
      'flow.configure': { labels: { vi: 'Cấu hình Flow', en: 'Configure Flow' }, includes: ['flow.operate'] },
      'flow.project-delete': {
        labels: { vi: 'Xóa vĩnh viễn dự án Flow', en: 'Permanently delete Flow projects' },
      },
      'flow.author': {
        labels: { vi: 'Soạn nội dung Flow', en: 'Author Flow content' },
        includes: ['flow.operate'],
      },
    },
    functions: permissionFunctions,
    exemptions: {
      'flow.attachment.prepare': { reason: 'internal-route', authority: 'flow.native-upload-owner' },
      'flow.attachment.complete': { reason: 'internal-route', authority: 'flow.native-upload-owner' },
      'flow.attachment.read': { reason: 'internal-route', authority: 'flow.native-attachment-read' },
      ...Object.fromEntries(
        ['page', 'issue'].flatMap((domain) =>
          ['presence', 'presence.list'].map((name) => [
            `flow.${domain}.document.${name}`,
            { reason: 'internal-route' as const, authority: 'flow.native-document-owner' },
          ]),
        ),
      ),
      'flow.page.document.commit': { reason: 'internal-route', authority: 'flow.native-document-owner' },
      'flow.issue.document.commit': { reason: 'internal-route', authority: 'flow.native-document-owner' },
    },
  }
  return defineModule({
    name: 'flow',
    version: '1.0.0',
    depends: [
      'company',
      'partner',
      'user',
      'storage',
      'mail',
      ...(mailDelivery || options.notificationMail ? ['mail_transport'] : []),
    ],
    // Extensions belong to modules that build on Flow, so their effects name those modules optional.
    optional: [
      ...new Set(
        [...extensionEffects, ...projectionEffects].map(
          (effect) => effect.slice(effect.indexOf(':') + 1).split('.')[0]!,
        ),
      ),
    ].filter((owner) => owner !== 'flow'),
    title: 'Flow',
    models: { ...quarantinedModels, ...nativeFlowModels },
    functions,
    jobs: {
      expireUpload,
      expireDocumentPresence,
      ...(mailDelivery || options.notificationMail
        ? { deliverMail: createMailTransportJobs([createFlowMailGuard()]).deliver! }
        : {}),
      ...notifications.jobs,
      ...(mailDelivery?.jobs ?? {}),
      ...nativeDeletionJobs(extensions, [
        ...writeEffects,
        ...extensions.flatMap((extension) => extension.purgeEffects ?? []),
      ]),
    },
    permissions,
    assets: new URL('.', import.meta.resolve('@ketvietlab/flow-ui')),
    styles: [
      new URL(import.meta.resolve('@ketvietlab/design-system/tokens.css')),
      ...(options.designSystemStyles === false
        ? []
        : [new URL(import.meta.resolve('@ketvietlab/design-system/styles.css'))]),
      'styles.css',
    ],
  })
}

export type { NativeServerExtension, NativeMutation } from './command.ts'
export { createFlowMailGuard } from './notifications.ts'
