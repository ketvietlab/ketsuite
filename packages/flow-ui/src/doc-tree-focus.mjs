/** Focus follows a keyboard reorder after the consumer has refreshed the tree.
 * @param {HTMLElement} root */
export function createDocTreeFocusReturn(root) {
  let disposed = false,
    generation = 0
  return {
    /** @param {HTMLElement} button @param {string} id @param {void|Promise<unknown>} completion */
    async reorder(button, id, completion) {
      const current = ++generation
      const doc = root.ownerDocument,
        url = doc.defaultView?.location.href
      try {
        await completion
      } catch {
        /* The consumer owns error recovery. */
      }
      if (disposed || current !== generation || !root.isConnected || url !== doc.defaultView?.location.href)
        return
      const active = doc.activeElement
      if (active && active !== doc.body && active !== button) return
      const target = [...root.querySelectorAll('[data-flow="doc-tree-page"][data-page-id]')].find(
        (item) => item.getAttribute('data-page-id') === id,
      )
      if (target && !target.hasAttribute('disabled') && !target.closest('[inert],dialog:not([open])'))
        /** @type {HTMLElement} */ (target).focus({ preventScroll: true })
    },
    dispose() {
      disposed = true
      generation += 1
    },
  }
}
