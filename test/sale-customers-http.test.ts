import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/** A confirmed order of two boxes (2 × 100) to Buyer, with the books a sales invoice needs. */
async function seed(t: TestContext) {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  await r.save('sale.confirmOrder', { id: 'order' })
  for (const [id, accountType] of [
    ['revenue', 'income'],
    ['receivable', 'asset_receivable'],
    ['cash', 'asset_cash'],
  ])
    await r.save('account.saveAccount', { id, code: id, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  await r.save('account.saveJournal', {
    id: 'bank',
    name: 'Bank',
    code: 'BNK',
    type: 'bank',
    defaultAccountId: 'cash',
  })
  const credit = (orderId?: string) =>
    r.call('sale.getCustomerCredit', { partnerId: 'buyer', ...(orderId ? { orderId } : {}) })
  return { ...r, credit }
}

test('D11 customers: suppliers stay out, a seller saves contact, salesperson and pricelist', async (t) => {
  const r = await seed(t)
  await r.save('partner.savePartner', { id: 'maker', kind: 'company', name: 'Maker' })
  await r.save('partner.grantRole', { id: 'maker-role', partnerId: 'maker', role: 'supplier' })
  await r.save('partner.savePartner', { id: 'walkin', kind: 'person', name: 'Walk-in' })
  const listed = await r.call('sale.listCustomers', {})
  assert.deepEqual(
    (listed.rows as Row[]).map((row) => [row.id, row.orderCount]),
    [
      ['buyer', 1],
      ['walkin', 0],
    ],
  )
  assert.equal(await r.call('sale.getCustomer', { id: 'maker' }), null)
  assert.equal(
    (await r.call('sale.saveCustomer', { id: 'maker', expectedRevision: 0, kind: 'company', name: 'Maker' }))
      .ok,
    false,
  )

  await r.save('pricing.savePricelist', { id: 'vip', name: 'VIP', currency: 'VND' })
  const created = await r.call('sale.saveCustomer', {
    id: 'new-customer',
    expectedRevision: 0,
    kind: 'person',
    name: '  Chị Lan  ',
    phone: '0901 234 567',
    salespersonId: 'owner',
    pricelistId: 'vip',
  })
  assert.deepEqual([created.ok, created.revision], [true, 1], JSON.stringify(created))
  const customer = await r.call('sale.getCustomer', { id: 'new-customer' })
  assert.deepEqual(
    [customer.name, customer.salespersonName, customer.pricelistId, customer.revision],
    ['Chị Lan', 'Owner', 'vip', 1],
  )
  assert.ok(customer.phone)
  const roles = (await r.call('partner.getPartner', { id: 'new-customer' })).roles as Row[]
  assert.deepEqual(
    roles.map((row) => row.role),
    ['customer'],
  )
  const mine = await r.call('sale.listCustomers', { mine: true })
  assert.deepEqual(
    (mine.rows as Row[]).map((row) => [row.id, row.salespersonName]),
    [['new-customer', 'Owner']],
  )

  // A stale page, a stranger as salesperson and another company's pricelist are refused.
  const stale = await r.call('sale.saveCustomer', {
    id: 'new-customer',
    expectedRevision: 0,
    kind: 'person',
    name: 'X',
  })
  assert.equal((stale.errors as Row[])[0]!.messageKey, 'sale.error.customerChanged')
  await r.fixture('user.createUser', {
    id: 'stranger',
    login: 'stranger',
    password: 'test-password',
    name: 'Stranger',
    defaultCompanyId: 'other',
  })
  await r.fixture(
    'user.grantCompany',
    { id: 'stranger-other', userId: 'stranger', companyId: 'other' },
    'other',
  )
  const stranger = await r.call('sale.saveCustomer', {
    id: 'new-customer',
    expectedRevision: 1,
    kind: 'person',
    name: 'Chị Lan',
    salespersonId: 'stranger',
  })
  assert.equal((stranger.errors as Row[])[0]!.messageKey, 'sale.error.customerSalesperson')
  await r.fixture('pricing.savePricelist', { id: 'theirs', name: 'Theirs', currency: 'VND' }, 'other')
  const theirs = await r.call('sale.saveCustomer', {
    id: 'new-customer',
    expectedRevision: 1,
    kind: 'person',
    name: 'Chị Lan',
    pricelistId: 'theirs',
  })
  assert.equal((theirs.errors as Row[])[0]!.messageKey, 'sale.error.customerPricelist')
  const choices = await r.call('sale.getCustomerChoices', {})
  assert.deepEqual(
    [choices.salespeople, choices.pricelists].map((rows) => (rows as Row[]).map((row) => row.id)),
    [['owner'], ['vip']],
  )
})

test('D12 credit exposure follows the books and only warns', async (t) => {
  const r = await seed(t)
  // Confirmed, not invoiced: the whole order counts; no limit means no warning.
  assert.deepEqual(
    [(await r.credit()).uninvoiced, (await r.credit()).exposure, (await r.credit()).over],
    ['200', '200', false],
  )
  const saved = await r.call('sale.saveCustomerCredit', {
    partnerId: 'buyer',
    expectedRevision: 0,
    creditLimit: '150',
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.deepEqual([(await r.credit()).creditLimit, (await r.credit()).over], ['150', true])
  const listed = ((await r.call('sale.listCustomers', { over: true })).rows as Row[]).map((row) => [
    row.id,
    row.exposure,
    row.over,
  ])
  assert.deepEqual(listed, [['buyer', '200', true]])

  // The quotation being looked at counts as if confirmed; a confirmed order is not added twice.
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh' })
  await r.call('sale.addLine', {
    id: 'quote-line',
    orderId: 'quote',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '1',
    priceUnit: '100',
  })
  assert.deepEqual([(await r.credit('quote')).quotation, (await r.credit('quote')).exposure], ['100', '300'])
  assert.deepEqual([(await r.credit('order')).quotation, (await r.credit('order')).exposure], ['0', '200'])

  // Invoiced and posted: it moves from the order to the receivable.
  const invoice = await r.call('sale.createInvoice', {
    id: 'invoice',
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  assert.equal(invoice.ok, true, JSON.stringify(invoice))
  assert.deepEqual([(await r.credit()).receivable, (await r.credit()).uninvoiced], ['0', '0'])
  assert.equal((await r.call('account.postMove', { id: 'invoice' })).ok, true)
  assert.deepEqual([(await r.credit()).receivable, (await r.credit()).exposure], ['200', '200'])

  // A customer payment not yet applied to the invoice lowers what they owe.
  const paid = await r.call('account.registerPayment', {
    id: 'deposit',
    name: 'PAY/1',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'buyer',
    journalId: 'bank',
    destinationAccountId: 'receivable',
    amount: '120',
  })
  assert.equal(paid.ok, true, JSON.stringify(paid))
  assert.deepEqual([(await r.credit()).receivable, (await r.credit()).over], ['80', false])

  // Confirming over the limit still works: the warning never blocks.
  await r.call('sale.saveCustomerCredit', { partnerId: 'buyer', expectedRevision: 1, creditLimit: '0' })
  assert.equal((await r.credit('quote')).over, true)
  assert.equal((await r.call('sale.confirmOrder', { id: 'quote' })).ok, true)
  const stale = await r.call('sale.saveCustomerCredit', {
    partnerId: 'buyer',
    expectedRevision: 1,
    creditLimit: '900',
  })
  assert.equal((stale.errors as Row[])[0]!.messageKey, 'sale.error.customerChanged')
  const refused = await r.call('sale.saveCustomerCredit', {
    partnerId: 'buyer',
    expectedRevision: 2,
    creditLimit: '-1',
  })
  assert.equal((refused.errors as Row[])[0]!.messageKey, 'sale.error.customerCreditLimit')
})

test('D11 sellers keep customers; credit is the manager’s and the accountant’s', async (t) => {
  const r = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const login = async (roleId: string) => {
    const id = roleId.replace('commerce.', '')
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId })
    const client = r.app.client.anonymous()
    await client.login({ login: id, password: 'test-password' })
    return client
  }
  const post = (client: Awaited<ReturnType<typeof login>>, fn: string, args: Row, key?: string) =>
    client.request(`/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
      body: JSON.stringify(args),
    })
  let revision = 0
  for (const [roleId, reads, saves, credit] of [
    ['commerce.sales-representative', 200, 200, 403],
    ['commerce.sales-manager', 200, 200, 200],
    ['commerce.accountant', 200, 403, 200],
    ['commerce.warehouse-operator', 403, 403, 403],
  ] as const) {
    const client = await login(roleId)
    assert.equal((await post(client, 'sale.listCustomers', {})).status, reads, roleId)
    assert.equal((await post(client, 'sale.getCustomer', { id: 'buyer' })).status, reads, roleId)
    // The record page posts its commands with an idempotency key.
    const save = await post(
      client,
      'sale.saveCustomer',
      { id: 'buyer', expectedRevision: revision, kind: 'company', name: 'Buyer' },
      `${roleId}-save`,
    )
    assert.equal(save.status, saves, roleId)
    if (save.status === 200) revision++
    const limit = await post(
      client,
      'sale.saveCustomerCredit',
      { partnerId: 'buyer', expectedRevision: revision, creditLimit: '500' },
      `${roleId}-credit`,
    )
    assert.equal(limit.status, credit, roleId)
    if (limit.status === 200) revision++
  }
  assert.equal((await r.call('sale.getCustomer', { id: 'buyer' })).revision, revision)
})

test('D11 D12 the Customers screens: list, read model, customer page and the order page warning', async (t) => {
  const r = await seed(t)
  const list = await r.app.client.get('/admin/sales/customers?lang=vi')
  assert.equal(list.status, 200)
  const html = await list.text()
  for (const marker of [
    'sale.customer-list-controls',
    'sale.customer-list-results',
    'sale.customer-list-footer',
    'id="sale-customer-help"',
    'href="/admin/sales/customers/new?lang=vi"',
  ])
    assert.ok(html.includes(marker), marker)
  assert.match(html, /data-active="true" data-level="2" href="\/admin\/sales\/customers" aria-current="page"/)

  await r.save('sale.saveCustomerCredit', { partnerId: 'buyer', expectedRevision: 0, creditLimit: '150' })
  // A customer within their limit stays out of the "Over credit limit" filter.
  await r.save('partner.savePartner', { id: 'lan', kind: 'person', name: 'Chị Lan' })
  await r.save('partner.grantRole', { id: 'lan-role', partnerId: 'lan', role: 'customer' })
  await r.save('sale.saveCustomerCredit', { partnerId: 'lan', expectedRevision: 0, creditLimit: '10' })
  const read = await r.app.client.request('/admin/sales/customers/read?lang=vi', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ href: '/admin/sales/customers?lang=vi&over=1' }).toString(),
  })
  assert.equal(read.status, 200)
  const answer = (await read.json()).value
  assert.deepEqual(
    answer.rows.map((row: Row) => [row.name, row.kind, row.over, row.orderCount]),
    [['Buyer', 'Công ty', true, '1']],
  )
  assert.match(answer.rows[0].detailHref, /^\/admin\/sales\/customers\/buyer\?lang=vi&returnTo=/)
  assert.deepEqual(
    answer.search.facets.map((facet: Row) => facet.id),
    ['over'],
  )
  const foreign = await r.app.client.request('/admin/sales/customers/read?lang=vi', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ href: '/admin/sales/orders?lang=vi' }).toString(),
  })
  assert.equal(foreign.status, 400)

  const page = await r.app.client.get('/admin/sales/customers/buyer?lang=vi')
  assert.equal(page.status, 200)
  assert.ok((await page.text()).includes('sale.customer-page'))
  const context = await (await r.app.client.get('/admin/sales/customers/buyer/context?lang=vi')).json()
  assert.deepEqual([context.data.save, context.data.credit], [true, true])
  assert.equal(context.data.summary.over, true)
  assert.match(context.data.summary.overMessage, /^Công nợ 200\s?₫ vượt hạn mức 150\s?₫/)
  assert.deepEqual(
    context.data.orders.map((row: Row) => [row.href, row.state]),
    [['/admin/sales/orders/order?lang=vi', 'Đơn bán hàng']],
  )
  assert.ok(context.messages['sale_backend.customers.creditEdit'])
  assert.equal((await r.app.client.get('/admin/sales/customers/maker-missing/context?lang=vi')).status, 404)

  // The quotation page warns, counting the quotation itself; a customer under the limit is quiet.
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh' })
  const order = await (await r.app.client.get('/admin/sales/record/quote/context?lang=vi')).json()
  assert.match(
    String(order.data.creditWarning),
    /^Tính cả báo giá này, công nợ của Buyer là 200\s?₫, vượt hạn mức 150\s?₫/,
  )
  await r.save('sale.saveCustomerCredit', { partnerId: 'buyer', expectedRevision: 1, creditLimit: '' })
  const quiet = await (await r.app.client.get('/admin/sales/record/quote/context?lang=vi')).json()
  assert.equal(quiet.data.creditWarning, null)
})
