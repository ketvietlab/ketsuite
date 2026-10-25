// Records a visit for a visitor who agreed to the site's notice. Served from the site, without
// inline JavaScript. A visitor who lands from an ad usually calls or opens a chat rather than
// checking out, so the visit keeps the ad click ids, what was looked at and which contact link was
// pressed; staff link it to the customer later.
import { readConsent, writeConsent } from './consent.mjs'

export const VISIT_PATH = '/_website/visit'
const VISITOR_STORE = 'kv.visitor'
const VISIT_STORE = 'kv.visit'
const CAMPAIGN_KEYS = [
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'ttclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
]

/**
 * The ad click ids and campaign tags a landing URL carries.
 * @param {string} search
 * @returns {Record<string, string> | null}
 */
export function campaignParams(search) {
  const query = new URLSearchParams(search)
  /** @type {Record<string, string>} */
  const picked = {}
  for (const key of CAMPAIGN_KEYS) {
    const value = query.get(key)
    if (value) picked[key] = value.slice(0, 512)
  }
  return Object.keys(picked).length ? picked : null
}

/**
 * The contact channel a link opens, and where it points.
 * @param {string} href
 * @param {string} base
 * @returns {{ channel: 'phone' | 'zalo' | 'messenger' | 'email', target: string } | null}
 */
export function contactOf(href, base) {
  let url
  try {
    url = new URL(href, base)
  } catch {
    return null
  }
  if (url.protocol === 'tel:') return { channel: 'phone', target: decodeURIComponent(url.pathname) }
  if (url.protocol === 'mailto:') return { channel: 'email', target: decodeURIComponent(url.pathname) }
  const host = url.hostname.toLowerCase()
  if (host === 'zalo.me' || host.endsWith('.zalo.me')) return { channel: 'zalo', target: host + url.pathname }
  if (host === 'm.me' || host === 'messenger.com' || host.endsWith('.messenger.com'))
    return { channel: 'messenger', target: host + url.pathname }
  return null
}

/** @param {Crypto} crypto */
const randomKey = (crypto) => {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** @param {Storage | null | undefined} store @param {string} key */
const readJson = (store, key) => {
  try {
    return JSON.parse(store?.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/**
 * @param {Document} doc
 * @param {Window & typeof globalThis} view
 */
export function installVisitTracking(doc, view = /** @type {any} */ (doc.defaultView)) {
  const loader = /** @type {HTMLScriptElement | null} */ (doc.querySelector('script[data-website-visit]'))
  if (!loader || !view) return null
  const version = Number(loader.dataset.websiteVisit)
  if (!Number.isInteger(version) || version <= 0) return null
  const subject = loader.dataset.subjectType
    ? { subjectType: loader.dataset.subjectType, subjectId: loader.dataset.subjectId ?? null }
    : {}
  const banner = /** @type {HTMLElement | null} */ (doc.querySelector('[data-website-consent]'))
  const reopen = /** @type {HTMLElement | null} */ (doc.querySelector('[data-website-consent-reopen]'))
  /** @type {string | null} */
  let visitId = null
  /** @type {string | null} */
  let visitorKey = null

  const ask = () => {
    if (banner) banner.hidden = false
    if (reopen) reopen.hidden = true
  }
  const answered = () => {
    if (banner) banner.hidden = true
    if (reopen) reopen.hidden = false
  }
  /** @param {boolean} granted */
  const announce = (granted) =>
    doc.dispatchEvent(new view.CustomEvent('website:consent', { detail: { granted } }))

  /** @param {string} url @param {Record<string, unknown>} body */
  const post = (url, body) =>
    view.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorKey, consentVersion: version, ...body }),
      credentials: 'same-origin',
      keepalive: true,
    })

  const start = async () => {
    visitorKey = view.localStorage?.getItem(VISITOR_STORE) ?? null
    if (!visitorKey) {
      visitorKey = randomKey(view.crypto)
      view.localStorage?.setItem(VISITOR_STORE, visitorKey)
    }
    const path = view.location.pathname
    const params = campaignParams(view.location.search)
    const stored = readJson(view.sessionStorage, VISIT_STORE)
    // A landing that carries a new click or campaign is a new visit; anything else continues one.
    if (stored?.id && stored.version === version && !params) {
      const response = await post(`${VISIT_PATH}/${encodeURIComponent(stored.id)}/events`, {
        kind: 'page',
        path,
        ...subject,
      })
      if (response.ok) {
        visitId = stored.id
        return
      }
    }
    let referrerHost = null
    try {
      const referrer = new URL(doc.referrer)
      if (referrer.host !== view.location.host) referrerHost = referrer.hostname
    } catch {
      /* No referrer, or one the browser withheld. */
    }
    const response = await post(VISIT_PATH, { path, params, referrerHost, ...subject })
    if (response.status === 409) {
      // The notice changed after this page was rendered: the agreement no longer holds.
      view.sessionStorage?.removeItem(VISIT_STORE)
      ask()
      return
    }
    if (!response.ok) return
    const body = await response.json()
    visitId = body.id
    view.sessionStorage?.setItem(VISIT_STORE, JSON.stringify({ id: visitId, version }))
  }

  doc.addEventListener(
    'click',
    (event) => {
      const target = /** @type {Element | null} */ (event.target)
      const link = target?.closest?.('a[href]')
      if (!link || !visitId) return
      const contact = contactOf(link.getAttribute('href') ?? '', view.location.href)
      if (!contact) return
      void post(`${VISIT_PATH}/${encodeURIComponent(visitId)}/events`, {
        kind: 'contact',
        path: view.location.pathname,
        ...subject,
        ...contact,
      }).catch(() => {})
    },
    true,
  )
  banner?.querySelector('[data-website-consent-accept]')?.addEventListener('click', () => {
    writeConsent(doc, version, 'yes')
    answered()
    announce(true)
    void start().catch(() => {})
  })
  banner?.querySelector('[data-website-consent-decline]')?.addEventListener('click', () => {
    writeConsent(doc, version, 'no')
    // Declining after agreeing ends tracking here: the browser forgets who it was.
    view.localStorage?.removeItem(VISITOR_STORE)
    view.sessionStorage?.removeItem(VISIT_STORE)
    visitId = null
    answered()
    announce(false)
  })
  reopen?.addEventListener('click', () => {
    ask()
    const first = banner?.querySelector('button')
    if (first instanceof view.HTMLElement) first.focus()
  })

  const answer = readConsent(doc, version)
  if (answer === null) ask()
  else answered()
  if (answer === 'yes') void start().catch(() => {})
  return { start }
}

if (typeof document !== 'undefined') installVisitTracking(document)
