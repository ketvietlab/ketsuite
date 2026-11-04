import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  variantMatrixGridConfig,
  variantMatrixDefinition,
  type VariantMatrixData,
} from '../packages/ketsuite/src/modules/sale_backend/modal/matrix-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { matrixMessages } from '../packages/ketsuite/src/modules/sale_backend/matrix-messages.ts'
const context = (axes = 2, save = true) =>
  ({
    id: 'template',
    kind: 'sale.variantMatrix',
    busy: false,
    data: {
      order: { id: 'order', name: 'Q001', revision: 3 },
      template: { id: 'template', name: 'Tee' },
      axes: Array.from({ length: axes }, (_, i) => ({
        id: 'axis' + i,
        name: 'Axis ' + i,
        values: [
          { id: 'a' + i, name: 'A' + i },
          { id: 'b' + i, name: 'B' + i },
        ],
      })),
      rows: [
        {
          id: 'sku',
          name: 'Tee A0 A1 A2',
          values: { axis0: 'a0', axis1: 'a1', axis2: 'a2' },
          quantity: '2',
          unit: 'Each',
          price: '100',
          currency: 'VND',
        },
      ],
      matrixRevision: 'hash',
      save,
      lang: 'en',
      orderHref: '/admin/sales/quotations/order',
    },
    t: (key: string) =>
      matrixMessages.en[key.replace('sale_backend.', '') as keyof typeof matrixMessages.en] ?? key,
    draft: (_name: string, value: string) => value,
    fieldError: () => null,
  }) as unknown as RecordModalContext<VariantMatrixData>

test('D28 quantities are edited in a KetGrid, one row per variant, never in fields set in a table', () => {
  const config = variantMatrixGridConfig(context())
  assert.deepEqual(
    config.columns.map((column) => [column.key, column.editable === true]),
    [
      ['axis:axis0', false],
      ['axis:axis1', false],
      ['unit', false],
      ['price', false],
      ['quantity', true],
      ['amount', false],
    ],
  )
  assert.deepEqual(config.columns[5]!.compute, { multiply: ['quantity', 'price'] })
  assert.equal(config.columns[5]!.footer, 'sum')
  assert.deepEqual(
    config.columns.map((column) => column.grow ?? 0),
    [1, 1, 0, 0, 0, 0],
  )
  assert.deepEqual(config.rows, [
    { id: 'sku', 'axis:axis0': 'A0', 'axis:axis1': 'A1', unit: 'Each', price: 100, quantity: 2 },
  ])
  assert.equal(config.name, 'quantities')
  assert.equal(config.form, 'sale-variant-matrix-form')
  assert.equal(config.removable, false)
  assert.equal(config.reorderable, false)
  // The dialog renders the grid's island and no field of its own.
  const html = renderToString(<div>{variantMatrixDefinition.body!(context())}</div>)
  assert.match(html, /backend\.ket-grid/)
  assert.doesNotMatch(html, /<input[^>]*name="quantity/)
})
test('D28 one or three attributes give a column each; a reader gets a read-only grid with nothing to post', () => {
  assert.deepEqual(
    variantMatrixGridConfig(context(3))
      .columns.filter((column) => column.key.startsWith('axis:'))
      .map((column) => column.label),
    ['Axis 0', 'Axis 1', 'Axis 2'],
  )
  assert.equal(variantMatrixGridConfig(context(1)).columns[0]!.label, 'Axis 0')
  const reader = variantMatrixGridConfig(context(2, false))
  assert.equal(reader.readOnly, true)
  assert.equal(reader.columns.find((column) => column.key === 'quantity')!.editable, false)
  assert.equal(reader.name, undefined)
  assert.equal(reader.carry, undefined)
  const html = renderToString(<div>{variantMatrixDefinition.body!(context(2, false))}</div>)
  assert.doesNotMatch(html, /sale-variant-matrix-form/)
})
test('D28 matrix form submits changed cells, blank zero and invalid drafts for server validation', () => {
  const c = context(),
    form = new FormData()
  const input = variantMatrixDefinition.commands!.save!.input!
  assert.equal(typeof input, 'function')
  if (typeof input !== 'function') return
  const posted = (quantity: unknown) =>
    JSON.stringify({ added: [], updated: [{ id: 'sku', values: { quantity } }], removed: [] })
  form.set('quantities', posted(2))
  assert.deepEqual(input(form, c, {}), {
    id: 'order',
    templateId: 'template',
    expectedRevision: 3,
    matrixRevision: 'hash',
    quantities: [],
  })
  for (const [value, quantity] of [
    [null, ''],
    [4, '4'],
    [2.5, '2.5'],
    ['invalid', 'invalid'],
  ] as const) {
    form.set('quantities', posted(value))
    assert.deepEqual((input(form, c, {}) as { quantities: unknown }).quantities, [
      { productId: 'sku', quantity },
    ])
  }
  // A row the dialog does not hold, or a grid with nothing changed, posts no cell.
  form.set('quantities', JSON.stringify({ updated: [{ id: 'other', values: { quantity: 1 } }] }))
  assert.deepEqual((input(form, c, {}) as { quantities: unknown }).quantities, [])
  form.set('quantities', '')
  assert.deepEqual((input(form, c, {}) as { quantities: unknown }).quantities, [])
})
