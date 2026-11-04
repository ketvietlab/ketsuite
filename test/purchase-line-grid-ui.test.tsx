import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { KET_GRID_NO_CHANGES } from '@ketvietlab/design-system'
import { postedPurchaseLines } from '../packages/ketsuite/src/modules/purchase_backend/modal/line-grid-draft.ts'
import {
  linesInGrid,
  purchaseLinesGridConfig,
} from '../packages/ketsuite/src/modules/purchase_backend/modal/line-grid.tsx'
import { purchaseOrderModalDefinition as order } from '../packages/ketsuite/src/modules/purchase_backend/modal/order-modal-view.tsx'

type Row = Record<string, unknown>
const html = (value: unknown) => renderToString(value as TemplateResult)
// Two saved lines: goods by the box, and a retired product by the hour.
const lines: Row[] = [
  {
    id: 'a',
    productId: 'goods',
    name: 'Goods',
    productQty: '2',
    productUomId: 'box',
    qtyReceived: '0',
    priceUnit: '1200',
    discount: '0',
    taxId: 'vat',
  },
  {
    id: 'b',
    productId: 'retired',
    name: 'Retired',
    productQty: '1',
    productUomId: 'hour',
    qtyReceived: '1',
    priceUnit: '50',
    discount: '10',
    taxId: null,
  },
]
const units: Row[] = [
  { id: 'each', name: 'Each', parentPath: '/each/' },
  { id: 'box', name: 'Box of 12', parentPath: '/each/box/' },
  { id: 'hour', name: 'Hour', parentPath: '/hour/' },
]
const all = { saveLines: true, addLine: true, updateLine: true, removeLine: true }
const context = (data: Row = {}, extra: Row = {}) =>
  ({
    kind: 'purchase.order',
    id: 'po',
    creating: false,
    tab: 'info',
    dialog: null,
    data: {
      record: { id: 'po', name: 'RFQ0001', state: 'draft', currency: 'USD', lines, pickings: [], bills: [] },
      permissions: all,
      choices: {
        variants: [
          { id: 'goods', name: 'Goods · GOODS', defaultCode: 'GOODS', uomId: 'each' },
          { id: 'serum', name: 'Serum', defaultCode: '', uomId: 'hour' },
        ],
        units,
        taxes: [{ id: 'vat', name: 'VAT 10%' }],
      },
      draftId: 'draft-id',
      lang: 'vi',
      ...data,
    },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    href: () => '',
    busy: false,
    recordChanged: false,
    ...extra,
  }) as never
const read = (raw: string) => postedPurchaseLines(lines, raw, (id) => `draft:${id}`)
const posted = (changes: Row) =>
  JSON.stringify({ added: [], updated: [], removed: [], order: null, ...changes })

