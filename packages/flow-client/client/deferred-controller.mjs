import { signal } from '@ketvietlab/ketjs-view'

/** Load a screen controller at the route boundary, never from a render function.
 * The shell's route metadata remains synchronous and independent of this read. */
export function createDeferredController(options) {
  const instance = signal(null),
    error = signal(null)
  let pending = null,
    generation = 0,
    disposed = false
  const prepare = () => {
    if (disposed) return Promise.resolve()
    if (instance()) {
      instance().prepare?.()
      return Promise.resolve()
    }
    if (pending) return pending
    const turn = generation
    error.set(null)
    const operation = Promise.resolve()
      .then(options.load)
      .then((factory) => {
        if (!disposed && turn === generation) {
          instance.set(factory())
          instance().prepare?.()
        }
      })
      .catch((failure) => {
        if (!disposed && turn === generation) error.set(failure)
      })
      .finally(() => {
        if (pending === operation) pending = null
      })
    pending = operation
    return operation
  }
  const fallback = () => (error() ? options.failed(prepare) : options.loading())
  return {
    prepare,
    view: (...args) => instance()?.view(...args) ?? fallback(),
    modal: (...args) => instance()?.modal(...args) ?? { body: fallback(), footer: null },
    topAction: (...args) => instance()?.topAction(...args) ?? null,
    reset() {
      generation++
      pending = null
      error.set(null)
      instance()?.reset?.()
    },
    dispose() {
      disposed = true
      generation++
      pending = null
      instance()?.reset?.()
      instance()?.dispose?.()
    },
  }
}
