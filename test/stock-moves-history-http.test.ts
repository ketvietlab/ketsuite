import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/**
 * Counted on 20 December 2029: lot A (10, expiring first) and lot B (5) in Warehouse. On 10 January an order for
 * 12 holds A and 2 of B but ships only A; on 15 January 3 of B go to Hà Nội, where one breaks on the 20th. Today
 * is 31 January 2030. A transfer holding the last of B and one cancelled moved nothing.
 */
async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2029-12-20T03:00:00.000Z') })
  const r = await setup(t)
  // A session lasts less than the weeks the story spans: sign in again after each jump.
  const at = async (iso: string) => {
    t.mock.timers.setTime(Date.parse(iso))
    await r.app.client.login({ login: 'owner', password: 'test-password' })
  }
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('stock.saveWarehouse', { id: 'hn', name: 'Hà Nội', code: 'HN' })
  for (const [id, expirationDate, counted] of [
    ['A', '2030-06-01T00:00:00Z', '10'],
    ['B', '2030-12-01T00:00:00Z', '5'],
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
  // B is held too, but none of it ships: its line closes at 0 and B stays.
  const held = ((await r.call('stock.getPicking', { id: 'order:delivery' })) as Row).moves as Row[]
  await r.save('stock.completePicking', {
    id: 'order:delivery',
    createBackorder: false,
    quantities: (held[0]!.lines as Row[]).map((line) => ({
      moveLineId: line.id,
      quantity: line.lotId === 'A' ? 10 : 0,
    })),
  })
  await at('2030-01-15T03:00:00.000Z')
  const transfer = async (id: string, quantity: string) => {
    await r.save('stock.createPicking', {
      id,
      name: id,
      pickingTypeId: 'wh:internal',
      locationId: 'wh:stock',
      locationDestId: 'hn:stock',
    })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: quantity,
      locationId: 'wh:stock',
      locationDestId: 'hn:stock',
    })
    await r.save('stock.confirmPicking', { id })
    await r.save('stock.assignPicking', { id })
  }
  await transfer('to-hn', '3')
  await r.save('stock.completePicking', { id: 'to-hn', createBackorder: false })
  // On 20 January one of B breaks in Hà Nội.
  await at('2030-01-20T03:00:00.000Z')
  await r.save('stock.saveScrap', {
    id: 'broken',
    warehouseId: 'hn',
    productId: r.productId,
    lotId: 'B',
    quantity: '1',
    reason: 'damaged',
  })
  await r.save('stock.validateScrap', { id: 'broken' })
  await transfer('open', '1')
  await r.save('stock.createPicking', { id: 'dropped', name: 'dropped', pickingTypeId: 'wh:internal' })
  await r.save('stock.cancelPicking', { id: 'dropped' })
  await at('2030-01-31T05:00:00.000Z')
  return r
}

/** The history the list shows at `query`, each line as [document, lot, from, to, quantity, type]. */
async function listed(
  client: { request: (path: string, init?: RequestInit) => Promise<Response> },
  query = '',
) {
  const response = await client.request('/admin/stock/moves/data?lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ href: `/admin/stock/moves?lang=en${query}` }),
  })
  if (response.status !== 200) return response.status
  return ((await response.json()).value.rows as Row[]).map((row) => [
    row.pickingName,
    row.lot,
    row.from,
    row.to,
    row.quantityText,
    row.kindText,
  ])
}

