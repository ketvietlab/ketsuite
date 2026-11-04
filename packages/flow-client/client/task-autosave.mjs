// Keeps edits made during an in-flight request, and retains failed patches for retry.
export function createTaskAutosave({ save, version = () => undefined, onChange = () => {} }) {
  const entries = new Map()
  let disposed = false
  const entry = (id) => {
    if (!entries.has(id)) entries.set(id, { draft: {}, pending: {}, running: null, timer: null, error: null })
    return entries.get(id)
  }
  const flush = async (id) => {
    const e = entry(id)
    clearTimeout(e.timer)
    e.timer = null
    if (e.running) return e.running
    if (disposed || !Object.keys(e.pending).length) return
    // A known stale version cannot succeed automatically. Keep its error/draft
    // visible through blur so a retry button is not removed before its click.
    if (e.error?.code === 'conflict') return
    e.running = (async () => {
      while (!disposed && Object.keys(e.pending).length) {
        const patch = { ...e.pending }
        e.pending = {}
        e.error = null
        onChange()
        try {
          await save(id, patch, e.expectedVersion)
          for (const [key, value] of Object.entries(patch))
            if (e.draft[key] === value && !Object.hasOwn(e.pending, key)) delete e.draft[key]
          e.expectedVersion = version(id)
        } catch (error) {
          e.pending = { ...patch, ...e.pending }
          e.error = error
          break
        }
      }
    })()
    onChange()
    try {
      await e.running
    } finally {
      e.running = null
      onChange()
    }
  }
  return {
    edit(id, patch, { delay = 0 } = {}) {
      if (disposed) return
      const e = entry(id)
      if (!Object.keys(e.draft).length && !e.running) e.expectedVersion = version(id)
      Object.assign(e.draft, patch)
      Object.assign(e.pending, patch)
      e.error = null
      clearTimeout(e.timer)
      onChange()
      if (delay) e.timer = setTimeout(() => flush(id), delay)
      else void flush(id)
    },
    draft: (id) => entry(id).draft,
    state(id) {
      const e = entry(id)
      return e.error ? 'error' : e.running ? 'saving' : Object.keys(e.pending).length ? 'pending' : 'saved'
    },
    flush,
    retry(id) {
      const e = entry(id)
      // Only an explicit retry may rebase a conflicted draft. Blur and automatic
      // context/navigation flushes keep the version captured at the first edit.
      if (e.error?.code === 'conflict') {
        e.expectedVersion = version(id)
        e.error = null
      }
      return flush(id)
    },
    async flushAll() {
      await Promise.all([...entries.keys()].map(flush))
    },
    dispose() {
      disposed = true
      for (const e of entries.values()) clearTimeout(e.timer)
    },
  }
}
