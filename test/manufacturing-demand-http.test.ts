import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

/** Xà phòng XP-01A/B/C, each made from oil; only XP-01C is made to order. */
const soapWorks = async (t: Parameters<typeof boot>[0]) => {
  const r = await boot(t)
  await r.save('stock.saveWarehouse', { id: 'hcm', name: 'HCM', code: 'HCM' })
  await r.save('stock.saveLocation', { id: 'production', name: 'Sản xuất', usage: 'production' })
  await r.save('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Buyer' })
  await r.save('partner.grantRole', { id: 'buyer-role', partnerId: 'buyer', role: 'customer' })
  for (const [id, name] of [
    ['oil', 'Dầu dừa'],
    ['xp-a', 'XP-01A'],
    ['xp-b', 'XP-01B'],
    ['xp-c', 'XP-01C'],
    ['bought', 'Hộp quà'],
  ] as const) {
    await r.save('product.saveRecord', {
      id,
      name,
      type: 'goods',
      defaultCode: id.toUpperCase(),
      uomId: 'each',
      listPrice: '100',
      saleOk: true,
    })
    await r.save('stock.configureProduct', { templateId: id, isStorable: true, tracking: 'none' })
  }
  for (const [id, productId, toOrder] of [
    ['bom-a', 'xp-a:default', false],
    ['bom-b', 'xp-b:default', false],
    ['bom-c', 'xp-c:default', true],
  ] as const)
    await r.save('manufacturing.saveBom', {
      id,
      code: id.toUpperCase(),
      productId,
      productQty: '1',
      productUomId: 'each',
      toOrder,
      lines: [{ id: `${id}-oil`, productId: 'oil:default', productQty: '0.1', productUomId: 'each' }],
    })
  const productions = async () =>
    ((await r.call('manufacturing.listProductions', {})) as unknown as Row[]).map((row) => String(row.id))
  const production = async (id: string) => r.call('manufacturing.getProduction', { id })
  const attempt = async (fn: string, input: Row) => (await r.app.client.call<Row>(fn, input)).value
  return { ...r, productions, production, attempt }
}

test('manufacturing demand HTTP: confirming a sale drafts one order per make-to-order line, due on its commitment date', async (t) => {
  const r = await soapWorks(t)
  await r.save('sale.createOrder', { id: 'so', partnerId: 'buyer', warehouseId: 'hcm' })
  for (const [id, productId, quantity] of [
    ['so-c', 'xp-c:default', '30'],
    ['so-a', 'xp-a:default', '10'],
  ] as const)
    await r.save('sale.addLine', {
      id,
      orderId: 'so',
      productId,
      productUomId: 'each',
      productUomQty: quantity,
    })
  // The salesperson promised 20/10.
  await r.app.adapter!.run(sql('UPDATE sale_order SET "commitmentDate" = ? WHERE id = ?'), [
    '2026-10-20T03:00:00.000Z',
    'so',
  ])
  assert.deepEqual(await r.productions(), [])
  await r.save('sale.confirmOrder', { id: 'so' })
  assert.deepEqual(await r.productions(), ['sale:so-c'])
  const drafted = await r.production('sale:so-c')
  assert.deepEqual(
    [
      drafted.state,
      drafted.productId,
      drafted.productQty,
      drafted.orderSource,
      drafted.saleOrderId,
      drafted.saleLineId,
      drafted.origin,
      String(drafted.deadline).slice(0, 10),
      drafted.name,
    ],
    [
      'draft',
      'xp-c:default',
      '30',
      'sale',
      'so',
      'so-c',
      String((await r.call('sale.getOrder', { id: 'so' })).name),
      '2026-10-20',
      'HCM/SX/0001',
    ],
  )

  // The order page names its source and the list filters by it.
  const page = await (await r.app.client.get('/admin/manufacturing/orders/sale%3Aso-c?lang=vi')).text()
  for (const text of ['Nguồn lệnh', 'Từ đơn bán', 'Hạn giao', '20/10/2026'])
    assert.ok(page.includes(text), `the order page shows ${text}`)
  const link = await r.app.client.get('/admin/manufacturing?lang=vi&orderSource=sale', { redirect: 'manual' })
  assert.equal(link.status, 303)
  const filtered = await (await r.app.client.get(String(link.headers.get('location')))).text()
  assert.ok(filtered.includes('HCM/SX/0001'), 'the sale draft is listed')
  const bogus = await r.app.client.get('/admin/manufacturing?lang=vi&orderSource=elsewhere', {
    redirect: 'manual',
  })
  assert.equal(bogus.headers.get('location'), '/admin/manufacturing?lang=vi')
})

