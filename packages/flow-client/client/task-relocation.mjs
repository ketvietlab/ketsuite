import { signal, html, each } from '@ketvietlab/ketjs-view'
import { FlowButton, FlowInput, FlowEmpty } from '@ketvietlab/flow-ui'
import {
  FlowStack,
  FlowSection,
  FlowSelectField,
  FlowNotice,
  FlowLoading,
  FlowProperties,
} from '@ketvietlab/flow-ui/workspace'
import { tr } from './i18n.mjs'

export const relocationRoutes = new Set(['issue-copy', 'issue-transfer'])
const empty = () => ({
  projects: [],
  cursor: null,
  catalogs: null,
  target: '',
  column: '',
  type: '',
  fieldMap: {},
  preview: null,
  loading: false,
  error: '',
  title: '',
})
const sourceFields = (data, task) =>
  (data.fields ?? []).filter((f) => Object.hasOwn(task.customFields ?? {}, f.id))
const readError = (error) => {
  const fields = error.fields ?? {}
  const key =
    fields.id === 'has_children'
      ? 'hasChildren'
      : fields.id === 'form_response'
        ? 'formResponse'
        : fields.id === 'pending_uploads'
          ? 'pendingUploads'
          : fields.fieldMap
            ? 'invalidMapping'
            : Object.keys(fields).some((k) => k.startsWith('fieldValues.'))
              ? 'invalidValues'
              : error.code === 'forbidden'
                ? 'accessChanged'
                : error.code === 'archived'
                  ? 'archived'
                  : 'readFailed'
  return tr(`flow.relocation.${key}`)
}

