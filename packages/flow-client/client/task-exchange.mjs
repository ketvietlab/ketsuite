import { each, html, signal } from '@ketvietlab/ketjs-view'
import { FlowButton, FlowInput } from '@ketvietlab/flow-ui'
import {
  FlowHint,
  FlowInline,
  FlowLoading,
  FlowNotice,
  FlowProperties,
  FlowSection,
  FlowSelectField,
  FlowStack,
  FlowTextarea,
} from '@ketvietlab/flow-ui/workspace'
import {
  decodeExchange,
  encodeExchange,
  exchangeBatch,
  exchangeSchema,
  exchangeVersion,
} from './exchange-contract.mjs'
import { tr } from './i18n.mjs'
const initial = () => ({
  text: '',
  format: 'json',
  mode: 'create',
  importId: crypto.randomUUID(),
  rows: [],
  sources: {},
  previews: [],
  mapping: {},
  loading: false,
  error: '',
  progress: 0,
  applied: 0,
  pending: null,
  mappingPage: 0,
})
const sourceFields = ['columnId', 'typeId', 'tagIds', 'assigneeIds', 'fieldValues']
const sourcesOf = (rows) =>
  Object.fromEntries(
    sourceFields.map((field) => {
      const sources = new Map()
      for (const row of rows)
        for (const id of field === 'fieldValues'
          ? Object.keys(row[field] ?? {})
          : Array.isArray(row[field])
            ? row[field]
            : row[field]
              ? [row[field]]
              : [])
          if (!sources.has(id)) sources.set(id, { id, title: row.title })
      return [field, [...sources.values()]]
    }),
  )
const sourceCount = (state) =>
  Math.max(0, ...Object.values(state.sources ?? {}).map((values) => values.length))
const errorText = (error) =>
  error.code === 'conflict'
    ? tr('flow.exchange.stale')
    : error.code === 'forbidden'
      ? tr('flow.exchange.denied')
      : tr('flow.exchange.invalid')

