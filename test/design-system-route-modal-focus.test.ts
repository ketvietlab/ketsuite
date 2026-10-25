import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// The runtime exports only attachDesignSystemInteractions, so the focus rule is read from its source
// and run against a few stand-in controls. The real focus is recorded with a consumer dialog in the browser.
const source = readFileSync('packages/design-system/src/runtime/index.js', 'utf8')
const code = source.slice(
  source.indexOf('const focusableSelector'),
  source.indexOf('/**\n * Binds the interactions'),
)

class Control {
  tabIndex = 0
  hidden = false
  readonly name: string
  readonly attributes: Record<string, string>
  constructor(name: string, attributes: Record<string, string> = {}) {
    this.name = name
    this.attributes = attributes
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null
  }
  matches(selector: string) {
    return selector === ':disabled' && this.attributes.disabled !== undefined
  }
  closest() {
    return this.hidden ? this : null
  }
  checkVisibility() {
    return true
  }
}
class Modal extends Control {
  readonly controls: Control[]
  constructor(controls: Control[]) {
    super('modal')
    this.controls = controls
  }
  querySelectorAll() {
    return this.controls
  }
  querySelector() {
    return this
  }
}

const focusTarget = new Function('HTMLElement', `${code}\nreturn routeModalFocusTarget`)(Control) as (
  modal: Modal,
) => Control

test('a route modal back from a rejected submit focuses its first invalid control', () => {
  const close = new Control('close')
  const room = new Control('room')
  const reason = new Control('reason', { 'aria-invalid': 'true' })
  const note = new Control('note', { 'aria-invalid': 'true' })
  assert.equal(focusTarget(new Modal([close, room, reason, note])).name, 'reason')
})

test('a route modal without errors focuses its first control, or itself when it has none', () => {
  const hidden = Object.assign(new Control('hidden', { 'aria-invalid': 'true' }), { hidden: true })
  assert.equal(focusTarget(new Modal([hidden, new Control('close'), new Control('room')])).name, 'close')
  assert.equal(focusTarget(new Modal([])).name, 'modal')
})

test('the route modal focuses through the shared rule', () => {
  assert.match(
    source,
    /if \(modal instanceof HTMLElement\) \{[\s\S]*?routeModalFocusTarget\(modal\)\.focus\(\)/,
  )
})

test('the backend route-modal controller preserves the first invalid field selected by the design system', () => {
  const backend = readFileSync('packages/ketsuite/src/ui/client/table-selection-view.tsx', 'utf8')
  const start = backend.indexOf('const sheet = modal.querySelector<HTMLElement>')
  const end = backend.indexOf(';(target ?? sheet)?.focus()', start)
  assert.ok(start > 0 && end > start)
  const selection = backend.slice(start, end).replace('<HTMLElement>', '')
  const select = new Function('modal', 'modalFocusables', `${selection}; return target`)
  const kind = new Control('buyerType'),
    tax = new Control('buyerTaxCode', { 'aria-invalid': 'true' }),
    address = new Control('buyerAddress', { 'aria-invalid': 'true' })
  const modal = new Modal([kind, tax, address])
  assert.equal(select(modal, (node: Modal) => node.controls).name, 'buyerTaxCode')
  assert.equal(select(new Modal([kind]), (node: Modal) => node.controls).name, 'buyerType')
})
