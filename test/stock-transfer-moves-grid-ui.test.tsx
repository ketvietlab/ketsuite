import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { postedTransferMoves } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-moves-draft.ts'
import {
  movesGridConfig,
  movesInGrid,
} from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-moves-grid.tsx'
import { transferModalDefinition as transfer } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'

type Row = Record<string, unknown>
const html = (value: unknown) => renderToString(value as TemplateResult)
const posted = (changes: Row) =>
  JSON.stringify({ added: [], updated: [], removed: [], order: null, ...changes })
// Goods counts in pieces (a box holds 12); Oil is measured in litres; an archived product stays on its line.
const units: Row[] = [
  { id: 'each', name: 'Cái', parentPath: 'each/' },
  { id: 'box', name: 'Hộp 12', parentPath: 'each/box/' },
  { id: 'litre', name: 'Lít', parentPath: 'litre/' },
  { id: 'ml', name: 'ml', parentPath: 'litre/ml/' },
]
const products: Row[] = [
  { id: 'goods', name: 'Goods · GOODS', uomId: 'each' },
  { id: 'oil', name: 'Oil · OIL', uomId: 'litre' },
]
const moves: Row[] = [
  { id: 'm1', name: 'Old · OLD', productId: 'old', productUomId: 'each', productUomQty: '4', state: 'draft' },
]
const read = (raw: string) => postedTransferMoves(products, raw, (id) => `draft:${id}`)
const context = (data: Row = {}, extra: Row = {}) =>
  ({
    kind: 'stock.transfer',
    id: 't1',
    creating: false,
    data: {
      record: { id: 't1', name: 'WH/INT/0001', state: 'draft', moves },
      permissions: { addMove: true, addMoves: true, confirmPicking: true, assignPicking: true },
      choices: { products, units },
      draftId: 'draft-id',
      ...data,
    },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
    recordChanged: false,
    ...extra,
  }) as never

test('C23 R3: past draft, a move reads what its picked lines hold against its demand, a delivery past it too', () => {
  const shipped = {
    record: {
      id: 't1',
      state: 'assigned',
      moves: [
        {
          ...moves[0],
          productUomQty: '2',
          state: 'assigned',
          lines: [{ quantity: '2' }, { quantity: '1.5' }],
        },
      ],
    },
  }
  const grid = movesGridConfig(context(shipped))
  const done = grid.columns.find((entry) => entry.key === 'done')!
  assert.deepEqual([done.label, done.type, done.editable], ['stock_backend.modal.done', 'number', false])
  assert.deepEqual(
    grid.columns.map((entry) => entry.key),
    ['productId', 'productUomId', 'productUomQty', 'done', 'state'],
  )
  assert.equal(grid.rows[0]!.done, 3.5)
  assert.equal(grid.rows[0]!.productUomQty, 2)
  // A draft has picked nothing yet: no column for it.
  assert.equal(
    movesGridConfig(context()).columns.some((entry) => entry.key === 'done'),
    false,
  )
})

test('the products grid adds lines in place: a product sets its unit and offers only the units it converts into', () => {
  const grid = movesGridConfig(context())
  const column = (key: string) => grid.columns.find((entry) => entry.key === key)!
  assert.deepEqual(
    grid.columns.map((entry) => [entry.key, entry.type, entry.editable, entry.lockedBy]),
    [
      ['productId', 'select', true, 'saved'],
      ['productUomId', 'select', true, 'saved'],
      ['productUomQty', 'number', true, 'saved'],
      ['state', 'text', false, undefined],
    ],
  )
  // A saved line's product stays named even when it is no longer offered.
  assert.deepEqual(column('productId').options, [
    { value: 'old', label: 'Old · OLD' },
    { value: 'goods', label: 'Goods · GOODS' },
    { value: 'oil', label: 'Oil · OIL' },
  ])
  assert.deepEqual(column('productId').sets, {
    goods: { productUomId: 'each' },
    oil: { productUomId: 'litre' },
  })
  assert.deepEqual(column('productUomId').optionsBy, {
    field: 'productId',
    values: { goods: ['each', 'box'], oil: ['litre', 'ml'] },
  })
  assert.equal(column('productUomQty').min, 0)
  assert.deepEqual(grid.rows, [
    {
      id: 'm1',
      productId: 'old',
      productUomId: 'each',
      productUomQty: 4,
      done: 0,
      state: 'stock_backend.state.draft',
      saved: true,
    },
  ])
  assert.deepEqual(grid.newRows, [
    {
      label: 'stock_backend.modal.addProduct',
      row: { productId: null, productUomId: null, productUomQty: 1, state: '', saved: false },
    },
  ])
  assert.equal(grid.removable, false)
  assert.equal(grid.name, 'moves')
  assert.equal(grid.form, 'stock-transfer-moves-form')
  // Unsaved rows survive the modal reading the record again.
  const carried = movesGridConfig(
    context({}, { draft: (key: string, fallback: string) => (key === 'moves' ? 'kept' : fallback) }),
  )
  assert.equal(carried.carry, 'kept')
  // A product without a unit offers none rather than every unit.
  const unitless = movesGridConfig(context({ choices: { products: [{ id: 'x', name: 'X' }], units } }))
  assert.deepEqual(unitless.columns[1]!.optionsBy!.values, { x: [] })
})

