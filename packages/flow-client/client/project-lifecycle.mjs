import { signal, html, each } from '@ketvietlab/ketjs-view'
import { FlowButton, FlowInput, FlowConfirmDialog } from '@ketvietlab/flow-ui'
import {
  FlowSection,
  FlowStack,
  FlowInline,
  FlowListItem,
  FlowProperties,
  FlowNotice,
  FlowTextarea,
} from '@ketvietlab/flow-ui/workspace'
import { tr } from './i18n.mjs'

const text = (key, args) => tr(`flow.lifecycle.${key}`, args)
const initial = () => ({
  company: '',
  action: null,
  preview: null,
  name: '',
  reason: '',
  error: '',
  loading: false,
  archives: [],
  records: [],
  archiveCursor: null,
  cursor: null,
  loaded: false,
})
const stack = (...children) =>
  FlowStack({
    children: html`${each(
      children,
      (_, i) => i,
      (child) => html`${child}`,
    )}`,
  })
const inline = (...children) =>
  FlowInline({
    children: html`${each(
      children,
      (_, i) => i,
      (child) => html`${child}`,
    )}`,
  })
const errorText = (error) =>
  text(
    error.code === 'conflict'
      ? 'stale'
      : error.fields?.projectId === 'goal_links_in_use'
        ? 'goalLinks'
        : ['forbidden', 'not_found'].includes(error.code)
          ? 'denied'
          : 'failed',
  )

