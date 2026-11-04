import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { postedPickingLines } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-grid-draft.ts'
import { pickingGridConfig } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-grid.tsx'
import { transferModalDefinition as transfer } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'

type Row = Record<string, unknown>
const html = (value: unknown) => renderToString(value as TemplateResult)
/** A new row's line id as the modal derives it from its draft id. */
const read = (raw: string) => postedPickingLines(moves, raw, (id) => `draft:${id}`)
const EMPTY = JSON.stringify({ added: [], updated: [], removed: [], order: null })
const posted = (changes: Row) =>
  JSON.stringify({ added: [], updated: [], removed: [], order: null, ...changes })
// A lot-tracked receipt line and a picked delivery line from one lot.
const moves: Row[] = [
  {
    id: 'in',
    name: 'Serum',
    productId: 'serum',
    productUomQty: '5',
    receiptLotInput: true,
    valuedReceipt: true,
    lines: [
      {
        id: 'r1',
        moveId: 'in',
        quantity: '3',
        receiptLotName: 'BATCH-1',
        receiptLotNumber: 'BATCH-1',
        receiptExpiryDate: '2031-01-01',
        receiptRevision: 'rev-1',
        picked: true,
      },
    ],
  },
  {
    id: 'out',
    name: 'Goods',
    productId: 'goods',
    productUomQty: '4',
    lines: [{ id: 'p1', moveId: 'out', quantity: '2', lotId: 'g-old', picked: false }],
  },
]
const valuation = {
  currency: 'VND',
  drafts: [{ moveLineId: 'r1', unitCost: '1500', averageCost: '1300' }],
  lines: [],
  total: '0',
  accountMoveName: null,
  entryHref: null,
}
const all = {
  savePickingLines: true,
  saveMoveLine: true,
  prepareReceiptLot: true,
  setReceiptUnitCost: true,
  validatePicking: true,
}
const context = (data: Row = {}, extra: Row = {}) =>
  ({
    kind: 'stock.transfer',
    id: 't1',
    creating: false,
    data: {
      record: { id: 't1', name: 'WH/IN/0001', state: 'assigned', moves },
      permissions: all,
      valuation,
      choices: {
        lots: [
          { id: 'g-old', name: 'G-OLD', productId: 'goods' },
          { id: 'g-new', name: 'G-NEW', productId: 'goods' },
          { id: 's-1', name: 'S-1', productId: 'serum' },
        ],
      },
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

test('K30/K24 the transfer grid takes each line in place: lot by move, receipt lot and expiry, picked and price', () => {
  const grid = pickingGridConfig(context())
  assert.deepEqual(
    grid.columns.map((column) => [column.key, column.type, column.lockedBy]),
    [
      ['moveId', 'select', 'saved'],
      ['quantity', 'number', 'lineLocked'],
      ['lotId', 'select', 'lotLocked'],
      ['name', 'text', 'receiptLocked'],
      ['expirationDate', 'date', 'receiptLocked'],
      ['picked', 'checkbox', 'lineLocked'],
      ['unitCost', 'number', 'costLocked'],
    ],
  )
  const column = (key: string) => grid.columns.find((entry) => entry.key === key)!
  // Each move offers only its own product's lots, and choosing a move unlocks the cells it takes.
  assert.deepEqual(column('lotId').optionsBy, {
    field: 'moveId',
    values: { in: ['s-1'], out: ['g-old', 'g-new'] },
  })
  assert.deepEqual(column('moveId').sets, {
    in: { lineLocked: false, lotLocked: true, receiptLocked: false, costLocked: false },
    out: { lineLocked: false, lotLocked: false, receiptLocked: true, costLocked: true },
  })
  assert.deepEqual(column('moveId').resets, ['lotId'])
  // A quantity is never negative, nor a price.
  assert.deepEqual([column('quantity').min, column('unitCost').min], [0, 0])
  assert.equal(column('unitCost').placeholder, 'stock_backend.modal.averageCost')
  assert.equal(column('name').placeholder, 'stock_backend.modal.receiptAutomatic')
  assert.deepEqual(grid.rows, [
    {
      id: 'r1',
      moveId: 'in',
      quantity: 3,
      lotId: null,
      name: 'BATCH-1',
      expirationDate: '2031-01-01',
      picked: true,
      saved: true,
      lineLocked: false,
      lotLocked: true,
      receiptLocked: false,
      costLocked: false,
      unitCost: 1500,
    },
    {
      id: 'p1',
      moveId: 'out',
      quantity: 2,
      lotId: 'g-old',
      name: '',
      expirationDate: null,
      picked: false,
      saved: true,
      lineLocked: false,
      lotLocked: false,
      receiptLocked: true,
      costLocked: true,
      // A delivery line has no price of its own, so its cell stays empty and locked.
      unitCost: null,
    },
  ])
  assert.equal(grid.newRows?.length, 1)
  assert.deepEqual(grid.newRows![0]!.row, {
    moveId: null,
    quantity: 1,
    lotId: null,
    name: '',
    expirationDate: null,
    picked: true,
    saved: false,
    lineLocked: true,
    lotLocked: true,
    receiptLocked: true,
    costLocked: true,
  })
  assert.deepEqual(
    [grid.name, grid.form, grid.removable, grid.carry],
    ['lines', 'stock-transfer-lines-form', false, EMPTY],
  )
  // Unsaved lines survive the modal reading the transfer again.
  const held = posted({ updated: [{ id: 'p1', values: { quantity: 4 } }] })
  const kept = pickingGridConfig(
    context({}, { draft: (key: string, fallback: string) => (key === 'lines' ? held : fallback) }),
  )
  assert.equal(kept.carry, held)

  // Without the price right, or without valuation, there is no price column; without a line right, no new rows.
  const keeper = pickingGridConfig(context({ permissions: { ...all, setReceiptUnitCost: false } }))
  assert.equal(
    keeper.columns.some((entry) => entry.key === 'unitCost'),
    false,
  )
  assert.equal(
    pickingGridConfig(context({ valuation: null })).columns.some((entry) => entry.key === 'unitCost'),
    false,
  )
  const pricer = pickingGridConfig(
    context({ permissions: { savePickingLines: true, setReceiptUnitCost: true } }),
  )
  assert.deepEqual(pricer.newRows, [])
  assert.deepEqual(
    pricer.rows.map((row) => [row.id, row.lineLocked, row.costLocked]),
    [
      ['r1', true, false],
      ['p1', true, true],
    ],
  )
  // A transfer with receipts only has no lot picker; one without receipts has no receipt lot cells.
  const receipts = pickingGridConfig(context({ record: { id: 't1', state: 'assigned', moves: [moves[0]] } }))
  assert.equal(
    receipts.columns.some((entry) => entry.key === 'lotId'),
    false,
  )
  const deliveries = pickingGridConfig(
    context({ record: { id: 't1', state: 'assigned', moves: [moves[1]] } }),
  )
  assert.deepEqual(
    deliveries.columns.map((entry) => entry.key),
    ['moveId', 'quantity', 'lotId', 'picked'],
  )
})

test('K30 the grid replaces every per-line dialog, and completing waits for saved lines', () => {
  const body = html(transfer.body!(context()))
  assert.match(body, /<form[^>]*id="stock-transfer-lines-form"/)
  assert.match(body, /data-island="backend\.ket-grid"/)
  assert.match(body, /stock_backend\.modal\.saveLines/)
  assert.match(body, /stock_backend\.modal\.receiptHint/)
  assert.doesNotMatch(body, /data-record-dialog="(line|receipt|cost)"/)
  assert.equal(transfer.dialogs?.line ?? transfer.dialogs?.receipt ?? transfer.dialogs?.cost, undefined)
  assert.ok(transfer.observeDrafts?.includes('lines'))
  const complete = (changed: boolean) =>
    html(transfer.pageActions!(context({}, { recordChanged: changed }))).match(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*stock_backend\.action\.validate/,
    )![0]
  assert.doesNotMatch(complete(false), /disabled/)
  assert.match(complete(true), /disabled/)
  // A refused save names what went wrong above the grid.
  const refused = html(
    transfer.body!(
      context(
        {},
        { fieldError: (field: string) => (field === 'lines' ? 'Số lượng không hợp lệ' : undefined) },
      ),
    ),
  )
  assert.match(refused, /Số lượng không hợp lệ[\s\S]*backend\.ket-grid/)
  // Every refusal of the save lands on the grid's own field, so the modal does not repeat it on top.
  for (const field of ['quantity', 'moveId', 'expectedRevision', 'id'])
    assert.equal(transfer.commands!.lines!.issueField!(field, new FormData(), context()), 'lines')
  // Without savePickingLines, or once the transfer is done, the lines are read only.
  for (const reader of [
    context({ permissions: { saveMoveLine: true, prepareReceiptLot: true } }),
    context({ record: { id: 't1', state: 'done', moves } }),
  ]) {
    const view = html(transfer.body!(reader))
    assert.doesNotMatch(view, /backend\.ket-grid|stock-transfer-lines-form/)
    assert.match(view, /BATCH-1/)
  }
  // A transfer without receipts carries no receipt hint.
  const delivery = html(
    transfer.body!(context({ record: { id: 't1', state: 'assigned', moves: [moves[1]] } })),
  )
  assert.doesNotMatch(delivery, /stock_backend\.modal\.receiptHint/)
})

test('K30 the posted grid becomes savePickingLines entries; a malformed draft sends nothing', () => {
  assert.deepEqual(read(''), [])
  // A changed line sends all its values with the receipt revision it was read at.
  assert.deepEqual(read(posted({ updated: [{ id: 'r1', values: { quantity: 4 } }] })), [
    {
      id: 'r1',
      moveId: 'in',
      quantity: '4',
      lotId: null,
      name: 'BATCH-1',
      expirationDate: '2031-01-01',
      picked: true,
      expectedRevision: 'rev-1',
    },
  ])
  assert.deepEqual(read(posted({ updated: [{ id: 'p1', values: { lotId: 'g-new', picked: true } }] })), [
    { id: 'p1', moveId: 'out', quantity: '2', lotId: 'g-new', name: '', expirationDate: '', picked: true },
  ])
  // A price alone sends only the price; a cleared price goes back to the average.
  assert.deepEqual(read(posted({ updated: [{ id: 'r1', values: { unitCost: 1600 } }] })), [
    { id: 'r1', moveId: 'in', unitCost: '1600' },
  ])
  assert.deepEqual(read(posted({ updated: [{ id: 'r1', values: { unitCost: null } }] })), [
    { id: 'r1', moveId: 'in', unitCost: '' },
  ])
  // A new line sends every value under the grid's id; an empty price is left to the average.
  assert.deepEqual(
    read(
      posted({
        added: [
          {
            id: 'new-1',
            values: {
              moveId: 'in',
              quantity: 2,
              name: '',
              expirationDate: '2031-06-01',
              picked: true,
              unitCost: null,
            },
          },
          { id: 'new-2', values: { moveId: 'in', quantity: 1, unitCost: 1400 } },
        ],
      }),
    ),
    [
      {
        id: 'draft:new-1',
        moveId: 'in',
        quantity: '2',
        lotId: null,
        name: '',
        expirationDate: '2031-06-01',
        picked: true,
      },
      {
        id: 'draft:new-2',
        moveId: 'in',
        quantity: '1',
        lotId: null,
        name: '',
        expirationDate: '',
        picked: false,
        unitCost: '1400',
      },
    ],
  )
  for (const bad of [
    'not json',
    '[]',
    posted({ removed: ['p1'] }),
    posted({ updated: [{ id: 'elsewhere', values: { moveId: 'out', quantity: 1 } }] }),
    posted({ updated: [{ id: 'p1' }] }),
    posted({ updated: [{ id: 'p1', values: 'quantity' }] }),
    posted({ updated: [{ id: 'p1', values: { moveId: 'other' } }] }),
    posted({ added: [{ id: 'p1', values: { moveId: 'out', quantity: 1 } }] }),
    posted({ added: [{ id: 'new', values: { quantity: 1 } }] }),
    posted({ added: [{ values: { moveId: 'out', quantity: 1 } }] }),
    posted({ updated: 'p1' }),
  ])
    assert.equal(read(bad), null, bad)
  const data = new FormData()
  data.set('lines', posted({ updated: [{ id: 'p1', values: { quantity: 3 } }] }))
  assert.deepEqual(transfer.commands!.lines!.input(data, context(), {} as never), {
    id: 't1',
    lines: [
      { id: 'p1', moveId: 'out', quantity: '3', lotId: 'g-old', name: '', expirationDate: '', picked: false },
    ],
  })
  // A new line takes the modal reading's draft id, so a retried save writes it once.
  data.set(
    'lines',
    posted({ added: [{ id: 'new-1', values: { moveId: 'out', quantity: 1, picked: true } }] }),
  )
  assert.deepEqual(transfer.commands!.lines!.input(data, context(), {} as never), {
    id: 't1',
    lines: [
      {
        id: 'draft-id:new-1',
        moveId: 'out',
        quantity: '1',
        lotId: null,
        name: '',
        expirationDate: '',
        picked: true,
      },
    ],
  })
  data.set('lines', 'not json')
  assert.deepEqual(transfer.commands!.lines!.input(data, context(), {} as never), { id: 't1', lines: null })
})
