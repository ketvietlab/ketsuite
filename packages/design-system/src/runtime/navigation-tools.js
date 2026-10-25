// @ts-check
/** @typedef {{ hidden: boolean | 'until-found', open: boolean, name: string | null }} NavigationSnapshot */
/** Case- and accent-insensitive labels, including Vietnamese Đ. @param {string} value */
export const normalizeMenuSearch = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()

/**
 * Filter only the host's already-permitted links; restore branch state after searching.
 * @param {HTMLElement} groups
 * @param {string} query
 * @param {Map<HTMLElement, NavigationSnapshot>} snapshots
 */
export const filterNavigationMenu = (groups, query, snapshots) => {
  const term = normalizeMenuSearch(query)
  for (const [element, state] of snapshots) {
    if (!groups.contains(element)) {
      snapshots.delete(element)
      continue
    }
    element.hidden = state.hidden
    if (element instanceof HTMLDetailsElement) {
      element.open = state.open
      if (state.name === null) element.removeAttribute('name')
      else element.setAttribute('name', state.name)
    }
  }
  if (!term) {
    snapshots.clear()
    return 0
  }
  /** @param {HTMLElement} element */
  const remember = (element) => {
    if (!snapshots.has(element))
      snapshots.set(element, {
        hidden: element.hidden,
        open: element instanceof HTMLDetailsElement && Boolean(element.open),
        name: element.getAttribute('name'),
      })
  }
  const links = /** @type {HTMLElement[]} */ ([...groups.querySelectorAll('[data-ui="navigation-item"]')])
  let matches = 0
  for (const link of links) {
    remember(link)
    const labels = [
      link.querySelector('[data-ui="navigation-item-label"]')?.textContent ?? link.textContent ?? '',
    ]
    for (let parent = link.parentElement; parent && parent !== groups; parent = parent.parentElement) {
      if (parent.matches('[data-ui="navigation-branch"]'))
        labels.unshift(
          parent.querySelector(':scope > summary [data-ui="navigation-item-label"]')?.textContent ?? '',
        )
      if (parent.matches('[data-ui="navigation-group"]'))
        labels.unshift(parent.querySelector(':scope > [data-ui="navigation-group-label"]')?.textContent ?? '')
    }
    const visible = !snapshots.get(link)?.hidden && normalizeMenuSearch(labels.join(' ')).includes(term)
    link.hidden = !visible
    if (visible) matches++
  }
  for (const element of /** @type {NodeListOf<HTMLElement>} */ (
    groups.querySelectorAll('[data-ui="navigation-branch"], [data-ui="navigation-group"]')
  )) {
    remember(element)
    const visible = [...element.querySelectorAll('[data-ui="navigation-item"]')].some(
      (link) => !(/** @type {HTMLElement} */ (link).hidden),
    )
    element.hidden = (snapshots.get(element)?.hidden ?? false) || !visible
    if (element instanceof HTMLDetailsElement) {
      // Native exclusive accordions otherwise close other matching branches.
      element.removeAttribute('name')
      element.open = visible
    }
  }
  return matches
}

/**
 * Narrow a settings directory to the links, modules and sections that match.
 * A module whose name matches keeps all its links. Returns how many links show.
 * @param {HTMLElement} directory
 * @param {string} query
 */
export const filterSettingsDirectory = (directory, query) => {
  const term = normalizeMenuSearch(query)
  let shown = 0
  for (const section of directory.querySelectorAll('[data-ui="settings-directory-section"]')) {
    if (!(section instanceof HTMLElement)) continue
    let sectionShown = 0
    for (const module of section.querySelectorAll('[data-ui="settings-directory-module"]')) {
      if (!(module instanceof HTMLElement)) continue
      const title = module.querySelector('[data-ui="settings-directory-module-title"]')?.textContent ?? ''
      const whole = !term || normalizeMenuSearch(title).includes(term)
      let moduleShown = 0
      for (const link of module.querySelectorAll('[data-ui="settings-directory-link"]')) {
        const item = link.closest('li')
        if (!(item instanceof HTMLElement)) continue
        item.hidden = !(whole || normalizeMenuSearch(link.textContent ?? '').includes(term))
        if (!item.hidden) moduleShown++
      }
      module.hidden = moduleShown === 0
      sectionShown += moduleShown
    }
    section.hidden = sectionShown === 0
    shown += sectionShown
  }
  const empty = directory.querySelector('[data-ui="settings-directory-empty"]')
  if (empty instanceof HTMLElement) empty.hidden = !term || shown > 0
  return shown
}

