/**
 * Route dialogs may be removed without firing the native close event. Remember
 * their opener until the next render, then return focus inside the same Flow root.
 * @param {HTMLElement} root
 */
export function createDialogFocusReturn(root) {
  /** @type {Map<HTMLDialogElement, HTMLElement|null>} */
  const openers = new Map()
  /** @param {HTMLElement|null} opener */
  const restore = (opener) => {
    const active = root.ownerDocument.activeElement
    if (
      active &&
      active !== root.ownerDocument.body &&
      root.contains(active) &&
      !active.closest('[inert], dialog:not([open])')
    )
      return
    if (
      opener &&
      opener !== root.ownerDocument.body &&
      opener.isConnected &&
      root.contains(opener) &&
      !opener.hasAttribute('disabled') &&
      !opener.closest('[inert], dialog:not([open])')
    ) {
      opener.focus({ preventScroll: true })
      return
    }
    const fallback = /** @type {HTMLElement|null} */ (
      root.querySelector('[data-flow="shell-header"] h1') ??
        root.querySelector('[data-flow="doc-title"]') ??
        root.querySelector('[data-flow="shell-main"]')
    )
    if (!fallback) return
    if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1')
    fallback.focus({ preventScroll: true })
  }
  return {
    /** @param {HTMLDialogElement} dialog */
    remember(dialog) {
      const active = /** @type {HTMLElement|null} */ (root.ownerDocument.activeElement)
      // A route replacement can remove the previous opener before the new
      // dialog mounts. Keep the outer opener for that contiguous modal journey.
      const previous = [...openers.values()].at(-1) ?? null
      openers.set(dialog, active && active !== root.ownerDocument.body ? active : previous)
    },
    /** @param {HTMLDialogElement[]} dialogs */
    sync(dialogs) {
      const live = new Set(dialogs)
      /** @type {(HTMLElement|null)[]} */
      const removed = []
      for (const [dialog, opener] of openers) {
        if (live.has(dialog)) continue
        removed.push(opener)
        openers.delete(dialog)
      }
      if (!dialogs.length && removed.length) restore(removed[0])
      else if (removed.length) {
        const opener = removed.at(-1)
        if (opener && dialogs.includes(/** @type {HTMLDialogElement} */ (opener.closest('dialog[open]'))))
          restore(opener)
      }
    },
    /** @param {HTMLDialogElement} dialog */
    closed(dialog) {
      const opener = openers.get(dialog) ?? null
      openers.delete(dialog)
      if (!root.querySelector('dialog[open]')) restore(opener)
    },
    dispose() {
      openers.clear()
    },
  }
}
