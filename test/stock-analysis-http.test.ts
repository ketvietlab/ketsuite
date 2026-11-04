import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}
/** Five in the morning UTC is noon in the company's zone, so the civil day never slips. */
const at = (day: string) => `${day}T05:00:00.000Z`
const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)

async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('product.setCost', { productId: r.productId, standardPrice: '1000' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('stock.saveWarehouse', { id: 'east', name: 'East', code: 'EA' })
  /** A transfer of the goods, confirmed and ready; receipts carry their unit cost. */
  const transfer = async (
    id: string,
    type: 'incoming' | 'outgoing' | 'internal',
    quantity: string,
    options: { unitCost?: string; to?: string } = {},
  ) => {
    await r.save('stock.createPicking', {
      id,
      name: id,
      pickingTypeId: `wh:${type}`,
      ...(options.to ? { locationDestId: options.to } : {}),
    })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: quantity,
    })
    await r.save('stock.confirmPicking', { id })
    if (type === 'incoming') {
      await r.save('stock.saveMoveLine', { id: `${id}-line`, moveId: `${id}-move`, quantity })
      if (options.unitCost)
        assert.equal(
          (await r.call('stock.setReceiptUnitCost', { id: `${id}-line`, unitCost: options.unitCost })).ok,
          true,
        )
    } else await r.save('stock.reserveMove', { id: `${id}-move` })
  }
  /** Completes a transfer as of a day: the clock stays put, since a session would not survive moving it. */
  const complete = async (id: string, day?: string) => {
    assert.equal((await r.call('stock.completePicking', { id, createBackorder: false })).ok, true, id)
    if (day)
      await r.app.adapter!.run(
        sql(`UPDATE stock_picking SET "dateDone" = ?, "scheduledDate" = ? WHERE id = ?`),
        [at(day), at(day), id],
      )
  }
  const count = async (id: string, countedQuantity: string, locationId = 'wh:stock') =>
    assert.equal(
      (
        await r.call('stock.adjustInventory', {
          id,
          productId: r.productId,
          locationId,
          inventoryLocationId: 'count',
          countedQuantity,
          productUomId: 'each',
        })
      ).ok,
      true,
    )
  return { ...r, transfer, complete, count }
}

const analysisOf = async (r: Awaited<ReturnType<typeof seed>>, args: Row = {}) =>
  Object.fromEntries(
    ((await r.call('stock.listMoveAnalysis', args)).rows as Row[]).map((row) => [
      row.pickingName,
      [row.kind, row.state, row.demand, row.quantity, row.value, row.remaining, row.remainingValue],
    ]),
  )

test('K63 the moves analysis lists every line of every transfer and what of each arrival is left, first in first out', async (t) => {
  const r = await seed(t)
  await r.count('opening', '4')
  await r.transfer('R1', 'incoming', '6', { unitCost: '1500' })
  await r.complete('R1', '2030-01-10')
  // Five leave: the four counted first, then one of the receipt's.
  await r.transfer('D1', 'outgoing', '5')
  await r.complete('D1', '2030-01-20')
  // Two more of the receipt move to the east warehouse, where they arrive today.
  await r.transfer('T1', 'internal', '2', { to: 'east:stock' })
  await r.complete('T1', '2030-01-25')
  await r.save('stock.createPicking', { id: 'DR', name: 'DR', pickingTypeId: 'wh:incoming' })
  await r.save('stock.addMove', {
    id: 'DR-move',
    pickingId: 'DR',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '3',
  })
  await r.transfer('C1', 'outgoing', '1')
  assert.equal((await r.call('stock.cancelPicking', { id: 'C1' })).ok, true)
  // Reserved is not done: what a waiting delivery holds moves nothing yet.
  await r.transfer('A1', 'outgoing', '1')

  const rows = await analysisOf(r)
  // The opening count came in to WH, so it takes WH's first receipt number (K17).
  assert.deepEqual(rows, {
    'WH/NK/0001': ['adjustment', 'done', '4', '4', '4000', '0', '0'],
    R1: ['receipt', 'done', '6', '6', '9000', '3', '4500'],
    D1: ['delivery', 'done', '5', '5', '-6500', null, null],
    T1: ['internal', 'done', '2', '2', null, '2', null],
    DR: ['receipt', 'draft', '3', '0', null, null, null],
    C1: ['delivery', 'cancel', '1', '0', null, null, null],
    A1: ['delivery', 'assigned', '1', '0', null, null, null],
  })
  // What the layers leave is what the warehouses hold.
  const left = Object.values(rows).reduce((sum, row) => sum + Number(row[5] ?? 0), 0)
  const held = ((await r.call('stock.listValuation', {})).rows as Row[])[0]!
  assert.deepEqual([left, held.quantity], [5, '5'])
  const listed = (await r.call('stock.listMoveAnalysis', {})).rows as Row[]
  assert.deepEqual(
    listed.filter((row) => row.state === 'done').map((row) => [row.pickingName, row.date]),
    [
      ['T1', '2030-01-25'],
      ['D1', '2030-01-20'],
      ['R1', '2030-01-10'],
      ['WH/NK/0001', '2030-01-01'],
    ],
  )
  // A transfer between warehouses belongs to both.
  assert.deepEqual(Object.keys(await analysisOf(r, { warehouseId: 'east' })), ['T1'])
  assert.equal(Object.keys(await analysisOf(r, { warehouseId: 'wh' })).length, 7)
})

