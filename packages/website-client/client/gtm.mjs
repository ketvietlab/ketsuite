// Opt-in site tracking. This module is served from the visitor site, without inline JavaScript.
import { readConsent } from './consent.mjs'
/**
 * @param {Document} doc
 * @param {string | undefined} id
 * @param {(Window & {dataLayer?: Record<string, unknown>[], google_tag_manager?: Record<string, unknown>}) | null} view
 */
export function installGoogleTagManager(doc, id, view = doc.defaultView) {
  if (!id || !/^GTM-[A-Z0-9]{4,20}$/.test(id) || !view) return null
  const src = `https://www.googletagmanager.com/gtm.js?id=${id}`
  const existing = doc.querySelector(`script[src="${src}"]`)
  if (existing) return existing
  const root = doc.documentElement
  view.dataLayer = view.dataLayer || []
  view.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
  const script = doc.createElement('script')
  script.async = true
  script.src = src
  script.dataset.websiteGtmContainer = id
  root.dataset.websiteGtmState = 'loading'
  script.addEventListener('load', () => {
    root.dataset.websiteGtmState = view.google_tag_manager?.[id] ? 'ready' : 'loaded'
  })
  script.addEventListener('error', () => {
    root.dataset.websiteGtmState = 'error'
  })
  doc.head.append(script)
  return script
}

/**
 * Install the container now, or, when the site asks before tracking, once the visitor agrees.
 * @param {Document} doc
 * @param {HTMLScriptElement} loader
 */
export function installWhenAllowed(doc, loader) {
  const id = loader.dataset.websiteGtm
  const required = loader.dataset.websiteGtmConsent
  if (!required || readConsent(doc, required) === 'yes') return installGoogleTagManager(doc, id)
  doc.addEventListener('website:consent', (event) => {
    if (/** @type {CustomEvent} */ (event).detail?.granted) installGoogleTagManager(doc, id)
  })
  return null
}

if (typeof document !== 'undefined') {
  const loader = /** @type {HTMLScriptElement | null} */ (document.querySelector('script[data-website-gtm]'))
  if (loader) installWhenAllowed(document, loader)
}
