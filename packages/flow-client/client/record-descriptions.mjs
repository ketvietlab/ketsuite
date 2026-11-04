import { html, signal } from '@ketvietlab/ketjs-view'
import { FlowLiveDoc, FlowTag } from '@ketvietlab/flow-ui'
import { tr } from './i18n.mjs'

// Project/epic descriptions use the native document transport. Local snapshots
// never enter a metadata form or an autosave mutation.
export function createRecordDescriptions(ctx) {
  const controllers = new Map(),
    states = signal({})
  let disposed = false,
    refreshing = false
  return {
    render(kind, record) {
      const company = ctx.companyId(),
        key = `${company}:${kind}:${record.id}`
      const state = states()[key] ?? 'saved'
      return html`${FlowLiveDoc({
        id: key,
        label: tr('flow.ui.description'),
        text: record.description ?? '',
        snapshot: record.descriptionDoc,
        transport: record.documentTransport,
        readOnly: !ctx.canManage(record.projectId ?? record.id) || record.archived,
        onReady: (editor) => {
          if (disposed) editor.dispose()
          else controllers.set(key, editor)
        },
        onDispose: () => {
          controllers.delete(key)
          if (!disposed) {
            const next = { ...states() }
            delete next[key]
            states.set(next)
          }
        },
        onSync: (next) => {
          if (disposed || ctx.lifetime?.aborted || company !== ctx.companyId()) return
          if (next.status === 'forbidden') {
            if (!refreshing) {
              refreshing = true
              void ctx.reload().finally(() => {
                refreshing = false
              })
            }
            return
          }
          const patch = next.record?.[kind],
            collection = kind === 'project' ? 'projects' : 'epics'
          const current = ctx.data()?.[collection]?.find((row) => row.id === record.id)
          if (!current) return
          states.set({ ...states(), [key]: next.status })
          if (
            patch &&
            current &&
            kind === 'project' &&
            Number(patch.version) >= Number(current.version) &&
            ['workspaceId', 'access', 'catalogOverrides'].some(
              (key) => JSON.stringify(patch[key]) !== JSON.stringify(current[key]),
            )
          ) {
            if (!refreshing) {
              refreshing = true
              void ctx.reload().finally(() => {
                refreshing = false
              })
            }
            return
          }
          if (patch)
            ctx.data.set({
              ...ctx.data(),
              [collection]: ctx
                .data()
                [collection].map((row) =>
                  row.id === record.id && Number(patch.version) >= Number(row.version)
                    ? { ...row, ...patch }
                    : row,
                ),
            })
        },
        onBlur: () => controllers.get(key)?.flush(),
      })}${FlowTag({ label: tr(state === 'saved' ? 'flow.ui.saved' : ['error', 'offline'].includes(state) ? 'flow.ui.not.saved.try.again' : 'flow.ui.autosaving'), tone: ['error', 'offline'].includes(state) ? 'red' : 'neutral' })}`
    },
    pending: () => [...controllers.values()].some((editor) => editor.isPending()),
    async flush() {
      for (const editor of controllers.values())
        if (editor.isPending() && !(await editor.flush())) return false
      return true
    },
    dispose() {
      disposed = true
      for (const editor of controllers.values()) editor.dispose?.()
      controllers.clear()
    },
  }
}
