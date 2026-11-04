import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, schemaFromManifest, tableNameFor, type Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

async function seed(t: TestContext) {
  const r = await boot(t)
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await r.save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    purchaseOk: true,
    isStorable: true,
  })
  for (const id of ['east', 'lotus', 'unrelated'])
    await r.save('partner.savePartner', { id, name: id, kind: 'company' })
  for (const [id, partnerId, minQty, price, delay, sequence] of [
    ['first', 'east', '500', '17200', 10, 1],
    ['second', 'lotus', '100', '18000', 5, 2],
  ])
    await r.save('purchase.saveSupplierInfo', {
      id,
      partnerId,
      productTemplateId: 'goods',
      productUomId: 'each',
      minQty,
      price,
      delay,
      sequence,
    })
  const point: Row = {
    id: 'point',
    productId: 'goods:default',
    warehouseId: 'wh',
    locationId: 'wh:stock',
    trigger: 'manual',
    minQuantity: '100',
    maxQuantity: '200',
    replenishmentUomId: 'each',
    source: 'supplier',
    vendorId: null,
    leadDays: null,
  }
  const save = (patch: Row = {}) => r.save('stock.saveOrderpoint', { ...point, ...patch })
  const run = (moveId: string, id = 'point') => r.call('stock.runOrderpoint', { id, moveId })
  const plan = () => r.call('stock.getOrderpointSupply', { id: 'point' })
  return { ...r, point, savePoint: save, run, plan }
}

test('P50 automatic supplier selection groups draft receipts by vendor without purchase prices', async (t) => {
  const r = await seed(t)
  await r.savePoint()
  const initial = await r.plan()
  // The look-ahead is the first supplier's; the supplier named is the one the run orders from:
  // 200 falls short of east's 500 and reaches lotus's 100 (P49).
  assert.equal(initial.leadDays, 10)
  assert.equal((initial.selected as Row).partnerId, 'lotus')
  assert.equal(initial.quantity, 200)
  const first = await r.run('first-run')
  assert.equal(first.ok, true)
  let receipt = await r.call('stock.getPicking', { id: first.pickingId })
  assert.equal(receipt.partnerId, 'lotus')
  assert.equal(receipt.state, 'draft')
  assert.equal((receipt.moves as Row[])[0]!.productUomQty, '200')
  assert.equal((receipt.moves as Row[])[0]!.price, undefined)
  assert.equal((receipt.moves as Row[])[0]!.purchaseLineId, null)
  assert.equal((await r.plan()).onOrder, 200)
  assert.equal((await r.run('covered-run')).quantity, '0')
  await r.savePoint({ minQuantity: '1100', maxQuantity: '1200' })
  const second = await r.run('second-run')
  assert.equal(second.quantity, '1000')
  assert.notEqual(second.pickingId, first.pickingId)
  assert.equal((await r.call('stock.getPicking', { id: second.pickingId })).partnerId, 'east')
  await r.savePoint({ vendorId: 'lotus', minQuantity: '1400', maxQuantity: '1500' })
  assert.equal((await r.plan()).leadDays, 5)
  const third = await r.run('third-run')
  assert.equal(third.pickingId, first.pickingId)
  receipt = await r.call('stock.getPicking', { id: first.pickingId })
  assert.equal((receipt.moves as Row[]).length, 2)
  assert.equal((await r.run('third-run')).pickingId, first.pickingId)
  await r.savePoint({ vendorId: 'lotus', leadDays: 3 })
  assert.equal((await r.plan()).leadDays, 3)
  const rejected = await r.call('stock.saveOrderpoint', { ...r.point, vendorId: 'unrelated' })
  assert.equal(rejected.ok, false)
  assert.equal((await r.plan()).leadDays, 3)
  assert.equal(
    (await r.call('stock.saveOrderpoint', { ...r.point, source: 'route', leadDays: null })).ok,
    false,
  )
})

test('P50 warehouse lock prevents duplicate procurement and cross-company mutation', async (t) => {
  const r = await seed(t)
  await r.savePoint()
  const results = await Promise.all([r.run('race-a'), r.run('race-b')])
  assert.equal(results.filter((row) => row.quantity === '200').length, 1)
  assert.equal(results.filter((row) => row.quantity === '0').length, 1)
  assert.equal(((await r.call('stock.listPickings', {})) as unknown as Row[]).length, 1)
  const foreign = await r.fixture('stock.runOrderpoint', { id: 'point', moveId: 'foreign' }, 'other')
  assert.equal(foreign.ok, false)
  assert.equal((await r.plan()).onOrder, 200)
  assert.equal((await r.call('stock.saveOrderpoint', { ...r.point, leadDays: 366 })).ok, false)
  assert.equal((await r.call('stock.saveOrderpoint', { ...r.point, minQuantity: '-1' })).ok, false)
})

