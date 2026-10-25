import { createPagedOptions } from './paged-options.mjs'
import { createTaskOptions } from './task-options.mjs'
import { taskFieldControl } from './task-field-control.mjs'
import { tr } from './i18n.mjs'
import { assignableSelf, taskUsers } from './task-assignees.mjs'
import { usesSprints } from './sprint-cadence.mjs'
import { taskColumns, taskTags, statusForKind } from './project-catalogs.mjs'
import { each, html, signal } from '@ketvietlab/ketjs-view'
import { FlowInput, FlowTag, FlowLiveDoc, FlowLiveDocText, FlowButton } from '@ketvietlab/flow-ui'
import {
  FlowChoiceField,
  FlowLoading,
  FlowNotice,
  FlowUserPicker,
  FlowTagPicker,
  FlowDisclosure,
  FlowRecordLayout,
  FlowPropertyFields,
  FlowSection,
  FlowStack,
  FlowInline,
  FlowTextarea,
  FlowSelectField,
} from '@ketvietlab/flow-ui/workspace'
const lines = (value) =>
  String(value ?? '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
export function taskCreatePayload(values, { parentId = null, files = [] } = {}) {
  // Native FormData may include controls owned by a nested editor (e.g. its
  // link popover). Only task fields cross the command boundary.
  const fields = [
    'title',
    'description',
    'descriptionDoc',
    'projectId',
    'assignee',
    'assigneeIds',
    'priority',
    'status',
    'sprint',
    'type',
    'startDate',
    'dueDate',
    'customFields',
    'sprintId',
  ]
  return {
    ...Object.fromEntries(
      fields.filter((name) => values[name] !== undefined).map((name) => [name, values[name]]),
    ),
    points: Number(values.points) || 0,
    tags: [...new Set(Array.isArray(values.tags) ? values.tags : [])],
    checklist: lines(values.checklist).map((text, i) => ({
      id: `check-${i}`,
      text,
      checked: false,
    })),
    subtasks: lines(values.subtasks),
    blockedBy: values.dependency ? [values.dependency] : [],
    attachments: files.map((file) => ({ title: file.name, size: file.size })),
    parentId,
  }
}
export function createTaskComposer(ctx) {
  const drafts = new Map()
  const revision = signal(0)
  const key = () => (ctx.route() === 'subtask-new' ? `child:${ctx.record()}` : 'task')
  const draft = () => {
    const id = key()
    if (!drafts.has(id))
      drafts.set(id, {
        title: '',
        description: '',
        projectId: ctx.project(),
        assigneeIds: assignableSelf(ctx.data(), ctx.project()) ? [ctx.data().user.id] : [],
        priority: 'normal',
        status: statusForKind(ctx.data(), ctx.project(), 'todo'),
        sprint: 'Backlog',
        type: ctx.data().types?.[0]?.id ?? 'task',
        points: '',
        tags: [],
        startDate: '',
        dueDate: '',
        checklist: '',
        subtasks: '',
        dependency: '',
        customFields: {},
      })
    return drafts.get(id)
  }
  const knownProjects = new Map(),
    knownDependencies = new Map()
  const projects = ctx.call
    ? createPagedOptions({
        scope: ctx.companyId,
        refused: ctx.refused,
        read: (input, signal) =>
          ctx.call('flow.project.options', { ...input, companyId: ctx.companyId() }, { signal }),
        accept: (items) => {
          for (const item of items) knownProjects.set(item.id, item)
        },
      })
    : null
  const dependencies = ctx.call
    ? createPagedOptions({
        scope: () => JSON.stringify([ctx.companyId(), draft().projectId]),
        refused: ctx.refused,
        read: async (input, signal) => {
          const page = await ctx.call(
            'flow.issue.list',
            { ...input, companyId: ctx.companyId(), projectId: draft().projectId },
            { signal },
          )
          return { items: page.tasks, total: page.total, cursor: page.cursor }
        },
        accept: (items) => {
          for (const item of items) knownDependencies.set(item.id, item)
        },
      })
    : null
  // A new project may not admit everyone chosen; the server rechecks that selection.
  let assigneeTicket = 0
  const recheckAssignees = async (projectId) => {
    const ids = [...draft().assigneeIds],
      ticket = ++assigneeTicket
    if (!ids.length || !ctx.call) return
    try {
      const page = await ctx.call('flow.member.options', {
        companyId: ctx.companyId(),
        projectId,
        ids,
        limit: 100,
      })
      const d = draft()
      if (ticket !== assigneeTicket || d.projectId !== projectId) return
      const eligible = new Set(page.items.map((u) => u.id))
      d.assigneeIds = d.assigneeIds.filter((id) => !ids.includes(id) || eligible.has(id))
      revision.set(revision() + 1)
    } catch (error) {
      if (['forbidden', 'unauthenticated'].includes(error.code)) ctx.refused?.(error)
    }
  }
  const changeProject = (projectId) => {
    const d = draft()
    d.projectId = projectId
    d.status = statusForKind(ctx.data(), projectId, 'todo')
    d.tags = []
    d.customFields = {}
    d.dependency = ''
    d.sprint = 'Backlog'
    dependencies?.close()
    knownDependencies.clear()
    void recheckAssignees(projectId)
    void remote?.load(projectId)
    revision.set(revision() + 1)
  }
  const pagedField = (picker, id, label, value, selected, items, disabled, change) => {
    const s = picker.state()
    return FlowChoiceField({
      id,
      label,
      icon: id === 'projectId' ? 'folder' : 'link',
      value,
      disabled,
      selected: { label: selected, content: selected },
      options: items.map((item) => ({ value: item.id, label: item.label, content: item.label })),
      menu: { open: s.open, onToggle: (open) => (open ? void picker.open() : picker.close()) },
      remote: {
        query: s.query,
        loading: s.loading,
        error: s.error,
        onQuery: picker.query,
        onRetry: picker.retry,
        ...(s.cursor ? { onMore: picker.more } : {}),
      },
      onChange: change,
    })
  }
  let draftCompany = ctx.companyId?.()
  const remote = ctx.call
    ? createTaskOptions({
        call: ctx.call,
        companyId: ctx.companyId,
        refused: ctx.refused,
        accept: (value) => {
          const d = draft()
          if (d.projectId !== value.projectId) return
          if (!value.columns.some((c) => c.id === d.status))
            d.status = value.columns.find((c) => c.kind === 'todo')?.id ?? value.columns[0]?.id ?? ''
          d.type =
            value.types.find((t) => t.id === d.type || t.code === d.type)?.id ?? value.types[0]?.id ?? ''
          d.tags = d.tags.filter((id) => value.tags.some((tag) => tag.id === id))
          d.customFields = Object.fromEntries(
            Object.entries(d.customFields).filter(([id]) => value.fields.some((f) => f.id === id)),
          )
          revision.set(revision() + 1)
        },
      })
    : null
  const ready = () =>
    !!draft().projectId &&
    (!remote ||
      (remote.state().companyId === ctx.companyId() &&
        remote.state().value?.projectId === draft().projectId &&
        remote.state().value.project?.canWrite !== false))
  return {
    ready,
    prepare() {
      if (ctx.companyId?.() !== draftCompany) {
        drafts.clear()
        knownProjects.clear()
        knownDependencies.clear()
        projects?.close()
        dependencies?.close()
        draftCompany = ctx.companyId?.()
      }
      if (!['issue-new', 'subtask-new'].includes(ctx.route())) {
        remote?.close()
        projects?.close()
        dependencies?.close()
        return
      }
      return remote?.prepare(draft().projectId)
    },
    dispose: () => {
      remote?.dispose()
      projects?.dispose()
      dependencies?.dispose()
    },
    view() {
      revision()
      const d = draft(),
        pending = remote?.state(),
        choices = remote
          ? pending.value
          : {
              columns: taskColumns(ctx.data(), d.projectId),
              types: ctx.data().types ?? [],
              tags: taskTags(ctx.data(), d.projectId),
              fields: (ctx.data().fields ?? []).filter(
                (f) =>
                  !f.archived &&
                  (!f.projectId || f.projectId === d.projectId) &&
                  (!f.appliesTo || f.appliesTo === 'all' || f.appliesTo === d.projectId),
              ),
            },
        disabled = !ctx.canWrite() || !!ctx.busy?.() || choices?.project?.canWrite === false
      const propertyIcons = {
        projectId: 'folder',
        type: 'list',
        status: 'status',
        assignee: 'user',
        priority: 'flag',
        sprint: 'layers',
        startDate: 'calendar',
        dueDate: 'calendar',
        points: 'clock',
        tags: 'tag',
        dependency: 'link',
      }
      const input = (id, label, extra = {}) =>
        FlowInput({
          id,
          label,
          icon: propertyIcons[id],
          value: d[id],
          error: ctx.errors()[id],
          disabled,
          onInput: (e) => {
            d[id] = e.target.value
          },
          ...extra,
        })
      const area = (id, label, placeholder) =>
        FlowTextarea({
          id,
          label,
          value: d[id],
          placeholder,
          error: ctx.errors()[id],
          disabled,
          onInput: (e) => {
            d[id] = e.target.value
          },
        })
      const select = (name, label, options) =>
        FlowSelectField({
          name,
          label,
          icon: propertyIcons[name],
          value: d[name],
          options,
          error: ctx.errors()[name],
          disabled:
            name === 'projectId' ? !ctx.canWrite() || !!ctx.busy?.() : disabled || (!!remote && !ready()),
          onChange: (e) => {
            d[name] = e.target.value
            if (name === 'projectId') changeProject(d.projectId)
          },
        })
      return html`<form
        id="flow-task-create"
        on:submit=${(e) => {
          e.preventDefault()
          if (disabled || !ready()) return
          const form = e.currentTarget
          const id = key()
          const values = {
            ...Object.fromEntries(new FormData(form)),
            description: d.description,
            descriptionDoc: d.descriptionDoc,
            tags: d.tags,
            customFields: d.customFields,
            projectId: d.projectId,
            dependency: d.dependency,
            assigneeIds: d.assigneeIds,
          }
          if (remote) {
            values.sprintId = d.sprint === 'Backlog' ? null : d.sprint
            delete values.sprint
          }
          const files = [...(form.elements.attachments?.files ?? [])]
          ctx.create(
            taskCreatePayload(values, {
              parentId: ctx.route() === 'subtask-new' ? ctx.record() : null,
            }),
            () => drafts.delete(id),
            files,
          )
        }}
      >
        ${choices?.project?.canWrite === false ? FlowNotice({ title: tr('flow.ui.view.only'), message: tr('flow.ui.you.cannot.edit.this.task'), tone: 'yellow' }) : null}
        ${pending?.loading ? FlowLoading({ label: tr('flow.record.loading') }) : null}
        ${pending?.error ? FlowNotice({ title: tr('flow.ui.unable.to.process.the.request'), message: pending.error, tone: 'red', action: FlowButton({ label: tr('flow.exchange.retry'), onClick: remote.retry }) }) : null}
        ${FlowRecordLayout({
          main: FlowSection({
            children: FlowStack({
              children: html`${FlowInline({ children: html`${FlowTag({ label: ctx.route() === 'subtask-new' ? tr('flow.ui.subtask.of', [ctx.record()]) : tr('flow.ui.new.task') })}${FlowTag({ label: tr('flow.ui.draft.not.created') })}` })}${input('title', tr('flow.ui.title'), { required: true, placeholder: tr('flow.ui.what.needs.to.be.done'), error: ctx.errors().title })}${FlowLiveDoc(
                {
                  id: `task-draft-${key()}`,
                  label: tr('flow.ui.description'),
                  text: d.description,
                  snapshot: d.descriptionDoc,
                  readOnly: disabled,
                  onChange: (value) => {
                    d.description = FlowLiveDocText(value)
                    d.descriptionDoc = value.snapshot
                  },
                },
              )}${FlowDisclosure({ title: tr('flow.ui.checklist.subtasks.files'), children: html`${area('checklist', 'Checklist', tr('flow.ui.one.checklist.item.per.line'))}${area('subtasks', tr('flow.ui.subtasks'), tr('flow.ui.one.subtask.per.line.created.with.this.task'))}${FlowInput({ id: 'attachments', label: tr('flow.ui.attachments'), type: 'file', multiple: true, error: ctx.errors().attachments, disabled })}` })}`,
            }),
          }),
          aside: FlowPropertyFields({
            children: html`${
              projects
                ? pagedField(
                    projects,
                    'projectId',
                    tr('flow.ui.projects'),
                    d.projectId,
                    choices?.project?.title ??
                      knownProjects.get(d.projectId)?.title ??
                      ctx.data().projects.find((p) => p.id === d.projectId)?.title ??
                      tr('flow.ui.select.project.8930e1'),
                    projects.state().items.map((p) => ({ id: p.id, label: p.title })),
                    !ctx.canWrite() || !!ctx.busy?.(),
                    changeProject,
                  )
                : select('projectId', tr('flow.ui.projects'), [
                    { value: '', label: tr('flow.ui.select.project.8930e1') },
                    ...ctx.data().projects.map((p) => ({ value: p.id, label: p.title })),
                  ])
            }${select(
              'type',
              tr('flow.ui.task.type'),
              (choices?.types ?? []).map((t) => ({ value: t.id, label: t.title })),
            )}${select(
              'status',
              tr('flow.ui.status'),
              (choices?.columns ?? []).map((c) => ({ value: c.id, label: c.label })),
            )}${FlowUserPicker({
              id: 'create-assignees',
              label: tr('flow.ui.assignee.02be53'),
              size: 'md',
              value: d.assigneeIds,
              options: taskUsers(ctx.data(), { assigneeIds: d.assigneeIds }),
              ...(ctx.userPickerProps?.('create-assignees', {
                projectId: d.projectId,
                assigneeIds: d.assigneeIds,
              }) ?? {}),
              disabled: disabled || !d.projectId,
              placeholder: d.projectId
                ? tr('flow.ui.unassigned.1f3799')
                : tr('flow.ui.select.a.project.first'),
              onChange: (ids) => {
                d.assigneeIds = ids
                revision.set(revision() + 1)
              },
            })}${select('priority', tr('flow.ui.priority'), [
              { value: 'normal', label: tr('flow.ui.normal') },
              { value: 'high', label: tr('flow.ui.high') },
              { value: 'urgent', label: tr('flow.ui.urgent') },
            ])}${
              usesSprints(choices?.project ?? ctx.data().projects.find((p) => p.id === d.projectId))
                ? select('sprint', 'Sprint', [
                    { value: 'Backlog', label: 'Backlog' },
                    ...(remote
                      ? (choices?.sprints ?? [])
                      : ctx.data().sprints.filter((s) => s.projectId === d.projectId)
                    ).map((s) => ({ value: remote ? s.id : s.title, label: s.title })),
                  ])
                : null
            }${input('startDate', tr('flow.ui.start.date'), { type: 'date' })}${input('dueDate', tr('flow.ui.due.date'), { type: 'date' })}${ctx.data().quality ? html`<span data-flow="muted">${tr('flow.ui.ai.estimates.work.volume.from.deliverables.after.the.task.is.created')}</span>` : input('points', tr('flow.ui.estimate.points'), { type: 'number', min: '0' })}${FlowTagPicker(
              {
                id: 'create-tags',
                value: d.tags,
                options: choices?.tags ?? [],
                disabled,
                onChange: (ids) => {
                  d.tags = ids
                  revision.set(revision() + 1)
                },
              },
            )}${each(
              choices?.fields ?? [],
              (field) => field.id,
              (field) =>
                taskFieldControl(field, d.customFields[field.id], {
                  disabled,
                  error: ctx.errors()['customFields.' + field.id] ?? ctx.errors()['fieldValues.' + field.id],
                  change: (value) => {
                    d.customFields[field.id] = value
                    revision.set(revision() + 1)
                  },
                }),
            )}${
              dependencies
                ? pagedField(
                    dependencies,
                    'dependency',
                    tr('flow.ui.blocked.by.87822e'),
                    d.dependency,
                    d.dependency
                      ? (knownDependencies.get(d.dependency)?.title ?? d.dependency)
                      : tr('flow.ui.no.dependencies'),
                    [
                      { id: '', label: tr('flow.ui.no.dependencies') },
                      ...dependencies.state().items.map((t) => ({ id: t.id, label: `${t.id} · ${t.title}` })),
                    ],
                    disabled || !d.projectId,
                    (id) => {
                      d.dependency = id
                      revision.set(revision() + 1)
                    },
                  )
                : select('dependency', tr('flow.ui.blocked.by.87822e'), [
                    { value: '', label: tr('flow.ui.no.dependencies') },
                    ...ctx
                      .data()
                      .tasks.filter((t) => !t.archived && t.projectId === d.projectId)
                      .map((t) => ({ value: t.id, label: `${t.id} · ${t.title}` })),
                  ])
            }`,
          }),
        })}
      </form>`
    },
  }
}
