import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Peek, PeekLayout } from '@ketvietlab/design-system'

const render = (view: Parameters<typeof renderToString>[0]) =>
  renderToString(view).replace(/<!--.*?-->/gs, '')
const sheet = readFileSync('packages/design-system/src/patterns/peek/styles.css', 'utf8')

const peekView = (overrides: Partial<Parameters<typeof Peek>[0]> = {}) => (
  <Peek
    id="reservation-peek"
    eyebrow="R-1042"
    title="Alex Morgan"
    status={<span data-test="status">Due in</span>}
    body={<p data-test="summary">Summary</p>}
    actions={<button type="button">Check in</button>}
    record={{ label: 'Open reservation', href: '/reservations/R-1042' }}
    closeLabel="Close"
    closeHref="?view=all"
    previous={{ label: 'Previous arrival', href: '?view=all&peek=R-1041' }}
    next={{ label: 'Next arrival', href: null }}
    {...overrides}
  />
)
const peek = (overrides: Partial<Parameters<typeof Peek>[0]> = {}) => render(peekView(overrides))

test('peek is a labelled, non-modal complementary panel that always leads to the full record', () => {
  const html = peek()
  assert.match(html, /<aside data-ui="peek" aria-labelledby="reservation-peek-title" tabindex="-1">/)
  assert.doesNotMatch(html, /role="dialog"|aria-modal/)
  assert.match(
    html,
    /<div data-ui="peek-heading" aria-live="polite"><p data-ui="peek-eyebrow">R-1042<\/p><h2 data-ui="peek-title" id="reservation-peek-title">Alex Morgan<\/h2>/,
  )
  assert.match(html, /data-ui="peek-status"><span data-test="status">/)
  assert.match(html, /<footer data-ui="peek-foot"><div data-ui="peek-actions"><button type="button">Check in/)
  // The way to the full record is the expand tool in the head, so the commands keep the foot.
  const tools = html.slice(html.indexOf('data-ui="peek-tools"'), html.indexOf('data-ui="peek-status"'))
  assert.match(tools, /<a [^>]*href="\/reservations\/R-1042"[^>]*aria-label="Open reservation"[^>]*>/)
  assert.ok(tools.indexOf('Open reservation') < tools.indexOf('id="reservation-peek-close"'))
  // Close is the URL-owned link; its id is what Escape and the runtime click.
  assert.match(html, /<a id="reservation-peek-close"[^>]*href="\?view=all"[^>]*aria-label="Close"/)
  assert.match(html, /<a [^>]*href="\?view=all&amp;peek=R-1041"[^>]*aria-label="Previous arrival"/)
  // The end of the run is a disabled control, not a dead link.
  assert.match(html, /<button [^>]*disabled[^>]*aria-label="Next arrival"/)
  // The tools keep their target size; only the glyph is small, so the title leads the head.
  assert.equal(tools.match(/data-ui="icon"/g)?.length, 4)
  assert.equal(tools.match(/data-ui="icon"[^>]*data-size="small"/g)?.length, 4)
  assert.doesNotMatch(tools, /data-ui="action"[^>]*data-size="(compact|small)"/)
})

test('peek without a URL closes with a button and loads in place with a skeleton', () => {
  const html = peek({
    closeHref: null,
    loading: { label: 'Loading reservation' },
    previous: null,
    next: null,
  })
  assert.match(html, /<button id="reservation-peek-close"[^>]*type="button"[^>]*aria-label="Close"/)
  assert.match(html, /aria-label="Close"[^>]*>.*?data-ui="icon"[^>]*data-size="small"/s)
  assert.match(html, /<aside data-ui="peek"[^>]*aria-busy="true"/)
  assert.match(
    html,
    /data-ui="peek-body"><div data-ui="skeleton" role="status" aria-label="Loading reservation">/,
  )
  // The title stays; status, summary and commands wait for the record.
  assert.match(html, /Alex Morgan/)
  assert.doesNotMatch(html, /data-ui="peek-status"|data-test="summary"|data-ui="peek-actions"/)
  // The record stays reachable while it loads; the foot waits for the commands.
  assert.match(html, /aria-label="Open reservation"/)
  assert.doesNotMatch(html, /data-ui="peek-foot"/)
  assert.doesNotMatch(html, /Previous arrival|Next arrival/)
})

