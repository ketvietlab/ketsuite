import { salesConfigurationDefinition } from '../packages/ketsuite/src/modules/sale_backend/record/configuration-view.tsx'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, html as template } from '@ketvietlab/ketjs-view'
import {
  saleOrderModalDefinition,
  type SaleOrderModalData,
} from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import {
  SaleLineGrid,
  saleLineGridConfig,
} from '../packages/ketsuite/src/modules/sale_backend/modal/line-grid.tsx'
import { ketGridOptions } from '../packages/design-system/src/interactions/ket-grid/index.tsx'

const contextOf = (productId: string, permissions: Record<string, boolean> = { addLine: true }) =>
  ({
    kind: 'sale.order',
    id: 'order',
    busy: false,
    creating: false,
    dialog: null,
    data: {
      record: { id: 'order', name: 'S00001', state: 'draft', lines: [], pickings: [], invoices: [] },
      choices: {},
      permissions,
      lang: 'en',
    },
    draft: (name: string, fallback = '') => (name === 'productId' ? productId : fallback),
    fieldError: () => null,
    t: (key: string) => key,
  }) as unknown as RecordModalContext<SaleOrderModalData>

test('R10 native combo grid restricts item choices and retains locked cells, with no line dialog', async () => {
  const child = {
    id: 'child',
    comboParentId: 'parent',
    comboChoiceId: 'choice',
    productId: 'item',
    name: 'Item',
    productUomId: 'each',
    productUomName: 'Each',
    productUomQty: '2',
    priceUnit: '33',
    discount: '0',
    taxId: 'vat',
    comboOptions: [
      { id: 'item', name: 'Item' },
      { id: 'other', name: 'Alternative' },
    ],
  }
  const c = {
    kind: 'sale.order',
    id: 'order',
    busy: false,
    dialog: { name: 'editLine', params: { id: 'child' } },
    data: {
      record: {
        state: 'draft',
        revision: 7,
        lines: [
          {
            id: 'parent',
            productId: 'combo',
            name: 'Combo',
            comboBasePrice: '101',
            priceUnit: '0',
            productUomQty: '2',
            productUomId: 'each',
          },
          child,
        ],
      },
      choices: { variants: [{ id: 'unrelated', name: 'Unrelated' }] },
      permissions: { updateLine: true },
      lang: 'en',
    },
    draft: (_name: string, fallback = '') => fallback,
    fieldError: () => null,
    t: (key: string) => key,
  } as unknown as RecordModalContext<SaleOrderModalData>
  const config = saleLineGridConfig(c)
  const native = ketGridOptions(config)
  const row = config.rows[1]!
  const picker = native.columns[0]!
  const found = await picker.search!('', { row, signal: new AbortController().signal })
  assert.deepEqual(
    found.map((option) => option.value),
    ['item', 'other'],
  )
  // Locked unit and price cells stay; the hidden price flags follow the product column, and the
  // server never prices a combo item automatically whatever the grid sends.
  assert.deepEqual(picker.set!(row, 'other'), {
    ...row,
    productId: 'other',
    priceAutomatic: true,
    priceManual: false,
    priceSteps: null,
  })
  // Swapping a combo item happens in the grid: no line dialog or line command is left beside it.
  assert.equal(saleOrderModalDefinition.dialogs?.editLine, undefined)
  for (const command of ['addLine', 'updateLine', 'removeLine'])
    assert.equal(saleOrderModalDefinition.commands?.[command], undefined, command)
})

test('sale modal labels saved costs separately and hides them without cost permission', () => {
  const render = (allowed: boolean) => {
    const c = {
      kind: 'sale.order',
      id: 'order',
      creating: false,
      busy: false,
      data: {
        record: { state: 'sale', lines: [], pickings: [], invoices: [] },
        choices: {},
        permissions: { getLineCosts: allowed },
        lang: 'en',
        lineCosts: [
          { lineId: 'line', name: 'Goods', unitName: 'Box of 12', unitCostLabel: '720 ₫', currency: 'VND' },
        ],
      },
      t: (key: string) => key,
    } as unknown as RecordModalContext<SaleOrderModalData>
    return renderToString(template`${saleOrderModalDefinition.body!(c)}`)
  }
  assert.match(render(true), /sale_backend.cost.saved/)
  assert.match(render(true), /720 ₫/)
  assert.match(render(true), /Box of 12/)
  assert.doesNotMatch(render(false), /720 ₫|sale_backend.cost.saved/)
  // A reader's empty lines table speaks the page's language, not the table's default.
  assert.match(render(false), /sale_backend.lines.empty/)
  assert.doesNotMatch(render(false), /No records|nothing to show/)
})