test('K63 the stock aging buckets each warehouse by days since its goods came in, and totals what the valuation does', async (t) => {
  const r = await seed(t)
  const asOf = '2030-06-30'
  // One unit a day, at odd prices so shares of the average round.
  const arrivals = [120, 91, 90, 61, 60, 31, 30]
  for (const [index, days] of arrivals.entries()) {
    await r.transfer(`R${days}`, 'incoming', '1', { unitCost: String(1001 + index * 2) })
    await r.complete(`R${days}`, daysBefore(asOf, days))
  }
  // The oldest unit leaves for east ten days ago: there it is ten days old.
  await r.transfer('T1', 'internal', '1', { to: 'east:stock' })
  await r.complete('T1', daysBefore(asOf, 10))
  const aging = await r.call('stock.listStockAging', { asOf })
  const rows = Object.fromEntries(
    (aging.rows as Row[]).map((row) => [
      row.warehouseName,
      [row.quantity, row.age30, row.age60, row.age90, row.ageOlder, row.oldest],
    ]),
  )
  assert.deepEqual(rows, {
    // 30 days is the first bucket, 31 and 60 the second, 61 and 90 the third, 91 the last.
    Warehouse: ['6', '1', '2', '2', '1', daysBefore(asOf, 91)],
    East: ['1', '1', '0', '0', '0', daysBefore(asOf, 10)],
  })
  const valuation = await r.call('stock.listValuation', {})
  const total = (aging.rows as Row[]).reduce((sum, row) => sum + Number(row.value), 0)
  assert.equal(String(total), valuation.totalValue)
  for (const warehouseId of ['wh', 'east']) {
    const own = await r.call('stock.listStockAging', { asOf, warehouseId })
    const valued = await r.call('stock.listValuation', { warehouseId })
    assert.deepEqual(
      (own.rows as Row[]).map((row) => row.value),
      [valued.totalValue],
      warehouseId,
    )
  }
})

test('K63 warehouse shares that round apart still add up to the valuation without a warehouse', async (t) => {
  const r = await seed(t)
  await r.save('stock.saveWarehouse', { id: 'north', name: 'North', code: 'NO' })
  // Three units worth 1,000: a third each is 333.33, which rounds to 999 across three warehouses.
  await r.transfer('R1', 'incoming', '3', { unitCost: '333.34' })
  await r.complete('R1', '2029-12-01')
  for (const to of ['east', 'north']) {
    await r.transfer(`T-${to}`, 'internal', '1', { to: `${to}:stock` })
    await r.complete(`T-${to}`, '2029-12-02')
  }
  const aging = await r.call('stock.listStockAging', {})
  assert.deepEqual(
    (aging.rows as Row[]).map((row) => row.quantity),
    ['1', '1', '1'],
  )
  const values = (aging.rows as Row[]).map((row) => Number(row.value)).sort()
  assert.deepEqual(values, [333, 333, 334])
  assert.equal((await r.call('stock.listValuation', {})).totalValue, '1000')
  // A warehouse alone keeps its rounded share, as the valuation shows it.
  const east = await r.call('stock.listStockAging', { warehouseId: 'east' })
  assert.deepEqual(
    (east.rows as Row[]).map((row) => row.value),
    [(await r.call('stock.listValuation', { warehouseId: 'east' })).totalValue],
  )
})

test('K63 stock no recorded transfer explains is the oldest layer, dated when its stock line came in', async (t) => {
  const r = await seed(t)
  await r.count('opening', '3')
  // As stock held before the ledger began: the quantity stays, the transfer lines that explain it do not.
  await r.app.adapter!.run(sql(`DELETE FROM stock_move_line`))
  await r.transfer('D1', 'outgoing', '1')
  await r.complete('D1', '2030-01-05')
  const aging = await r.call('stock.listStockAging', { asOf: '2030-04-15' })
  assert.deepEqual(
    (aging.rows as Row[]).map((row) => [row.quantity, row.age90, row.ageOlder, row.oldest]),
    [['2', '0', '2', '2030-01-01']],
  )
})