test('K52 the moves history lists what finished transfers moved, a lot a line, newest first', async (t) => {
  const r = await seed(t)
  const delivery = String(((await r.call('stock.getPicking', { id: 'order:delivery' })) as Row).name)
  const counts = await Promise.all(
    ['count-A:picking', 'count-B:picking'].map(async (id) =>
      String(((await r.call('stock.getPicking', { id })) as Row).name),
    ),
  )
  const scrap = String(((await r.call('stock.getScrap', { id: 'broken' })) as Row).name)
  const all = [
    [scrap, 'B', 'HN/Stock', 'HN/Scrap', '1', 'Scrap'],
    ['to-hn', 'B', 'WH/Stock', 'HN/Stock', '3', 'Internal transfer'],
    [delivery, 'A', 'WH/Stock', 'WH/Customer', '10', 'Delivery'],
    [counts[1], 'B', 'Count', 'WH/Stock', '5', 'Count adjustment'],
    [counts[0], 'A', 'Count', 'WH/Stock', '10', 'Count adjustment'],
  ]
  const rows = (await listed(r.app.client)) as unknown[][]
  // The two lines of one delivery keep their own order; everything else is newest first.
  assert.deepEqual(
    rows.map((row) => row.slice(0, 2).join(':')),
    all.map((row) => row.slice(0, 2).join(':')),
  )
  assert.deepEqual(rows, all)

  // The menu opens this month; last month holds the counts.
  assert.deepEqual(await listed(r.app.client, '&preset=thisMonth'), all.slice(0, 3))
  assert.deepEqual(await listed(r.app.client, '&preset=lastMonth'), all.slice(3))
  // A transfer between two warehouses belongs to both; the scrap is Hà Nội's alone.
  assert.deepEqual(await listed(r.app.client, '&warehouse=hn'), all.slice(0, 2))
  assert.deepEqual(await listed(r.app.client, '&warehouse=wh'), all.slice(1))
  // By type, and by lot, document, code or name.
  assert.deepEqual(await listed(r.app.client, '&preset=delivery'), all.slice(2, 3))
  assert.deepEqual(await listed(r.app.client, '&preset=delivery&preset=internal'), all.slice(1, 3))
  assert.deepEqual(
    ((await listed(r.app.client, '&q=B')) as unknown[][]).map((row) => row[1]),
    ['B', 'B', 'B'],
  )
  assert.equal(((await listed(r.app.client, '&q=to-hn')) as unknown[][]).length, 1)

  // Read from the transfers each time: what came into a location less what left is what it holds.
  const { rows: lines } = (await r.call('stock.listMoveHistory', {})) as unknown as { rows: Row[] }
  const quants = (await r.call('stock.listQuants', {})) as unknown as Row[]
  for (const location of ['wh:stock', 'hn:stock']) {
    const moved = lines.reduce(
      (total, line) =>
        total +
        (line.locationDestId === location ? Number(line.quantity) : 0) -
        (line.locationId === location ? Number(line.quantity) : 0),
      0,
    )
    const held = quants
      .filter((quant) => quant.locationId === location)
      .reduce((total, quant) => total + Number(quant.quantity), 0)
    assert.equal(moved, held, location)
  }
  // The function answers newest first too, for callers without the list.
  assert.deepEqual(
    lines.map((line) => line.pickingName),
    all.map((row) => row[0]),
  )
  assert.deepEqual(
    [lines.length, lines.some((line) => ['open', 'dropped'].includes(String(line.pickingName)))],
    [5, false],
  )
})

test('K52 the moves history opens to whoever reads stock on hand, from the menu on this month', async (t) => {
  const r = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const client = async (roleId: string | null, id: string) => {
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    if (roleId) await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId })
    const session = r.app.client.anonymous()
    await session.login({ login: id, password: 'test-password' })
    return session
  }
  const operator = await client('commerce.warehouse-operator', 'operator')
  const page = await operator.request('/admin/stock/moves?lang=vi&preset=thisMonth')
  assert.equal(page.status, 200)
  const markup = await page.text()
  assert.match(markup, /href="\/admin\/stock\/moves\?preset=thisMonth[^"]*"/)
  assert.match(markup, /id="stock-history-help"/)
  assert.match(markup, /aria-label="Hướng dẫn Lịch sử dịch chuyển"/)
  assert.equal(((await listed(operator, '&preset=thisMonth')) as unknown[]).length, 3)

  // Without a role reading stock, the page is locked and the data refused.
  const nobody = await client(null, 'nobody')
  const locked = await nobody.request('/admin/stock/moves?lang=en')
  assert.equal(locked.status, 403)
  assert.match(await locked.text(), /Your role cannot see the moves history/)
  assert.equal(await listed(nobody), 403)
})