/** Explicit disposable reads; responses never cross Company or supersede a newer action. */
export function createProjectLifecycle(ctx) {
  const state = signal(initial())
  let generation = 0,
    controller = null
  const company = () => ctx.data()?.company?.id ?? ''
  const flags = () => ctx.data()?.capabilities?.projectLifecycle ?? {}
  const update = (patch) => state.set({ ...state(), ...patch })
  const reset = () => {
    generation++
    controller?.abort()
    state.set(initial())
  }
  const begin = () => {
    generation++
    controller?.abort()
    controller = new AbortController()
    if (state().company !== company()) state.set({ ...initial(), company: company() })
    return { ticket: generation, company: company(), signal: controller.signal }
  }
  const current = (read) => read.ticket === generation && read.company === company()
  const manages = (project) =>
    ctx.data()?.capabilities?.manageOrganization || ['admin', 'owner'].includes(project?.accessInfo?.role)
  const read = async (name, input, accept) => {
    const held = begin()
    update({ loading: true, error: '' })
    try {
      const value = await ctx.call(name, input, { signal: held.signal })
      if (current(held)) {
        accept(value)
        update({ loading: false })
      }
    } catch (error) {
      if (current(held) && error.name !== 'AbortError')
        update({
          loading: false,
          error: errorText(error),
          ...(error.code === 'forbidden' ? { preview: null, archives: [], records: [] } : {}),
        })
    }
  }
  const open = (action, project) => {
    begin()
    update({
      action: { kind: action, project },
      preview: null,
      name: '',
      reason: '',
      error: '',
      loading: false,
    })
    if (action === 'delete') return preview()
  }
  const preview = () => {
    const project = state().action?.project
    if (project)
      return read('flow.project.deletion.preview', { id: project.id }, (value) => update({ preview: value }))
  }
  const loadArchives = (more = false) =>
    read(
      'flow.project.list',
      { archived: true, limit: 20, ...(more ? { cursor: state().archiveCursor } : {}) },
      (value) =>
        update({
          archives: more ? [...state().archives, ...value.items] : value.items,
          archiveCursor: value.cursor,
          loaded: true,
        }),
    )
  const loadHistory = (more = false) =>
    read('flow.project.deletion.list', { limit: 20, ...(more ? { cursor: state().cursor } : {}) }, (value) =>
      update({
        records: more ? [...state().records, ...value.records] : value.records,
        cursor: value.nextCursor,
        loaded: true,
      }),
    )
  const submit = async () => {
    const held = state(),
      action = held.action
    if (!action || held.loading || held.company !== company()) return false
    const deleting = action.kind === 'delete'
    if (deleting && (!held.preview || held.name !== held.preview.title)) return false
    update({ loading: true, error: '' })
    const accepted = await ctx.mutate(
      deleting
        ? 'flow.project.delete'
        : action.kind === 'archive'
          ? 'flow.project.archive'
          : 'flow.project.restore',
      {
        id: action.project.id,
        expectedVersion: deleting ? held.preview.version : action.project.version,
        ...(deleting
          ? { confirmName: held.name, impactDigest: held.preview.impactDigest, reason: held.reason }
          : {}),
      },
      () => {
        reset()
        ctx.navigate(
          deleting ? (flags().history ? 'organization-settings' : 'workspace-overview') : 'settings',
          deleting ? { project: '' } : { project: action.project.id },
        )
      },
      {
        revalidate: !deleting,
        onError: (error) => {
          if (held.company === company())
            update({
              loading: false,
              error: errorText(error),
              ...(error.code === 'conflict' && deleting ? { preview: null } : {}),
            })
        },
      },
    )
    if (!accepted && state().company === held.company) update({ loading: false })
    return accepted
  }
  const retry = (record) =>
    ctx.mutate('flow.project.deletion.retry', { id: record.id }, () => loadHistory(), {
      onError: (error) => update({ error: errorText(error) }),
    })
  const notice = () =>
    state().company === company() && state().error
      ? FlowNotice({ tone: 'red', title: text('attention'), children: state().error })
      : null
  return {
    reset,
    dispose: reset,
    open,
    submit,
    loadArchives,
    loadHistory,
    state: () => state(),
    projectSection(project) {
      if (!project || !manages(project)) return null
      return FlowSection({
        inset: 'none',
        title: text('title'),
        children: stack(
          FlowListItem({
            title: project.archived ? text('restore') : text('archive'),
            description: text('archiveHelp'),
            actions: flags().archive
              ? FlowButton({
                  label: project.archived ? text('restore') : text('archive'),
                  onClick: () => open(project.archived ? 'restore' : 'archive', project),
                })
              : null,
          }),
          FlowListItem({
            title: text('delete'),
            description: flags().delete ? text('deleteHelp') : text('separateGrant'),
            actions: flags().delete
              ? FlowButton({
                  label: text('delete'),
                  variant: 'danger',
                  onClick: () => open('delete', project),
                })
              : null,
          }),
        ),
      })
    },
    organizationSection() {
      const s = state().company === company() ? state() : initial()
      return FlowSection({
        inset: 'none',
        title: text('title'),
        children: stack(
          notice(),
          FlowSection({
            inset: 'none',
            title: text('archives'),
            actions: FlowButton({
              label: text('refreshArchives'),
              loading: s.loading,
              onClick: () => loadArchives(),
            }),
            children: stack(
              ...s.archives.map((project) =>
                FlowListItem({
                  title: project.title,
                  description: project.code,
                  actions: inline(
                    FlowButton({
                      label: text('open'),
                      onClick: () =>
                        ctx.navigate('settings', { project: project.id, workspace: project.workspaceId }),
                    }),
                    flags().archive && manages(project)
                      ? FlowButton({
                          label: text('restore'),
                          disabled: ctx.busy(),
                          onClick: () => open('restore', project),
                        })
                      : null,
                  ),
                }),
              ),
              s.archiveCursor
                ? FlowButton({ label: text('more'), loading: s.loading, onClick: () => loadArchives(true) })
                : null,
            ),
          }),
          flags().history
            ? FlowSection({
                inset: 'none',
                title: text('history'),
                actions: FlowButton({
                  label: text('refresh'),
                  loading: s.loading,
                  onClick: () => loadHistory(),
                }),
                children: stack(
                  ...s.records.map((record) =>
                    FlowListItem({
                      title: `${record.projectCode} · ${record.projectTitle}`,
                      description: text(`state.${record.state}`),
                      meta: record.reason,
                      actions:
                        flags().retry && !['done', 'retained_blobs'].includes(record.state)
                          ? FlowButton({
                              label: text('retry'),
                              disabled: ctx.busy(),
                              onClick: () => retry(record),
                            })
                          : null,
                    }),
                  ),
                  s.cursor
                    ? FlowButton({
                        label: text('more'),
                        loading: s.loading,
                        onClick: () => loadHistory(true),
                      })
                    : null,
                ),
              })
            : null,
        ),
      })
    },
    dialog() {
      const s = state(),
        action = s.action
      if (!action || s.company !== company()) return null
      const deleting = action.kind === 'delete'
      return FlowConfirmDialog({
        id: 'flow-project-lifecycle',
        autoOpen: true,
        title: text(action.kind),
        message: deleting
          ? text('irreversible', [action.project.title])
          : text('archiveQuestion', [action.project.title]),
        details: deleting
          ? stack(
              s.preview
                ? FlowProperties({
                    items: Object.entries(s.preview.impact).map(([key, value]) => ({
                      label: text(`impact.${key}`),
                      value: String(value),
                    })),
                  })
                : FlowButton({ label: text('readImpact'), loading: s.loading, onClick: preview }),
              FlowInput({
                id: 'flow-project-confirm-name',
                label: text('confirmName', [s.preview?.title ?? action.project.title]),
                value: s.name,
                disabled: s.loading,
                onInput: (event) => update({ name: event.target.value }),
              }),
              FlowTextarea({
                id: 'flow-project-delete-reason',
                label: text('reason'),
                value: s.reason,
                disabled: s.loading,
                onInput: (event) => update({ reason: event.target.value }),
              }),
            )
          : null,
        feedback: notice(),
        confirmLabel: text(action.kind),
        cancelLabel: text('cancel'),
        loading: s.loading || ctx.busy(),
        confirmDisabled: s.loading || ctx.busy() || (deleting && (!s.preview || s.name !== s.preview.title)),
        tone: deleting ? 'danger' : 'primary',
        onConfirm: submit,
        onCancel: () => {
          if (!state().loading) {
            begin()
            update({ action: null, preview: null, error: '' })
          }
        },
      })
    },
  }
}
