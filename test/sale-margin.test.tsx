import { resolveColumn } from '../packages/design-system/src/interactions/ket-grid/columns.ts'
import { createGridModel } from '../packages/design-system/src/interactions/ket-grid/model.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computedGridValue,
  solveGridValue,
  canSolveGridValue,
  type GridProduct,
} from '../packages/design-system/src/interactions/ket-grid/calculations.ts'
import { ketGridOptions } from '../packages/design-system/src/interactions/ket-grid/index.tsx'
import {
  postedLineGrid,
  saleLineGridConfig,
} from '../packages/ketsuite/src/modules/sale_backend/modal/line-grid.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import type { SaleOrderModalData } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'

const formula: GridProduct = {
  multiply: ['quantity', 'price'],
  percentOff: 'discount',
  less: ['quantity', 'cost'],
  solve: { field: 'price', digits: 0 },
}
const row = { id: 'line', quantity: 12, price: '400000', discount: 5, cost: '137000' }

test('D26 inverse margin uses quantity, discount and exact rounding into the existing price field', () => {
  const result = solveGridValue(formula, row, 4056000, true)
  assert.equal(result.price, '500000')
  assert.equal(computedGridValue(formula, result), 4056000)
  assert.equal('margin' in result, false)
  const percent = { ...formula, as: 'percent' as const }
  const half = solveGridValue(percent, { ...row, quantity: 2, cost: '100', discount: 20 }, 50, true)
  assert.equal(half.price, '250')
  assert.equal(computedGridValue(percent, half), 50)
  assert.equal(solveGridValue(formula, { ...row, quantity: 1, cost: '0', discount: 0 }, 1.5, true).price, '2')
})

test('D26 impossible, missing or unsafe targets keep the old price', () => {
  for (const bad of [
    { ...row, quantity: 0 },
    { ...row, cost: null },
    { ...row, discount: 100 },
  ]) {
    assert.equal(canSolveGridValue(formula, bad), false)
    assert.deepEqual(solveGridValue(formula, bad, 500, true), bad)
  }
  assert.deepEqual(solveGridValue({ ...formula, as: 'percent' }, row, 100, true), row)
  assert.deepEqual(solveGridValue(formula, row, -99999999, true), row)
  assert.deepEqual(solveGridValue(formula, row, '99999999999999999999999999999', true), row)
  assert.deepEqual(solveGridValue(formula, row, 'not a number', true), row)
})

test('D26 remote option setters remain scoped to current product and never trust draft metadata', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ ok: true, value: [{ id: 'box', name: 'Box', unitCost: '120', price: '240' }] }),
        { headers: { 'content-type': 'application/json' } },
      ),
  )
  const options = ketGridOptions({
    label: 'Lines',
    rows: [],
    columns: [
      {
        key: 'unit',
        label: 'Unit',
        type: 'combobox',
        editable: true,
        resets: ['unitCost', 'price'],
        search: {
          listFunction: 'sale.listLinePricing',
          listInputFields: { productId: 'productId' },
          setsFrom: { unitCost: 'unitCost', price: 'price' },
        },
      },
    ],
  })
  const column = options.columns[0]!
  const context = {
    row: { productId: 'a', unit: null, unitCost: null, price: null },
    signal: new AbortController().signal,
  }
  await column.search!('', context)
  assert.equal(column.set!(context.row, 'box').unitCost, '120')
  const other = column.set!({ ...context.row, productId: 'b', unitCost: 'FORGED' }, 'box')
  assert.equal(other.unitCost, null)
  assert.equal(other.price, null)
})

test('D26 native grid gates margin data, keeps compact width and posts price without cost metadata', () => {
  const c = {
    kind: 'sale.order',
    id: 'order',
    busy: false,
    data: {
      record: {
        state: 'draft',
        currency: 'VND',
        lines: [
          {
            id: 'line',
            productId: 'sku',
            productUomId: 'each',
            productUomQty: '2',
            priceUnit: '100',
            discount: '0',
          },
        ],
        invoices: [],
      },
      lineCosts: [{ lineId: 'line', unitCost: '60', currency: 'VND' }],
      choices: {},
      permissions: { getLineCosts: true, listLinePricing: true },
      lang: 'en',
    },
    t: (key: string) => key,
    draft: (_key: string, fallback: string) => fallback,
  } as unknown as RecordModalContext<SaleOrderModalData>
  const config = saleLineGridConfig(c)
  assert.equal(config.rows[0]!.unitCost, '60')
  assert.equal(config.rows[0]!.marginLocked, false)
  assert.ok(28 + config.columns.reduce((sum, column) => sum + Number(column.width), 0) <= 1064)
  c.data.permissions.getLineCosts = false
  const hidden = saleLineGridConfig(c)
  assert.equal(
    hidden.columns.some((column) => column.key === 'margin'),
    false,
  )
  assert.equal('unitCost' in hidden.rows[0]!, false)
  const form = new FormData()
  form.set(
    'lines',
    JSON.stringify({
      added: [
        {
          id: 'new',
          index: 1,
          values: { productId: 'sku', priceAutomatic: true, priceManual: false, priceSteps: [{ min: 1 }] },
        },
      ],
      removed: [],
      order: null,
      updated: [
        { id: 'line', values: { priceUnit: '120', unitCost: 'FAKE', marginLocked: false, priceSteps: null } },
      ],
    }),
  )
  // A picked product brings its price steps for display; the server refuses any field it does not write.
  assert.deepEqual(postedLineGrid(form), {
    added: [{ id: 'new', index: 1, values: { productId: 'sku', priceAutomatic: true } }],
    removed: [],
    order: null,
    updated: [{ id: 'line', values: { priceUnit: '120' } }],
  })
})

