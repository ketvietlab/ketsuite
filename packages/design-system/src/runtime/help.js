// @ts-check
import { attachMermaidDiagrams } from './mermaid.js'

const TRIGGERS = '[data-ui="app-switcher-help"], button[name="screen-help"]'

/** Native dialog lifetime: modeless desktop guidance, modal fullscreen mobile.
 * @param {Document | HTMLElement} [root]
 * @param {{beforeOpen?:(trigger:HTMLElement)=>HTMLElement|undefined}} [options] */
export const attachHelpDrawers = (root = document, options = {}) => {
  const drawers = () => [...root.querySelectorAll('[data-ui="help-drawer"]')]
  const media = window.matchMedia('(max-width: 767px)')
  /** @type {HTMLDialogElement | null} */
  let active = null
  /** @type {HTMLElement | null} */
  let invoker = null
  /** @type {HTMLElement | null} */
  let returnTo = null
  let disposeDiagrams = () => {}
  let scrollLocked = false
  let previousOverflow = ''
  /** @param {boolean} modal */
  const syncScroll = (modal) => {
    if (modal && !scrollLocked) {
      previousOverflow = document.documentElement.style.overflow
      document.documentElement.style.overflow = 'hidden'
      scrollLocked = true
    } else if (!modal && scrollLocked) {
      document.documentElement.style.overflow = previousOverflow
      scrollLocked = false
    }
  }
  /** @param {HTMLElement} trigger */
  const guideFor = (trigger) => {
    // A sheet, record page or peek with its own guide keeps it; one without falls back to the
    // screen's guide, which the content slot renders beside the page rather than inside it.
    const scopes = [
      trigger.closest('[data-ui="modal-sheet"], [data-ui="record-page"], [data-ui="peek"]'),
      trigger.closest('[data-ui="app-shell"]') ?? root,
    ]
    for (const scope of scopes) {
      if (!scope) continue
      const current = drawers().filter((candidate) => scope.contains(candidate))
      const guide =
        current.find((candidate) => candidate.id === trigger.getAttribute('aria-controls')) ?? current[0]
      if (guide) return guide
    }
    return undefined
  }
  for (const trigger of root.querySelectorAll(TRIGGERS)) {
    if (!(trigger instanceof HTMLElement)) continue
    const drawer = guideFor(trigger)
    if (drawer) {
      trigger.setAttribute('aria-controls', drawer.id)
      trigger.setAttribute('aria-expanded', 'false')
    }
  }
  const close = (restore = true) => {
    disposeDiagrams()
    if (active?.open) active.close()
    syncScroll(false)
    invoker?.setAttribute('aria-expanded', 'false')
    if (restore && returnTo?.isConnected) returnTo.focus()
    active = null
    invoker = null
    returnTo = null
  }
  /** @param {Event} event */
  const request = (event) => {
    if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return
    const trigger = event.target
    // Content-slot navigation replaces screen-owned guides while the shell lives on.
    const drawer = guideFor(trigger)
    if (!(drawer instanceof HTMLDialogElement)) return
    trigger.setAttribute('aria-controls', drawer.id)
    event.preventDefault()
    if (active === drawer && drawer.open) {
      close()
      return
    }
    close(false)
    invoker = trigger
    returnTo = trigger
    const hostReturnTo = options.beforeOpen?.(trigger)
    if (hostReturnTo instanceof HTMLElement) returnTo = hostReturnTo
    // Close navigation through its existing close control, so its inert/scroll state is restored.
    const navigation = trigger.closest('[data-ui="app-navigation"][open]')
    if (media.matches && navigation instanceof HTMLDetailsElement) {
      const controls = navigation.querySelector('[data-ui="navigation-drawer"]')?.id
      const toggle = [...root.querySelectorAll('[data-ui="navigation-toggle"]')].find(
        (node) => node.getAttribute('aria-controls') === controls,
      )
      if (toggle instanceof HTMLElement) returnTo = toggle
      const control = navigation.querySelector('[data-ui="navigation-close"]')
      if (control instanceof HTMLElement) control.click()
    }
    active = drawer
    syncScroll(media.matches)
    if (media.matches) drawer.showModal()
    else drawer.show()
    trigger.setAttribute('aria-expanded', 'true')
    const button = drawer.querySelector('[data-ui="help-close"]')
    if (button instanceof HTMLElement) button.focus()
    disposeDiagrams = attachMermaidDiagrams(drawer)
  }
  /** @param {MouseEvent} event */
  const click = (event) => {
    const trigger =
      event.target instanceof Element
        ? event.target.closest('[data-ui="app-switcher-help"], button[name="screen-help"]')
        : null
    if (trigger instanceof HTMLElement && root.contains(trigger) && !event.defaultPrevented) {
      event.preventDefault()
      trigger.dispatchEvent(
        new CustomEvent('ket:screen-help-request', {
          bubbles: true,
          cancelable: true,
          detail: { trigger },
        }),
      )
    }
    if (
      event.target instanceof Element &&
      event.target.closest('[data-ui="help-close"]') &&
      active?.contains(event.target)
    )
      close()
  }
  // Pressing anywhere outside the guide dismisses it, like the shared popups. Pointerdown, not
  // click: a text selection dragged out of the guide stays open, and keys never dismiss it.
  // The pointer moves focus itself, so it does not return to `?`; `?` toggles on its own.
  /** @param {PointerEvent} event */
  const pointerdown = (event) => {
    if (!active?.open || event.button !== 0 || !(event.target instanceof Element)) return
    if (active.contains(event.target) || event.target.closest(TRIGGERS)) return
    close(false)
  }
  /** @param {KeyboardEvent} event */
  const key = (event) => {
    if (!active?.open || event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (media.matches && event.key === 'Tab') {
      const items = [
        ...active.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]'),
      ].filter(
        (node) =>
          node instanceof HTMLElement &&
          node.tabIndex >= 0 &&
          !node.matches(':disabled') &&
          !node.closest('[hidden], [inert], [aria-hidden="true"], details:not([open]) > :not(summary)') &&
          (typeof node.checkVisibility !== 'function' || node.checkVisibility({ visibilityProperty: true })),
      )
      const first = items[0]
      const last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === active)) {
        event.preventDefault()
        if (last instanceof HTMLElement) last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        if (first instanceof HTMLElement) first.focus()
      }
    }
  }
  const resize = () => {
    if (!active?.open) return
    const focus = document.activeElement
    active.close()
    syncScroll(media.matches)
    if (media.matches) active.showModal()
    else active.show()
    if (focus instanceof HTMLElement && active.contains(focus)) focus.focus()
  }
  root.addEventListener('ket:screen-help-request', request)
  document.addEventListener('click', click)
  document.addEventListener('pointerdown', pointerdown)
  document.addEventListener('keydown', key)
  media.addEventListener('change', resize)
  return () => {
    root.removeEventListener('ket:screen-help-request', request)
    document.removeEventListener('click', click)
    document.removeEventListener('pointerdown', pointerdown)
    document.removeEventListener('keydown', key)
    media.removeEventListener('change', resize)
    close(false)
  }
}
