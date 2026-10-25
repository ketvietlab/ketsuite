import test from 'node:test'
import assert from 'node:assert/strict'
import { createDocTreeFocusReturn } from '../src/doc-tree-focus.mjs'

function fixture() {
  const focused = [],
    body = {},
    button = {},
    target = {
      getAttribute: () => 'doc-a',
      hasAttribute: () => false,
      closest: () => null,
      focus: (options) => focused.push(options),
    }
  const doc = { body, activeElement: body, defaultView: { location: { href: '/flow/pages' } } }
  const root = { isConnected: true, ownerDocument: doc, querySelectorAll: () => [target] }
  return { focused, button, doc, root, runtime: createDocTreeFocusReturn(root) }
}

test('keyboard reorder restores the same document after refresh, including rejected writes', async () => {
  for (const result of [true, false]) {
    const f = fixture()
    let complete
    const pending = f.runtime.reorder(
      f.button,
      'doc-a',
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    assert.equal(f.focused.length, 0)
    complete(result)
    await pending
    assert.deepEqual(f.focused, [{ preventScroll: true }])
  }
})

test('late reorders cannot steal focus after another focus, route change or disposal', async () => {
  for (const interrupt of [
    (f) => {
      f.doc.activeElement = {}
    },
    (f) => {
      f.doc.defaultView.location.href = '/flow/my-work'
    },
    (f) => f.runtime.dispose(),
  ]) {
    const f = fixture()
    let complete
    const pending = f.runtime.reorder(
      f.button,
      'doc-a',
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    interrupt(f)
    complete(true)
    await pending
    assert.equal(f.focused.length, 0)
  }
})
