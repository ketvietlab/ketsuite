import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Dock, DockRegion } from '@ketvietlab/design-system'

const render = (view: Parameters<typeof renderToString>[0]) =>
  renderToString(view).replace(/<!--.*?-->/gs, '')
const sheet = readFileSync('packages/design-system/src/patterns/dock/styles.css', 'utf8')
const tokens = readFileSync('packages/design-system/src/foundations/tokens.css', 'utf8')

const dockView = (overrides: Partial<Parameters<typeof Dock>[0]> = {}) => (
  <Dock
    id="call-dock"
    eyebrow="On a call"
    title="Alex Morgan"
    status={<span data-test="timer">04:12</span>}
    toggle={{ collapseLabel: 'Collapse call', expandLabel: 'Expand call' }}
    body={<p data-test="notes">Notes</p>}
    actions={<button type="button">End call</button>}
    {...overrides}
  />
)
const dock = (overrides: Partial<Parameters<typeof Dock>[0]> = {}) => render(dockView(overrides))
// The rule block of a selector, so a property is checked where it applies.
const rule = (selector: string) => {
  const start = sheet.indexOf(`${selector} {`)
  assert.ok(start >= 0, `no rule for ${selector}`)
  return sheet.slice(start, sheet.indexOf('}', start))
}

test('dock is a labelled, non-modal region that announces its state but not its timer', () => {
  const html = dock()
  assert.match(
    html,
    /<section data-ui="dock" id="call-dock" aria-labelledby="call-dock-title" data-tone="default" data-collapsed="false">/,
  )
  assert.doesNotMatch(html, /role="dialog"|aria-modal|tabindex/)
  assert.match(
    html,
    /<div data-ui="dock-heading" aria-live="polite"><p data-ui="dock-eyebrow">On a call<\/p><h2 data-ui="dock-title" id="call-dock-title">Alex Morgan<\/h2><\/div>/,
  )
  // The timer ticks every second: it sits outside the live heading.
  const heading = html.slice(html.indexOf('data-ui="dock-heading"'), html.indexOf('data-ui="dock-tools"'))
  assert.doesNotMatch(heading, /data-test="timer"/)
  assert.match(html, /data-ui="dock-status"><span data-test="timer">/)
  assert.match(html, /<div data-ui="dock-body" id="call-dock-body"><p data-test="notes">/)
  assert.match(html, /<footer data-ui="dock-foot"><div data-ui="dock-actions"><button type="button">End call/)
})

test('dock toggle names the body it hides, and collapsed keeps the actions', () => {
  assert.match(
    dock(),
    /<button id="call-dock-toggle"[^>]*aria-label="Collapse call"[^>]*aria-expanded="true" aria-controls="call-dock-body"/,
  )
  const collapsed = dock({ collapsed: true })
  assert.match(collapsed, /data-collapsed="true"/)
  assert.match(
    collapsed,
    /<button id="call-dock-toggle"[^>]*aria-label="Expand call"[^>]*aria-expanded="false" aria-controls="call-dock-body"/,
  )
  assert.match(collapsed, /<div data-ui="dock-body" id="call-dock-body" hidden(="[^"]*")?>/)
  // A collapsed call can still be ended.
  assert.match(collapsed, /data-ui="dock-actions"><button type="button">End call/)
  // Without a body there is nothing to collapse: no toggle, never collapsed.
  const bare = dock({ body: undefined, collapsed: true })
  assert.match(bare, /data-collapsed="false"/)
  assert.doesNotMatch(bare, /call-dock-toggle|dock-body|dock-tools/)
})

test('dock region holds several channels, newest at the end edge, and hides while empty', () => {
  const html = render(<DockRegion docks={[dockView({ id: 'chat-dock', title: 'Chat' }), dockView()]} />)
  assert.match(
    html,
    /^<div data-ui="dock-region" data-placement="fixed"><section data-ui="dock" id="chat-dock"/,
  )
  assert.ok(html.indexOf('id="chat-dock"') < html.indexOf('id="call-dock"'))
  assert.equal(render(<DockRegion />), '<div data-ui="dock-region" data-placement="fixed"></div>')
  assert.match(sheet, /\[data-ui="dock-region"\]:not\(:has\(> \[data-ui="dock"\]\)\) \{\s*display: none;/)
  assert.match(rule(':where([data-kv-design-system]) [data-ui="dock-region"]'), /justify-content: flex-end;/)
})

test('dock region stacks over dialogs, keeps page and dialog room and sends toasts to the top', () => {
  const z = (name: string) => Number(tokens.match(new RegExp(`--kv-z-${name}: (\\d+);`, 'u'))?.[1])
  // A call runs across dialogs: the dock sits over them and under toasts.
  assert.ok(z('popover') < z('modal') && z('modal') < z('dock') && z('dock') < z('toast'))
  assert.match(tokens, /--kv-layer-dock: var\(--kv-z-dock\);/)
  const fixed = rule(':where([data-kv-design-system]) [data-ui="dock-region"][data-placement="fixed"]')
  assert.match(fixed, /position: fixed;/)
  assert.match(fixed, /z-index: var\(--kv-layer-dock\);/)
  assert.match(fixed, /pointer-events: none;/)
  // The panel itself never positions itself: an embedded region and a lone dock stay in the flow.
  assert.doesNotMatch(rule(':where([data-kv-design-system]) [data-ui="dock"]'), /position:/)
  assert.match(
    sheet,
    /:has\(\[data-ui="dock-region"\]\[data-placement="fixed"\] > \[data-ui="dock"\]\)\s*\[data-ui="app-main"\] \{\s*padding-block-end: var\(--kv-dock-reserve\);/,
  )
  assert.match(
    sheet,
    /:has\(\[data-ui="dock-region"\]\[data-placement="fixed"\] > \[data-ui="dock"\]\)\s*\[data-ui="toast-region"\] \{\s*top: calc\(var\(--kv-app-topbar-height\) \+ var\(--kv-space-3\)\);\s*bottom: auto;/,
  )
  // A dialog keeps the collapsed dock's room free, so its actions stay clear of the call.
  assert.match(
    sheet,
    /:has\(\[data-ui="dock-region"\]\[data-placement="fixed"\] > \[data-ui="dock"\]\)\s*\[data-ui="modal-layer"\]:not\(\[data-mode="embedded"\]\) \{\s*padding-block-end: var\(--kv-dock-reserve\);/,
  )
  // On a phone the docks span the bottom edge, one above the other.
  const phone = sheet.slice(sheet.indexOf('@media (max-width: 47.9375rem)'))
  assert.match(
    phone,
    /\[data-ui="dock-region"\]\[data-placement="fixed"\] \{\s*inset-inline: 0;\s*bottom: 0;[^}]*flex-direction: column;/,
  )
})