test('P50 lead horizon counts committed demand, ignores later demand and rounds supplier units', async (t) => {
  const r = await seed(t)
  await r.save('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'each', relativeFactor: '12' })
  const types = (await r.call('stock.listPickingTypes', {})) as unknown as Row[]
  const outgoing = types.find((row) => row.code === 'outgoing')!
  for (const [id, days, quantity] of [
    ['soon', 2, '24'],
    ['later', 20, '1200'],
  ] as const) {
    await r.save('stock.createPicking', {
      id,
      name: id,
      pickingTypeId: outgoing.id,
      scheduledDate: new Date(Date.now() + days * 86400000).toISOString(),
    })
    await r.save('stock.addMove', {
      id: id + '-move',
      name: id,
      pickingId: id,
      productId: 'goods:default',
      productUomId: 'each',
      productUomQty: quantity,
    })
    await r.save('stock.confirmPicking', { id })
  }
  await r.savePoint({ minQuantity: '10', maxQuantity: '101', replenishmentUomId: 'box' })
  const plan = await r.plan()
  assert.equal(plan.outgoing, 24)
  assert.equal(plan.quantity, 10.417)
  const run = await r.run('boxes')
  assert.equal(run.ok, true)
  assert.equal((await r.run('boxes')).quantity, run.quantity)
  const receipt = await r.call('stock.getPicking', { id: run.pickingId })
  assert.equal(receipt.partnerId, 'lotus')
  const move = (receipt.moves as Row[])[0]!
  assert.equal(move.productUomId, 'each')
  assert.equal(move.productUomQty, '125.004')
})

test('P50 legacy route orderpoints retain their move contract and supplier choices never expose price', async (t) => {
  const r = await seed(t)
  await r.save('stock.saveRoute', { id: 'buy', name: 'Buy' })
  const types = (await r.call('stock.listPickingTypes', {})) as unknown as Row[]
  const incoming = types.find((row) => row.code === 'incoming')!
  await r.save('stock.saveRule', {
    id: 'buy-rule',
    name: 'Buy rule',
    routeId: 'buy',
    action: 'pull',
    locationSrcId: incoming.defaultLocationSrcId,
    locationDestId: 'wh:stock',
    pickingTypeId: incoming.id,
    procureMethod: 'make_to_order',
  })
  const { source: _source, vendorId: _vendor, leadDays: _days, ...legacy } = r.point
  await r.save('stock.saveOrderpoint', { ...legacy, routeId: 'buy' })
  const result = await r.run('route-run')
  assert.deepEqual(result, { ok: true, moveIds: ['route-run'], method: 'make_to_order', quantity: '200' })
  const options = await r.call('stock.getOrderpointSupply', { productId: 'goods:default' })
  assert.doesNotMatch(JSON.stringify(options), /17200|18000|price|discount/)
})

test('P50 collection sends a bounded page, preserves compound filters and exposes no costs', async (t) => {
  const r = await seed(t)
  await r.savePoint()
  await r.save('stock.saveLocation', {
    id: 'second-location',
    name: 'Second location',
    usage: 'internal',
    warehouseId: 'wh',
  })
  await r.savePoint({
    id: 'second-point',
    locationId: 'second-location',
    trigger: 'auto',
    minQuantity: '300',
    maxQuantity: '600',
    vendorId: 'lotus',
  })
  const read = async (href: string, pageSize = 1) => {
    const response = await r.app.client.request('/admin/stock/replenishment/data?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ href, pageSize }),
    })
    assert.equal(response.status, 200)
    return (await response.json()).value
  }
  const first = await read('/admin/stock/replenishment?lang=en')
  assert.equal(first.total, 2)
  assert.equal(first.rows.length, 1)
  assert.equal(first.rows[0].sourceName, first.rows[0].id === 'point' ? 'east' : 'lotus')
  assert.equal(first.rows[0].leadDays, first.rows[0].id === 'point' ? '10' : '5')
  assert.equal(first.rows[0].onOrder, '0')
  assert.ok(!JSON.stringify(first).includes('17200'))
  assert.equal((await read('/admin/stock/replenishment?page=99')).page, 2)
  assert.equal((await read('/admin/stock/replenishment?q=missing')).total, 0)
  const state = await r.call('stock_backend.applySearchFilter', {
    listKey: 'stock.replenishment',
    returnTo: '/admin/stock/replenishment',
    query: 'Goods',
    customFilters: [
      { id: 'trigger', field: 'trigger', operator: 'equals', value: 'auto' },
      { id: 'minimum', field: 'minQuantity', operator: 'gt', value: '200' },
    ],
  })
  const filtered = await read(String(state.href))
  assert.equal(filtered.total, 1)
  assert.equal(filtered.rows[0].id, 'second-point')
  assert.equal(filtered.search.customFilters.length, 2)
  const groupedState = await r.call('stock_backend.applySearchFilter', {
    listKey: 'stock.replenishment',
    returnTo: '/admin/stock/replenishment',
    groupBy: ['warehouse'],
  })
  const grouped = await read(String(groupedState.href))
  assert.equal(grouped.groups[0].count, 2)
  assert.equal((await read(grouped.groups[0].href)).groups[0].rows.length, 2)
  const crossSite = await r.app.client.request('/admin/stock/replenishment/data', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' },
    body: '{}',
  })
  assert.equal(crossSite.status, 403)
})