test('the RFQ line grid takes each line in place: searched product, its units, price, discount and tax', () => {
  const grid = purchaseLinesGridConfig(context())
  assert.deepEqual(
    grid.columns.map((column) => [column.key, column.type, column.editable, column.lockedBy]),
    [
      ['productId', 'combobox', true, 'saved'],
      ['productQty', 'number', true, 'lineLocked'],
      ['productUomId', 'select', true, 'lineLocked'],
      ['qtyReceived', 'number', false, undefined],
      ['priceUnit', 'money', true, 'lineLocked'],
      ['discount', 'percent', true, 'lineLocked'],
      ['taxId', 'select', true, 'lineLocked'],
      ['subtotal', 'money', false, undefined],
    ],
  )
  const column = (key: string) => grid.columns.find((entry) => entry.key === key)!
  // The catalogue is searched among products that can be bought; a found one brings its unit.
  assert.deepEqual(column('productId').search, {
    listFunction: 'product.listVariants',
    listInput: { purchaseOk: true },
    labelField: 'defaultCode',
    labelFallbackField: 'displayName',
    descriptionField: 'displayName',
    setsFrom: { productUomId: 'uomId' },
  })
  assert.deepEqual(column('productId').resets, ['productUomId'])
  assert.deepEqual(column('productId').sets, {
    goods: { productUomId: 'each' },
    serum: { productUomId: 'hour' },
  })
  // Saved products stay named even when no longer offered; a code labels a product that has one.
  assert.deepEqual(column('productId').options, [
    { value: 'goods', label: 'GOODS', description: 'Goods · GOODS' },
    { value: 'retired', label: 'Retired', description: 'Retired' },
    { value: 'serum', label: 'Serum', description: 'Serum' },
  ])
  // A product takes the units its own unit converts into; a searched product is left every unit.
  assert.deepEqual(column('productUomId').optionsBy, {
    field: 'productId',
    values: { goods: ['each', 'box'], retired: ['hour'], serum: ['hour'] },
  })
  assert.deepEqual(
    column('productUomId').options,
    units.map((unit) => ({ value: unit.id, label: unit.name })),
  )
  assert.deepEqual([column('productQty').min, column('priceUnit').min], [0, 0])
  assert.deepEqual([column('discount').min, column('discount').max], [0, 100])
  assert.equal(column('priceUnit').placeholder, 'purchase_backend.lines.vendorPrice')
  assert.deepEqual(column('taxId').options, [
    { value: '', label: '—' },
    { value: 'vat', label: 'VAT 10%' },
  ])
  assert.deepEqual(column('subtotal').compute, {
    multiply: ['productQty', 'priceUnit'],
    percentOff: 'discount',
  })
  assert.equal(grid.currency, 'USD')
  assert.deepEqual(grid.rows, [
    {
      id: 'a',
      productId: 'goods',
      productQty: 2,
      productUomId: 'box',
      qtyReceived: 0,
      priceUnit: 1200,
      discount: 0,
      taxId: 'vat',
      saved: true,
      lineLocked: false,
    },
    {
      id: 'b',
      productId: 'retired',
      productQty: 1,
      productUomId: 'hour',
      qtyReceived: 1,
      priceUnit: 50,
      discount: 10,
      taxId: '',
      saved: true,
      lineLocked: false,
    },
  ])
  assert.deepEqual(grid.newRows, [
    {
      label: 'purchase_backend.action.addLine',
      row: {
        productId: null,
        productQty: 1,
        productUomId: null,
        qtyReceived: null,
        priceUnit: null,
        discount: 0,
        taxId: '',
        saved: false,
        lineLocked: false,
      },
    },
  ])
  assert.equal(grid.removable, true)
  assert.equal(grid.readOnly, false)
  assert.deepEqual(
    [grid.name, grid.form, grid.carry],
    ['lines', 'purchase-order-lines-form', KET_GRID_NO_CHANGES],
  )
  // Each part follows its own right: no add row, no removal, saved lines locked.
  const narrow = purchaseLinesGridConfig(context({ permissions: { saveLines: true, addLine: true } }))
  assert.equal(narrow.removable, false)
  assert.deepEqual(
    narrow.rows.map((row) => row.lineLocked),
    [true, true],
  )
  const changesOnly = purchaseLinesGridConfig(context({ permissions: { saveLines: true, updateLine: true } }))
  assert.deepEqual(changesOnly.newRows, [])
  assert.equal(purchaseLinesGridConfig(context({}, { busy: true })).readOnly, true)
})

test('the grid shows only on an open RFQ for who may save it and change some line', () => {
  assert.equal(linesInGrid(context()), true)
  assert.equal(linesInGrid(context({ record: { id: 'po', state: 'sent', lines } })), true)
  for (const reader of [
    context({}, { creating: true }),
    context({ record: { id: 'po', state: 'to approve', lines } }),
    context({ record: { id: 'po', state: 'purchase', lines } }),
    context({ record: { id: 'po', state: 'draft', locked: true, lines } }),
    context({ permissions: { addLine: true, updateLine: true, removeLine: true } }),
    context({ permissions: { saveLines: true } }),
  ])
    assert.equal(linesInGrid(reader), false)
  for (const fn of ['addLine', 'updateLine', 'removeLine'])
    assert.equal(linesInGrid(context({ permissions: { saveLines: true, [fn]: true } })), true, fn)
})

