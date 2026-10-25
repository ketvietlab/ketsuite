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
