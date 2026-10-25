// Native drafts stay in memory. No field values are written to storage or logs.
const state = (form) =>
  JSON.stringify(
    [...new FormData(form)]
      .map(([name, value]) => [
        name,
        typeof value === 'string'
          ? value
          : value.name || value.size
            ? [value.name, value.size, value.type, value.lastModified]
            : ['', 0, ''],
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  )

/** Keeps modal form baselines separate from autosaved task and document drafts. */
export function createFormLeaveGuard({ context, forms, snapshot = state }) {
  let key = ''
  const baseline = new Map()
  return {
    sync() {
      const next = context()
      if (next !== key) {
        key = next
        baseline.clear()
      }
      if (!key) return
      const live = new Set(forms())
      for (const form of baseline.keys()) if (!live.has(form)) baseline.delete(form)
      for (const form of live) if (!baseline.has(form)) baseline.set(form, snapshot(form))
    },
    hasChanges() {
      if (!key || context() !== key) return false
      return [...baseline].some(([form, value]) => snapshot(form) !== value)
    },
    submission(form) {
      return baseline.has(form) ? { key, form, value: snapshot(form) } : null
    },
    accept(submitted) {
      if (submitted?.key === key && baseline.has(submitted.form))
        baseline.set(submitted.form, submitted.value)
    },
    reset(form) {
      if (key && context() === key && baseline.has(form)) baseline.set(form, snapshot(form))
    },
    discard() {
      baseline.clear()
    },
    dispose() {
      baseline.clear()
      key = ''
    },
  }
}
