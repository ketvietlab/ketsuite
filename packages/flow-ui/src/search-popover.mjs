/** Owns only combobox overlay geometry and dismissal, never product state.
 * @param {HTMLElement} root @param {AbortSignal} signal */
export function attachSearchPopover(root, signal) {
  const initialized = new WeakSet()
  const selections = new WeakMap()
  const sync = () =>
    root.querySelectorAll('[data-flow="global-search"]').forEach((wrapper) => {
      const panel = wrapper.querySelector('[data-flow="global-search-panel"]')
      if (!(panel instanceof HTMLElement)) return
      if (!initialized.has(panel)) {
        initialized.add(panel)
        panel.addEventListener(
          'toggle',
          (event) => {
            if (event.newState === 'closed' && wrapper.getAttribute('data-open') === 'true')
              wrapper.dispatchEvent(new CustomEvent('flowsearchdismiss'))
          },
          { signal },
        )
      }
      if (wrapper.getAttribute('data-open') !== 'true') {
        if (panel.matches(':popover-open')) panel.hidePopover()
        return
      }
      const bounds = wrapper.getBoundingClientRect()
      const gutter = Number.parseFloat(getComputedStyle(root).getPropertyValue('--flow-page-gutter')) || 8
      panel.style.left = `${Math.max(gutter, bounds.left)}px`
      panel.style.top = `${bounds.bottom + gutter}px`
      panel.style.width = `${Math.min(bounds.width, window.innerWidth - gutter * 2)}px`
      panel.style.maxHeight = `${Math.max(0, window.innerHeight - bounds.bottom - gutter * 2)}px`
      if (!panel.matches(':popover-open')) panel.showPopover()
      const selected = wrapper.querySelector('input')?.getAttribute('aria-activedescendant')
      if (selected && selections.get(panel) !== selected) {
        selections.set(panel, selected)
        const option = panel.querySelector(`#${CSS.escape(selected)}`)
        if (option instanceof HTMLElement) {
          const region = panel.getBoundingClientRect(),
            item = option.getBoundingClientRect()
          if (item.bottom > region.bottom) panel.scrollTop += item.bottom - region.bottom
          else if (item.top < region.top) panel.scrollTop -= region.top - item.top
        }
      }
    })
  window.addEventListener('resize', sync, { signal })
  window.addEventListener('scroll', sync, { capture: true, signal })
  return {
    sync,
    dispose: () =>
      root.querySelectorAll('[data-flow="global-search-panel"]:popover-open').forEach((panel) => {
        if (panel instanceof HTMLElement) panel.hidePopover()
      }),
  }
}
