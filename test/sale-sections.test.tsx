import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ketGridOptions } from '../packages/design-system/src/interactions/ket-grid/index.tsx'
import { validSaleLine } from '../packages/ketsuite/src/modules/sale/free-lines.ts'

test('D25 full-width tags leave the editable description unchanged', () => {
  const row = { id: 's', kind: 'section', name: 'Equipment', optional: true }
  const options = ketGridOptions({
    label: 'Lines',
    rows: [row],
    columns: [{ key: 'name', label: 'Description', editable: true }],
    kindField: 'kind',
    fullWidthKey: 'name',
    fullWidthTag: { field: 'optional', label: 'Optional' },
  })
  assert.deepEqual(options.fullWidth!(row), { key: 'name', tone: 'section', tag: 'Optional' })
  assert.equal(row.name, 'Equipment')
  assert.equal(options.fullWidth!({ ...row, optional: false })!.tag, undefined)
  assert.equal(options.fullWidth!({ ...row, kind: 'line' }), null)
})
test('D25 distinguishes structural rows, zero and negative quantities', () => {
  assert.equal(validSaleLine({ displayType: 'section', name: 'Equipment', productUomQty: 0 }), true)
  assert.equal(validSaleLine({ name: 'Advice', productUomQty: '0' }), true)
  assert.equal(validSaleLine({ name: 'Advice', productUomQty: '-1' }), false)
  assert.equal(validSaleLine({ displayType: 'note', name: 'Note', priceUnit: '12' }), false)
  // A product line may leave its unit to the product's own; a unit that is not an id is refused.
  assert.equal(validSaleLine({ productId: 'sku', productUomId: null, productUomQty: 1 }), true)
  assert.equal(validSaleLine({ productId: 'sku', productUomId: 4, productUomQty: 1 }), false)
})

test('D25 native optional dialog blocks pending parent edits and preserves checked selections', async () => {
  const { saleOrderModalDefinition } = await import(
    '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
  )
  const { renderToString, html: template } = await import('@ketvietlab/ketjs-view')
  const c = {
    kind: 'sale.order',
    id: 'order',
    busy: false,
    recordChanged: true,
    data: {
      record: {
        lines: [{ id: 'section', displayType: 'section', name: 'Equipment', optionalSection: true }],
      },
      permissions: { setOptionalSections: true },
    },
    t: (key: string) => key,
    draftChecked: (_name: string, _value: string, fallback: boolean) => fallback,
  } as unknown as Parameters<
    NonNullable<typeof saleOrderModalDefinition.dialogs>['optionalSections']['view']
  >[0]
  const dialog = saleOrderModalDefinition.dialogs!.optionalSections!
  const dirty = renderToString(template`${dialog.view(c)}`)
  assert.match(dirty, /saveBeforeSections/)
  assert.match(dirty, /disabled/)
  assert.doesNotMatch(dirty, /type="checkbox"/)
  const clean = renderToString(template`${dialog.view({ ...c, recordChanged: false })}`)
  assert.match(clean, /checked/)
  assert.doesNotMatch(clean, /saveBeforeSections/)
})
