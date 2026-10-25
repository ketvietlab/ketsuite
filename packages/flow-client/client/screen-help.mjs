import { signal } from '@ketvietlab/ketjs-view'
import { flowHelpRoutes } from './help-routes.generated.mjs'
import { FlowScreenHelp, FlowHelpTrigger } from '@ketvietlab/flow-ui/workspace'
import { flowLocale, tr } from './i18n.mjs'

const knownRoutes = new Set(flowHelpRoutes)
export const hasFlowHelp = (route) => knownRoutes.has(route)
let loaded
export const loadScreenHelp = () =>
  (loaded ??= import('./help.generated.mjs')
    .then(
      ({ flowHelp }) =>
        new Map(Object.values(flowHelp).flatMap((guide) => guide.routes.map((route) => [route, guide]))),
    )
    .catch((error) => {
      loaded = undefined
      throw error
    }))
const labels = () =>
  Object.fromEntries(
    ['label', 'close', 'diagram', 'source', 'loading', 'error', 'table'].map((key) => [
      key,
      tr('flow.help.' + key),
    ]),
  )
export const screenHelpTrigger = (route) =>
  hasFlowHelp(route) ? FlowHelpTrigger({ label: labels().label }) : null
export function screenHelp(route, title, guides) {
  const guide = guides?.get(route)
  if (!guide) return null
  const content = guide[flowLocale() === 'vi' ? 'vi' : 'en'],
    text = labels()
  return FlowScreenHelp({
    id: `flow-help-${route}`,
    label: text.label,
    title,
    closeLabel: text.close,
    source: content.source,
    lexer: () => content.tokens,
    labels: text,
  })
}

/** Keep DS drawer/runtime ownership. Load guide content only after an explicit
 * request, then let the existing DS request handler open the rendered drawer. */
export function createScreenHelp(ctx) {
  const current = signal(null)
  let pending = null,
    requesting = false,
    disposed = false
  const request = async (event) => {
    if (event.defaultPrevented || !ctx.allowed() || !hasFlowHelp(ctx.route())) return
    if (current()?.key === ctx.key()) return
    event.preventDefault()
    if (requesting) return
    requesting = true
    const key = ctx.key(),
      trigger = event.target
    trigger.setAttribute?.('aria-busy', 'true')
    try {
      const guides = await (ctx.load ?? loadScreenHelp)()
      if (disposed || key !== ctx.key() || !ctx.allowed()) return
      pending = { key, trigger }
      current.set({ key, guides })
    } catch {
      if (!disposed && key === ctx.key() && ctx.allowed()) ctx.error(tr('flow.help.error'))
    } finally {
      requesting = false
      trigger.removeAttribute?.('aria-busy')
    }
  }
  return {
    attach(root, lifetime) {
      root.addEventListener('ket:screen-help-request', request, { capture: true, signal: lifetime })
    },
    afterRender(root) {
      if (!pending) return
      const next = pending
      if (next.key !== ctx.key() || !ctx.allowed()) {
        pending = null
        return
      }
      if (!root.querySelector('[data-ui="help-drawer"]')) return
      pending = null
      const trigger = next.trigger.isConnected
        ? next.trigger
        : root.querySelector('[data-ui="app-switcher-help"]')
      trigger?.dispatchEvent(new CustomEvent('ket:screen-help-request', { bubbles: true, cancelable: true }))
    },
    view() {
      const value = current()
      return value?.key === ctx.key() && ctx.allowed()
        ? screenHelp(ctx.route(), ctx.title(), value.guides)
        : null
    },
    dispose() {
      disposed = true
      pending = null
    },
  }
}