test('P50 rechecks archived destinations and concurrent rules group only by matching supplier and location', async (t) => {
  const r = await seed(t)
  await r.savePoint()
  await r.app.fixture.withTenant('', async ({ adapter }) => {
    await adapter.run(
      `UPDATE ${adapter.quoteIdent(tableNameFor('stock.Location'))} SET active = ${process.env.KET_COMMERCE_PG ? '$1' : '?'} WHERE id = ${process.env.KET_COMMERCE_PG ? '$2' : '?'}`,
      [process.env.KET_COMMERCE_PG ? false : 0, 'wh:stock'],
    )
  })
  assert.equal((await r.run('archived-location')).ok, false)
  assert.equal(((await r.call('stock.listPickings', {})) as unknown as Row[]).length, 0)
  await r.app.fixture.withTenant('', async ({ adapter }) => {
    await adapter.run(
      `UPDATE ${adapter.quoteIdent(tableNameFor('stock.Location'))} SET active = ${process.env.KET_COMMERCE_PG ? '$1' : '?'} WHERE id = ${process.env.KET_COMMERCE_PG ? '$2' : '?'}`,
      [process.env.KET_COMMERCE_PG ? true : 1, 'wh:stock'],
    )
  })
  await r.save('product.saveRecord', {
    id: 'goods-two',
    name: 'Second product',
    type: 'goods',
    defaultCode: 'GOODS2',
    uomId: 'each',
    purchaseOk: true,
    isStorable: true,
  })
  await r.save('purchase.saveSupplierInfo', {
    id: 'supplier-two',
    partnerId: 'lotus',
    productTemplateId: 'goods-two',
    productUomId: 'each',
    minQty: '0',
    price: '99999',
    delay: 5,
    sequence: 1,
  })
  await r.savePoint({ id: 'second-point', productId: 'goods-two:default' })
  const [a, b] = await Promise.all([r.run('one'), r.run('two', 'second-point')])
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.equal(a.pickingId, b.pickingId)
  const picking = await r.call('stock.getPicking', { id: a.pickingId })
  assert.equal(picking.partnerName, 'lotus')
  assert.equal((picking.moves as Row[]).length, 2)
  assert.ok(!JSON.stringify(picking).includes('99999'))
})

test('P50 warehouse operator can read supplier choices without purchase costs and viewers cannot run', async (t) => {
  const r = await seed(t)
  await r.savePoint()
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  for (const [id, role] of [
    ['operator', 'warehouse-operator'],
    ['viewer', 'tenant-auditor'],
  ]) {
    await r.fixture('user.createUser', {
      id,
      login: id,
      name: id,
      password: 'test-password',
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId: `commerce.${role}` })
    await r.app.client.login({ login: id, password: 'test-password' })
    const choices = (await r.call('stock.listOrderpointSuppliers', {
      productId: 'goods:default',
      search: 'lot',
    })) as unknown as Row[]
    assert.equal(choices.length, 1)
    assert.equal(choices[0]!.name, 'lotus')
    assert.equal(choices[0]!.price, undefined)
    const response = await r.app.client.request('/admin/stock/record/replenishment/point/context?lang=en')
    assert.equal(response.status, 200)
    const context = await response.json()
    assert.equal(context.data.run, id === 'operator')
    assert.equal(context.data.supply.enabled, true)
    if (id === 'viewer')
      await assert.rejects(
        () => r.run('viewer-run'),
        (error: { status?: number }) => error.status === 403,
      )
  }
})

