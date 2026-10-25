/** Open layers that own Escape before the peek: dialogs above it and popups inside it. */
const LAYERS_ABOVE = [
  '[data-ui="modal-layer"]',
  'dialog[open]',
  '[data-ui="menu"][open]',
  '[data-ui="timeframe-menu"][open]',
  '[data-ui="view-settings"][open]',
  '[data-ui="list-filters"][open]',
  '[data-ui="popover"][data-open="true"]',
].join(', ')

/**
 * Focus lifetime for a PeekLayout whose Peek an application island renders and replaces.
 * Attach once per layout. The application owns which record is peeked (usually `peek=<id>`
 * in the URL) and keeps the view interactive; invokers name the layout's place (`peekId`, which
 * stays in the DOM while the peek is closed) with `aria-controls`, and the current one carries
 * `aria-current="true"`. The runtime only:
 * - moves focus into the panel when an invoker opens it, not when a page loads with it open;
 * - keeps focus in the view when another invoker replaces the content (the heading is a
 *   polite live region, so the new record is announced);
 * - closes on Escape through the peek's close control unless a layer above owns Escape;
 * - when the user closes it, returns focus to the item it showed (after paging, not the
 *   original invoker); when the application closes it, only if focus would otherwise be lost;
 * - where the peek is a sheet (below 64rem), scrolls the invoker out from under it.
 * @param {HTMLElement} layout the `[data-ui="peek-layout"]` element
 * @returns {() => void}
 */
export const attachPeekInteractions = (layout) => {
  // An island can retain its layout while replacing the aside on each render.
  const aside = () =>
    /** @type {HTMLElement | null} */ (layout.querySelector(':scope > [data-ui="peek-layout-aside"]'))
  const id = layout.dataset.peekId
  if (!aside() || !id) return () => {}
  const selector = `[aria-controls="${CSS.escape(id)}"]`
  const closeSelector = `#${CSS.escape(id)}-close`
  const panel = () => /** @type {HTMLElement | null} */ (aside()?.querySelector('[data-ui="peek"]'))
  const lost = () => !document.activeElement || document.activeElement === document.body
  /** The item the peek currently shows, as the view marks it. */
  const marked = () =>
    /** @type {HTMLElement | null} */ (
      layout.querySelector(`[data-ui="peek-layout-main"] ${selector}[aria-current="true"]`)
    )
  /** @type {HTMLElement | null} */
  let invoker = null
  // Where a user's close goes back to, taken when they ask: the view may unmark its item
  // before the peek leaves the DOM, and the pager may have moved past the invoker.
  /** @type {HTMLElement | null} */
  let returnTo = null
  let opening = false
  let restore = false
  // Whether focus was last inside the peek: a removed element takes focus to <body> silently.
  let inside = false
  let open = panel() !== null

  /** @param {MouseEvent | KeyboardEvent} event */
  const pick = (event) => {
    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return
    const origin = /** @type {Element | null} */ (event.target)
    const target = /** @type {HTMLElement | null} */ (origin?.closest?.(selector) ?? null)
    if (target && !aside()?.contains(target)) {
      invoker = target
      opening = true
    } else if (origin?.closest?.(closeSelector)) {
      restore = true
      returnTo = marked() ?? invoker
    }
  }
  /** @param {FocusEvent} event */
  const focusin = (event) => {
    inside = Boolean(aside()?.contains(/** @type {Node | null} */ (event.target)))
  }
  /** @param {KeyboardEvent} event */
  const keydown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    const current = panel()
    if (!current || document.querySelector(LAYERS_ABOVE)) return
    if (!lost() && !layout.contains(document.activeElement)) return
    const close = /** @type {HTMLElement | null} */ (current.querySelector(closeSelector))
    if (!close) return
    restore = true
    returnTo = marked() ?? invoker
    event.preventDefault()
    close.click()
  }
  const returnFocus = () => {
    const target = [returnTo, invoker, marked()].find((node) => node?.isConnected)
    target?.focus()
  }
  /** @param {HTMLElement} current */
  const clearSheet = (current) => {
    const rail = aside()
    if (!rail || !invoker?.isConnected || getComputedStyle(rail).position !== 'fixed') return
    if (invoker.getBoundingClientRect().bottom > current.getBoundingClientRect().top)
      invoker.scrollIntoView({ block: 'center', behavior: 'auto' })
  }
  const changed = () => {
    const current = panel()
    if (current && !open) {
      if (opening) current.focus({ preventScroll: true })
      clearSheet(current)
    } else if (current && inside && lost()) {
      // A re-render replaced the control that had focus (the pager, for instance).
      current.focus({ preventScroll: true })
    } else if (!current && open && (restore || (inside && lost()))) {
      returnFocus()
    }
    if (!current) {
      restore = false
      returnTo = null
    }
    opening = false
    open = current !== null
  }
  const observer = new MutationObserver(changed)
  observer.observe(layout, { childList: true, subtree: true })
  layout.addEventListener('click', pick, true)
  layout.addEventListener('keydown', pick, true)
  // Bubble phase: an inner popup or a dialog's capture handler gets Escape first.
  document.addEventListener('keydown', keydown)
  document.addEventListener('focusin', focusin)
  return () => {
    observer.disconnect()
    layout.removeEventListener('click', pick, true)
    layout.removeEventListener('keydown', pick, true)
    document.removeEventListener('keydown', keydown)
    document.removeEventListener('focusin', focusin)
  }
}