test('manufacturing demand HTTP: a reorder rule that makes drafts an order once and the forecast counts it', async (t) => {
  const r = await soapWorks(t)
  // A product without a BOM cannot be made.
  const refused = await r.attempt('stock.saveOrderpoint', {
    id: 'rule-gift',
    productId: 'bought:default',
    warehouseId: 'hcm',
    locationId: 'hcm:stock',
    minQuantity: '5',
    maxQuantity: '10',
    source: 'manufacture',
    leadDays: 0,
  })
  assert.deepEqual(refused.errors, [{ field: 'source', code: 'stock.error.replenishment.make' }])

  await r.save('stock.saveOrderpoint', {
    id: 'rule-b',
    productId: 'xp-b:default',
    warehouseId: 'hcm',
    locationId: 'hcm:stock',
    minQuantity: '500',
    maxQuantity: '600',
    source: 'manufacture',
    leadDays: 2,
  })
  const supply = await r.call('stock.getOrderpointSupply', { id: 'rule-b' })
  assert.deepEqual([supply.quantity, supply.onOrder, supply.make], [600, 0, true])
  const run = await r.save('stock.runOrderpoint', { id: 'rule-b', moveId: 'run-1' })
  assert.deepEqual(
    [run.method, run.quantity, run.productionId, run.href],
    ['manufacture', '600', 'orderpoint:run-1', '/admin/manufacturing/orders/orderpoint%3Arun-1'],
  )
  const drafted = await r.production('orderpoint:run-1')
  assert.deepEqual(
    [drafted.state, drafted.productQty, drafted.orderSource, drafted.orderpointId, drafted.name],
    ['draft', '600', 'rule', 'rule-b', 'HCM/SX/0001'],
  )
  // The same run answers the same order; another run finds nothing left to order.
  const again = await r.save('stock.runOrderpoint', { id: 'rule-b', moveId: 'run-1' })
  assert.equal(again.productionId, 'orderpoint:run-1')
  const next = await r.save('stock.runOrderpoint', { id: 'rule-b', moveId: 'run-2' })
  assert.deepEqual([next.method, next.quantity], ['none', '0'])
  assert.deepEqual(await r.productions(), ['orderpoint:run-1'])

  // The forecast shows the draft on order, opening the order.
  const detail = await r.call('stock.getForecastDetail', { warehouseId: 'hcm', productId: 'xp-b:default' })
  const line = detail.line as Row
  assert.equal(line.onOrder, 600)
  assert.deepEqual(
    (line.drafts as Row[]).map((event) => [event.kind, event.pickingName, event.quantity, event.href]),
    [['make', 'HCM/SX/0001', 600, '/admin/manufacturing/orders/orderpoint%3Arun-1']],
  )
  const forecast = await (await r.app.client.get('/admin/stock/forecast/hcm/xp-b%3Adefault?lang=vi')).text()
  assert.ok(
    forecast.includes('/admin/manufacturing/orders/orderpoint%3Arun-1'),
    'the forecast links the draft',
  )

  // The order page names the rule as its source.
  const page = await (await r.app.client.get('/admin/manufacturing/orders/orderpoint%3Arun-1?lang=vi')).text()
  for (const text of ['Từ quy tắc bổ sung', 'Xem quy tắc bổ sung', '/admin/stock/replenishment/rule-b'])
    assert.ok(page.includes(text), `the order page shows ${text}`)
})