test('P50 partial supplier receipt carries the supplier to its backorder', async (t) => {
  const r = await seed(t)
  await r.savePoint()
  const run = await r.run('partial')
  await r.save('stock.confirmPicking', { id: run.pickingId })
  await r.save('stock.saveMoveLine', { id: 'partial-line', moveId: 'partial', quantity: '40' })
  const completion = await r.save('stock.completePicking', { id: run.pickingId, createBackorder: true })
  assert.ok(completion.backorderId)
  const backorder = await r.call('stock.getPicking', { id: completion.backorderId })
  assert.equal(backorder.partnerId, 'lotus')
  assert.equal(backorder.partnerName, 'lotus')
  assert.equal(backorder.state, 'confirmed')
  assert.equal((backorder.moves as Row[])[0]!.productUomQty, '160')
  assert.equal((await r.plan()).quantity, 0)
})

test('P50 nullable schema upgrade preserves legacy rules, receipts and moves and replays cleanly', async (t) => {
  const r = await seed(t)
  await r.savePoint()
  await r.run('migration-move')
  const adapter = r.app.adapter!,
    manifest = compose(r.deployment.modules, { headless: true, companies: true })
  const schema = schemaFromManifest(manifest)
  const added: Record<string, string[]> = {
    'stock.Orderpoint': ['source', 'vendorId', 'leadDays'],
    'stock.Picking': ['partnerId', 'replenishmentGroup'],
    'stock.Move': ['replenishmentQuantity', 'replenishmentUomId'],
  }
  const legacy = structuredClone(schema)
  for (const [tableName, table] of Object.entries(legacy.tables)) {
    for (const column of added[table.model] ?? []) {
      delete table.columns[column]
      await adapter.exec(
        `ALTER TABLE ${adapter.quoteIdent(tableName)} DROP COLUMN ${adapter.quoteIdent(column)}`,
      )
    }
  }
  const tables = ['stock_orderpoint', 'stock_picking', 'stock_move']
  const before = await Promise.all(
    tables.map((table) =>
      adapter.all(`SELECT * FROM ${table} ORDER BY id`).then((rows) => rows.map((row) => ({ ...row }))),
    ),
  )
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(legacy)],
  )
  await migrateOne(adapter, manifest)
  const after = await adapter.all('SELECT * FROM stock_orderpoint')
  for (const [index, table] of tables.entries()) {
    const addedColumns = added[['stock.Orderpoint', 'stock.Picking', 'stock.Move'][index]!]!
    const restored = await adapter.all(`SELECT * FROM ${table} ORDER BY id`)
    assert.deepEqual(
      restored.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !addedColumns.includes(key))),
      ),
      before[index],
    )
  }
  assert.equal(after[0]!.source, null)
  assert.equal((await r.plan()).leadDays, 0)
  assert.deepEqual(await migrateOne(adapter, manifest), [])
})

test('P50 supplier picker can return to automatic selection and rejects nonstorable products', async (t) => {
  const r = await seed(t)
  const automatic = (await r.call('stock.listOrderpointSuppliers', {
    productId: 'goods:default',
    includeAutomatic: true,
    locale: 'en',
  })) as unknown as Row[]
  assert.deepEqual(automatic[0], { id: '', name: 'Follow product', delay: null })
  assert.deepEqual(
    (
      (await r.call('stock.listOrderpointSuppliers', {
        productId: 'goods:default',
        includeAutomatic: true,
        search: 'LOTUS',
      })) as unknown as Row[]
    ).map((row) => row.id),
    ['lotus'],
  )
  await r.save('product.saveRecord', {
    id: 'unstored',
    name: 'Unstored',
    defaultCode: 'UNSTORED',
    type: 'goods',
    uomId: 'each',
    purchaseOk: true,
    isStorable: false,
  })
  assert.equal(
    (await r.call('stock.saveOrderpoint', { ...r.point, productId: 'unstored:default' })).ok,
    false,
  )
})

test('P50 legacy create POST returns raw values and field errors instead of discarding an invalid form', async (t) => {
  const r = await seed(t)
  const form = new URLSearchParams(
    Object.fromEntries(
      Object.entries({ ...r.point, leadDays: '3.5', minQuantity: ' 00100 ' }).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    ),
  )
  const response = await r.app.client.request('/admin/stock/replenishment/new?lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  assert.equal(response.status, 422)
  const html = await response.text()
  assert.match(html, /3\.5/)
  assert.match(html, / 00100 /)
  assert.match(html, /fieldErrors/)
  assert.match(html, /leadDays/)
  assert.deepEqual(await r.call('stock.listOrderpoints', {}), [])
  const valid = await r.app.client.request('/admin/stock/replenishment/new?lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...Object.fromEntries(form), leadDays: '' }).toString(),
  })
  assert.equal(valid.status, 200)
  assert.equal(new URL(valid.url).pathname, '/admin/stock/replenishment')
  assert.equal(((await r.call('stock.listOrderpoints', {})) as unknown as Row[]).length, 1)
})
