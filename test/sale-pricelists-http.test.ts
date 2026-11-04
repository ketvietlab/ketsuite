import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { type Row, tableNameFor } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/** Retail (first active) at a fixed 90, VIP at 20% off list price, and an archived list the order never picks. */
async function priced(t: TestContext) {
  const r = await setup(t)
  await r.save('pricing.savePricelist', { id: 'old', name: 'Old', sequence: 0, active: false })
  await r.save('pricing.savePricelist', { id: 'retail', name: 'Bảng giá bán lẻ', sequence: 1 })
  await r.save('pricing.savePricelist', { id: 'vip', name: 'VIP', sequence: 2 })
  await r.save('pricing.savePricelistItem', {
    id: 'retail-fixed',
    pricelistId: 'retail',
    appliedOn: '3_global',
    computePrice: 'fixed',
    fixedPrice: '90',
  })
  await r.save('pricing.savePricelistItem', {
    id: 'vip-percent',
    pricelistId: 'vip',
    appliedOn: '3_global',
    computePrice: 'percentage',
    percentPrice: '20',
  })
  await r.save('account.savePaymentTerm', { id: 'net30', name: '30 ngày' })
  const order = (id: string) => r.call('sale.getOrder', { id })
  const line = async (orderId: string, id: string, input: Row = {}) => {
    const added = await r.call('sale.addLine', {
      id,
      orderId,
      productId: r.productId,
      productUomId: 'each',
      productUomQty: '1',
      ...input,
    })
    assert.equal(added.ok, true, JSON.stringify(added))
  }
  const prices = async (id: string) =>
    ((await order(id)).lines as Row[])
      .map((row) => [row.id, String(Number(row.priceUnit)), String(Number(row.discount))])
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
  return { ...r, order, line, prices }
}

