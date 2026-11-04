import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('D26 protected picker converts exact cost and price into only eligible selling units', async (t) => {
  const r = await setup(t)
  await r.save('product.setCost', { productId: r.productId, standardPrice: '60.123456789123' })
  const input = { orderId: 'order', productId: r.productId, quantity: 2 }
  const rows = (await r.app.client.call<Row[]>('sale.listLinePricing', input)).value
  assert.deepEqual(rows.map((row) => row.id).sort(), ['box', 'each'])
  const box = rows.find((row) => row.id === 'box')!
  assert.equal(box.unitCost, '721.481481469476')
  assert.equal(box.priceUnit, '1200')
  assert.equal(box.marginLocked, false)
  assert.equal(box.currency, 'VND')
  assert.deepEqual(
    (await r.app.client.call<Row[]>('sale.listLinePricing', { ...input, quantity: -1 })).value,
    [],
  )
  assert.deepEqual(
    (await r.app.client.call<Row[]>('sale.listLinePricing', { ...input, search: 'case' })).value,
    [],
  )
  await r.add()
  const context = (await (await r.app.client.get('/admin/sales/record/order/context?lang=en')).json()) as {
    data: { costSummary: { margin: string } }
  }
  assert.equal(context.data.costSummary.margin, '957.037037061048')
  const ordinary = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(JSON.stringify(ordinary).includes('unitCost'), false)
})

test('D26 missing costs remain unknown, zero cost remains known and foreign orders disclose nothing', async (t) => {
  const r = await setup(t)
  const input = { orderId: 'order', productId: r.productId, quantity: 0 }
  await r.add()
  const unknown = (await (await r.app.client.get('/admin/sales/record/order/context?lang=en')).json()) as {
    data: { costSummary: { margin: unknown } }
  }
  assert.equal(unknown.data.costSummary.margin, null)
  let rows = (await r.app.client.call<Row[]>('sale.listLinePricing', input)).value
  assert.ok(rows.every((row) => row.unitCost === null && row.marginLocked === true))
  await r.save('product.setCost', { productId: r.productId, standardPrice: '0' })
  rows = (await r.app.client.call<Row[]>('sale.listLinePricing', input)).value
  assert.ok(rows.every((row) => row.unitCost === '0' && row.marginLocked === false))
  const foreign = await r.app.fixture.call<Row[]>('sale.listLinePricing', input, {
    scope: { company: 'other', branches: null },
  })
  assert.deepEqual(foreign.value, [])
})

test('D26 protected unit prices require the cost grant independently of ordinary quotation read', async (t) => {
  const r = await setup(t)
  await r.fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'read-role', name: 'Reader' })
  await r.fixture('user.grantFunction', { id: 'read-order', roleId: 'read-role', fnKey: 'sale.getOrder' })
  await r.fixture('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'read-role' })
  const reader = r.app.client.anonymous()
  await reader.login({ login: 'reader', password: 'test-password' })
  await reader.call('sale.getOrder', { id: 'order' })
  const context = (await (await reader.get('/admin/sales/record/order/context?lang=en')).json()) as {
    data: Record<string, unknown>
  }
  assert.equal(context.data.lineCosts, undefined)
  assert.equal(context.data.costSummary, undefined)
  await assert.rejects(
    () => reader.call('sale.listLinePricing', { orderId: 'order', productId: r.productId, quantity: 2 }),
    (error: unknown) => (error as { status: number }).status === 403,
  )
})

test('D26 grid persists only the solved selling price, never posted cost facts', async (t) => {
  const r = await setup(t)
  await r.save('product.setCost', { productId: r.productId, standardPrice: '60' })
  await r.add({ productUomId: 'each', priceUnit: '100' })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const patch = (values: Row) =>
    r.call('sale.applyLineGrid', {
      id: 'order',
      expectedRevision: before.revision,
      changes: { added: [], removed: [], order: null, updated: [{ id: 'line', values }] },
    })
  assert.equal((await patch({ priceUnit: '120', unitCost: '1' })).ok, false)
  assert.equal((await patch({ priceUnit: '120' })).ok, true)
  const order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal((order.lines as Row[])[0]!.priceUnit, '120')
  assert.equal('unitCost' in (order.lines as Row[])[0]!, false)
  const costs = (await r.app.client.call<Row[]>('sale.getLineCosts', { id: 'order' })).value
  assert.equal(costs[0]!.unitCost, '60')
  assert.equal(costs[0]!.margin, '120')
})

test('D26 protected unit prices use the same active order pricelist and packaging quote', async (t) => {
  const r = await setup(t)
  await r.save('product.setCost', { productId: r.productId, standardPrice: '60' })
  await r.save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await r.save('pricing.savePricelistItem', {
    id: 'rule',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId: r.productId,
    computePrice: 'fixed',
    fixedPrice: '90',
  })
  await r.save('sale.createOrder', {
    id: 'priced',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  const rows = (
    await r.app.client.call<Row[]>('sale.listLinePricing', {
      orderId: 'priced',
      productId: r.productId,
      quantity: '2',
    })
  ).value
  assert.equal(rows.find((row) => row.id === 'box')!.priceUnit, '1080')
  assert.equal(rows.find((row) => row.id === 'box')!.unitCost, '720')
})

test('D26 multi-company readers cannot attach another company catalogue cost to an active order', async (t) => {
  const r = await setup(t)
  await r.fixture(
    'product.saveRecord',
    {
      id: 'foreign-goods',
      name: 'Foreign goods',
      type: 'goods',
      defaultCode: 'FOREIGN',
      uomId: 'each',
      saleOk: true,
      listPrice: '900',
    },
    'other',
  )
  const response = await r.app.fixture.call<Row[]>(
    'sale.listLinePricing',
    { orderId: 'order', productId: 'foreign-goods:default', quantity: '1' },
    { scope: { company: 'acme', companies: ['acme', 'other'], branches: null } },
  )
  assert.deepEqual(response.value, [])
})

test('D24 a line without a product is costed at zero, so its subtotal adds to the saved margin', async (t) => {
  const r = await setup(t)
  await r.save('product.setCost', { productId: r.productId, standardPrice: '60' })
  await r.add({ productUomId: 'each', priceUnit: '100' })
  const margin = async () =>
    (
      (await (await r.app.client.get('/admin/sales/record/order/context?lang=en')).json()) as {
        data: { costSummary: { margin: string | null } }
      }
    ).data.costSummary.margin
  const goods = await margin()
  assert.notEqual(goods, null)
  // Two at 100 less 10%: 180, all of it margin.
  await r.save('sale.addLine', {
    id: 'free',
    orderId: 'order',
    name: 'On-site advice',
    productUomQty: '2',
    priceUnit: '100',
    discount: '10',
  })
  assert.equal(Number(await margin()), Number(goods) + 180)
})