test('D26 a computed column with an explicit inverse writer is editable, undoable and posts only its target', () => {
  const options = ketGridOptions({
    label: 'Lines',
    rows: [row],
    columns: [
      { key: 'price', label: 'Price', type: 'text', editable: true },
      { key: 'margin', label: 'Margin', type: 'money', editable: true, compute: formula },
      { key: 'readonly', label: 'Read only', type: 'money', compute: { multiply: ['quantity', 'price'] } },
    ],
  })
  const grid = createGridModel({
    columns: options.columns.map((column) =>
      resolveColumn(column, { locale: 'en', currency: 'VND', yes: 'Yes', no: 'No' }),
    ),
    rows: [row],
    createRow: null,
    rowId: (line) => String(line.id),
    rowEditable: () => true,
    rowRemovable: () => true,
    readOnly: false,
    messages: { required: '', belowMin: '', aboveMax: '', conflict: '', removedElsewhere: '' },
  })
  const edited = grid.edit(
    [
      { id: 'line', key: 'margin', value: 4056000 },
      { id: 'line', key: 'readonly', value: 1 },
    ],
    'edit',
  )
  assert.equal(edited.skipped, 1)
  assert.equal(grid.entry('line')!.row.price, '500000')
  assert.deepEqual(grid.changes().updated[0]!.fields, ['price'])
  grid.undo()
  assert.equal(grid.entry('line')!.row.price, row.price)
  grid.redo()
  assert.equal(grid.entry('line')!.row.price, '500000')
})

test('D14 a price typed by hand stays when the quantity changes; another product takes the pricelist (#1425)', () => {
  const steps = [
    { from: 0, row: { priceUnit: '100', discount: 0 } },
    { from: 10, row: { priceUnit: '80', discount: 0 } },
  ]
  const line = (id: string, priceUnit: string, priceAutomatic: boolean) => ({
    id,
    productId: 'sku',
    productUomId: 'each',
    productUomQty: '2',
    priceUnit,
    discount: '0',
    priceAutomatic,
    priceSteps: steps,
  })
  const c = {
    kind: 'sale.order',
    id: 'order',
    busy: false,
    data: {
      record: {
        state: 'draft',
        currency: 'VND',
        lines: [line('typed', '150', false), line('listed', '100', true)],
        invoices: [],
      },
      lineCosts: [],
      choices: {},
      permissions: {},
      lang: 'en',
    },
    t: (key: string) => key,
    draft: (_key: string, fallback: string) => fallback,
  } as unknown as RecordModalContext<SaleOrderModalData>
  const config = saleLineGridConfig(c)
  const native = ketGridOptions(config)
  const column = (key: string) => native.columns.find((item) => item.key === key)!
  const [typed, listed] = config.rows as Record<string, unknown>[]
  // A quantity past a step: the pricelist's line follows it, the negotiated one keeps its price.
  assert.equal(column('productUomQty').set!(typed!, 12).priceUnit, '150')
  assert.equal(column('productUomQty').set!(listed!, 12).priceUnit, '80')
  // Typing a price marks the line, so its next quantity change keeps it too.
  const edited = column('priceUnit').set!(listed!, '95')
  assert.deepEqual([edited.priceManual, edited.priceAutomatic], [true, false])
  assert.equal(column('productUomQty').set!(edited, 12).priceUnit, '95')
  // Another product drops the typed price and asks the server for the pricelist's.
  const swapped = column('productId').set!(typed!, 'other')
  assert.deepEqual([swapped.priceManual, swapped.priceAutomatic, swapped.priceUnit], [false, true, null])
})