test('D14 a new order takes the customer pricelist and terms, else the company retail pricelist', async (t) => {
  const r = await priced(t)
  await r.save('sale.createOrder', { id: 'plain', partnerId: 'buyer', warehouseId: 'wh' })
  assert.deepEqual(
    [(await r.order('plain')).pricelistId, (await r.order('plain')).paymentTermId],
    ['retail', null],
  )
  await r.line('plain', 'plain-line')
  assert.deepEqual(await r.prices('plain'), [['plain-line', '90', '0']])

  const terms = await r.call('sale.saveCustomer', {
    id: 'buyer',
    expectedRevision: 0,
    kind: 'company',
    name: 'Buyer',
    pricelistId: 'vip',
  })
  assert.equal(terms.ok, true, JSON.stringify(terms))
  await r.save('sale.saveCustomerCredit', { partnerId: 'buyer', expectedRevision: 1, paymentTermId: 'net30' })
  await r.save('sale.createOrder', { id: 'own', partnerId: 'buyer', warehouseId: 'wh' })
  assert.deepEqual(
    [(await r.order('own')).pricelistId, (await r.order('own')).paymentTermId],
    ['vip', 'net30'],
  )
  // What the caller names wins, including no pricelist at all.
  await r.save('sale.createOrder', {
    id: 'named',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  assert.equal((await r.order('named')).pricelistId, 'retail')
  await r.save('sale.createOrder', { id: 'none', partnerId: 'buyer', warehouseId: 'wh', pricelistId: null })
  assert.equal((await r.order('none')).pricelistId, null)
})

test('D14 Update prices reprices the quotation by its pricelist, or by another one', async (t) => {
  const r = await priced(t)
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh' })
  await r.line('quote', 'auto')
  await r.line('quote', 'manual', { priceUnit: '70', discount: '5' })
  assert.deepEqual(await r.prices('quote'), [
    ['auto', '90', '0'],
    ['manual', '70', '5'],
  ])
  const revision = Number((await r.order('quote')).revision)
  const stale = await r.call('sale.updatePrices', { id: 'quote', expectedRevision: revision - 1 })
  assert.equal((stale.errors as Row[])[0]!.messageKey, 'sale.error.orderChanged')
  // An archived pricelist is refused, and the pricelist stays as it was.
  const old = await r.call('sale.updatePrices', {
    id: 'quote',
    expectedRevision: revision,
    pricelistId: 'old',
  })
  assert.equal((old.errors as Row[])[0]!.messageKey, 'sale.error.pricelistInvalid')
  assert.equal((await r.order('quote')).pricelistId, 'retail')

  const same = await r.call('sale.updatePrices', { id: 'quote', expectedRevision: revision })
  assert.equal(same.ok, true, JSON.stringify(same))
  assert.deepEqual(await r.prices('quote'), [
    ['auto', '90', '0'],
    ['manual', '90', '0'],
  ])
  const vip = await r.call('sale.updatePrices', {
    id: 'quote',
    expectedRevision: Number(same.revision),
    pricelistId: 'vip',
  })
  assert.equal(vip.ok, true, JSON.stringify(vip))
  const repriced = await r.order('quote')
  assert.equal(repriced.pricelistId, 'vip')
  // A percentage rule keeps the list price as unit price and shows the discount (D13).
  assert.deepEqual(await r.prices('quote'), [
    ['auto', '100', '20'],
    ['manual', '100', '20'],
  ])
  assert.equal(String(Number(repriced.amountUntaxed)), '160')

  // A confirmed order keeps the pricelist it was sold under.
  await r.save('sale.confirmOrder', { id: 'quote' })
  const locked = await r.call('sale.updatePrices', {
    id: 'quote',
    expectedRevision: Number((await r.order('quote')).revision),
    pricelistId: 'retail',
  })
  assert.equal((locked.errors as Row[])[0]!.messageKey, 'sale.error.pricesLocked')
  assert.equal((await r.order('quote')).pricelistId, 'vip')
})

test('D14 Update prices leaves lines with history, rewards and combo items as they are', async (t) => {
  const r = await priced(t)
  const q = r.app.adapter!.quoteIdent.bind(r.app.adapter)
  const set = (id: string, column: string, value: string) =>
    r.app.adapter!.run(
      `UPDATE ${q(tableNameFor('sale.OrderLine'))} SET ${q(column)} = ${value} WHERE ${q('id')} = '${id}'`,
    )
  // A cancelled order back in draft keeps the stock moves of its confirmation.
  await r.save('sale.createOrder', { id: 'again', partnerId: 'buyer', warehouseId: 'wh' })
  await r.line('again', 'moved', { priceUnit: '70' })
  await r.save('sale.confirmOrder', { id: 'again' })
  await r.save('sale.cancelOrder', { id: 'again' })
  await r.save('sale.resetOrder', { id: 'again' })
  await r.line('again', 'fresh', { priceUnit: '70' })
  // Kinds a quotation only gets from loyalty, combos or an earlier delivery.
  for (const id of ['reward', 'item', 'delivered']) await r.line('again', id, { priceUnit: '70' })
  await set('reward', 'lineKind', "'reward'")
  await set('item', 'comboParentId', "'fresh'")
  await set('delivered', 'qtyDelivered', '1')
  const updated = await r.call('sale.updatePrices', {
    id: 'again',
    expectedRevision: Number((await r.order('again')).revision),
    pricelistId: 'vip',
  })
  assert.equal(updated.ok, true, JSON.stringify(updated))
  assert.deepEqual(await r.prices('again'), [
    ['delivered', '70', '0'],
    ['fresh', '100', '20'],
    ['item', '70', '0'],
    ['moved', '70', '0'],
    ['reward', '70', '0'],
  ])

  // With nothing to reprice, switching the pricelist still moves the order to a new revision.
  await r.save('sale.createOrder', { id: 'empty', partnerId: 'buyer', warehouseId: 'wh' })
  const before = Number((await r.order('empty')).revision)
  const empty = await r.call('sale.updatePrices', {
    id: 'empty',
    expectedRevision: before,
    pricelistId: 'vip',
  })
  assert.deepEqual([empty.ok, empty.revision], [true, before + 1])
  assert.equal(Number((await r.order('empty')).revision), before + 1)
})

test('D14 a refused repricing keeps the pricelist the quotation had', async (t) => {
  const r = await priced(t)
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh' })
  await r.line('quote', 'auto')
  // And one that edits line by line, having been confirmed once.
  await r.save('sale.createOrder', { id: 'again', partnerId: 'buyer', warehouseId: 'wh' })
  await r.line('again', 'moved')
  await r.save('sale.confirmOrder', { id: 'again' })
  await r.save('sale.cancelOrder', { id: 'again' })
  await r.save('sale.resetOrder', { id: 'again' })
  await r.line('again', 'fresh')
  const context = await r.call('product.templateModalContext', { id: 'goods', locale: 'en' })
  await r.save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    uomId: 'each',
    saleOk: false,
    expectedRevisionId: ((context.data as Row).record as Row).revisionId,
  })
  const refused = await r.call('sale.updatePrices', {
    id: 'quote',
    expectedRevision: Number((await r.order('quote')).revision),
    pricelistId: 'vip',
  })
  assert.equal(refused.ok, false, JSON.stringify(refused))
  assert.equal((await r.order('quote')).pricelistId, 'retail')
  assert.deepEqual(await r.prices('quote'), [['auto', '90', '0']])
  const history = await r.call('sale.updatePrices', {
    id: 'again',
    expectedRevision: Number((await r.order('again')).revision),
    pricelistId: 'vip',
  })
  assert.equal(history.ok, false, JSON.stringify(history))
  assert.equal((await r.order('again')).pricelistId, 'retail')
})

test('D14 a seller updates prices from the page; the warehouse cannot', async (t) => {
  const r = await priced(t)
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh' })
  await r.line('quote', 'auto')
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
  for (const [roleId, status] of [
    ['commerce.warehouse-operator', 403],
    ['commerce.sales-representative', 200],
  ] as const) {
    const client = await login(roleId)
    // The page posts its commands with an idempotency key.
    const response = await client.request('/_ket/fn/sale.updatePrices', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `${roleId}-prices` },
      body: JSON.stringify({
        id: 'quote',
        expectedRevision: Number((await r.order('quote')).revision),
        pricelistId: 'vip',
      }),
    })
    assert.equal(response.status, status, roleId)
  }
  assert.equal((await r.order('quote')).pricelistId, 'vip')
  const context = await (await r.app.client.get('/admin/sales/record/quote/context?lang=vi')).json()
  assert.equal(context.data.permissions.updatePrices, true)
  assert.equal(context.messages['sale_backend.prices.action'], 'Cập nhật giá')
})
