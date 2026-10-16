import test from 'node:test'
import assert from 'node:assert/strict'
import { createFormErrorFocus } from '../src/form-error-focus.mjs'

function fixture(compact = true) {
  const events = [],
    doc = { activeElement: null }
  const root = { ownerDocument: doc, contains: (node) => node.within !== false }
  const disclosure = {
    localName: 'details',
    parentElement: root,
    set open(value) {
      events.push(['disclosure', value])
    },
  }
  const panel = {
    open: false,
    matches() {
      return this.open
    },
    showPopover() {
      this.open = true
      events.push(['popover'])
    },
  }
  const field = {
    isConnected: true,
    parentElement: disclosure,
    closest: () => panel,
    focus() {
      events.push(['focus'])
      doc.activeElement = this
    },
  }
  const scope = { querySelector: () => field }
  root.querySelector = scope.querySelector
  return { events, root, field, panel, scope, manager: createFormErrorFocus(root, () => compact) }
}

test('server errors reveal ancestor disclosures and the compact property panel before focusing', () => {
  const f = fixture()
  assert.equal(f.manager.focusInvalid(f.scope), true)
  assert.deepEqual(f.events, [['disclosure', true], ['popover'], ['focus']])
  assert.equal(f.root.ownerDocument.activeElement, f.field)
})

test('wide or already-open properties do not acquire another popover transition', () => {
  for (const compact of [false, true]) {
    const f = fixture(compact)
    f.panel.open = compact
    assert.equal(f.manager.focusInvalid(f.scope), true)
    assert.deepEqual(f.events, [['disclosure', true], ['focus']])
  }
})

test('native invalid reveals its field without taking focus from native validation', () => {
  const f = fixture()
  assert.equal(f.manager.reveal(f.field), true)
  assert.deepEqual(f.events, [['disclosure', true], ['popover']])
  assert.equal(f.root.ownerDocument.activeElement, null)
})

test('missing, disabled, detached or foreign fields do not steal focus', () => {
  const f = fixture()
  assert.equal(f.manager.focusInvalid({ within: false }), false)
  assert.equal(
    f.manager.focusInvalid({
      querySelector: (selector) => {
        assert.equal(selector, '[aria-invalid="true"]:not(:disabled)')
        return null
      },
    }),
    false,
  )
  f.field.isConnected = false
  assert.equal(f.manager.focusInvalid(f.scope), false)
  f.field.isConnected = true
  f.field.within = false
  assert.equal(f.manager.focusInvalid(f.scope), false)
  assert.deepEqual(f.events, [])
})
