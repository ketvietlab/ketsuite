import test from 'node:test'
import assert from 'node:assert/strict'
import { createDialogFocusReturn } from '../src/dialog-focus.mjs'

function fixture() {
  const focused = []
  const element = (name, options = {}) => ({
    name,
    isConnected: true,
    within: true,
    blocked: false,
    attributes: new Map(),
    hasAttribute(key) {
      return this.attributes.has(key)
    },
    setAttribute(key, value) {
      this.attributes.set(key, value)
    },
    closest() {
      return this.blocked ? {} : null
    },
    focus(options) {
      focused.push({ name, options })
      doc.activeElement = this
    },
    ...options,
  })
  const body = element('body', { within: false }),
    heading = element('heading')
  const doc = { body, activeElement: body }
  const root = {
    ownerDocument: doc,
    contains: (node) => node.within && node.isConnected,
    querySelector: (selector) => (selector === 'dialog[open]' ? null : heading),
  }
  return { focused, element, doc, heading, manager: createDialogFocusReturn(root) }
}

test('removing a route dialog returns focus to its connected opener without scrolling', () => {
  const f = fixture(),
    opener = f.element('new-goal'),
    dialog = {}
  f.doc.activeElement = opener
  f.manager.remember(dialog)
  f.doc.activeElement = f.doc.body
  f.manager.sync([])
  assert.deepEqual(f.focused, [{ name: 'new-goal', options: { preventScroll: true } }])
  f.manager.sync([])
  assert.equal(f.focused.length, 1)
})

test('a deep link or detached opener returns focus to the background heading', () => {
  for (const detached of [false, true]) {
    const f = fixture(),
      dialog = {},
      opener = f.element('old-button')
    if (detached) f.doc.activeElement = opener
    f.manager.remember(dialog)
    opener.isConnected = false
    f.doc.activeElement = f.doc.body
    f.manager.sync([])
    assert.equal(f.focused[0].name, 'heading')
    assert.equal(f.heading.attributes.get('tabindex'), '-1')
  }
})

test('modal replacement keeps focus in the new dialog, then returns to the outer opener', () => {
  const f = fixture(),
    opener = f.element('record'),
    first = {},
    second = {}
  f.doc.activeElement = opener
  f.manager.remember(first)
  f.doc.activeElement = f.doc.body
  f.manager.remember(second)
  f.doc.activeElement = f.element('second-field')
  f.manager.sync([second])
  assert.deepEqual(f.focused, [])
  f.doc.activeElement = f.doc.body
  f.manager.sync([])
  assert.equal(f.focused[0].name, 'record')
})

test('closing preserves valid new focus and skips disabled or inert openers', () => {
  const f = fixture(),
    dialog = {},
    opener = f.element('disabled')
  opener.attributes.set('disabled', '')
  f.doc.activeElement = opener
  f.manager.remember(dialog)
  f.doc.activeElement = f.doc.body
  f.manager.closed(dialog)
  assert.equal(f.focused[0].name, 'heading')
  f.focused.length = 0
  f.doc.activeElement = f.element('new-focus')
  f.manager.remember(dialog)
  f.manager.closed(dialog)
  assert.deepEqual(f.focused, [])
})
