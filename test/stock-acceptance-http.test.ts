import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/** A storable product with `held` pieces in the warehouse and a confirmed-to-be order of 3. */
async function seed(t: TestContext, held: string) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  const count = (id: string, countedQuantity: string) =>
    r.save('stock.adjustInventory', {
      id,
      productId: r.productId,
      locationId: 'wh:stock',
      inventoryLocationId: 'count',
      countedQuantity,
      productUomId: 'each',
    })
  await count('opening', held)
  await r.add({ productUomId: 'each', productUomQty: '3' })
  const order = async () => (await r.call('sale.getOrder', { id: 'order' })) as Row
  const policy = async (shippingPolicy: string) => {
    const saved = await r.call('sale.saveDeliveryPromise', {
      id: 'order',
      expectedRevision: Number((await order()).revision),
      shippingPolicy,
    })
    assert.equal(saved.ok, true, JSON.stringify(saved))
  }
  const delivery = async () => (await r.call('stock.getPicking', { id: 'order:delivery' })) as Row
  return { ...r, count, order, policy, delivery }
}

test('K2 an order shipping at once when complete is ready only when all of it is held', async (t) => {
  const r = await seed(t, '1')
  await r.policy('one')
  await r.save('sale.confirmOrder', { id: 'order' })
  // One delivery from the order's warehouse to its customer, at once when complete.
  const made = await r.delivery()
  assert.deepEqual(
    [made.locationId, made.locationDestId, made.partnerId, made.moveType],
    ['wh:stock', 'wh:customer', 'buyer', 'one'],
  )
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  await r.save('stock.assignPicking', { id: 'order:delivery' })
  // 1 of 3 is held: the move holds what it can, the delivery is not ready.
  assert.equal(((await r.delivery()).moves as Row[])[0]!.state, 'partially_available')
  assert.equal((await r.delivery()).state, 'confirmed')
  // Shipping what is there makes the same delivery ready, and back again.
  await r.policy('direct')
  assert.deepEqual([(await r.delivery()).moveType, (await r.delivery()).state], ['direct', 'assigned'])
  await r.policy('one')
  assert.deepEqual([(await r.delivery()).moveType, (await r.delivery()).state], ['one', 'confirmed'])
  // Once all of it is in stock and held, it is ready and ships in full.
  await r.count('restock', '3')
  await r.save('stock.assignPicking', { id: 'order:delivery' })
  assert.equal((await r.delivery()).state, 'assigned')
  await r.save('stock.completePicking', { id: 'order:delivery', createBackorder: false })
  assert.equal((await r.delivery()).state, 'done')
  assert.equal(Number(((await r.order()).lines as Row[])[0]!.qtyDelivered), 3)
})

test('K15 a new order comes with the only warehouse chosen, and picks among several', async (t) => {
  const r = await seed(t, '0')
  const chosen = async () => {
    const response = await r.app.client.get('/admin/sales/record/new/context?lang=en')
    assert.equal(response.status, 200)
    const { data } = (await response.json()) as { data: { record: Row; choices: { warehouses: Row[] } } }
    return [data.record.warehouseId ?? null, data.choices.warehouses.map((row) => row.id)]
  }
  assert.deepEqual(await chosen(), ['wh', ['wh']])
  await r.save('stock.saveWarehouse', { id: 'hn', name: 'Hà Nội', code: 'HN' })
  const [warehouseId, warehouses] = await chosen()
  assert.equal(warehouseId, null)
  assert.deepEqual([...(warehouses as string[])].sort(), ['hn', 'wh'])
  // The ledger checks what is saved: an unknown warehouse is refused.
  const refused = await r.call('sale.createOrder', {
    id: 'elsewhere',
    partnerId: 'buyer',
    warehouseId: 'gone',
  })
  assert.equal(refused.ok, false)
  assert.equal((refused.errors as Row[])[0]!.field, 'warehouseId')
})