test('a quotation edits its lines only in a grid card, with history too; without the grid it reads them', () => {
  const page = (
    state: string,
    permissions: Record<string, boolean>,
    history: Partial<Record<string, unknown>> = {},
  ) =>
    renderToString(
      template`${saleOrderModalDefinition.body!({
        ...contextOf('', permissions),
        data: {
          ...contextOf('').data,
          permissions,
          record: { ...contextOf('').data.record, state, ...history },
        },
      } as RecordModalContext<SaleOrderModalData>)}`,
    )
  // The lines table alone: the deliveries table further down has a delivered column of its own.
  const linesTable = (html: string) =>
    /<table data-ui="table" aria-label="sale_backend\.modal\.lines">[\s\S]*?<\/table>/.exec(html)?.[0] ?? ''
  const grid = { addLine: true, applyLineGrid: true }
  const delivery = { moves: [{ id: 'move', quantity: '1', state: 'done' }] }
  for (const [state, history] of [
    ['draft', {}],
    ['sent', {}],
    ['sent', delivery],
    ['draft', { invoices: [{ id: 'invoice' }] }],
  ] as const) {
    const html = page(state, grid, history)
    assert.match(html, /backend\.ket-grid/, state)
    assert.match(html, /name="__command" value="saveLines"/, state)
    assert.doesNotMatch(html, /value="addLine"/, state)
    // The grid sits in the lines card, like every block of the page.
    assert.match(html, /data-ui="surface"[\s\S]*sale_backend\.modal\.lines[\s\S]*backend\.ket-grid/, state)
  }
  // Without the grid, the lines are read: no field, no add row, no line dialog.
  const reader = linesTable(
    page(
      'sent',
      { addLine: true, updateLine: true, removeLine: true },
      {
        ...delivery,
        lines: [{ id: 'line', productId: 'goods', name: 'Goods', productUomQty: '2', qtyDelivered: '1' }],
      },
    ),
  )
  assert.match(reader, /sale_backend\.field\.delivered[\s\S]*sale_backend\.field\.subtotal/)
  assert.doesNotMatch(reader, /<input|<select|<textarea|<button|data-record-dialog/)
})

test('a quotation with history keeps its saved lines and their order, and adds product lines only', () => {
  const contextWith = (record: Record<string, unknown>) =>
    ({
      ...contextOf(''),
      data: {
        ...contextOf('').data,
        permissions: { applyLineGrid: true },
        record: {
          ...contextOf('').data.record,
          lines: [
            { id: 'line', productId: 'goods', productUomId: 'each', productUomQty: '2', priceUnit: '100' },
          ],
          ...record,
        },
      },
    }) as unknown as RecordModalContext<SaleOrderModalData>
  const fresh = saleLineGridConfig(contextWith({}))
  const history = saleLineGridConfig(contextWith({ moves: [{ id: 'move' }] }))
  const invoiced = saleLineGridConfig(contextWith({ invoices: [{ id: 'invoice' }] }))
  assert.deepEqual([fresh.removable, fresh.reorderable, fresh.newRows?.length], [true, true, 3])
  for (const config of [history, invoiced]) {
    assert.deepEqual([config.removable, config.reorderable], [false, false])
    assert.deepEqual(
      config.newRows?.map((row) => row.row.displayType),
      [null],
    )
    assert.deepEqual([config.rows[0]!.identityLocked, config.rows[0]!.unitLocked], [true, true])
    assert.ok(config.columns.some((column) => column.key === 'qtyDelivered'))
  }
  assert.deepEqual([fresh.rows[0]!.identityLocked, fresh.rows[0]!.unitLocked], [false, false])
  assert.ok(!fresh.columns.some((column) => column.key === 'qtyDelivered'))
})

