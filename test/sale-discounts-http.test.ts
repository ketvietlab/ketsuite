import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, type Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
async function prepared(t: TestContext) {
  const r = await setup(t)
  const order = () => r.call('sale.getOrder', { id: 'order' })
  const apply = async (mode: string, value: string) =>
    r.call('sale.applyDiscount', {
      id: 'order',
      expectedRevision: (await order()).revision,
      mode,
      value,
      label: 'Order discount',
    })
  const line = (id: string, priceUnit: string, taxIds: string[] = []) =>
    r.save('sale.addLine', { id, orderId: 'order', name: id, productUomQty: '1', priceUnit, taxIds })
  return { ...r, order, apply, line }
}
const lines = (order: Row) => order.lines as Row[]
const discounts = (order: Row) => lines(order).filter((line) => line.lineKind === 'discount')
test('D31a order discounts allocate exact minor amounts by tax group and replace previous discounts', async (t) => {
  const r = await prepared(t)
  for (const [id, amount] of [
    ['vat8', '8'],
    ['vat10', '10'],
  ])
    await r.save('account.saveTax', { id, name: id, typeTaxUse: 'sale', amountType: 'percent', amount })
  await r.line('a', '100', ['vat8'])
  await r.line('b', '200', ['vat10'])
  assert.equal((await r.apply('amount', '101')).ok, true)
  let order = await r.order(),
    adjustment = discounts(order)
  assert.deepEqual(
    adjustment.map((row) => row.priceUnit),
    ['-33', '-68'],
  )
  assert.equal(order.amountUntaxed, '199')
  assert.equal(order.amountTotal, '217')
  assert.ok(adjustment.every((row) => row.productId === null && row.productUomId === null))
  assert.equal((await r.apply('order_percent', '10')).ok, true)
  order = await r.order()
  assert.equal(discounts(order).length, 2)
  assert.equal(order.amountUntaxed, '270')
  assert.equal(order.amountTotal, '295')
  const before = order
  assert.equal((await r.apply('amount', '301')).ok, false)
  assert.deepEqual(await r.order(), before)
  assert.equal((await r.apply('amount', '0')).ok, true)
  assert.equal(discounts(await r.order()).length, 0)
})
test('D31a discounts are before tax even for included tax and do not reduce per-unit fixed levies', async (t) => {
  const r = await prepared(t)
  await r.save('account.saveTax', {
    id: 'included',
    name: 'Included VAT',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
    priceInclude: true,
  })
  await r.line('a', '110', ['included'])
  assert.equal((await r.apply('amount', '10')).ok, true)
  const order = await r.order()
  assert.equal(order.amountUntaxed, '90')
  assert.equal(order.amountTotal, '99')
  await r.save('account.saveTax', {
    id: 'fixed',
    name: 'Fixed levy',
    typeTaxUse: 'sale',
    amountType: 'fixed',
    amount: '5',
  })
  await r.line('b', '100', ['fixed'])
  assert.equal((await r.apply('amount', '20')).ok, true)
  assert.equal((await r.order()).amountUntaxed, '180')
  assert.equal((await r.order()).amountTotal, '194')
})
test('D31a percentage on ordinary lines keeps structural rows and locks negotiated prices', async (t) => {
  const r = await prepared(t)
  await r.line('a', '100')
  await r.line('b', '200')
  await r.save('sale.addLine', {
    id: 'section',
    orderId: 'order',
    displayType: 'section',
    name: 'Services',
    productUomQty: '0',
  })
  assert.equal((await r.apply('line_percent', '25')).ok, true)
  const order = await r.order()
  assert.equal(order.amountTotal, '225')
  assert.equal(discounts(order).length, 0)
  assert.ok(
    lines(order)
      .filter((row) => !row.displayType)
      .every((row) => row.discount === '25' && row.priceAutomatic === false),
  )
  assert.equal(lines(order).find((row) => row.id === 'section')!.discount, '0')
  for (const value of ['-1', '101']) assert.equal((await r.apply('line_percent', value)).ok, false)
})
test('D31a discount rows cannot be forged or edited but can be retained or removed through the grid', async (t) => {
  const r = await prepared(t)
  await r.line('a', '100')
  await r.apply('amount', '10')
  let order = await r.order(),
    row = discounts(order)[0]!
  assert.equal(
    (
      await r.call('sale.updateLine', {
        id: row.id,
        expectedRevision: order.revision,
        productUomQty: '1',
        priceUnit: '-90',
      })
    ).ok,
    false,
  )
  const grid = (changes: Row) =>
    r.call('sale.applyLineGrid', { id: 'order', expectedRevision: order.revision, changes })
  assert.equal(
    (
      await grid({
        added: [],
        updated: [{ id: row.id, values: { name: 'Forged' } }],
        removed: [],
        order: null,
      })
    ).ok,
    false,
  )
  assert.equal(
    (await grid({ added: [], updated: [{ id: 'a', values: { name: 'Changed' } }], removed: [], order: null }))
      .ok,
    true,
  )
  order = await r.order()
  assert.deepEqual(discounts(order)[0]!.priceUnit, '-10')
  assert.equal(
    (
      await grid({
        added: [{ id: 'fake', values: { name: 'Fake', productUomQty: '1', priceUnit: '-10' } }],
        updated: [],
        removed: [],
        order: null,
      })
    ).ok,
    false,
  )
  assert.equal((await grid({ added: [], updated: [], removed: [row.id], order: null })).ok, true)
  assert.equal((await r.order()).amountTotal, '100')
})
test('D31a concurrent and cross-company discount writes cannot silently overwrite', async (t) => {
  const r = await prepared(t)
  await r.line('a', '100')
  const order = await r.order()
  const input = { id: 'order', expectedRevision: order.revision, mode: 'amount', value: '10' }
  const result = await Promise.all([
    r.call('sale.applyDiscount', input),
    r.call('sale.applyDiscount', { ...input, value: '20' }),
  ])
  assert.equal(result.filter((row) => row.ok).length, 1)
  assert.equal((await r.fixture('sale.applyDiscount', input, 'other')).ok, false)
})
async function accounting(r: Awaited<ReturnType<typeof prepared>>) {
  for (const [id, accountType] of [
    ['revenue', 'income'],
    ['receivable', 'asset_receivable'],
  ])
    await r.save('account.saveAccount', { id, code: id, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  return { journalId: 'journal', revenueAccountId: 'revenue', receivableAccountId: 'receivable' }
}
test('D31a invoices preserve discount kinds and balanced contra-lines without delivery placeholders', async (t) => {
  const r = await prepared(t)
  await r.line('a', '100')
  await r.apply('amount', '10')
  const accounts = await accounting(r)
  await r.save('sale.confirmOrder', { id: 'order' })
  assert.equal(
    (await r.call('sale.createInvoice', { id: 'invoice', orderId: 'order', ...accounts })).ok,
    true,
  )
  const move = (await r.app.adapter!.all(`SELECT * FROM account_move WHERE id = 'invoice'`))[0]!
  assert.equal(String(move.amountTotal), '90')
  const items = await r.app.adapter!.all(`SELECT * FROM account_move_line WHERE "moveId" = 'invoice'`)
  const discount = items.find((row) => row.lineKind === 'discount')!
  assert.equal(String(discount.priceUnit), '-10')
  assert.equal(String(discount.debit), '10')
  assert.equal(
    items.reduce((sum, row) => sum + Number(row.balance), 0),
    0,
  )
  assert.equal((await r.app.adapter!.all('SELECT * FROM stock_move')).length, 0)
})
for (const quantity of ['0', '0.1'])
  test(
    'D31a invoices refuse a discount-only or negative remainder atomically at quantity ' + quantity,
    async (t) => {
      const r = await prepared(t)
      await r.line('a', '100')
      await r.apply('amount', '90')
      const order = await r.order()
      await r.save('sale.applyLineGrid', {
        id: 'order',
        expectedRevision: order.revision,
        changes: {
          added: [],
          updated: [{ id: 'a', values: { productUomQty: quantity } }],
          removed: [],
          order: null,
        },
      })
      const accounts = await accounting(r)
      await r.save('sale.confirmOrder', { id: 'order' })
      assert.equal(
        (await r.call('sale.createInvoice', { id: 'bad', orderId: 'order', ...accounts })).ok,
        false,
      )
      assert.equal((await r.app.adapter!.all(`SELECT * FROM account_move WHERE id = 'bad'`)).length, 0)
    },
  )

test('D31a direct accounting invoices require negative discount lines and reject negative ordinary lines', async (t) => {
  const r = await prepared(t)
  await accounting(r)
  const input = {
    journalId: 'journal',
    moveType: 'out_invoice',
    partnerId: 'buyer',
    lineAccountId: 'revenue',
    counterpartAccountId: 'receivable',
  }
  for (const [id, entries] of [
    ['ordinary-negative', [{ description: 'Bad', quantity: '1', priceUnit: '-10' }]],
    [
      'ordinary-negative-offset',
      [
        { description: 'Sale', quantity: '1', priceUnit: '100' },
        { description: 'Bad', quantity: '1', priceUnit: '-10' },
      ],
    ],
    [
      'discount-positive-offset',
      [
        { description: 'Sale', quantity: '1', priceUnit: '100' },
        { description: 'Bad', quantity: '1', priceUnit: '10', lineKind: 'discount' },
      ],
    ],
    ['discount-positive', [{ description: 'Bad', quantity: '1', priceUnit: '10', lineKind: 'discount' }]],
    ['discount-only', [{ description: 'Bad', quantity: '1', priceUnit: '-10', lineKind: 'discount' }]],
    [
      'negative-total',
      [
        { description: 'Sale', quantity: '1', priceUnit: '5' },
        {
          description: 'Discount',
          lineAccountId: 'revenue',
          quantity: '1',
          priceUnit: '-10',
          lineKind: 'discount',
        },
      ],
    ],
  ] as const)
    assert.equal(
      (
        await r.call('account.createInvoice', {
          ...input,
          id,
          lines: entries.map((line) => ({ ...line, lineAccountId: 'revenue' })),
        })
      ).ok,
      false,
    )
  assert.equal(
    (
      await r.call('account.createInvoice', {
        ...input,
        id: 'direct',
        lines: [
          { description: 'Sale', lineAccountId: 'revenue', quantity: '1', priceUnit: '100' },
          {
            description: 'Discount',
            lineAccountId: 'revenue',
            quantity: '1',
            priceUnit: '-10',
            lineKind: 'discount',
          },
        ],
      })
    ).ok,
    true,
  )
  const rows = await r.app.adapter!.all(`SELECT * FROM account_move_line WHERE "moveId" = 'direct'`)
  assert.equal(rows.filter((row) => row.lineKind === 'discount').length, 1)
  assert.equal(
    (
      await r.call('account.addMoveLine', {
        id: 'bad-direct',
        moveId: 'direct',
        name: 'Bad',
        accountId: 'revenue',
        quantity: '1',
        priceUnit: '-1',
        credit: '1',
      })
    ).ok,
    false,
  )
})
test('D31a viewers cannot apply discounts and stale requests keep order data intact', async (t) => {
  const r = await prepared(t)
  await r.line('a', '100')
  await r.fixture('user.createUser', {
    id: 'viewer',
    login: 'viewer',
    password: 'test-password',
    name: 'Viewer',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'viewer-company', userId: 'viewer', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'viewer-role', name: 'Viewer' })
  await r.fixture('user.assignRole', { id: 'viewer-role-link', userId: 'viewer', roleId: 'viewer-role' })
  await r.fixture('user.grantFunction', { id: 'viewer-read', roleId: 'viewer-role', fnKey: 'sale.getOrder' })
  const client = r.app.client.anonymous()
  await client.login({ login: 'viewer', password: 'test-password' })
  const before = await r.order(),
    input = { id: 'order', expectedRevision: before.revision, mode: 'amount', value: '10' }
  await assert.rejects(() => client.call('sale.applyDiscount', input), { status: 403 })
  assert.deepEqual(await r.order(), before)
  assert.equal((await r.call('sale.applyDiscount', { ...input, expectedRevision: -1 })).ok, false)
  assert.deepEqual(await r.order(), before)
})

test('D31a discount invoice retains included VAT and product-required confirmation excludes adjustments', async (t) => {
  const r = await prepared(t)
  const accounts = await accounting(r)
  await r.save('account.saveAccount', {
    id: 'tax-account',
    code: 'TAX',
    name: 'VAT',
    accountType: 'liability_current',
  })
  await r.save('account.saveTax', {
    id: 'vat',
    name: 'Included VAT',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
    priceInclude: true,
    accountId: 'tax-account',
  })
  await r.save('sale.addLine', {
    id: 'goods-line',
    orderId: 'order',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '1',
    priceUnit: '110',
    taxIds: ['vat'],
  })
  await r.apply('amount', '10')
  await r.save('sale.saveConfiguration', { requireProduct: true, expectedRevision: 0 })
  await r.save('sale.confirmOrder', { id: 'order' })
  const invoice = await r.call('sale.createInvoice', {
    id: 'taxed-invoice',
    orderId: 'order',
    ...accounts,
    taxAccountId: 'tax-account',
  })
  assert.equal(invoice.ok, true, JSON.stringify(invoice))
  assert.equal(invoice.amountTotal, '99')
  const rows = await r.app.adapter!.all(`SELECT * FROM account_move_line WHERE "moveId" = 'taxed-invoice'`)
  assert.equal(
    rows.reduce((sum, row) => sum + Number(row.balance), 0),
    0,
  )
  assert.equal(
    rows.filter((row) => row.accountId === 'tax-account').reduce((sum, row) => sum + Number(row.balance), 0),
    -9,
  )
})
test('D31a nullable line classifications migrate without changing existing commercial facts', async (t) => {
  const r = await prepared(t)
  await r.line('a', '100')
  const accounts = await accounting(r)
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('sale.createInvoice', { id: 'invoice', orderId: 'order', ...accounts })
  const legacy = r.deployment.modules.map((module) => {
    if (typeof module === 'string' || !['sale', 'account'].includes(module.name)) return module
    const name = module.name === 'sale' ? 'OrderLine' : 'MoveLine',
      model = module.models![name]!,
      { lineKind: _kind, ...fields } = model.fields
    return { ...module, models: { ...module.models, [name]: { ...model, fields } } }
  })
  await migrateOne(r.app.adapter!, compose(legacy, { headless: true, companies: true }), {
    allowDestructive: true,
  })
  const before = await Promise.all(
    ['sale_order_line', 'account_move_line'].map((table) =>
      r.app.adapter!.all('SELECT * FROM ' + table + ' ORDER BY id'),
    ),
  )
  const target = compose(r.deployment.modules, { headless: true, companies: true })
  await migrateOne(r.app.adapter!, target)
  const after = await Promise.all(
    ['sale_order_line', 'account_move_line'].map((table) =>
      r.app.adapter!.all('SELECT * FROM ' + table + ' ORDER BY id'),
    ),
  )
  for (const [index, rows] of after.entries()) {
    assert.ok(rows.every((row) => row.lineKind === null))
    assert.deepEqual(
      rows.map(({ lineKind: _kind, ...row }) => row),
      before[index]!.map((row) => ({ ...row })),
    )
  }
  assert.deepEqual(await migrateOne(r.app.adapter!, target), [])
})

test('D31a line discounts treat combo parents once and preserve child pricing ownership', async (t) => {
  const r = await prepared(t)
  await r.save('product.saveCombo', {
    id: 'choice',
    name: 'Choice',
    items: [{ productId: r.productId, extraPrice: '0' }],
  })
  await r.save('product.saveRecord', {
    id: 'combo',
    name: 'Combo',
    defaultCode: 'COMBO',
    type: 'combo',
    uomId: 'each',
    comboIds: ['choice'],
    listPrice: '100',
    saleOk: true,
  })
  await r.save('sale.addLine', {
    id: 'parent',
    orderId: 'order',
    productId: 'combo:default',
    productUomId: 'each',
    productUomQty: '2',
  })
  assert.equal((await r.apply('line_percent', '10')).ok, true)
  let order = await r.order()
  assert.equal(order.amountTotal, '180')
  const parent = lines(order).find((row) => row.id === 'parent')!,
    child = lines(order).find((row) => row.comboParentId === 'parent')!
  assert.equal(parent.discount, '10')
  assert.equal(child.discount, '10')
  assert.equal(child.productUomQty, '2')
  assert.equal((await r.apply('order_percent', '10')).ok, true)
  order = await r.order()
  assert.equal(order.amountTotal, '162')
  assert.equal(discounts(order)[0]!.priceUnit, '-18')
})

test('D31a a failed later tax group rolls back discount replacement and the order revision', async (t) => {
  const r = await prepared(t)
  for (const id of ['a-tax', 'b-tax'])
    await r.save('account.saveTax', { id, name: id, typeTaxUse: 'sale', amountType: 'percent', amount: '10' })
  await r.line('a', '100', ['a-tax'])
  await r.line('b', '100', ['b-tax'])
  await r.apply('amount', '20')
  await r.save('account.saveTax', {
    id: 'b-tax',
    name: 'Inactive',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
    active: false,
  })
  const before = await r.order()
  assert.equal((await r.apply('amount', '30')).ok, false)
  assert.deepEqual(await r.order(), before)
})
test('D31a a legacy zero discount cannot create a standalone invoice', async (t) => {
  const r = await prepared(t)
  await r.line('a', '100')
  await r.apply('amount', '10')
  const order = await r.order(),
    discount = discounts(order)[0]!
  await r.save('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: order.revision,
    changes: { added: [], updated: [{ id: 'a', values: { productUomQty: '0' } }], removed: [], order: null },
  })
  await r.app.adapter!.exec(
    `UPDATE sale_order_line SET "priceUnit" = '0', "priceSubtotal" = '0', "priceSubtotalIncl" = '0' WHERE id = '${String(discount.id)}'`,
  )
  const accounts = await accounting(r)
  await r.save('sale.confirmOrder', { id: 'order' })
  assert.equal(
    (await r.call('sale.createInvoice', { id: 'zero-only', orderId: 'order', ...accounts })).ok,
    false,
  )
})