test('manufacturing demand HTTP: a sale changed after confirming resizes or cancels its drafts and warns on confirmed orders', async (t) => {
  const r = await soapWorks(t)
  await r.save('sale.createOrder', { id: 'so', partnerId: 'buyer', warehouseId: 'hcm' })
  for (const [id, quantity] of [
    ['so-1', '30'],
    ['so-2', '5'],
    ['so-3', '8'],
  ] as const)
    await r.save('sale.addLine', {
      id,
      orderId: 'so',
      productId: 'xp-c:default',
      productUomId: 'each',
      productUomQty: quantity,
    })
  await r.save('sale.confirmOrder', { id: 'so' })
  assert.deepEqual((await r.productions()).sort(), ['sale:so-1', 'sale:so-2', 'sale:so-3'])
  // Someone starts on the third; the sale may no longer change it.
  const third = await r.production('sale:so-3')
  await r.save('manufacturing.confirmProduction', { id: 'sale:so-3', version: third.version })

  const order = () => r.call('sale.getOrder', { id: 'so' })
  const grid = async (changes: Row) =>
    r.call('sale.applyLineGrid', {
      id: 'so',
      expectedRevision: (await order()).revision,
      changes: { added: [], updated: [], removed: [], order: null, ...changes },
    })
  const resized = await grid({
    updated: [
      { id: 'so-1', values: { productUomQty: 12 } },
      { id: 'so-3', values: { productUomQty: 9 } },
    ],
    removed: ['so-2'],
  })
  assert.equal(resized.ok, true, JSON.stringify(resized))
  const state = async (id: string) => {
    const row = await r.production(id)
    return [row.state, row.productQty, row.saleNotice ?? null]
  }
  assert.deepEqual(await state('sale:so-1'), ['draft', '12', null], 'the draft follows the line')
  assert.deepEqual(
    await state('sale:so-2'),
    ['cancelled', '5', 'changed'],
    'a removed line cancels its draft',
  )
  assert.deepEqual(await state('sale:so-3'), ['confirmed', '8', 'changed'], 'a confirmed order only warns')
  const changedPage = await (await r.app.client.get('/admin/manufacturing/orders/sale%3Aso-3?lang=vi')).text()
  assert.ok(changedPage.includes('Đơn bán đã đổi số lượng'), 'the order page says the sale changed')

  // Bringing the line back to the order's quantity clears the warning.
  assert.equal((await grid({ updated: [{ id: 'so-3', values: { productUomQty: 8 } }] })).ok, true)
  assert.deepEqual(await state('sale:so-3'), ['confirmed', '8', null])

  // A line added to the confirmed sale gets its own draft.
  const grown = await grid({
    added: [
      { id: 'new', index: 2, values: { productId: 'xp-c:default', productUomId: 'each', productUomQty: 4 } },
    ],
  })
  assert.equal(grown.ok, true, JSON.stringify(grown))
  const added = ((await order()).lines as Row[]).find((line) => Number(line.productUomQty) === 4)!
  assert.deepEqual(await state(`sale:${String(added.id)}`), ['draft', '4', null])

  await r.save('sale.cancelOrder', { id: 'so' })
  assert.deepEqual(await state('sale:so-1'), ['cancelled', '12', 'cancelled'])
  assert.deepEqual(await state(`sale:${String(added.id)}`), ['cancelled', '4', 'cancelled'])
  assert.deepEqual(await state('sale:so-3'), ['confirmed', '8', 'cancelled'], 'a confirmed order is kept')
  const cancelledPage = await (
    await r.app.client.get('/admin/manufacturing/orders/sale%3Aso-3?lang=en')
  ).text()
  assert.ok(cancelledPage.includes('The sale was cancelled'), 'the order page says the sale was cancelled')
})

test('manufacturing demand HTTP: reconfirming a cancelled sale creates a new draft and preserves its history', async (t) => {
  const r = await soapWorks(t)
  await r.save('sale.createOrder', { id: 'again', partnerId: 'buyer', warehouseId: 'hcm' })
  await r.save('sale.addLine', {
    id: 'again-line',
    orderId: 'again',
    productId: 'xp-c:default',
    productUomId: 'each',
    productUomQty: '3',
  })
  await r.save('sale.confirmOrder', { id: 'again' })
  await r.save('sale.cancelOrder', { id: 'again' })
  assert.equal((await r.production('sale:again-line')).state, 'cancelled')
  await r.save('sale.resetOrder', { id: 'again' })
  await r.save('sale.confirmOrder', { id: 'again' })
  const orders = await Promise.all((await r.productions()).map(r.production))
  assert.equal(orders.filter((row) => row.state === 'draft').length, 1)
  assert.equal(orders.filter((row) => row.state === 'cancelled').length, 1)
  assert.equal(orders.find((row) => row.state === 'draft')!.saleLineId, 'again-line')
  await r.save('sale.confirmOrder', { id: 'again' })
  assert.equal((await r.productions()).length, 2, 'replay does not create another draft')
})
