const positionOf = (state) =>
  Number.isSafeInteger(state?.flowHistoryIndex) && state.flowHistoryIndex >= 0 ? state.flowHistoryIndex : null

/** Flow-owned history methods; never replace global browser methods. */
export function createFlowHistory(native) {
  let position = positionOf(native.state) ?? 0
  let currentURL = ''
  return {
    get state() {
      return native.state
    },
    get position() {
      return position
    },
    get currentURL() {
      return currentURL
    },
    initialize(url) {
      currentURL = url
      native.replaceState({ ...native.state, flowHistoryIndex: position }, '', url)
    },
    pushState(state, unused, url) {
      position += 1
      currentURL = url
      native.pushState({ ...state, flowHistoryIndex: position }, unused, url)
    },
    replaceState(state, unused, url) {
      currentURL = url
      native.replaceState({ ...state, flowHistoryIndex: position }, unused, url)
    },
    delta() {
      const target = positionOf(native.state)
      return target === null ? null : target - position
    },
    accept(url) {
      position = positionOf(native.state) ?? position
      currentURL = url
    },
    /** Adopt a completed KetJS fragment navigation without pushing a second entry. */
    navigated(url, mode) {
      position = mode === 'push' ? position + 1 : (positionOf(native.state) ?? position)
      currentURL = url
      native.replaceState({ ...native.state, flowHistoryIndex: position }, '', url)
    },
    back() {
      native.back()
    },
    go(delta) {
      native.go(delta)
    },
  }
}

/** Restore the current history entry before asking about a dirty modal. */
export function createHistoryLeaveGuard(history, { hasChanges, request, restored, read }) {
  let returning = false
  return {
    get restoring() {
      return returning
    },
    pop(url) {
      const delta = history.delta()
      if (returning && delta === 0) {
        returning = false
        restored()
        return
      }
      if (returning) return
      if (hasChanges()) {
        if (delta !== null && delta !== 0) {
          returning = true
          request(() => history.go(delta), true)
          history.go(-delta)
        } else {
          // An older, unindexed same-document entry cannot be traversed safely.
          // Preserve the draft and URL; accepting explicitly opens that target.
          const targetState = history.state
          history.replaceState({}, '', history.currentURL)
          request(() => {
            history.replaceState(targetState, '', url)
            history.accept(url)
            read()
          }, false)
        }
        return
      }
      history.accept(url)
      read()
    },
  }
}