/** Persistent shell controls. Content navigation never owns this state. @param {ParentNode} [root] */
export const attachNavigationTools = (root = document) => {
  /** @type {(() => void)[]} */
  const cleanups = []
  for (const input of root.querySelectorAll('[data-ui="settings-directory-search-input"]')) {
    const directory = input.closest('[data-ui="settings-directory"]')
    if (!(input instanceof HTMLInputElement) || !(directory instanceof HTMLElement)) continue
    const filter = () => filterSettingsDirectory(directory, input.value)
    /** @param {KeyboardEvent} event */
    const clear = (event) => {
      if (event.key !== 'Escape' || !input.value) return
      event.preventDefault()
      input.value = ''
      filter()
    }
    input.addEventListener('input', filter)
    input.addEventListener('keydown', clear)
    // A value restored by the browser after back navigation is applied at once.
    if (input.value) filter()
    cleanups.push(() => {
      input.removeEventListener('input', filter)
      input.removeEventListener('keydown', clear)
      filterSettingsDirectory(directory, '')
    })
  }
  for (const navigation of root.querySelectorAll('[data-ui="app-navigation"][data-has-tools="true"]')) {
    const shell = navigation.closest('[data-ui="app-shell"]')
    const sidebarNode = navigation.closest('[data-ui="app-sidebar"]')
    const sidebar = sidebarNode instanceof HTMLElement ? sidebarNode : null
    /** @param {string} selector */
    const find = (selector) => {
      const element = navigation.querySelector(selector)
      return element instanceof HTMLElement ? element : null
    }
    const drawer = navigation.querySelector('[data-ui="navigation-drawer"]')
    const panel = find('[data-ui="navigation-search"]')
    const input = navigation.querySelector('[data-ui="navigation-search-input"]')
    const search = find('[data-ui="navigation-search-toggle"]')
    const collapse = find('[data-ui="navigation-collapse"]')
    const empty = find('[data-ui="navigation-search-empty"]')
    const groups = find('[data-ui="navigation-groups"]')
    if (
      !(shell instanceof HTMLElement) ||
      !(input instanceof HTMLInputElement) ||
      !panel ||
      !search ||
      !groups
    )
      continue
    const expand = /** @type {HTMLElement | undefined} */ (
      [...shell.querySelectorAll('[data-ui="app-switcher-expand"]')].find(
        (button) => button.getAttribute('aria-controls') === drawer?.id,
      )
    )
    const media = window.matchMedia('(width < 48rem)')
    const previousInert = sidebar?.inert ?? false
    const snapshots = /** @type {Map<HTMLElement, NavigationSnapshot>} */ (new Map())
    const filter = () => {
      const count = filterNavigationMenu(groups, input.value, snapshots)
      if (empty) empty.hidden = !normalizeMenuSearch(input.value) || count > 0
    }
    const toggleSearch = () => {
      panel.hidden = !panel.hidden
      search.setAttribute('aria-expanded', String(!panel.hidden))
      if (panel.hidden) {
        input.value = ''
        filter()
        search.focus()
      } else input.focus()
    }
    /** @param {KeyboardEvent} event */
    const searchKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        toggleSearch()
      }
    }
    const syncCollapsed = () => {
      const collapsed = shell.dataset.sidebarCollapsed === 'true' && !media.matches
      if (sidebar) sidebar.inert = collapsed || previousInert
      expand?.setAttribute('aria-expanded', String(!collapsed))
      collapse?.setAttribute('aria-expanded', String(!collapsed))
    }
    /** @param {boolean} collapsed */
    const setCollapsed = (collapsed) => {
      if (media.matches) return
      shell.dataset.sidebarCollapsed = String(collapsed)
      syncCollapsed()
      ;(collapsed ? expand : collapse)?.focus()
    }
    const fold = () => setCollapsed(true)
    const unfold = () => setCollapsed(false)
    search.addEventListener('click', toggleSearch)
    input.addEventListener('input', filter)
    input.addEventListener('keydown', searchKey)
    collapse?.addEventListener('click', fold)
    expand?.addEventListener('click', unfold)
    media.addEventListener('change', syncCollapsed)
    // The menu slot may be reconciled after navigation or a permission/context change.
    const observer = new MutationObserver(() => {
      if (input.value) filter()
    })
    observer.observe(groups, { childList: true, subtree: true })
    syncCollapsed()
    if (input.value) filter()
    cleanups.push(() => {
      observer.disconnect()
      filterNavigationMenu(groups, '', snapshots)
      if (sidebar) sidebar.inert = previousInert
      search.removeEventListener('click', toggleSearch)
      input.removeEventListener('input', filter)
      input.removeEventListener('keydown', searchKey)
      collapse?.removeEventListener('click', fold)
      expand?.removeEventListener('click', unfold)
      media.removeEventListener('change', syncCollapsed)
    })
  }
  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}
