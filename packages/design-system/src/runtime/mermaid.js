// @ts-check
import { createMermaidTheme, readMermaidPalette, hasMermaidOverrides } from './mermaid-theme.js'

/** @typedef {{initialize: (config: ReturnType<typeof createMermaidTheme>) => void, render: (id:string, source:string, container?:Element) => Promise<{svg:string}>}} MermaidEngine */
/** @type {(() => Promise<MermaidEngine>) | null} */
let loader = null
/** @type {Promise<MermaidEngine> | null} */
let engine = null
let sequence = 0
let queue = Promise.resolve()
const DIAGRAM_INSET = 8
/**
 * Mermaid sizes its view box in the off-screen host, and the drawing can land elsewhere in that
 * box (shifted, clipped on one side). Once shown, the box is fitted to what is drawn here.
 * @internal Not part of the public runtime entry.
 * @param {SVGSVGElement} diagram
 */
export const fitDiagram = (diagram) => {
  const box = typeof diagram.getBBox === 'function' ? diagram.getBBox() : null
  if (!box?.width || !box.height) return
  const inset = DIAGRAM_INSET
  diagram.setAttribute(
    'viewBox',
    `${box.x - inset} ${box.y - inset} ${box.width + 2 * inset} ${box.height + 2 * inset}`,
  )
  // Retained Mermaid width/height would preserve the old intrinsic ratio and scale the text.
  diagram.removeAttribute('width')
  diagram.removeAttribute('height')
}

/** A host bundles/pins Mermaid; all presentation and rendering policy stays here. @param {() => Promise<MermaidEngine>} load */
export const configureMermaidLoader = (load) => {
  loader = load
  engine = null
}

/** Enhance SSR sources. Hidden help drawers are deferred until the runtime opens them. @param {Document | HTMLElement} [root] */
export const attachMermaidDiagrams = (root = document) => {
  let disposed = false
  const figures = [...root.querySelectorAll('[data-ui="mermaid"]')].filter(
    (figure) => figure instanceof HTMLElement && !figure.closest('dialog:not([open])'),
  )
  /** @type {WeakMap<Element, number>} */
  const revisions = new WeakMap()
  /** @param {Element} figure */
  const render = (figure) => {
    if (!(figure instanceof HTMLElement)) return
    const source = figure.querySelector('[data-ui="mermaid-source"]')
    const code = source?.querySelector('code')
    const canvas = figure.querySelector('[data-ui="mermaid-canvas"]')
    const status = figure.querySelector('[data-ui="mermaid-status"]')
    if (
      !(source instanceof HTMLDetailsElement) ||
      !(canvas instanceof HTMLElement) ||
      !(status instanceof HTMLElement)
    )
      return
    const revision = (revisions.get(figure) ?? 0) + 1
    revisions.set(figure, revision)
    const current = () => !disposed && figure.isConnected && revisions.get(figure) === revision
    const text = code?.textContent ?? ''
    figure.dataset.state = 'loading'
    status.textContent = figure.dataset.loadingLabel ?? ''
    status.hidden = false
    canvas.hidden = true
    // Mermaid has process-wide configuration. Serialize initialize + render, including distinct themes.
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (!current()) return
        try {
          if (!loader || hasMermaidOverrides(text))
            throw new Error('No renderer or unsupported diagram configuration')
          engine ??= loader().catch((error) => {
            engine = null
            throw error
          })
          const mermaid = await engine
          if (!current()) return
          await document.fonts?.ready
          mermaid.initialize(createMermaidTheme(readMermaidPalette(figure)))
          const id = `kv-mermaid-${++sequence}`
          // An off-screen host isolates Mermaid's temporary SVG from the application body.
          const host = document.createElement('div')
          host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;'
          document.body.append(host)
          let svg
          try {
            svg = (await mermaid.render(id, text, host)).svg
          } finally {
            host.remove()
          }
          if (!current()) return
          // Only the strict Mermaid engine's sanitized SVG crosses this boundary; Markdown never does.
          canvas.innerHTML = svg
          const diagram = canvas.querySelector('svg')
          if (!diagram) throw new Error('Renderer returned no SVG')
          canvas.hidden = false
          fitDiagram(diagram)
          const width = diagram.viewBox.baseVal.width
          diagram.style.width = `${width}px`
          diagram.style.maxWidth = 'none'
          diagram.style.height = 'auto'
          diagram.setAttribute('role', 'img')
          if (!diagram.querySelector('title'))
            diagram.setAttribute('aria-label', canvas.getAttribute('aria-label') ?? '')
          source.open = false
          status.hidden = true
          figure.dataset.state = 'ready'
        } catch {
          if (!current()) return
          figure.dataset.state = 'error'
          status.textContent = figure.dataset.errorLabel ?? ''
          source.open = true
        }
      })
  }
  for (const figure of figures) render(figure)
  const owners = new Set([
    document.documentElement,
    ...figures.map(
      (figure) =>
        figure.closest('[data-theme]') ??
        figure.closest('[data-kv-design-system]') ??
        document.documentElement,
    ),
  ])
  const observer = new MutationObserver(() => {
    for (const figure of figures) render(figure)
  })
  for (const owner of owners)
    observer.observe(owner, { attributes: true, attributeFilter: ['data-theme', 'data-kv-theme'] })
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const refresh = () => {
    for (const figure of figures) render(figure)
  }
  media.addEventListener('change', refresh)
  return () => {
    disposed = true
    observer.disconnect()
    media.removeEventListener('change', refresh)
  }
}