test('the modal edits lines only in the grid, guides every tab and waits for saved lines', () => {
  const info = order.tabs!.find((tab) => tab.id === 'info')!
  const body = html(info.view(context()))
  assert.match(body, /<form[^>]*id="purchase-order-lines-form"/)
  assert.match(body, /data-island="backend\.ket-grid"/)
  assert.match(body, /purchase_backend\.action\.saveLines/)
  assert.doesNotMatch(body, /data-record-dialog="(addLine|editLine)"|name="productId"/)
  assert.deepEqual(Object.keys(order.dialogs ?? {}), ['bill'])
  for (const command of ['addLine', 'updateLine', 'removeLine'])
    assert.equal(order.commands?.[command], undefined)
  assert.ok(order.observeDrafts?.includes('lines'))
  // A refused save names what went wrong above the grid, once.
  const refused = html(
    info.view(
      context({}, { fieldError: (field: string) => (field === 'lines' ? 'Đơn vị không hợp lệ' : undefined) }),
    ),
  )
  assert.match(refused, /Đơn vị không hợp lệ[\s\S]*backend\.ket-grid/)
  for (const field of ['productUomId', 'productQty', 'id', 'lines'])
    assert.equal(order.commands!.saveLines!.issueField!(field, new FormData(), context()), 'lines')
  // A reader who may not save the grid reads the lines.
  const reading = html(info.view(context({ permissions: { addLine: true } })))
  assert.doesNotMatch(reading, /backend\.ket-grid/)
  assert.match(reading, /Goods[\s\S]*Retired/)
  // The order's guide opens from every tab and while creating.
  for (const tab of order.tabs!) assert.match(html(tab.view(context())), /id="purchase-order-help"/, tab.id)
  assert.match(html(order.body!(context({}, { creating: true }))), /id="purchase-order-help"/)
  // Its footer opens that guide (the shell's own Help sits behind the modal).
  for (const creating of [false, true])
    assert.match(
      html(order.actions!(context({}, { creating }))),
      /<button[^>]*name="screen-help"[^>]*>[\s\S]*?purchase_backend\.modal\.help/,
    )
  // Sending and confirming wait for the grid to be saved; approving does not edit lines.
  const button = (markup: string, label: string) =>
    markup.match(
      new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*purchase_backend\\.action\\.${label}<`),
    )![0]
  const actions = (changed: boolean, state = 'draft') =>
    html(
      order.actions!(
        context(
          {
            record: { id: 'po', state, lines },
            permissions: { ...all, sendRfq: true, confirmOrder: true, approveOrder: true },
          },
          { recordChanged: changed },
        ),
      ),
    )
  for (const label of ['send', 'confirm', 'requestApproval']) {
    assert.doesNotMatch(button(actions(false), label), /disabled/, label)
    assert.match(button(actions(true), label), /disabled/, label)
  }
  assert.doesNotMatch(button(actions(true, 'to approve'), 'approve'), /disabled/)
})

test('the posted grid becomes saveLines input; a malformed draft sends nothing', () => {
  assert.deepEqual(read(''), { lines: [], removed: [] })
  // A changed line sends only the cells that changed; an emptied cell is empty text.
  assert.deepEqual(
    read(
      posted({
        updated: [
          { id: 'a', values: { productQty: 5, taxId: '' } },
          { id: 'b', values: { discount: null } },
        ],
      }),
    ),
    {
      lines: [
        { id: 'a', productQty: '5', taxId: '' },
        { id: 'b', discount: '' },
      ],
      removed: [],
    },
  )
  // A change that touches no line cell sends nothing for that line.
  assert.deepEqual(read(posted({ updated: [{ id: 'a', values: { subtotal: 9 } }] })), {
    lines: [],
    removed: [],
  })
  // A new line sends its product and every cell under the reading's id; a removal names its line.
  assert.deepEqual(
    read(
      posted({
        added: [
          {
            id: 'new-1',
            values: { productId: 'serum', productQty: 2, productUomId: 'hour', priceUnit: null },
          },
        ],
        removed: ['b'],
      }),
    ),
    {
      lines: [
        {
          id: 'draft:new-1',
          productId: 'serum',
          productQty: '2',
          priceUnit: '',
          productUomId: 'hour',
          discount: '',
          taxId: '',
        },
      ],
      removed: ['b'],
    },
  )
  for (const bad of [
    'not json',
    '[]',
    posted({ removed: ['elsewhere'] }),
    posted({ removed: [1] }),
    posted({ removed: [['a']] }),
    posted({ removed: 'b' }),
    posted({ updated: [{ id: 'elsewhere', values: { productQty: 1 } }] }),
    posted({ updated: [{ id: 'a' }] }),
    posted({ updated: [{ id: 'a', values: 'productQty' }] }),
    posted({ updated: [{ id: 'b', values: { productQty: 1 } }], removed: ['b'] }),
    posted({ updated: 'a' }),
    posted({ added: [{ id: 'new-1', values: { productQty: 1 } }] }),
    posted({ added: [{ id: 'new-1', values: { productId: '', productQty: 1 } }] }),
    posted({ added: [{ values: { productId: 'goods', productQty: 1 } }] }),
    posted({ added: [{ id: 'new-1' }] }),
  ])
    assert.equal(read(bad), null, bad)
  const data = new FormData()
  data.set(
    'lines',
    posted({ added: [{ id: 'new-1', values: { productId: 'goods', productQty: 1 } }], removed: ['a'] }),
  )
  assert.deepEqual(order.commands!.saveLines!.input(data, context(), {} as never), {
    id: 'po',
    lines: [
      {
        id: 'draft-id:new-1',
        productId: 'goods',
        productQty: '1',
        priceUnit: '',
        productUomId: '',
        discount: '',
        taxId: '',
      },
    ],
    removed: ['a'],
  })
  // A grid that could not be read sends no lines, so the server refuses it by name.
  data.set('lines', 'not json')
  assert.deepEqual(order.commands!.saveLines!.input(data, context(), {} as never), {
    id: 'po',
    lines: null,
    removed: [],
  })
})
