import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Combobox, DatePicker, Field, MoneyField } from '@ketvietlab/design-system'

test('a field states how long its value is; without it the control fills its column', () => {
  const short = renderToString(<Field id="rate" name="rate" label="Rate" width="xs" />)
  assert.match(short, /<div data-ui="field" data-kind="text"[^>]*data-width="xs"/u)
  assert.doesNotMatch(renderToString(<Field id="name" name="name" label="Name" />), /data-width/u)
  // The enhanced controls carry it on the same field root.
  assert.match(
    renderToString(<MoneyField id="price" name="price" label="Price" currency="VND" width="sm" />),
    /data-ui="field"[^>]*data-width="sm"/u,
  )
  assert.match(
    renderToString(<DatePicker id="due" name="due" label="Due" width="sm" />),
    /data-ui="field" data-kind="date"[^>]*data-width="sm"/u,
  )
  assert.match(
    renderToString(
      <Combobox
        id="unit"
        name="unit"
        label="Unit"
        width="md"
        query=""
        open={false}
        openHref="?open=unit"
        closeHref="?"
        options={[{ value: 'box', label: 'Box' }]}
      />,
    ),
    /data-ui="field" data-kind="combobox"[^>]*data-width="md"/u,
  )
})

test('the control keeps to the start of its column at its width; label, help and error keep their tracks', () => {
  const css = readFileSync('packages/design-system/src/primitives/field/styles.css', 'utf8')
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector.replace(/[[\]()*]/gu, '\\$&')} \\{(?<body>[^}]+)\\}`, 'u'))?.groups
      ?.body ?? ''
  assert.match(rule('[data-ui="field"][data-width="xs"]'), /--kv-field-width: 7rem;/u)
  assert.match(rule('[data-ui="field"][data-width="sm"]'), /--kv-field-width: 11rem;/u)
  assert.match(rule('[data-ui="field"][data-width="md"]'), /--kv-field-width: 18rem;/u)
  const control = css.match(
    /\[data-ui="field"\]\[data-width\]\s*> :not\(\[data-ui="field-label"\], \[data-ui="field-help"\], \[data-ui="field-error"\]\) \{(?<body>[^}]+)\}/u,
  )?.groups?.body
  assert.ok(control, 'the control rule')
  assert.match(control, /justify-self: start;/u)
  assert.match(control, /inline-size: 100%;/u)
  assert.match(control, /max-inline-size: var\(--kv-field-width\);/u)
  // In a row there is no column: the field starts at its width and gives way only to the row's room.
  const row = rule('[data-ui="inline"] > [data-ui="field"][data-width]')
  assert.match(row, /flex: 0 1 var\(--kv-field-width\);/u)
  assert.match(row, /min-inline-size: min\(4rem, 100%\);/u)
  // A row of fields that hide their label is no container, so a row sized by its content keeps its width.
  assert.match(
    rule('[data-ui="inline"][data-ui]:not(:has(> [data-ui="field"]:not([data-label-hidden="true"])))'),
    /container-type: normal;/u,
  )
  // A sized select's chevron follows the control's end, not the column's.
  const chevron = rule('[data-ui="field"][data-kind="select"][data-width]:has(> select)::after')
  assert.match(chevron, /justify-self: start;/u)
  assert.match(chevron, /min\(100%, var\(--kv-field-width\)\)/u)
})