test('the products grid replaces the add-line dialog, and confirming or reserving waits for saved grids', () => {
  const body = html(transfer.body!(context()))
  assert.match(body, /<form[^>]*id="stock-transfer-moves-form"/)
  assert.match(body, /stock_backend\.modal\.saveProducts/)
  assert.doesNotMatch(body, /data-record-dialog="add"/)
  assert.equal(transfer.dialogs?.add, undefined)
  assert.equal(transfer.commands?.add, undefined)
  assert.ok(transfer.observeDrafts?.includes('moves'))
  assert.ok(transfer.observeDrafts?.includes('lines'))
  const button = (state: string, label: string, changed: boolean) =>
    html(
      transfer.pageActions!(
        context({ record: { id: 't1', state, moves, reserves: true } }, { recordChanged: changed }),
      ),
    ).match(new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*stock_backend\\.action\\.${label}<`))![0]
  for (const [state, label] of [
    ['draft', 'confirm'],
    ['confirmed', 'assign'],
  ]) {
    assert.doesNotMatch(button(state!, label!, false), /disabled/, label)
    assert.match(button(state!, label!, true), /disabled/, label)
  }
  // A refused save shows once, above the grid.
  const refused = html(
    transfer.body!(
      context({}, { fieldError: (field: string) => (field === 'moves' ? 'phải lớn hơn 0' : undefined) }),
    ),
  )
  assert.match(refused, /phải lớn hơn 0[\s\S]*stock-transfer-moves-form/)
  for (const field of ['productUomQty', 'productUomId', 'pickingId', 'id'])
    assert.equal(transfer.commands!.moves!.issueField!(field, new FormData(), context()), 'moves')
  // Without addMoves or addMove, while creating, or once done, the products are read only.
  for (const reader of [
    context({ permissions: { addMove: true } }),
    context({ permissions: { addMoves: true } }),
    context({ record: { id: 't1', state: 'done', moves } }),
    context({ record: { id: 't1', state: 'cancel', moves } }),
  ]) {
    const view = html(transfer.body!(reader))
    assert.doesNotMatch(view, /stock-transfer-moves-form/)
    assert.match(view, /Old · OLD/)
  }
  assert.doesNotMatch(html(transfer.body!(context({}, { creating: true }))), /stock-transfer-moves-form/)
  assert.deepEqual([movesInGrid(context()), movesInGrid(context({}, { creating: true }))], [true, false])
})

test('K21 a sales delivery or a return reads its products in the grid with no row to add and no save; a receipt does not reserve', () => {
  const bound = context({
    record: { id: 't1', name: 'X', state: 'confirmed', moves, bound: true, reserves: true },
  })
  const grid = movesGridConfig(bound)
  assert.equal(grid.readOnly, true)
  assert.deepEqual(grid.newRows, [])
  assert.deepEqual(
    grid.columns.map((entry) => entry.key),
    ['productId', 'productUomId', 'productUomQty', 'done', 'state'],
  )
  const body = html(transfer.body!(bound))
  assert.doesNotMatch(body, /<form[^>]*id="stock-transfer-moves-form"/)
  assert.doesNotMatch(body, /stock_backend\.modal\.saveProducts/)
  const actions = (reserves: boolean) =>
    html(transfer.pageActions!(context({ record: { id: 't1', state: 'confirmed', moves, reserves } })))
  assert.match(actions(true), /stock_backend\.action\.assign</)
  assert.doesNotMatch(actions(false), /stock_backend\.action\.assign</)
})

test('the posted products grid becomes addMoves entries; anything but new rows sends nothing', () => {
  assert.deepEqual(read(''), [])
  assert.deepEqual(
    read(
      posted({
        added: [
          { id: 'new-1', index: 1, values: { productId: 'goods', productUomId: 'box', productUomQty: 2 } },
          { id: 'new-2', index: 2, values: { productId: 'oil', productUomId: 'litre', productUomQty: null } },
        ],
      }),
    ),
    [
      {
        id: 'draft:new-1',
        name: 'Goods · GOODS',
        productId: 'goods',
        productUomId: 'box',
        productUomQty: '2',
      },
      // An empty demand is sent empty, never zero, for the server to refuse.
      { id: 'draft:new-2', name: 'Oil · OIL', productId: 'oil', productUomId: 'litre', productUomQty: '' },
    ],
  )
  assert.deepEqual(read(posted({ added: [{ id: 'new-1', values: { productId: 'goods' } }] })), [
    { id: 'draft:new-1', name: 'Goods · GOODS', productId: 'goods', productUomId: '', productUomQty: '' },
  ])
  for (const raw of [
    'not json',
    '[]',
    posted({ updated: [{ id: 'm1', values: { productUomQty: 5 } }] }),
    posted({ removed: ['m1'] }),
    posted({ added: [{ id: 'new-1', values: { productId: 'old', productUomQty: 1 } }] }),
    posted({ added: [{ id: 'new-1', values: { productUomQty: 1 } }] }),
    posted({ added: [{ id: 'new-1' }] }),
    posted({ added: [{ values: { productId: 'goods' } }] }),
    posted({ added: 'new-1' }),
  ])
    assert.equal(read(raw), null, raw)
  // The modal command names this reading's draft for new moves, and sends null for a malformed grid.
  const data = new FormData()
  data.set(
    'moves',
    posted({
      added: [{ id: 'new-1', values: { productId: 'goods', productUomId: 'each', productUomQty: 3 } }],
    }),
  )
  assert.deepEqual(transfer.commands!.moves!.input(data, context(), {} as never), {
    pickingId: 't1',
    moves: [
      {
        id: 'draft-id:new-1',
        name: 'Goods · GOODS',
        productId: 'goods',
        productUomId: 'each',
        productUomQty: '3',
      },
    ],
  })
  data.set('moves', 'not json')
  assert.deepEqual(transfer.commands!.moves!.input(data, context(), {} as never), {
    pickingId: 't1',
    moves: null,
  })
})