test('a confirmed, cancelled or reset order moves to the list that now holds it', () => {
  const commands = saleOrderModalDefinition.commands!
  const c = contextOf('')
  const at = (href: string, run: () => string) => {
    const before = Object.getOwnPropertyDescriptor(globalThis, 'location')
    Object.defineProperty(globalThis, 'location', { value: new URL(href), configurable: true })
    try {
      return run()
    } finally {
      if (before) Object.defineProperty(globalThis, 'location', before)
      else delete (globalThis as { location?: unknown }).location
    }
  }
  const quote =
    'https://ket.test/admin/sales/quotations/order?lang=en&returnTo=%2Fadmin%2Fsales%2Fquotations%3Flang%3Den'
  // A confirmed quotation is no longer in Quotations: Back falls to the orders list.
  assert.equal(
    at(quote, () => commands.confirm!.navigate!(null, c)),
    '/admin/sales/orders/order?lang=en',
  )
  // Back to the overview still holds wherever the order goes.
  assert.equal(
    at('https://ket.test/admin/sales/quotations/order?returnTo=%2Fadmin%2Fsales', () =>
      commands.confirm!.navigate!(null, c),
    ),
    '/admin/sales/orders/order?returnTo=%2Fadmin%2Fsales',
  )
  const order = 'https://ket.test/admin/sales/orders/order?returnTo=%2Fadmin%2Fsales%2Forders'
  assert.equal(
    at(order, () => commands.cancel!.navigate!(null, c)),
    '/admin/sales/quotations/order',
  )
  assert.equal(
    at(quote, () => commands.reset!.navigate!(null, c)),
    '/admin/sales/quotations/order?lang=en&returnTo=%2Fadmin%2Fsales%2Fquotations%3Flang%3Den',
  )
})