test('peek layout names its peek and docks by default', () => {
  const docked = render(<PeekLayout peekId="reservation-peek" main={<p>View</p>} />)
  assert.match(
    docked,
    /<div data-ui="peek-layout" data-peek-id="reservation-peek" data-mode="docked"><div data-ui="peek-layout-main"><p>View<\/p><\/div><div data-ui="peek-layout-aside" id="reservation-peek"><\/div><\/div>/,
  )
  assert.match(render(<PeekLayout peekId="p" mode="embedded" main="" />), /data-mode="embedded"/)
})

test('an invoker’s aria-controls names one element whether the peek is open or closed', () => {
  const invoker = (
    <a href="?peek=R-1042" aria-controls="reservation-peek" aria-current="true">
      R-1042
    </a>
  )
  for (const peek of [undefined, peekView()]) {
    const html = render(<PeekLayout peekId="reservation-peek" main={invoker} peek={peek} />)
    const named = [...html.matchAll(/<\w+[^>]*\sid="reservation-peek"[^>]*>/g)].map(([tag]) => tag)
    assert.equal(named.length, 1, peek ? 'open' : 'closed')
    assert.match(named[0], /data-ui="peek-layout-aside"/, 'the place keeps the id')
  }
})

test('peek layout CSS: a rail beside the view, sticky when docked, a sheet below 64rem', () => {
  assert.match(
    sheet,
    /\[data-ui="peek-layout"\] \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*gap: var\(--kv-layout-gap\);/,
  )
  assert.match(
    sheet,
    /\[data-ui="peek-layout"\]:has\(> \[data-ui="peek-layout-aside"\] \[data-ui="peek"\]\) \{[^}]*grid-template-columns: minmax\(0, 1fr\) var\(--kv-right-rail-width\);/,
  )
  assert.match(sheet, /\[data-ui="peek-layout-aside"\]:not\(:has\(\[data-ui="peek"\]\)\) \{\s*display: none;/)
  assert.match(
    sheet,
    /\[data-mode="docked"\] \[data-ui="peek"\] \{\s*position: sticky;\s*top: var\(--kv-layout-gap\);\s*max-height: calc\(100dvh - 2 \* var\(--kv-layout-gap\)\);/,
  )
  // The frame is a card at the canvas level: no shadow, no backdrop.
  assert.match(
    sheet,
    /\[data-ui="peek"\] \{[^}]*border: 1px solid var\(--kv-panel-border\);[^}]*border-radius: var\(--kv-radius-md\);[^}]*background: var\(--kv-panel-bg\);/,
  )
  assert.doesNotMatch(sheet, /backdrop/)
  // Below 64rem (tablet and phone) the rail would starve the view, so the peek is a sheet.
  assert.doesNotMatch(sheet, /47\.9375rem/)
  const phone = sheet.slice(sheet.indexOf('@media (max-width: 63.9375rem)'))
  assert.ok(sheet.includes('@media (max-width: 63.9375rem)'))
  assert.match(phone, /--kv-peek-sheet-max-height: 60dvh;/)
  assert.match(
    phone,
    /\[data-mode="docked"\]:has\(> \[data-ui="peek-layout-aside"\] \[data-ui="peek"\]\) \{\s*padding-block-end: var\(--kv-peek-sheet-max-height\);/,
  )
  assert.match(
    phone,
    /\[data-mode="docked"\]\s+>\s+\[data-ui="peek-layout-aside"\] \{\s*position: fixed;\s*z-index: var\(--kv-z-popover\);/,
  )
  assert.match(phone, /max-height: var\(--kv-peek-sheet-max-height\);/)
  assert.match(
    phone,
    /\[data-mode="docked"\] \[data-ui="peek"\] \{[^}]*max-height: var\(--kv-peek-sheet-max-height\);[^}]*padding-block-end: env\(safe-area-inset-bottom\);/,
  )
})
