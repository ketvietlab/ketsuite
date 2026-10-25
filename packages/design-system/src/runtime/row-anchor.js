const PREFIX = 'row='
const STATE = 'kvRowAnchor'
const ROW = '[data-ui="kt-row"]'
const SCROLL = '[data-ui="kt-scroll"]'

/**
 * Keeping the reader's place in a collection while one of its rows opens on a record page.
 *
 * The way back names the row: a row link carries the collection URL in `returnTo` with the
 * fragment `#row=<id>` (`rowAnchorHref`), and before the link is followed the current history
 * entry gets the same fragment plus where the row stood on screen (`rememberRowAnchor`).
 * Coming back through the page's way back or through Back, the collection reads the anchor
 * (`takeRowAnchor`), renders its rows with that row current (`KetTable`'s `currentRow`) and,
 * once they are on screen, puts the row back where it stood and focus on its link
 * (`restoreRowAnchor`). The fragment names no element, so the browser leaves it to this
 * runtime. A native record link also carries the measured position in its `returnTo`
 * fragment, so its header's way back restores the same position without storage.
 */

/**
 * The collection link that returns to one row: `href` with its fragment set to the row.
 * @param {string} href the collection's current URL (path and query)
 * @param {string} rowId
 * @param {{ top?: number | null, left?: number }} [position]
 * @returns {string}
 */
export const rowAnchorHref = (href, rowId, position = {}) => {
  const top = typeof position.top === 'number' && Number.isFinite(position.top) ? `&top=${position.top}` : ''
  const left =
    typeof position.left === 'number' && Number.isFinite(position.left) && position.left >= 0
      ? `&left=${position.left}`
      : ''
  return `${href.split('#')[0]}#${PREFIX}${encodeURIComponent(rowId)}${top}${left}`
}

/**
 * The row a collection URL returns to, with where it stood on screen if this history entry
 * remembers it, otherwise from the measured return fragment. Unmeasured links have null `top`.
 * @param {{ hash: string }} [url]
 * @param {unknown} [state]
 * @returns {{ id: string, top: number | null, left?: number } | null}
 */
export const readRowAnchor = (url = location, state = history.state) => {
  const hash = url.hash.replace(/^#/, '')
  if (!hash.startsWith(PREFIX)) return null
  let id = ''
  try {
    id = decodeURIComponent(hash.slice(PREFIX.length).split('&')[0])
  } catch {
    return null
  }
  if (!id) return null
  const saved = /** @type {{ [STATE]?: { id?: unknown, top?: unknown, left?: unknown } } | null} */ (state)?.[
    STATE
  ]
  const params = new URLSearchParams(hash)
  /** @param {string} name */
  const measured = (name) => {
    const raw = params.get(name)
    return raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null
  }
  const top =
    saved?.id === id && typeof saved.top === 'number' && Number.isFinite(saved.top)
      ? saved.top
      : measured('top')
  const left =
    saved?.id === id && typeof saved.left === 'number' && Number.isFinite(saved.left)
      ? saved.left
      : measured('left')
  return { id, top, ...(left !== null && left >= 0 ? { left } : {}) }
}

/**
 * The anchor of the page being loaded. While it waits for the rows, the browser must not
 * restore an old scroll offset over a page that is still short, so scroll restoration is
 * manual until `restoreRowAnchor` has run.
 * @returns {{ id: string, top: number | null, left?: number } | null}
 */
export const takeRowAnchor = () => {
  const anchor = readRowAnchor()
  if (anchor && 'scrollRestoration' in history) history.scrollRestoration = 'manual'
  return anchor
}

/**
 * Call when a plain click (not one opening a new tab) follows a row link: the current entry
 * names that row and its position, so Back returns to it.
 * @param {Element} link the followed link inside a `[data-ui="kt-row"]`
 * @returns {string | null} the row id
 */
export const rememberRowAnchor = (link) => {
  const row = /** @type {HTMLElement | null} */ (link.closest(ROW))
  const id = row?.dataset.row
  if (!row || !id) return null
  const url = new URL(location.href)
  const scroller = /** @type {HTMLElement | null} */ (row.closest(SCROLL))
  const position = {
    id,
    top: row.getBoundingClientRect().top,
    ...(scroller ? { left: scroller.scrollLeft } : {}),
  }
  const anchored = rowAnchorHref(url.href, id)
  const state = history.state && typeof history.state === 'object' ? history.state : {}
  history.replaceState({ ...state, [STATE]: position }, '', anchored)
  const href = link.getAttribute('href')
  if (href) {
    const target = new URL(href, url)
    const returnTo = target.searchParams.get('returnTo')
    if (returnTo && target.origin === url.origin) {
      const back = new URL(returnTo, url)
      if (back.origin === url.origin && back.pathname === url.pathname) {
        target.searchParams.set('returnTo', rowAnchorHref(`${back.pathname}${back.search}`, id, position))
        const next = `${target.pathname}${target.search}${target.hash}`
        link.setAttribute('href', next)
        if (row.dataset.rowHref === href) row.dataset.rowHref = next
      }
    }
  }
  return id
}

/** @param {Element} node */
const scrollerOf = (node) => {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent)
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight)
      return parent
  }
  return document.scrollingElement ?? document.documentElement
}

/**
 * Once the rows are rendered: scroll the anchored row back to where it stood (or to the middle
 * of the view when that is unknown or no longer on screen) and focus its link without scrolling
 * again, unless focus is already inside the row. Scroll restoration is handed back to the
 * browser either way.
 * @param {ParentNode} root the element holding the collection's rows
 * @param {{ id: string, top: number | null, left?: number }} anchor
 * @returns {boolean} whether the row is among the rows shown
 */
export const restoreRowAnchor = (root, anchor) => {
  if ('scrollRestoration' in history) history.scrollRestoration = 'auto'
  const row = /** @type {HTMLElement | null} */ (
    root.querySelector(`${ROW}[data-row="${CSS.escape(anchor.id)}"]`)
  )
  if (!row) return false
  const scroller = /** @type {HTMLElement | null} */ (row.closest(SCROLL))
  if (scroller && typeof anchor.left === 'number' && Number.isFinite(anchor.left))
    scroller.scrollLeft = anchor.left
  const box = row.getBoundingClientRect()
  const fits = anchor.top !== null && anchor.top >= 0 && anchor.top + box.height <= innerHeight
  if (fits) scrollerOf(row).scrollTop += box.top - /** @type {number} */ (anchor.top)
  else row.scrollIntoView({ block: 'center' })
  // A control in this row that already holds focus keeps it: a modal opened from one of the
  // row's own actions has given focus back to that action, which is where the reader was.
  if (row.contains(document.activeElement)) return true
  const link = /** @type {HTMLElement | null} */ (row.querySelector('[data-ui="kt-row-link"]'))
  ;(link ?? row).focus({ preventScroll: true })
  return true
}
