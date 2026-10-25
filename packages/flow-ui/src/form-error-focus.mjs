/** Reveal validation errors without moving or duplicating controls.
 * @param {HTMLElement} root
 * @param {() => boolean} compactRecord
 */
export function createFormErrorFocus(root, compactRecord) {
  /** @param {Element|null} field */
  const reveal = (field) => {
    if (!field?.isConnected || !root.contains(field)) return false
    for (let parent = field.parentElement; parent && parent !== root; parent = parent.parentElement)
      if (parent.localName === 'details') /** @type {HTMLDetailsElement} */ (parent).open = true
    const panel = /** @type {HTMLElement|null} */ (field.closest('[data-flow-record-panel][popover]'))
    if (compactRecord() && panel && !panel.matches(':popover-open')) panel.showPopover()
    return true
  }
  return {
    reveal,
    /** Call after rendering field errors and releasing disabled controls.
     * @param {ParentNode} [scope]
     */
    focusInvalid(scope = root) {
      if (scope !== root && !root.contains(/** @type {Node} */ (scope))) return false
      const field = /** @type {HTMLElement|null} */ (
        scope.querySelector('[aria-invalid="true"]:not(:disabled)')
      )
      if (!field || typeof field.focus !== 'function' || !reveal(field)) return false
      field.focus()
      return root.ownerDocument.activeElement === field
    },
  }
}