test('a quotation is a page: its header carries Back, Print, Loyalty and the state commands', () => {
  const page = (data: Partial<SaleOrderModalData>, permissions = { confirmOrder: true }) =>
    renderToString(
      template`${saleOrderModalDefinition.pageActions!({
        ...contextOf('', permissions),
        data: { ...contextOf('', permissions).data, ...data },
      } as RecordModalContext<SaleOrderModalData>)}`,
    )
  // A page has no footer: the commands sit beside the title.
  assert.equal(saleOrderModalDefinition.actions, undefined)
  const plain = page({})
  assert.match(plain, /sale_backend\.action\.back/)
  assert.match(plain, /name="__command" value="confirm"/)
  assert.doesNotMatch(plain, /\/reports\/|\/admin\/loyalty\//)
  const composed = page({
    reports: [{ label: 'BÁO GIÁ', href: '/reports/sale.quotation/order?lang=en' }],
    loyalty: { label: 'Open order loyalty', href: '/admin/loyalty/orders/sale/order?lang=en' },
  })
  assert.match(composed, /href="\/reports\/sale\.quotation\/order\?lang=en"[\s\S]*BÁO GIÁ/)
  assert.match(composed, /href="\/admin\/loyalty\/orders\/sale\/order\?lang=en"/)
  // Confirm and cancel go through the route that picks loyalty_sale where it is composed.
  assert.equal(saleOrderModalDefinition.commands?.confirm?.route, '/admin/sales/order-command')
  assert.equal(saleOrderModalDefinition.commands?.cancel?.route, '/admin/sales/order-command')
})

test("a quotation page's aside holds the islands other modules place beside it", () => {
  const aside = (collaboration: Array<{ id: string; island: string }>) =>
    saleOrderModalDefinition.pageAside!({
      ...contextOf(''),
      data: { ...contextOf('').data, collaboration },
    } as RecordModalContext<SaleOrderModalData>)
  // Without islands the rail still holds the delivery plan (P51), and nothing else.
  const plain = renderToString(template`${aside([])}`)
  assert.match(plain, /delivery\.dates|Ngày giao/)
  assert.doesNotMatch(plain, /data-island=/)
  const html = renderToString(
    template`${aside([
      { id: 'sale_mail_backend', island: 'mail.chatter' },
      { id: 'sale_activity_backend', island: 'activity.record' },
    ])}`,
  )
  assert.match(html, /data-island="mail\.chatter"/)
  assert.match(html, /data-island="activity\.record"/)
  assert.match(html, /&quot;resModel&quot;:&quot;sale\.Order&quot;/)
})

test('a quotation is created with a customer picker that searches and creates partners', () => {
  const creating = {
    ...contextOf(''),
    creating: true,
    data: {
      ...contextOf('').data,
      record: { id: '', name: '', state: 'draft', lines: [], pickings: [], invoices: [] },
      choices: {
        partners: [{ id: 'buyer', name: 'Buyer', ref: 'KH01' }],
        ownPartners: [{ id: 'acme-partner' }],
        warehouses: [],
      },
    },
  } as unknown as RecordModalContext<SaleOrderModalData>
  const html = renderToString(template`${saleOrderModalDefinition.body!(creating)}`)
  const props = [...html.matchAll(/data-props="([^"]*)"/g)].map((match) =>
    JSON.parse(match[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'")),
  )
  const customer = props.find((props) => props.config?.name === 'partnerId')!.config
  assert.deepEqual(customer.options, [{ value: 'buyer', label: 'KH01 · Buyer' }])
  assert.equal(customer.manager.listFunction, 'partner.listPartners')
  assert.equal(customer.manager.searchInDropdown, true, 'a contact book outgrows the preload')
  assert.equal(customer.manager.saveFunction, 'partner.savePartner')
  assert.deepEqual(customer.manager.excludeIds, ['acme-partner'])
  assert.equal(customer.labels.dialogTitle, 'sale_backend.relation.customers')
  // No warehouse yet: the picker is shut and says where to create one.
  const warehouse = props.find((props) => props.config?.name === 'warehouseId')!.config
  assert.equal(warehouse.disabled, true)
  assert.match(html, /sale_backend\.setup\.warehouse/)
})

test('the quotation page puts every form in a titled card, and its state commands in the header', () => {
  // Creating: the terms form sits in a card, never straight on the page's canvas.
  const creating = renderToString(
    template`${saleOrderModalDefinition.body!({
      ...contextOf(''),
      creating: true,
      data: { ...contextOf('').data, choices: { partners: [], warehouses: [] } },
    } as unknown as RecordModalContext<SaleOrderModalData>)}`,
  )
  assert.match(
    creating,
    /^[\s\S]*?data-ui="surface"[\s\S]*sale_backend\.order\.information\.title[\s\S]*<form/,
  )
  // A saved quotation: its terms and its lines are cards; no tabs to hunt through.
  const saved = renderToString(template`${saleOrderModalDefinition.body!(contextOf(''))}`)
  assert.equal(saleOrderModalDefinition.tabs, undefined)
  assert.equal((saved.match(/data-ui="surface"/g) ?? []).length, 2)
  assert.doesNotMatch(saved, /data-ui="section"/)
  // A cancelled quotation is set back to draft from the header.
  const cancelled = renderToString(
    template`${saleOrderModalDefinition.pageActions!({
      ...contextOf('', { resetOrder: true }),
      data: {
        ...contextOf('', { resetOrder: true }).data,
        record: { id: 'order', name: 'S00001', state: 'cancel', lines: [], pickings: [], invoices: [] },
      },
    } as RecordModalContext<SaleOrderModalData>)}`,
  )
  assert.match(cancelled, /name="__command" value="reset"/)
})

test('sale grid posts only business changes and makes hidden-field refusals visible', () => {
  const c = {
    id: 'order',
    data: { record: { revision: 7 } },
  } as unknown as RecordModalContext<SaleOrderModalData>
  const form = new FormData()
  const changes = {
    added: [],
    updated: [{ id: 'line', values: { priceUnit: '12345678901234567890' } }],
    removed: [],
    order: null,
  }
  form.set('lines', JSON.stringify({ ...changes, optionLabels: { productUomId: { box: 'Box of 12' } } }))
  const command = saleOrderModalDefinition.commands!.saveLines!
  assert.deepEqual(command.input(form, c, {}), { id: 'order', expectedRevision: 7, changes })
  assert.equal(
    command.issueField!('changes', form, c),
    '',
    'hidden grid failures belong to the visible record summary',
  )
  form.set('lines', 'not json')
  assert.equal(command.input(form, c, {}).changes, null)
})

test('Native sales records retain fulfillment, invoice amounts and linked documents on direct pages', () => {
  const c = {
    kind: 'sale.order',
    id: 'order',
    creating: false,
    busy: false,
    data: {
      record: {
        state: 'sale',
        locked: true,
        display: { invoiceStatus: 'Fully invoiced' },
        lines: [
          {
            id: 'line',
            name: 'Goods',
            productUomName: 'Box',
            productUomQty: '4',
            qtyDelivered: '3',
            qtyInvoiced: '2',
            priceUnitLabel: '950 VND',
            priceSubtotalLabel: '3800 VND',
          },
        ],
        moves: [
          {
            id: 'move',
            origin: 'S00001',
            quantity: '36',
            state: 'done',
            pickingHref: '/admin/stock/transfers/picking?lang=en',
          },
        ],
        invoices: [
          {
            id: 'invoice',
            name: 'INV1',
            state: 'posted',
            amountTotalLabel: '1900 VND',
            href: '/admin/accounting/customer-invoices/invoice?lang=en',
          },
        ],
        pickings: [],
      },
      choices: {},
      permissions: {},
      lang: 'en',
    },
    t: (key: string) => key,
  } as unknown as RecordModalContext<SaleOrderModalData>
  const body = renderToString(template`${saleOrderModalDefinition.body!(c)}`)
  assert.match(body, /sale_backend.field.invoiced/)
  assert.match(body, /3800 VND/)
  assert.match(body, /Fully invoiced/)
  // Deliveries and invoices are cards of the same page, linked where the viewer may open them.
  assert.match(body, /href="\/admin\/stock\/transfers\/picking\?lang=en"/)
  assert.match(body, />36</)
  assert.match(body, /href="\/admin\/accounting\/customer-invoices\/invoice\?lang=en"/)
  assert.match(body, /1900 VND/)
  assert.match(renderToString(template`${saleOrderModalDefinition.status!(c)}`), /sale_backend.order.locked/)
})

test('D24 free grid rows keep descriptions and optional catalogue fields in the native form', () => {
  const c = {
    kind: 'sale.order',
    id: 'order',
    busy: false,
    data: {
      record: {
        currency: 'VND',
        lines: [
          {
            id: 'free',
            name: 'Advice',
            productId: null,
            productUomId: null,
            productUomQty: '2',
            priceUnit: '100',
            discount: '0',
          },
        ],
      },
      choices: { taxes: [{ id: 'vat', name: 'VAT' }] },
      lang: 'en',
    },
    draft: (_name: string, fallback = '') => fallback,
    t: (key: string) => key,
  } as unknown as RecordModalContext<SaleOrderModalData>
  const grid = saleLineGridConfig(c)
  assert.equal(grid.form, 'sale-line-grid-form')
  assert.ok(!grid.columns.find((column) => column.key === 'productId')!.required)
  assert.ok(!grid.columns.find((column) => column.key === 'productUomId')!.required)
  assert.equal(grid.rows[0]!.name, 'Advice')
  assert.ok(!grid.columns[0]!.options!.some((option) => option.value === 'null'))
  assert.deepEqual(JSON.parse(String(grid.carry)), { added: [], updated: [], removed: [], order: null })
  c.fieldError = (name) => (name === 'lines' ? 'Product required: Advice' : null)
  const refused = renderToString(template`${SaleLineGrid({ context: c })}`)
  assert.match(refused, /Product required: Advice/)
  assert.match(refused, /role="alert"/)
})

test('D24 Sales configuration uses revisioned native saves and hides writes from readers', () => {
  const c = {
    kind: 'sale.configuration',
    id: 'sales',
    busy: false,
    data: { record: { revision: 4, requireProduct: true }, save: true, lang: 'en' },
    draft: (_name: string, value = '') => value,
    draftChecked: (_name: string, _value: string, fallback: boolean) => fallback,
    fieldError: () => null,
    t: (key: string) => key,
  } as unknown as Parameters<NonNullable<typeof salesConfigurationDefinition.body>>[0]
  const html = renderToString(template`${salesConfigurationDefinition.body!(c)}`)
  assert.match(html, /name="requireProduct"/)
  assert.match(html, /type="submit"/)
  const form = new FormData()
  form.set('requireProduct', '1')
  assert.deepEqual(salesConfigurationDefinition.commands!.save!.input(form, c, {}), {
    requireProduct: true,
    saleWarnings: false,
    expectedRevision: 4,
  })
  // The new-quotation and confirmed-order cards save only their own settings (D20).
  assert.match(html, /name="quotationValidityDays"/)
  assert.match(html, /name="goodsInvoicePolicy"/)
  const quotations = new FormData()
  quotations.set('quotationValidityDays', '30')
  quotations.set('onlinePayment', '1')
  quotations.set('prepaymentPercent', ' 25 ')
  assert.deepEqual(salesConfigurationDefinition.commands!.saveQuotations!.input(quotations, c, {}), {
    quotationValidityDays: 30,
    onlineSignature: false,
    onlinePayment: true,
    prepaymentPercent: '25',
    expectedRevision: 4,
  })
  const orders = new FormData()
  orders.set('goodsInvoicePolicy', 'delivery')
  assert.deepEqual(salesConfigurationDefinition.commands!.saveOrders!.input(orders, c, {}), {
    lockConfirmed: false,
    goodsInvoicePolicy: 'delivery',
    expectedRevision: 4,
  })
  c.data.save = false
  const readonly = renderToString(template`${salesConfigurationDefinition.body!(c)}`)
  assert.doesNotMatch(readonly, /type="submit"/)
  assert.match(readonly, /disabled/)
})