/** Same controller in Atlas/native: retained file intent and uncertain batch retries. */
export function createTaskExchange(ctx) {
  const state = signal(initial())
  let project = '',
    generation = 0,
    abort = null
  const update = (patch) => state.set({ ...state(), ...patch })
  const cancel = () => {
    generation++
    abort?.abort()
    abort = null
  }
  const reset = () => {
    cancel()
    state.set(initial())
  }
  const changed = (patch) => {
    const previous = state()
    reset()
    update({
      ...(previous.sourceOffset
        ? { importId: previous.importId, sourceOffset: previous.sourceOffset, applied: previous.applied }
        : {}),
      ...patch,
    })
  }
  const args = (rows, operation) => ({
    projectId: project,
    schema: exchangeSchema,
    version: exchangeVersion,
    importId: state().importId,
    mode: state().mode,
    rows,
    mapping: state().mapping,
    idempotencyKey: `${state().importId}:${state().sourceOffset ?? 0}:${operation}`,
  })
  const read = async (name, input, signal) => ctx.call(name, input, { signal })
  const preview = async () => {
    cancel()
    const ticket = generation
    abort = new AbortController()
    update({ loading: true, error: '', previews: [], progress: 0 })
    try {
      const rows = decodeExchange(state().text, state().format),
        previews = []
      if (!rows.length) throw new Error('empty')
      update({ rows, sources: sourcesOf(rows), mappingPage: 0 })
      for (let offset = 0; offset < rows.length; ) {
        const batch = exchangeBatch(rows, offset)
        const result = await read('flow.issue.importPreview', args(batch, 'preview:' + offset), abort.signal)
        if (ticket !== generation) return
        previews.push(result)
        offset += batch.length
        update({ progress: offset })
      }
      update({ previews, loading: false })
    } catch (error) {
      if (ticket === generation && error.name !== 'AbortError')
        update({ error: errorText(error), loading: false })
    }
  }
  const apply = async () => {
    if (state().loading || !state().rows.length || !state().previews.every((p) => p.valid)) return
    cancel()
    const ticket = generation
    abort = new AbortController()
    update({ loading: true, error: '' })
    try {
      for (let offset = state().progressApplied ?? 0; offset < state().rows.length; ) {
        let pending = state().pending
        if (!pending) {
          const input = args(exchangeBatch(state().rows, offset), 'apply:' + offset)
          const preview = await read(
            'flow.issue.importPreview',
            { ...input, idempotencyKey: input.idempotencyKey + ':preview' },
            abort.signal,
          )
          if (ticket !== generation) return
          if (!preview.valid) {
            update({ previews: [preview], error: tr('flow.exchange.invalid'), loading: false })
            return
          }
          pending = { ...input, previewDigest: preview.previewDigest }
          update({ pending })
        }
        const succeeded = await ctx.apply(
          pending,
          (value) =>
            ticket === generation &&
            update({
              applied: state().applied + value.imported,
              pending: null,
              progressApplied: offset + pending.rows.length,
            }),
          (error) => {
            if (
              ticket === generation &&
              ['conflict', 'validation', 'blocked', 'replay_mismatch'].includes(error.code)
            )
              update({ pending: null, previews: [], error: errorText(error) })
          },
        )
        if (ticket !== generation) return
        if (!succeeded) {
          update({ loading: false })
          return
        }
        offset += pending.rows.length
      }
      update({ loading: false, progress: state().rows.length })
      ctx.acceptDraft?.()
    } catch (error) {
      if (ticket === generation && error.name !== 'AbortError')
        update({ error: errorText(error), loading: false })
    }
  }
  const reviewRemaining = () => {
    const s = state(),
      offset = Math.min(s.progressApplied ?? 0, s.rows.length)
    if (s.pending || !offset || offset >= s.rows.length) return
    const rows = s.rows.slice(offset)
    cancel()
    state.set({
      ...initial(),
      text: encodeExchange(rows, s.format),
      format: s.format,
      mode: s.mode,
      importId: s.importId,
      sourceOffset: (s.sourceOffset ?? 0) + offset,
      applied: s.applied,
    })
  }
  const download = async () => {
    cancel()
    const ticket = generation
    abort = new AbortController()
    update({ loading: true, error: '', progress: 0 })
    const format = state().format
    try {
      const rows = []
      let bytes = 0
      let cursor = null,
        revision
      do {
        const page = await read(
          'flow.issue.export',
          { projectId: project, limit: 10, ...(cursor ? { cursor, expectedRevision: revision } : {}) },
          abort.signal,
        )
        if (ticket !== generation) return
        bytes += new TextEncoder().encode(JSON.stringify(page.rows)).length
        if (bytes > 16 * 1024 * 1024) throw new Error('export_limit')
        rows.push(...page.rows)
        cursor = page.cursor
        revision = page.revision
        if (rows.length > 10000) throw new Error('export_limit')
        update({ progress: rows.length })
      } while (cursor)
      const encoded = encodeExchange(rows, format)
      if (new TextEncoder().encode(encoded).length > 16 * 1024 * 1024) throw new Error('export_limit')
      const blob = new Blob([encoded], {
          type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
        }),
        url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `flow-tasks.${format}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      update({ loading: false })
    } catch (error) {
      if (ticket === generation && error.name !== 'AbortError')
        update({ error: errorText(error), loading: false })
    }
  }
  const loadFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    cancel()
    const ticket = generation
    if (file.size > 16 * 1024 * 1024) {
      update({ error: tr('flow.exchange.invalid') })
      return
    }
    try {
      const text = await file.text()
      if (ticket === generation) changed({ text, format: /\.csv$/i.test(file.name) ? 'csv' : 'json' })
    } catch {
      if (ticket === generation) update({ error: tr('flow.exchange.invalid') })
    }
  }
  const mappingFields = () => {
    const s = state(),
      data = ctx.data(),
      specs = [
        ['columns', 'columnId', data.columns ?? [], 'flow.exchange.status'],
        ['types', 'typeId', data.taskTypes ?? [], 'flow.exchange.type'],
        ['labels', 'tagIds', (data.tags ?? []).filter((t) => t.domain !== 'project'), 'flow.exchange.label'],
        ['assignees', 'assigneeIds', data.members ?? [], 'flow.exchange.assignee'],
        ['fields', 'fieldValues', data.fields ?? [], 'flow.exchange.field'],
      ]
    return specs.flatMap(([category, field, choices, title]) => {
      const sources = s.sources[field] ?? [],
        ids = sources.map((source) => source.id)
      return ids.slice((s.mappingPage ?? 0) * 10, ((s.mappingPage ?? 0) + 1) * 10).map((id, index) => {
        const own = choices.find((c) => c.id === id),
          example = sources.find((source) => source.id === id)
        return FlowSelectField({
          id: `flow-exchange-${category}-${index}`,
          label: `${tr(title)} · ${own?.label ?? own?.title ?? own?.name ?? example?.title ?? index + 1}`,
          value: s.mapping[category]?.[id] ?? id,
          disabled: s.loading || Boolean(s.pending) || Boolean(s.progressApplied),
          options: [
            { value: id, label: own ? tr('flow.exchange.keep') : tr('flow.exchange.choose') },
            ...choices
              .filter((c) => !c.archived && c.id !== id)
              .map((c) => ({ value: c.id, label: c.title ?? c.label ?? c.name })),
          ],
          onChange: (event) =>
            update({
              mapping: { ...s.mapping, [category]: { ...s.mapping[category], [id]: event.target.value } },
              previews: [],
              progress: 0,
            }),
        })
      })
    })
  }
  return {
    discard: reset,
    dispose: () => {
      cancel()
      update({ loading: false })
    },
    view() {
      if (ctx.project() !== project) {
        project = ctx.project()
        reset()
      }
      const s = state(),
        disabled = s.loading || Boolean(s.pending) || Boolean(s.progressApplied),
        issues = s.previews.flatMap((p) => p.rows.filter((row) => row.ok === false))
      return FlowStack({
        inset: 'page',
        divided: true,
        children: html`
        ${FlowSection({
          title: tr('flow.exchange.export'),
          inset: 'none',
          actions: FlowButton({
            label: tr('flow.exchange.download'),
            onClick: download,
            disabled: s.loading,
          }),
          children: html`
          ${FlowHint({ children: tr('flow.exchange.scope') })}
          ${FlowSelectField({
            id: 'flow-exchange-format',
            label: tr('flow.exchange.format'),
            value: s.format,
            options: [
              { value: 'json', label: 'JSON' },
              { value: 'csv', label: 'CSV' },
            ],
            disabled,
            onChange: (event) => changed({ text: s.text, format: event.target.value, mode: s.mode }),
          })}`,
        })}
        ${
          ctx.canWrite()
            ? FlowSection({
                title: tr('flow.exchange.import'),
                inset: 'none',
                children: html`<form on:submit=${(event) => {
                  event.preventDefault()
                  void preview()
                }}>
          ${FlowStack({
            children: html`${FlowInput({ id: 'flow-exchange-file', label: tr('flow.exchange.file'), type: 'file', disabled, onChange: loadFile })}
          ${FlowTextarea({ id: 'flow-exchange-text', label: tr('flow.exchange.contents'), value: s.text, disabled, onInput: (event) => changed({ text: event.target.value, format: s.format, mode: s.mode }) })}
          ${FlowSelectField({
            id: 'flow-exchange-mode',
            label: tr('flow.exchange.mode'),
            value: s.mode,
            disabled,
            options: [
              { value: 'create', label: tr('flow.exchange.create') },
              { value: 'update', label: tr('flow.exchange.update') },
            ],
            onChange: (event) => changed({ text: s.text, format: s.format, mode: event.target.value }),
          })}
          ${FlowInline({ children: html`${FlowButton({ label: tr('flow.exchange.preview'), type: 'submit', disabled: s.loading || !s.text || Boolean(s.pending) || Boolean(s.progressApplied) })}${s.previews.length && !issues.length ? FlowButton({ label: tr(s.pending ? 'flow.exchange.retry' : 'flow.exchange.apply'), onClick: apply, disabled: s.loading || s.progressApplied >= s.rows.length }) : null}` })}
        `,
          })}</form>${s.progressApplied && s.progressApplied < s.rows.length && !s.pending ? FlowButton({ label: tr('flow.exchange.remaining'), onClick: reviewRemaining, disabled: s.loading }) : null}${(s.applied > 0 || (s.progressApplied >= s.rows.length && s.rows.length)) && !s.pending ? FlowButton({ label: tr('flow.exchange.new'), onClick: reset, disabled: s.loading }) : null}`,
              })
            : null
        }
        ${
          sourceCount(s)
            ? FlowSection({
                title: tr('flow.exchange.mapping'),
                inset: 'none',
                children: html`${FlowStack({
                  children: each(
                    mappingFields(),
                    (_field, index) => index,
                    (field) => field,
                  ),
                })}${sourceCount(s) > 10 ? FlowInline({ children: html`${FlowButton({ label: tr('flow.exchange.previous'), disabled: s.loading || !(s.mappingPage > 0), onClick: () => update({ mappingPage: Math.max(0, (s.mappingPage ?? 0) - 1) }) })}${FlowButton({ label: tr('flow.exchange.next'), disabled: s.loading || sourceCount(s) <= ((s.mappingPage ?? 0) + 1) * 10, onClick: () => update({ mappingPage: (s.mappingPage ?? 0) + 1 }) })}` }) : null}`,
              })
            : null
        }
        ${
          s.previews.length
            ? FlowSection({
                title: tr('flow.exchange.preview'),
                inset: 'none',
                children: html`
          ${FlowProperties({
            items: [
              { label: tr('flow.exchange.records'), value: String(s.rows.length) },
              { label: tr('flow.exchange.errors'), value: String(issues.length) },
              { label: tr('flow.exchange.imported'), value: String(s.applied) },
            ],
          })}
          ${each(
            issues.slice(0, 20),
            (row) => row.sourceId,
            (row) =>
              FlowNotice({
                title: row.sourceId,
                message: `${row.code} · ${Object.keys(row.fields ?? {}).join(', ')}`,
                tone: 'red',
              }),
          )}`,
              })
            : null
        }
        ${s.loading ? FlowLoading({ label: tr('flow.exchange.working') + ' ' + s.progress }) : null}
        ${s.error ? FlowNotice({ title: tr('flow.exchange.error'), message: s.error, tone: 'red', action: FlowButton({ label: tr('flow.exchange.retry'), onClick: s.pending ? apply : preview, disabled: s.loading }) }) : null}
      `,
      })
    },
  }
}