/** A retained choice model; reads cannot overwrite another task, mapping or destination. */
export function createTaskRelocation(ctx) {
  const state = signal(empty())
  let context = '',
    generation = 0,
    controller = null
  const update = (patch) => state.set({ ...state(), ...patch })
  const cancelRead = () => {
    generation++
    controller?.abort()
    controller = null
  }
  const mode = () => (ctx.route() === 'issue-copy' ? 'copy' : 'transfer')
  const request = async (name, input, accept) => {
    cancelRead()
    const ticket = generation
    controller = new AbortController()
    update({ loading: true, error: '' })
    try {
      const value = await ctx.call(
        name,
        { id: ctx.task().id, mode: mode(), ...input },
        { signal: controller.signal },
      )
      if (ticket === generation) {
        accept(value)
        update({ loading: false })
      }
      return ticket === generation
    } catch (error) {
      if (ticket === generation && error.name !== 'AbortError')
        update({ loading: false, error: readError(error) })
      if (ticket === generation && ['forbidden', 'not_found'].includes(error.code)) {
        // A refused read cannot retain another project's cached metadata.
        update({ projects: [], cursor: null, catalogs: null, target: '', preview: null, fieldMap: {} })
        ctx.refresh?.()
      }
      return false
    }
  }
  const options = (append = false) => {
    const s = state()
    return request('flow.issue.relocation.options', append ? { cursor: s.cursor } : {}, (value) =>
      update({
        projects: append
          ? [...s.projects, ...value.projects].filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i)
          : value.projects,
        cursor: value.nextCursor,
      }),
    )
  }
  const mapping = () => ({
    targetProjectId: state().target,
    ...(state().column ? { columnId: state().column } : {}),
    // Empty type means explicitly no type; the initial value is selected from the destination catalog.
    typeId: state().type || null,
    fieldMap: { ...state().fieldMap },
  })
  const choose = async (id) => {
    cancelRead()
    update({ target: id, catalogs: null, column: '', type: '', fieldMap: {}, preview: null })
    if (!id) {
      update({ loading: false, error: '' })
      return
    }
    await request('flow.issue.relocation.options', { targetProjectId: id }, (value) => {
      const task = ctx.task(),
        c = value.catalogs
      const original = (ctx.data().types ?? []).find((t) => t.id === task.type)
      const matches = c.types.filter(
        (t) => t.id === task.type || (original?.code && t.code === original.code),
      )
      const fieldMap = Object.fromEntries(
        sourceFields(ctx.data(), task).map((f) => [f.id, c.fields.some((x) => x.id === f.id) ? f.id : null]),
      )
      update({
        catalogs: c,
        column: c.columns.find((x) => x.kind === 'todo')?.id ?? '',
        type: matches.length === 1 ? matches[0].id : '',
        fieldMap,
      })
    })
  }
  const change = (patch) => {
    cancelRead()
    update({ ...patch, preview: null, loading: false, error: '' })
  }
  const preview = () =>
    request('flow.issue.relocation.preview', mapping(), (value) => update({ preview: value }))
  const confirm = async () => {
    const s = state(),
      held = s.preview
    if (!held || s.loading || ctx.busy()) return false
    const destination = s.projects.find((p) => p.id === s.target)
    if (!destination) return false
    const ok = await ctx.mutate(
      mode() === 'copy' ? 'flow.issue.copyTo' : 'flow.issue.transfer',
      {
        id: ctx.task().id,
        ...mapping(),
        sourceProjectId: held.sourceProjectId,
        expectedVersion: held.sourceVersion,
        impactDigest: held.impactDigest,
        ...(mode() === 'copy' && s.title.trim() ? { title: s.title.trim() } : {}),
      },
      (value) => ctx.completed(value, destination),
      { allowReadOnly: mode() === 'copy' },
    )
    if (!ok && ['conflict', 'validation', 'forbidden', 'archived'].includes(ctx.failure()?.code)) {
      change({ preview: null })
      update({ error: tr('flow.relocation.previewExpired') })
    }
    return ok
  }
  const impactView = () =>
    FlowProperties({
      items: Object.entries(state().preview?.impact ?? {})
        .filter(([, value]) => value !== false && value !== 0)
        .map(([key, value]) => ({
          label: tr(`flow.relocation.impact.${key}`),
          value: typeof value === 'boolean' ? tr('flow.relocation.yes') : String(value),
        })),
    })
  return {
    state,
    impactView,
    options,
    choose,
    change,
    preview,
    confirm,
    sync() {
      const task = ctx.task(),
        route = ctx.route()
      const next =
        relocationRoutes.has(route) && task && !task.summary
          ? JSON.stringify([
              ctx.company(),
              ctx.data()?.user?.id,
              ctx.data()?.organizationRevision,
              task.id,
              task.projectId,
              route,
            ])
          : ''
      if (next === context) return
      context = next
      cancelRead()
      state.set(empty())
      if (next) void options()
    },
    dispose() {
      context = ''
      cancelRead()
    },
    view() {
      const s = state(),
        task = ctx.task(),
        copying = mode() === 'copy'
      const disabled = s.loading || ctx.busy()
      return FlowSection({
        inset: 'none',
        children: FlowStack({
          children: html`
        ${FlowNotice({ title: `${task.id} · ${task.title}`, message: tr(copying ? 'flow.relocation.copyHelp' : 'flow.relocation.transferHelp') })}
        ${FlowSelectField({
          id: 'relocation-target',
          label: tr('flow.relocation.destination'),
          value: s.target,
          disabled,
          options: [
            { value: '', label: tr('flow.relocation.chooseDestination') },
            ...s.projects.map((p) => ({ value: p.id, label: p.title })),
          ],
          onChange: (e) => void choose(e.target.value),
        })}
        ${s.cursor ? FlowButton({ label: tr('flow.relocation.moreDestinations'), disabled, onClick: () => void options(true) }) : null}
        ${!s.loading && !s.error && !s.projects.length && !s.cursor ? FlowEmpty({ title: tr('flow.relocation.noDestinations'), description: tr('flow.relocation.noDestinationsHelp') }) : null}
        ${
          s.catalogs
            ? FlowStack({
                children: html`
          ${FlowSelectField({
            id: 'relocation-status',
            label: tr('flow.ui.status'),
            value: s.column,
            disabled,
            options: [
              { value: '', label: tr('flow.relocation.defaultStatus') },
              ...s.catalogs.columns.map((c) => ({ value: c.id, label: c.title ?? c.label })),
            ],
            onChange: (e) => change({ column: e.target.value }),
          })}
          ${FlowSelectField({
            id: 'relocation-type',
            label: tr('flow.ui.task.type'),
            value: s.type,
            disabled,
            options: [
              { value: '', label: tr('flow.relocation.noType') },
              ...s.catalogs.types.map((t) => ({ value: t.id, label: t.title })),
            ],
            onChange: (e) => change({ type: e.target.value }),
          })}
          ${each(
            sourceFields(ctx.data(), task),
            (f) => f.id,
            (f) =>
              FlowSelectField({
                id: `relocation-field-${f.id}`,
                label: tr('flow.relocation.mapField', [f.title]),
                value: s.fieldMap[f.id] ?? '',
                disabled,
                options: [
                  { value: '', label: tr('flow.relocation.dropField') },
                  ...s.catalogs.fields
                    .filter((t) => t.kind === f.kind)
                    .map((t) => ({ value: t.id, label: t.title })),
                ],
                onChange: (e) => change({ fieldMap: { ...s.fieldMap, [f.id]: e.target.value || null } }),
              }),
          )}
          ${
            copying
              ? FlowInput({
                  id: 'relocation-title',
                  label: tr('flow.ui.title'),
                  value: s.title,
                  placeholder: task.title,
                  disabled,
                  onInput: (e) => update({ title: e.target.value }),
                })
              : null
          }
        `,
              })
            : null
        }
        ${s.loading ? FlowLoading({ label: tr('flow.relocation.loading') }) : null}
        ${s.error ? FlowNotice({ title: tr('flow.relocation.unavailable'), message: s.error, tone: 'red', action: FlowButton({ label: tr('flow.relocation.retry'), onClick: () => void (s.catalogs ? preview() : s.target ? choose(s.target) : options()) }) }) : null}
        ${
          s.preview
            ? FlowSection({
                inset: 'none',
                title: tr('flow.relocation.impact'),
                children: FlowProperties({
                  items: Object.entries(s.preview.impact)
                    .filter(([, value]) => value !== false && value !== 0)
                    .map(([key, value]) => ({
                      label: tr(`flow.relocation.impact.${key}`),
                      value: typeof value === 'boolean' ? tr('flow.relocation.yes') : String(value),
                    })),
                }),
              })
            : null
        }
        ${FlowButton({
          label: s.preview
            ? tr(copying ? 'flow.relocation.confirmCopy' : 'flow.relocation.confirmTransfer')
            : tr('flow.relocation.review'),
          variant: 'primary',
          disabled: disabled || !s.catalogs || !s.target,
          loading: ctx.busy(),
          onClick: () => void (s.preview ? confirm() : preview()),
        })}
      `,
        }),
      })
    },
  }
}
