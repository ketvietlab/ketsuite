import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Field } from '@ketvietlab/design-system'

const units = [
  { value: 'unit', label: 'Unit' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'kg', label: 'kg' },
]

/** The values of the options the markup marks as chosen. */
const chosen = (html: string) =>
  [...html.matchAll(/<option value="(?<value>[^"]*)"[^>]*\sselected[\s>=]/gu)].map(
    (match) => match.groups?.value,
  )

// A client render inserts a list's items last to first; the browser keeps the first option it was given
// as chosen, so a select with no option marked showed its last option (a new product came up in kg).
test('a select whose value matches no option marks its first option, not none', () => {
  assert.deepEqual(
    chosen(renderToString(<Field id="u" name="uomId" label="Unit" type="select" options={units} />)),
    ['unit'],
  )
  assert.deepEqual(
    chosen(
      renderToString(
        <Field
          id="u"
          name="uomId"
          label="Unit"
          type="select"
          value="retired"
          options={[{ value: 'unit', label: 'Unit', disabled: true }, ...units.slice(1)]}
        />,
      ),
    ),
    ['bottle'],
    'a disabled first option is passed over',
  )
})

test('a matching value, or a placeholder, keeps the choice it had', () => {
  assert.deepEqual(
    chosen(
      renderToString(<Field id="u" name="uomId" label="Unit" type="select" value="kg" options={units} />),
    ),
    ['kg'],
  )
  assert.deepEqual(
    chosen(
      renderToString(
        <Field id="u" name="uomId" label="Unit" type="select" placeholder="Choose…" options={units} />,
      ),
    ),
    [''],
  )
  assert.deepEqual(
    chosen(
      renderToString(
        <Field
          id="u"
          name="uomId"
          label="Unit"
          type="select"
          value="retired"
          placeholder="Choose…"
          options={units}
        />,
      ),
    ),
    [''],
    'a value no longer offered shows the placeholder',
  )
})

test('inline native selects keep their chevron in the control cell after narrow layout rules', () => {
  const html = renderToString(
    <Field
      id="inline-unit"
      name="unit"
      label="Unit"
      type="select"
      layout="inline"
      options={units}
      help="Inherited unit"
    />,
  )
  assert.match(html, /data-layout="inline"/)
  const css = readFileSync(
    new URL('../../packages/design-system/src/primitives/field/styles.css', import.meta.url),
    'utf8',
  )
  const rule = css.slice(css.lastIndexOf('/* Inline native selects'))
  assert.match(rule, /\[data-layout="inline"\]\[data-kind="select"\]:has\(> select\)::after/)
  assert.match(rule, /grid-column: 2;/)
  assert.match(rule, /grid-row: 1;/)
  assert.match(rule, /align-self: center;/)
})
