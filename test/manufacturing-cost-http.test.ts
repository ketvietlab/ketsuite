import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

test('manufacturing cost HTTP: batches post at the provisional cost, the stock journal balances, and only cost readers see prices', async (t) => {
  const r = await boot(t)
  for (const [id, accountType] of [
    ['156', 'asset_current'],
    ['151', 'asset_current'],
    ['1541', 'asset_current'],
    ['632', 'expense_direct_cost'],
    ['33811', 'liability_current'],
    ['13811', 'asset_receivable'],
  ] as const)
    await r.save('account.saveAccount', { id, code: id, name: id, accountType, reconcile: false })
  await r.save('account.saveJournal', { id: 'kho', name: 'Kho', code: 'KHO', type: 'general' })
  await r.save('stock.saveAccountingSetting', {
    journalId: 'kho',
    valuationAccountId: '156',
    supplierAccountId: '151',
    productionAccountId: '1541',
    cogsAccountId: '632',
    gainAccountId: '33811',
    lossAccountId: '13811',
  })
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await r.save('stock.saveLocation', { id: 'production', name: 'Sản xuất', usage: 'production' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Kiểm kê', usage: 'inventory' })
  const variant: Record<string, string> = {}
  for (const [id, name, cost, stock] of [
    ['flour', 'Bột mì', '98000', '100'],
    ['box', 'Hộp', '1800', '300'],
    ['cake', 'Bánh', '0', null],
  ] as const) {
    await r.save('product.saveRecord', {
      id,
      name,
      type: 'goods',
      defaultCode: id.toUpperCase(),
      uomId: 'each',
      listPrice: '0',
    })
    await r.save('stock.configureProduct', { templateId: id, isStorable: true, tracking: 'none' })
    variant[id] = String(
      ((await r.call('product.listVariants', { templateId: id })) as unknown as Row[])[0]!.id,
    )
    await r.save('product.setCost', { productId: variant[id], standardPrice: cost })
    if (stock)
      await r.save('stock.adjustInventory', {
        id: `seed-${id}`,
        productId: variant[id],
        locationId: 'wh:stock',
        inventoryLocationId: 'count',
        countedQuantity: stock,
        productUomId: 'each',
      })
  }
  await r.save('manufacturing.saveBom', {
    id: 'cake-bom',
    code: 'CAKE-01',
    productId: variant.cake,
    productQty: '200',
    productUomId: 'each',
    consumption: 'flexible',
    lines: [
      { id: 'flour-line', productId: variant.flour, productQty: '10.5', productUomId: 'each' },
      { id: 'box-line', productId: variant.box, productQty: '200', productUomId: 'each' },
    ],
  })
  await r.save('manufacturing.saveProduction', {
    id: 'mo-cake',
    name: 'HCM/SX/0002',
    bomId: 'cake-bom',
    productQty: '200',
    productUomId: 'each',
    sourceLocationId: 'wh:stock',
    productionLocationId: 'production',
    destinationLocationId: 'wh:stock',
    scheduledStart: '2026-10-29T01:00:00.000Z',
  })
  await r.save('manufacturing.confirmProduction', { id: 'mo-cake', version: 1 })
  const batch = await r.save('manufacturing.recordOutput', { id: 'mo-cake', quantity: '180' })
  await r.save('manufacturing.consumeProduction', {
    id: 'mo-cake',
    components: [
      { productId: variant.flour, consumed: '10.5' },
      { productId: variant.box, consumed: '200' },
    ],
  })

  const posted = async (account: string, side: 'debit' | 'credit', pickingIds: string[]) => {
    const rows = (await r.app.adapter!.all(
      sql(
        `SELECT SUM(${side}) AS total FROM account_move_line WHERE "accountId" = ? AND "moveId" IN (SELECT "accountMoveId" FROM stock_valuation_layer WHERE "pickingId" IN (${pickingIds.map(() => '?').join(', ')}))`,
      ),
      [account, ...pickingIds],
    )) as Row[]
    return Number(rows[0]?.total ?? 0)
  }
  // Python: 10.5 × 98,000 + 200 × 1,800 = 1,389,000 issued; 180 × 6,945 = 1,250,100 received.
  const issues = (
    (await r.app.adapter!.all(sql('SELECT DISTINCT "pickingId" FROM stock_valuation_layer WHERE kind = ?'), [
      'consumption',
    ])) as Row[]
  ).map((row) => String(row.pickingId))
  assert.equal(await posted('1541', 'debit', issues), 1_389_000)
  assert.equal(await posted('156', 'credit', issues), 1_389_000)
  assert.equal(await posted('156', 'debit', [String(batch.pickingId)]), 1_250_100)
  assert.equal(await posted('1541', 'credit', [String(batch.pickingId)]), 1_250_100)

  const page = async () => (await r.app.client.get('/admin/manufacturing/orders/mo-cake?lang=vi')).text()
  const running = await page()
  assert.match(running, /Giá tạm tính \/ Each/)
  assert.match(running, /6\.945/)
  assert.doesNotMatch(running, /Giá thực tế/, 'no actual cost while the order runs')
  const version = Number((await r.call('manufacturing.getProduction', { id: 'mo-cake' })).version)
  await r.save('manufacturing.completeProduction', { id: 'mo-cake', version, rest: 'close' })
  const done = await page()
  // Python: 1,389,000 / 180 = 7,716.67 → 7,717.
  assert.match(done, /Giá thực tế \/ Each/)
  assert.match(done, /7\.717/)

  // A floor worker reads the order without its prices.
  await r.fixture('user.createUser', {
    id: 'worker',
    login: 'worker',
    password: 'test-password',
    name: 'Worker',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'worker-acme', userId: 'worker', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'floor', name: 'Floor' })
  for (const fnKey of [
    'manufacturing.getProduction',
    'manufacturing.productionQueue',
    'manufacturing.listProductions',
    'uom.listUnits',
    'product.listVariants',
  ])
    await r.fixture('user.grantFunction', { id: `floor:${fnKey}`, roleId: 'floor', fnKey })
  await r.fixture('user.assignRole', { id: 'worker:floor', userId: 'worker', roleId: 'floor' })
  await r.app.client.logout()
  await r.app.client.login({ login: 'worker', password: 'test-password' })
  const hidden = await page()
  assert.match(hidden, /HCM\/SX\/0002/)
  assert.doesNotMatch(hidden, /Giá thành|Giá tạm tính|Giá thực tế/)
  const refused = await r.app.client.call<Row>('manufacturing.getProductionCost', { id: 'mo-cake' }).then(
    (result) => JSON.stringify(result.value),
    (error: Error) => `refused: ${error.message}`,
  )
  assert.match(refused, /^refused: /, refused)
})

/** A 200-cake order closed short at 180, 65 minutes in the oven, `held` of the 180 still in stock. */
const settled = async (t: Parameters<typeof boot>[0], held: string) => {
  const r = await boot(t)
  for (const [id, accountType] of [
    ['156', 'asset_current'],
    ['151', 'asset_current'],
    ['1541', 'asset_current'],
    ['632', 'expense_direct_cost'],
    ['622', 'expense_direct_cost'],
    ['33811', 'liability_current'],
    ['13811', 'asset_receivable'],
  ] as const)
    await r.save('account.saveAccount', { id, code: id, name: id, accountType, reconcile: false })
  await r.save('account.saveJournal', { id: 'kho', name: 'Kho', code: 'KHO', type: 'general' })
  await r.save('stock.saveAccountingSetting', {
    journalId: 'kho',
    valuationAccountId: '156',
    supplierAccountId: '151',
    productionAccountId: '1541',
    cogsAccountId: '632',
    gainAccountId: '33811',
    lossAccountId: '13811',
  })
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await r.save('stock.saveLocation', { id: 'production', name: 'Sản xuất', usage: 'production' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Kiểm kê', usage: 'inventory' })
  await r.save('manufacturing.saveCostSetting', { labourAccountId: '622' })
  const variant: Record<string, string> = {}
  for (const [id, name, cost, stock] of [
    ['flour', 'Bột mì', '98000', '100'],
    ['box', 'Hộp', '1800', '300'],
    ['cake', 'Bánh', '0', null],
  ] as const) {
    await r.save('product.saveRecord', {
      id,
      name,
      type: 'goods',
      defaultCode: id.toUpperCase(),
      uomId: 'each',
      listPrice: '0',
    })
    await r.save('stock.configureProduct', { templateId: id, isStorable: true, tracking: 'none' })
    variant[id] = String(
      ((await r.call('product.listVariants', { templateId: id })) as unknown as Row[])[0]!.id,
    )
    await r.save('product.setCost', { productId: variant[id], standardPrice: cost })
    if (stock)
      await r.save('stock.adjustInventory', {
        id: `seed-${id}`,
        productId: variant[id],
        locationId: 'wh:stock',
        inventoryLocationId: 'count',
        countedQuantity: stock,
        productUomId: 'each',
      })
  }
  await r.save('manufacturing.saveWorkCenter', {
    id: 'oven',
    code: 'OVEN',
    name: 'Lò',
    capacity: '1',
    costPerHour: '150000',
  })
  await r.save('manufacturing.saveBom', {
    id: 'cake-bom',
    code: 'CAKE-01',
    productId: variant.cake,
    productQty: '200',
    productUomId: 'each',
    consumption: 'flexible',
    operations: [{ id: 'bake-op', name: 'Nướng', workCenterId: 'oven', durationExpected: 60, sequence: 1 }],
    lines: [
      { id: 'flour-line', productId: variant.flour, productQty: '10.5', productUomId: 'each' },
      { id: 'box-line', productId: variant.box, productQty: '200', productUomId: 'each' },
    ],
  })
  await r.save('manufacturing.saveProduction', {
    id: 'mo-cake',
    name: 'HCM/SX/0002',
    bomId: 'cake-bom',
    productQty: '200',
    productUomId: 'each',
    sourceLocationId: 'wh:stock',
    productionLocationId: 'production',
    destinationLocationId: 'wh:stock',
    scheduledStart: '2026-10-29T01:00:00.000Z',
  })
  await r.save('manufacturing.confirmProduction', { id: 'mo-cake', version: 1 })
  await r.save('manufacturing.startWorkOrder', { id: 'mo-cake:work:bake-op', version: 1 })
  await r.save('manufacturing.finishWorkOrder', {
    id: 'mo-cake:work:bake-op',
    version: 2,
    actualMinutes: '65',
  })
  await r.save('manufacturing.recordOutput', { id: 'mo-cake', quantity: '180' })
  await r.save('manufacturing.consumeProduction', {
    id: 'mo-cake',
    components: [
      { productId: variant.flour, consumed: '10.5' },
      { productId: variant.box, consumed: '200' },
    ],
  })
  // 60 of the 180 leave before the order closes.
  await r.save('stock.adjustInventory', {
    id: 'cake-out',
    productId: variant.cake,
    locationId: 'wh:stock',
    inventoryLocationId: 'count',
    countedQuantity: held,
    productUomId: 'each',
  })
  const version = Number((await r.call('manufacturing.getProduction', { id: 'mo-cake' })).version)
  await r.save('manufacturing.completeProduction', { id: 'mo-cake', version, rest: 'close' })
  const entry = async (id: string) =>
    (
      (await r.app.adapter!.all(
        sql('SELECT "accountId", debit, credit FROM account_move_line WHERE "moveId" = ? ORDER BY sequence'),
        [id],
      )) as Row[]
    ).map((row) => [row.accountId, Number(row.debit), Number(row.credit)])
  const revaluations = async () =>
    (await r.app.adapter!.all(
      sql('SELECT value, "accountMoveId" FROM stock_valuation_layer WHERE kind = ? AND "productId" = ?'),
      ['revaluation', variant.cake],
    )) as Row[]
  const wip = async () =>
    Number(
      (
        (await r.app.adapter!.all(
          sql('SELECT SUM(debit) - SUM(credit) AS balance FROM account_move_line WHERE "accountId" = ?'),
          ['1541'],
        )) as Row[]
      )[0]?.balance,
    )
  return { r, variant, entry, revaluations, wip }
}

test('manufacturing settle HTTP: closing charges labour, revalues the share still held and sends the rest to cost of goods', async (t) => {
  const { r, entry, revaluations, wip } = await settled(t, '120')

  // Python: 65 min × 150,000 / 60 = 162,500.
  assert.deepEqual(await entry('manufacturing-labour:mo-cake'), [
    ['1541', 162_500, 0],
    ['622', 0, 162_500],
  ])
  // Python: 1,389,000 + 162,500 − 1,250,100 = 301,400; 120 of 180 held → 200,933, sold 100,467.
  assert.deepEqual(await entry('manufacturing-variance:mo-cake'), [
    ['632', 100_467, 0],
    ['1541', 0, 100_467],
  ])
  const revaluation = await revaluations()
  assert.equal(revaluation.length, 1)
  assert.equal(Number(revaluation[0]?.value), 200_933)
  assert.deepEqual(await entry(String(revaluation[0]?.accountMoveId)), [
    ['156', 200_933, 0],
    ['1541', 0, 200_933],
  ])
  // Work in progress ends at nought.
  assert.equal(await wip(), 0)
  const cost = await r.call('manufacturing.getProductionCost', { id: 'mo-cake' })
  assert.deepEqual(
    [cost.labour, cost.varianceHeld, cost.varianceSold, cost.actual],
    ['162500', '200933', '100467', '8619'],
  )
  const page = await (await r.app.client.get('/admin/manufacturing/orders/mo-cake?lang=vi')).text()
  assert.ok(page.includes('Giờ công'), 'the order page shows labour')
  assert.ok(page.includes('162.500'), 'labour amount on the page')
})

test('manufacturing settle HTTP: with nothing left in stock the whole difference goes to cost of goods', async (t) => {
  const { r, entry, revaluations, wip } = await settled(t, '0')
  // Python: 301,400 with none of the 180 held.
  assert.deepEqual(await entry('manufacturing-variance:mo-cake'), [
    ['632', 301_400, 0],
    ['1541', 0, 301_400],
  ])
  assert.deepEqual(await revaluations(), [])
  assert.equal(await wip(), 0)
  const cost = await r.call('manufacturing.getProductionCost', { id: 'mo-cake' })
  assert.deepEqual([cost.varianceHeld, cost.varianceSold], ['0', '301400'])
})

test('manufacturing variance HTTP: use against the BOM counts the produced share of a short order, overuse first', async (t) => {
  const { r, variant } = await settled(t, '180')
  // A second order still running has used 15 of its 10.5 flour and none of its boxes.
  await r.save('manufacturing.saveProduction', {
    id: 'mo-next',
    name: 'HCM/SX/0003',
    bomId: 'cake-bom',
    productQty: '200',
    productUomId: 'each',
    sourceLocationId: 'wh:stock',
    productionLocationId: 'production',
    destinationLocationId: 'wh:stock',
    scheduledStart: '2026-10-30T01:00:00.000Z',
  })
  await r.save('manufacturing.confirmProduction', { id: 'mo-next', version: 1 })
  await r.save('manufacturing.consumeProduction', {
    id: 'mo-next',
    components: [{ productId: variant.flour, consumed: '15' }],
  })
  // Python: mo-cake closed at 180 of 200 → boxes 180 asked, 200 used (+20, +11.11%); flour
  // 10.5 × 0.9 = 9.45 asked, 10.5 used (+1.05, +11.11%). mo-next asks the whole BOM: flour 15 of 10.5
  // (+4.5, +42.86%), boxes 0 of 200 (−100%). Sorted by percent, not by order or insertion.
  const rows = (await r.call('manufacturing.consumptionVariance', {})) as unknown as Row[]
  assert.deepEqual(
    rows.map((row) => [
      row.productionName,
      row.productId,
      row.expected,
      row.used,
      row.difference,
      row.percent,
    ]),
    [
      ['HCM/SX/0003', variant.flour, '10.5', '15', '4.5', '42.86'],
      ['HCM/SX/0002', variant.box, '180', '200', '20', '11.11'],
      ['HCM/SX/0002', variant.flour, '9.45', '10.5', '1.05', '11.11'],
      ['HCM/SX/0003', variant.box, '200', '0', '-200', '-100'],
    ],
  )
  const page = await (await r.app.client.get('/admin/manufacturing/consumption?lang=vi')).text()
  assert.ok(page.includes('Tiêu hao so định mức'), 'the report title')
  assert.ok(page.includes('HCM/SX/0002'), 'the order name')
  assert.ok(page.includes('+1,05 '), 'the flour difference')
  assert.ok(page.includes('+4,5 '), 'the running flour difference')
  assert.ok(page.includes('/admin/manufacturing/orders/mo-cake'), 'rows open the order')
})
