import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { RecordForm } from '@ketvietlab/ketsuite/ui'

test('Hospitality profile identity uses a readonly submitted native input rather than disabling its value', () => {
  const output = renderToString(
    <RecordForm
      action="/admin/hospitality/properties/one"
      submit="Save"
      submitVariant="primary"
      fields={[{ name: 'code', label: 'Property code', value: 'DEMO', required: true, readOnly: true }]}
    />,
  )
  assert.match(output, /name="code"[^>]*value="DEMO"[^>]*readOnly(?:="true")?/i)
  assert.doesNotMatch(output, /name="code"[^>]*disabled/)
})
