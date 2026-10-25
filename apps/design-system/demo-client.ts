// Progressive enhancement belongs to this demo app, not to the component package.
// The server serves this public runtime at the absolute asset URL.
// @ts-expect-error Browser asset import, not a TypeScript filesystem module.
import { attachDesignSystemInteractions, configureMermaidLoader } from '/design-system/runtime/index.js'
// @ts-expect-error Host-owned lazy browser bundle; the DS does not import a Mermaid package.
configureMermaidLoader(async () => (await import('/design-system/vendor/mermaid.mjs')).default)
let disposeInteractions = attachDesignSystemInteractions(document)
document.documentElement.dataset.kvInteractions = 'attached'

let disposePage = () => {}
const bindPage = () => {
  disposePage()
  const lifetime = new AbortController()
  disposePage = () => lifetime.abort()

  const app = document.querySelector<HTMLElement>('[data-demo-app]')
  if (app) {
    const rows = [...app.querySelectorAll<HTMLInputElement>('[data-ui="row-select"]')]
    const all = app.querySelector<HTMLInputElement>('[data-ui="select-all"]')
    const updateSelection = () => {
      const count = rows.filter((row) => row.checked).length
      const summary = document.getElementById('selection-summary')
      const bulk = app.querySelector<HTMLElement>('[data-ui="bulk-actions"]')
      if (summary) summary.textContent = `${count} đơn được chọn`
      if (bulk) {
        if (count > 0) bulk.setAttribute('data-has-selection', 'true')
        else bulk.removeAttribute('data-has-selection')
      }
      app.querySelectorAll<HTMLButtonElement>('[data-ui="bulk-actions"] button').forEach((button) => {
        button.disabled = count === 0
      })
      if (all) {
        all.checked = rows.length > 0 && count === rows.length
        all.indeterminate = count > 0 && count < rows.length
      }
    }
    all?.addEventListener('change', () => {
      rows.forEach((row) => {
        row.checked = all.checked
      })
      updateSelection()
    })
    rows.forEach((row) => {
      row.addEventListener('change', updateSelection)
    })
    updateSelection()

    const form = app.querySelector<HTMLFormElement>('#order-form')
    let dirty = false
    form?.addEventListener('input', () => {
      dirty = true
    })
    form?.addEventListener('submit', () => {
      dirty = false
    })
    // Fragment navigation does not fire beforeunload; keep the existing dirty-form guard.
    document.addEventListener(
      'click',
      (event) => {
        if (
          !dirty ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return
        const link =
          event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
        if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
        const target = new URL(link.href)
        if (target.origin !== location.origin) return
        const message =
          document.documentElement.lang === 'en' ? 'Discard unsaved changes?' : 'Bỏ các thay đổi chưa lưu?'
        if (!window.confirm(message)) {
          event.preventDefault()
          event.stopImmediatePropagation()
        } else dirty = false
      },
      { capture: true, signal: lifetime.signal },
    )

    window.addEventListener(
      'beforeunload',
      (event) => {
        if (dirty) {
          event.preventDefault()
          event.returnValue = ''
        }
      },
      { signal: lifetime.signal },
    )
  }
}
bindPage()
document.addEventListener('ket:navigation-start', () => {
  disposePage()
  disposeInteractions()
})
document.addEventListener('ket:navigation-complete', () => {
  const app = document.querySelector<HTMLElement>('[data-demo-app]')
  const stateNode = app?.querySelector<HTMLElement>('[data-demo-navigation-state]')
  if (!app || !stateNode) return
  const state = JSON.parse(stateNode.dataset.demoNavigationState!) as {
    activeHrefs: string[]
    theme: string
    locale: string
    globalQuery: string
    themeLabel: string
    themeIcon: string
    themeHref: string
  }
  const themeChanged = app.dataset.theme !== state.theme
  app.dataset.theme = state.theme
  // URLs change with theme/locale while the shell elements keep their identity.
  for (const link of app.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.closest('[data-ket-slot="demo.content"], [data-ket-slot="demo.overlay"]')) continue
    const url = new URL(link.href)
    if (url.pathname !== '/demo2' && url.pathname !== '/demo') continue
    url.searchParams.set('theme', state.theme)
    if (state.locale === 'en') url.searchParams.set('lang', 'en')
    else url.searchParams.delete('lang')
    link.href = url.href
  }
  const themeToggle = app.querySelector<HTMLAnchorElement>('[data-demo-theme-toggle] a')
  if (themeToggle) {
    themeToggle.href = state.themeHref
    if (themeChanged) {
      themeToggle.setAttribute('aria-label', state.themeLabel)
      themeToggle.setAttribute('title', state.themeLabel)
      const icon = themeToggle.querySelector('svg')
      if (icon)
        icon.replaceWith(
          new DOMParser().parseFromString(state.themeIcon, 'text/html').body.firstElementChild!,
        )
    }
  }
  const search = app.querySelector<HTMLFormElement>('[data-ui="global-search-dialog"] form')
  if (search) {
    search.action = `${location.pathname}/search/${state.theme}`
    const language = search.querySelector<HTMLInputElement>('input[name="lang"]')
    if (language) language.value = state.locale
  }
  const launcher = app.querySelector<HTMLAnchorElement>('[data-ui="global-search-trigger"]')
  if (launcher)
    launcher.href = `${location.pathname}/search/${state.theme}?${new URLSearchParams({ lang: state.locale, q: state.globalQuery })}`
  const active = new Set(state.activeHrefs.map((href) => new URL(href, location.href).href))
  for (const link of app.querySelectorAll<HTMLAnchorElement>('[data-ui="navigation-item"]')) {
    if (active.has(link.href)) {
      link.dataset.active = 'true'
      link.setAttribute('aria-current', 'page')
    } else {
      delete link.dataset.active
      link.removeAttribute('aria-current')
    }
  }
  // Retain the existing branches and their scroll position; reveal the active path.
  const branches = [...app.querySelectorAll<HTMLDetailsElement>('[data-ui="navigation-branch"]')]
  for (const branch of branches) branch.open = Boolean(branch.querySelector('[aria-current="page"]'))
  disposeInteractions = attachDesignSystemInteractions(document)
  bindPage()
})