test('K28 the lots list says what each lot is fit for today, and filters by it', async (t) => {
  const r = await seed(t, '0')
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  const lot = async (id: string, expirationDate: string, counted = '5') => {
    await r.save('stock.createLot', { id, productId: r.productId, name: id, expirationDate })
    if (counted !== '0')
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
  // Today is 31 January 2030.
  await lot('IN-DATE', '2031-06-01T00:00:00Z')
  await lot('SOON', '2030-03-01T00:00:00Z')
  await lot('OLD', '2030-01-01T00:00:00Z')
  await lot('GONE', '2031-06-01T00:00:00Z', '0')
  await lot('HELD', '2031-06-01T00:00:00Z')
  await r.save('stock.saveLot', {
    id: 'HELD',
    productId: r.productId,
    name: 'HELD',
    expirationDate: '2031-06-01T00:00:00Z',
    quarantined: true,
    reason: 'Chờ kiểm nghiệm',
  })
  const conditions = async (query = '') => {
    const html = await (await r.app.client.get(`/admin/stock/lots?lang=vi${query}`)).text()
    return Object.fromEntries(
      [...html.matchAll(/<tr[^>]*data-row="([^"]+)"[\s\S]*?<\/tr>/g)].map((row) => [
        row[1],
        /data-col="condition"[\s\S]*?data-value="([^"]+)"/.exec(row[0])?.[1] ?? null,
      ]),
    )
  }
  assert.deepEqual(await conditions(), {
    GONE: 'depleted',
    HELD: 'quarantined',
    'IN-DATE': 'valid',
    OLD: 'expired',
    SOON: 'expiring',
  })
  assert.deepEqual(Object.keys(await conditions('&preset=expired')), ['OLD'])
  assert.deepEqual(Object.keys(await conditions('&preset=expiring')), ['SOON'])
})

test('K13 K28 on hand: expired and quarantined lots count but none is available; filters by availability', async (t) => {
  const r = await seed(t, '0')
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  for (const [id, expirationDate] of [
    ['OK', '2031-06-01T00:00:00Z'],
    ['OLD', '2030-01-01T00:00:00Z'],
    ['HELD', '2031-06-01T00:00:00Z'],
  ] as const) {
    await r.save('stock.createLot', { id, productId: r.productId, name: id, expirationDate })
    await r.save('stock.adjustInventory', {
      id: `count-${id}`,
      productId: r.productId,
      locationId: 'wh:stock',
      inventoryLocationId: 'count',
      countedQuantity: '3',
      productUomId: 'each',
      lotId: id,
    })
  }
  await r.save('stock.saveLot', {
    id: 'HELD',
    productId: r.productId,
    name: 'HELD',
    expirationDate: '2031-06-01T00:00:00Z',
    quarantined: true,
    reason: 'Chờ kiểm nghiệm',
  })
  /** Each on-hand row as lot → [on hand, reserved, available, expiry]. */
  const rows = async (query = '') => {
    const html = await (await r.app.client.get(`/admin/stock/inventory?lang=vi${query}`)).text()
    const cell = (row: string, col: string) =>
      new RegExp(`data-col="${col}"[^>]*>([\\s\\S]*?)</td>`)
        .exec(row)?.[1]
        ?.replace(/<[^>]*>/g, '')
        .trim()
    return Object.fromEntries(
      [...html.matchAll(/<tr[^>]*data-row="[^"]+"[\s\S]*?<\/tr>/g)].map(([row]) => [
        cell(row, 'lot'),
        ['quantity', 'reserved', 'available', 'expiry'].map((col) => cell(row, col)),
      ]),
    )
  }
  assert.deepEqual(await rows(), {
    OK: ['3', '0', '3', '1/6/31'],
    OLD: ['3', '0', '0', '1/1/30'],
    HELD: ['3', '0', '0', '1/6/31'],
  })
  assert.deepEqual(Object.keys(await rows('&preset=blocked')).sort(), ['HELD', 'OLD'])
  assert.deepEqual(Object.keys(await rows('&preset=available')), ['OK'])
  // Nothing is held yet, so nothing is all held; blocked lots never are.
  assert.deepEqual(Object.keys(await rows('&preset=fullyReserved')), [])
  // Delivering the order holds the only good lot in full.
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  await r.save('stock.assignPicking', { id: 'order:delivery' })
  assert.deepEqual((await rows()).OK, ['3', '3', '0', '1/6/31'])
  assert.deepEqual(Object.keys(await rows('&preset=fullyReserved')), ['OK'])
  assert.deepEqual(Object.keys(await rows('&preset=available')), [])
  assert.deepEqual(Object.keys(await rows('&preset=outOfStock')), [])
})
