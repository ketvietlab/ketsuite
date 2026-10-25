import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Button, Field } from '@ketvietlab/design-system'

test('a field with an action puts the entry and its command in one row of the control column', () => {
  const html = renderToString(
    <Field
      id="new-tag"
      name="newTag"
      label="New tag"
      help="Chosen at once."
      action={<Button label="Add" type="submit" variant="secondary" />}
    />,
  )
  const row = html.match(/<div data-ui="field-row">(?<body>[\s\S]*?)<\/div>/u)?.groups?.body ?? ''
  assert.match(html, /<label data-ui="field-label"[^>]*for="new-tag"/u)
  assert.ok(row.indexOf('id="new-tag"') >= 0 && row.indexOf('id="new-tag"') < row.indexOf('<button'), row)
  assert.match(row, /<button[^>]*type="submit"/u)
  assert.match(html, /aria-describedby="new-tag-help"/u)
  // Help stays the field's own, below the row rather than inside it.
  assert.doesNotMatch(row, /field-help/u)
  assert.doesNotMatch(renderToString(<Field id="plain" name="plain" label="Plain" />), /field-row/u)
})

test('the row keeps the entry compact and its command right after it', () => {
  const css = readFileSync('packages/design-system/src/primitives/field/styles.css', 'utf8')
  // The control column takes the row the way it takes a bare control.
  assert.match(css, /\[data-ui="field-input"\],\s*\[data-ui="field-row"\]\s*\) \{\s*grid-column: 2;/u)
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector.replace(/[[\]()*]/gu, '\\$&')} \\{(?<body>[^}]+)\\}`, 'u'))?.groups
      ?.body ?? ''
  assert.match(rule('[data-ui="field-row"]'), /display: flex;[\s\S]*gap: var\(--kv-space-2\)/u)
  assert.match(rule('[data-ui="field-row"] > :first-child'), /max-inline-size: 20rem/u)
  assert.match(rule('[data-ui="field-row"] > :not(:first-child)'), /flex: none/u)
})

const source = readFileSync('packages/design-system/src/runtime/index.js', 'utf8')
const enter = source.slice(
  source.indexOf('    // Enter in a short entry'),
  source.indexOf('    // Native dialogs own Escape'),
)

function press({ inRow = true, composing = false, disabled = false } = {}) {
  class HTMLButtonElement {
    disabled = disabled
    clicked = 0
    click() {
      this.clicked += 1
    }
    closest(selector: string) {
      return selector === 'button' ? this : null
    }
  }
  class HTMLInputElement {
    closest(selector: string) {
      return inRow && selector === '[data-ui="field-row"]' ? { lastElementChild: button } : null
    }
  }
  const button = new HTMLButtonElement()
  const event = {
    key: 'Enter',
    isComposing: composing,
    target: new HTMLInputElement(),
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
  const handled = runInNewContext(`(() => {${enter}\n return false })()`, {
    event,
    HTMLButtonElement,
    HTMLInputElement,
  })
  return { handled: handled === undefined, prevented: event.prevented, clicks: button.clicked }
}

test('Enter in the entry runs its command instead of submitting the form', () => {
  assert.ok(enter.includes("event.key === 'Enter'"), 'the runtime still handles Enter in a field row')
  assert.deepEqual(press(), { handled: true, prevented: true, clicks: 1 })
  assert.deepEqual(press({ composing: true }), { handled: false, prevented: false, clicks: 0 })
  assert.deepEqual(press({ disabled: true }), { handled: false, prevented: false, clicks: 0 })
  assert.deepEqual(press({ inRow: false }), { handled: false, prevented: false, clicks: 0 })
})