test('K63 the analysis and aging screens read one paged answer, group and total it, and stay locked without the value right', async (t) => {
  const r = await seed(t)
  await r.transfer('R1', 'incoming', '4', { unitCost: '1500' })
  await r.complete('R1', '2029-09-01')
  await r.transfer('D1', 'outgoing', '1')
  await r.complete('D1', '2029-12-03')
  const read = async (report: string, href: string, client = r.app.client) => {
    const response = await client.request(`/admin/stock/${report}/data?lang=en`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ href }),
    })
    return { status: response.status, value: response.status === 200 ? (await response.json()).value : null }
  }
  const all = (await read('analysis', '/admin/stock/analysis?lang=en')).value
  assert.deepEqual(
    all.rows.map((row: Row) => [
      row.dateText,
      row.pickingName,
      row.kindText,
      row.stateText,
      row.quantityText,
      row.valueText,
      row.remainingText,
      row.remainingValueText,
    ]),
    [
      ['03/12/2029', 'D1', 'Delivery', 'Done', '1', '-₫1,500', '', ''],
      ['01/09/2029', 'R1', 'Receipt', 'Done', '4', '₫6,000', '3', '₫4,500'],
    ],
  )
  assert.equal(all.rows[1].href, '/admin/stock/transfers/R1?lang=en')
  assert.deepEqual(all.totals, ['Value: ₫4,500', 'Remaining value: ₫4,500'])
  const months = (await read('analysis', '/admin/stock/analysis?lang=en&group=date:month')).value
  assert.deepEqual(
    months.groups.map((group: Row) => [group.label, group.count]),
    [
      ['09/2029', 1],
      ['12/2029', 1],
    ],
  )
  const left = (await read('analysis', '/admin/stock/analysis?lang=en&preset=left')).value
  assert.deepEqual(
    left.rows.map((row: Row) => row.pickingName),
    ['R1'],
  )
  const aging = (await read('aging', '/admin/stock/aging?lang=en')).value
  assert.deepEqual(
    aging.rows.map((row: Row) => [
      row.warehouse,
      row.quantityText,
      row.age30Text,
      row.ageOlderText,
      row.valueText,
    ]),
    [['Warehouse', '3', '0', '3', '₫4,500']],
  )
  const valuation = (
    await (
      await r.app.client.request('/admin/stock/valuation/data?lang=en', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ href: '/admin/stock/valuation?lang=en' }),
      })
    ).json()
  ).value
  assert.deepEqual(aging.totals, [`Filtered total: ${valuation.totalText}`])
  for (const report of ['analysis', 'aging']) {
    const page = await r.app.client.request(`/admin/stock/${report}?lang=en`)
    assert.equal(page.status, 200)
    const markup = await page.text()
    assert.match(markup, /stock\.report-results/)
    assert.match(markup, new RegExp(`stock-${report}-help`))
    assert.match(markup, /href="\/admin\/stock\/analysis"/)
    assert.match(markup, /href="\/admin\/stock\/aging"/)
  }

  await r.fixture('user.saveRole', { id: 'keeper', name: 'Keeper' })
  await r.fixture('user.createUser', {
    id: 'keeper',
    login: 'keeper',
    password: 'test-password',
    name: 'Keeper',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'keeper-company', userId: 'keeper', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'keeper-role', userId: 'keeper', roleId: 'keeper' })
  for (const fnKey of ['stock.listPickings', 'stock.getPicking'])
    await r.fixture('user.grantFunction', { id: fnKey, roleId: 'keeper', fnKey })
  const keeper = r.app.client.anonymous()
  await keeper.login({ login: 'keeper', password: 'test-password' })
  for (const [report, words] of [
    ['analysis', /Your role cannot see the moves analysis/],
    ['aging', /Your role cannot see stock aging/],
  ] as const) {
    assert.equal((await read(report, `/admin/stock/${report}`, keeper)).status, 403)
    const locked = await keeper.request(`/admin/stock/${report}?lang=en`)
    assert.equal(locked.status, 403)
    const markup = await locked.text()
    assert.match(markup, words)
    assert.doesNotMatch(markup, /stock\.report-results/)
  }
  const transfers = await (await keeper.request('/admin/stock/transfers?lang=en')).text()
  assert.doesNotMatch(transfers, /href="\/admin\/stock\/(analysis|aging)"/)
})

test('K63 the commerce job roles: whoever reads stock value reads the analysis and aging, storekeepers do not', async (t) => {
  const r = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const status = async (roleId: string) => {
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
    const statuses: number[] = []
    for (const fn of ['stock.listMoveAnalysis', 'stock.listStockAging'])
      statuses.push(
        (
          await client.request(`/_ket/fn/${fn}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
      )
    return statuses
  }
  const reads = {
    'commerce.warehouse-manager': [200, 200],
    'commerce.accountant': [200, 200],
    'commerce.tenant-auditor': [200, 200],
    'commerce.warehouse-operator': [403, 403],
    'commerce.sales-representative': [403, 403],
  }
  for (const [roleId, expected] of Object.entries(reads))
    assert.deepEqual(await status(roleId), expected, roleId)
})
