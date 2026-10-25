/** An acknowledged, disposable queue. Failed requests retain exactly the same CRDT update. */
export type LiveDocSyncState = {
  status: 'saving' | 'saved' | 'offline' | 'error'
  record?: Record<string, unknown>
}
export function createLiveDocTransport(options: {
  send: (update: Uint8Array) => Promise<{ record?: Record<string, unknown> }>
  merge: (updates: Uint8Array[]) => Uint8Array
  onState?: (state: LiveDocSyncState) => void
  online?: () => boolean
}) {
  const queue: Uint8Array[] = []
  let disposed = false,
    running: Promise<boolean> | null = null,
    timer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 500,
    status: LiveDocSyncState['status'] = 'saved'
  const notify = (next: LiveDocSyncState['status'], record?: Record<string, unknown>) => {
    if (!disposed && (next !== status || record)) {
      status = next
      options.onState?.({ status, ...(record ? { record } : {}) })
    }
  }
  const flush = (): Promise<boolean> => {
    if (disposed) return Promise.resolve(queue.length === 0)
    if (running) return running
    clearTimeout(timer)
    running = (async () => {
      while (queue.length && !disposed) {
        if (options.online?.() === false) {
          notify('offline')
          return false
        }
        const batch = queue.slice()
        notify('saving')
        try {
          const ack = await options.send(options.merge(batch))
          queue.splice(0, batch.length)
          retryDelay = 500
          notify(queue.length ? 'saving' : 'saved', ack.record)
        } catch {
          notify(options.online?.() === false ? 'offline' : 'error')
          if (!disposed)
            timer = setTimeout(() => {
              void flush()
            }, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 5000)
          return false
        }
      }
      return queue.length === 0
    })().finally(() => {
      running = null
    })
    return running
  }
  return {
    enqueue(update: Uint8Array) {
      if (!disposed) {
        queue.push(update)
        notify('saving')
        void flush()
      }
    },
    flush,
    isPending: () => queue.length > 0,
    dispose() {
      disposed = true
      clearTimeout(timer)
    },
  }
}
