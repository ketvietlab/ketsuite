import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  postedLineGrid,
  canUseSaleLineGrid,
  saleLineGridConfig,
} from '../packages/ketsuite/src/modules/sale_backend/modal/line-grid.tsx'
import { ketGridOptions } from '../packages/design-system/src/interactions/ket-grid/index.tsx'
import { createGridModel } from '../packages/design-system/src/interactions/ket-grid/model.ts'
import { resolveColumn } from '../packages/design-system/src/interactions/ket-grid/columns.ts'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import type { SaleOrderModalData } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'

test('D33b confirmed grid adds, removes and reorders, and locks the product of a delivered line only', () => {
  const c = {
    data: {
      record: {
        state: 'sale',
        currency: 'VND',
        lines: [
          {
            id: 'line',
            productId: 'sku',
            productUomId: 'each',
            productUomQty: '2',
            priceUnit: '100',
            qtyDelivered: '3',
            qtyInvoiced: '1',
          },
          { id: 'waiting', productId: 'sku', productUomId: 'each', productUomQty: '1', priceUnit: '100' },
          { id: 'combo', productId: 'set', productUomId: 'each', productUomQty: '1', comboBasePrice: '90' },
        ],
        moves: [{ id: 'move' }],
        invoices: [{ id: 'invoice' }],
      },
      choices: {},
      permissions: { applyLineGrid: true, getLineCosts: true },
      lang: 'en',
    },
    t: (key: string) => key,
    draft: (_key: string, fallback: string) => fallback,
  } as unknown as RecordModalContext<SaleOrderModalData>
  assert.equal(canUseSaleLineGrid(c), true)
  const config = saleLineGridConfig(c)
  // Mock `applyGridLines` (owner 25/10): the grid of a confirmed order works as a quotation's.
  assert.equal(config.removable, true)
  assert.equal(config.reorderable, true)
  assert.deepEqual(
    config.newRows!.map((kind) => kind.row.displayType),
    [null, 'section', 'note'],
  )
  assert.deepEqual(
    config.rows.map((row) => [row.identityLocked, row.unitLocked]),
    [
      [true, true],
      [false, false],
      [true, true],
    ],
  )
  assert.equal(config.rows[0]!.priceLocked, false)
  assert.equal(config.rows[0]!.priceHistory, true)
  assert.ok(config.columns.some((column) => column.key === 'qtyDelivered' && column.editable === false))
  assert.ok(config.columns.some((column) => column.key === 'qtyInvoiced' && column.editable === false))
  assert.ok(!config.columns.some((column) => column.key === 'margin'))
  assert.ok(28 + config.columns.reduce((sum, column) => sum + Number(column.width), 0) <= 1064)
  c.data.record.locked = true
  assert.equal(canUseSaleLineGrid(c), false)
  c.data.record.locked = false
  c.data.permissions.applyLineGrid = false
  assert.equal(canUseSaleLineGrid(c), false)
})

test('D33b native price submission excludes tier presentation flags while retaining manual price intent', () => {
  const form = new FormData()
  form.set(
    'lines',
    JSON.stringify({
      added: [],
      updated: [
        {
          id: 'line',
          values: { priceAutomatic: false, priceManual: true, priceHistory: true, priceUnit: '123.45' },
        },
      ],
      removed: [],
      order: null,
    }),
  )
  assert.deepEqual(postedLineGrid(form), {
    added: [],
    updated: [{ id: 'line', values: { priceAutomatic: false, priceUnit: '123.45' } }],
    removed: [],
    order: null,
  })
})

test('#1815 a new line opens its unit only once a product is picked; a combo item keeps it closed', () => {
  const c = {
    data: {
      record: { state: 'draft', currency: 'VND', lines: [] },
      choices: {},
      permissions: { applyLineGrid: true },
      lang: 'vi',
    },
    t: (key: string) => key,
    draft: (_key: string, fallback: string) => fallback,
  } as unknown as RecordModalContext<SaleOrderModalData>
  const config = saleLineGridConfig(c)
  const line = { ...config.newRows!.find((kind) => kind.row.displayType === null)!.row, id: 'new' }
  const item = { id: 'item', productId: 'tea', comboParentId: 'set', unitLocked: true, productUomId: 'each' }
  const options = ketGridOptions({ ...config, rows: [line, item] })
  const grid = createGridModel({
    columns: options.columns.map((column) =>
      resolveColumn(column, { locale: 'vi', currency: 'VND', yes: 'Có', no: 'Không' }),
    ),
    rows: [line, item],
    draftFlags: options.draftFlags,
    createRow: null,
    rowId: (row) => String(row.id),
    rowEditable: () => true,
    rowRemovable: () => true,
    readOnly: false,
    messages: { required: '', belowMin: '', aboveMax: '', conflict: '', removedElsewhere: '' },
  })
  const unit = options.columns.find((column) => column.key === 'productUomId')!
  const opens = (id: string) =>
    typeof unit.editable === 'function' ? unit.editable(grid.entry(id)!.row) : unit.editable
  // No product yet: the unit is closed, so the server never sees a unit without a product.
  assert.equal(opens('new'), false)
  grid.edit([{ id: 'new', key: 'productId', value: 'sku' }], 'edit')
  assert.equal(opens('new'), true)
  // Clearing the product closes it again.
  grid.edit([{ id: 'new', key: 'productId', value: null }], 'edit')
  assert.equal(opens('new'), false)
  // A combo item swaps its product in the grid, and its unit stays the combo's.
  grid.edit([{ id: 'item', key: 'productId', value: 'coffee' }], 'edit')
  assert.equal(opens('item'), false)
})
