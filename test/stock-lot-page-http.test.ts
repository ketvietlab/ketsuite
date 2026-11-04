import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/**
 * Lot A expires on 1 March 2030 and B a year later. 5 January: counted, A 10 and B 5. 10 January: the order
 * delivers 12, A first. 15 January: the customer returns 3 of A. 20 January: a receipt brings 4 more of A, and
 * an open transfer holds 2 of it; the customer then takes 1 more on a second order. Today is 31 January 2030.
 */
async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-05T03:00:00.000Z') })
  const r = await setup(t)
  const at = async (iso: string) => {
    t.mock.timers.setTime(Date.parse(iso))
    await r.app.client.login({ login: 'owner', password: 'test-password' })
  }
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  for (const [id, expirationDate, counted] of [
    ['A', '2030-03-01T00:00:00Z', '10'],
    ['B', '2031-03-01T00:00:00Z', '5'],
  ] as const) {
    await r.save('stock.createLot', { id, productId: r.productId, name: id, expirationDate })
    await r.save('stock.adjustInventory', {
      id: `count-${id}`,
      productId: r.productId,
      locationId: 'wh:stock',
      inventoryLocationId: 'count',
      countedQuantity: counted,
      productUomId: 'each',
      lotId: id,
    })
  }
  await at('2030-01-10T03:00:00.000Z')
  await r.add({ productUomId: 'each', productUomQty: '12' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  await r.save('stock.assignPicking', { id: 'order:delivery' })
  await r.save('stock.completePicking', { id: 'order:delivery', createBackorder: false })
  const receive = async (id: string, lotId: string, quantity: string) => {
    const move = (((await r.call('stock.getPicking', { id })) as Row).moves as Row[])[0]!
    await r.save('stock.saveMoveLine', { id: `${id}-line`, moveId: move.id, quantity, lotId, picked: true })
    await r.save('stock.completePicking', { id, createBackorder: false })
  }
  await at('2030-01-15T03:00:00.000Z')
  await r.save('stock.createReturn', { id: 'order:delivery', returnId: 'back' })
  await receive('back', 'A', '3')
  await at('2030-01-20T03:00:00.000Z')
  await r.save('stock.createPicking', { id: 'in', name: 'in', pickingTypeId: 'wh:incoming' })
  await r.save('stock.addMove', {
    id: 'in-move',
    pickingId: 'in',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '4',
  })
  await r.save('stock.confirmPicking', { id: 'in' })
  await receive('in', 'A', '4')
  // A transfer still open holds 2 of A, the soonest to expire.
  await r.save('stock.createPicking', { id: 'pick', name: 'pick', pickingTypeId: 'wh:internal' })
  await r.save('stock.addMove', {
    id: 'pick-move',
    pickingId: 'pick',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '2',
  })
  await r.save('stock.confirmPicking', { id: 'pick' })
  await r.save('stock.assignPicking', { id: 'pick' })
  // The same customer orders 1 more, from the A that is not held.
  await r.save('sale.createOrder', { id: 'again', partnerId: 'buyer', warehouseId: 'wh' })
  await r.call('sale.addLine', {
    id: 'again-line',
    orderId: 'again',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '1',
  })
  await r.save('sale.confirmOrder', { id: 'again' })
  await r.save('stock.confirmPicking', { id: 'again:delivery' })
  await r.save('stock.assignPicking', { id: 'again:delivery' })
  await r.save('stock.completePicking', { id: 'again:delivery', createBackorder: false })
  await at('2030-01-31T05:00:00.000Z')
  return r
}

type Client = { request: (path: string, init?: RequestInit) => Promise<Response> }
const lotPage = async (client: Client, id: string) => {
  const response = await client.request(`/admin/stock/record/lot/${id}/context?lang=en`)
  assert.equal(response.status, 200)
  return ((await response.json()) as { data: Row }).data
}

test('K32 a lot page traces the lot from count and receipt to customers, with its figures', async (t) => {
  const r = await seed(t)
  const name = async (id: string) => String(((await r.call('stock.getPicking', { id })) as Row).name)
  const [count, delivery, back, receipt] = await Promise.all(
    ['count-A:picking', 'order:delivery', 'back', 'in'].map(name),
  )
  const order = String(((await r.call('sale.getOrder', { id: 'order' })) as Row).name)
  const page = await lotPage(r.app.client, 'A')
  const [again, secondOrder] = [
    await name('again:delivery'),
    String(((await r.call('sale.getOrder', { id: 'again' })) as Row).name),
  ]
  assert.deepEqual(
    (page.trace as Row[]).map((row) => [
      row.date,
      row.pickingName,
      row.from,
      row.to,
      row.quantity,
      row.kind,
      row.partner,
      row.origin,
      row.originHref,
    ]),
    [
      [
        '2030-01-20',
        again,
        'WH/Stock',
        'WH/Customer',
        '1',
        'delivery',
        'Buyer',
        secondOrder,
        '/admin/sales/orders/again?lang=en',
      ],
      ['2030-01-20', receipt, 'WH/Vendor', 'WH/Stock', '4', 'receipt', null, null, null],
      // A return names the delivery it brings back.
      ['2030-01-15', back, 'WH/Customer', 'WH/Stock', '3', 'return', 'Buyer', delivery, null],
      [
        '2030-01-10',
        delivery,
        'WH/Stock',
        'WH/Customer',
        '10',
        'delivery',
        'Buyer',
        order,
        '/admin/sales/orders/order?lang=en',
      ],
      ['2030-01-05', count, 'Count', 'WH/Stock', '10', 'adjustment', null, null, null],
    ],
  )
  assert.equal((page.trace as Row[])[1]!.pickingHref, '/admin/stock/transfers/in?lang=en')
  // In from the count and the receipt; 6 on hand, 2 of them held; 11 delivered less 3 returned, to one customer
  // on two orders.
  assert.deepEqual(page.figures, { received: 14, onHand: 6, held: 2, delivered: 8, customers: 1 })
  // A expires within 90 days: its page says so; B, in date, says nothing.
  assert.equal(page.condition, 'expiring')
  assert.deepEqual(
    ((await lotPage(r.app.client, 'B')).trace as Row[]).map((row) => [row.pickingName, row.quantity]),
    [
      [delivery, '2'],
      [await name('count-B:picking'), '5'],
    ],
  )
  assert.equal((await lotPage(r.app.client, 'B')).condition, 'valid')
})

test('K32 the trace links a sales order only for whoever may read orders', async (t) => {
  const r = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const signIn = async (roleId: string) => {
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
  const reads: boolean[] = []
  for (const roleId of ['commerce.warehouse-operator', 'commerce.sales-representative']) {
    const client = await signIn(roleId)
    const readsOrders =
      (
        await client.request('/_ket/fn/sale.listOrders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 1 }),
        })
      ).status === 200
    // The first order's delivery, the oldest.
    const delivered = ((await lotPage(client, 'A')).trace as Row[])
      .filter((row) => row.kind === 'delivery')
      .at(-1)!
    assert.equal(delivered.originHref, readsOrders ? '/admin/sales/orders/order?lang=en' : null, roleId)
    assert.ok(delivered.origin, roleId)
    reads.push(readsOrders)
  }
  // The storekeeper sees the order's name; the seller opens it.
  assert.deepEqual(reads, [false, true])
})
