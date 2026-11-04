import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

/** A sales order of 3 delivered from 10 counted at 1,000 each. */
async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('product.setCost', { productId: r.productId, standardPrice: '1000' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  const opening = await r.call('stock.adjustInventory', {
    id: 'opening',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'count',
    countedQuantity: '10',
    productUomId: 'each',
  })
  assert.equal(opening.ok, true)
  await r.add({ productUomId: 'each', productUomQty: '3' })
  await r.save('sale.confirmOrder', { id: 'order' })
  const delivery = 'order:delivery'
  await r.save('stock.confirmPicking', { id: delivery })
  const deliveryMove = ((await r.call('stock.getPicking', { id: delivery })).moves as Row[])[0]!
  await r.save('stock.reserveMove', { id: deliveryMove.id })
  const deliver = () => r.call('stock.completePicking', { id: delivery, createBackorder: false })
  const createReturn = (returnId: string, id = delivery) => r.call('stock.createReturn', { id, returnId })
  const key = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.messageKey
  /** Receive `quantity` on a return and complete it without a backorder. */
  const receive = async (returnId: string, quantity: string) => {
    const move = ((await r.call('stock.getPicking', { id: returnId })).moves as Row[])[0]!
    await r.save('stock.saveMoveLine', { id: `${returnId}-line`, moveId: move.id, quantity })
    return r.call('stock.completePicking', { id: returnId, createBackorder: false })
  }
  const held = async () => {
    const [row] = await r.app.adapter!.all(sql(`SELECT quantity, value FROM stock_product_valuation`))
    return [String(Number(row!.quantity)), String(Number(row!.value))]
  }
  return { ...r, delivery, deliveryMove, deliver, createReturn, key, receive, held }
}

test('K19 a completed delivery returns as a confirmed receipt back to its source, once per unit', async (t) => {
  const r = await seed(t)
  assert.equal(r.key(await r.createReturn('early')), 'stock.error.returnNotDone')
  assert.equal((await r.deliver()).ok, true)
  const delivered = await r.call('stock.getPicking', { id: r.delivery })
  assert.equal(delivered.returnable, true)

  assert.deepEqual(await r.createReturn('back'), { ok: true, id: 'back' })
  const back = await r.call('stock.getPicking', { id: 'back' })
  assert.deepEqual(
    [back.state, back.pickingTypeId, back.locationId, back.locationDestId, back.partnerId],
    ['confirmed', 'wh:incoming', delivered.locationDestId, delivered.locationId, delivered.partnerId],
  )
  const move = (back.moves as Row[])[0]!
  assert.deepEqual(
    [move.productUomQty, move.originReturnedMoveId, move.saleLineId, move.locationDestId],
    ['3', r.deliveryMove.id, r.deliveryMove.saleLineId, 'wh:stock'],
  )
  // A replay answers the same return; an open return already claims every unit.
  assert.deepEqual(await r.createReturn('back'), { ok: true, id: 'back' })
  assert.equal(r.key(await r.createReturn('again')), 'stock.error.returnNothingLeft')
  assert.equal((await r.call('stock.getPicking', { id: r.delivery })).returnable, false)

  // Cancelling frees the units; a completed return claims only what it received.
  await r.save('stock.cancelPicking', { id: 'back' })
  assert.equal((await r.createReturn('partial')).ok, true)
  assert.equal((await r.receive('partial', '1')).ok, true)
  assert.equal((await r.createReturn('rest')).ok, true)
  const rest = await r.call('stock.getPicking', { id: 'rest' })
  assert.equal((rest.moves as Row[])[0]!.productUomQty, '2')

  // Each opens the other: the delivery lists its returns, a return names its delivery; both deal with the customer.
  const shipped = await r.call('stock.getPicking', { id: r.delivery })
  assert.equal(shipped.partnerRole, 'customer')
  assert.deepEqual(((shipped.related as Row).returns as Row[]).map((row) => row.id).sort(), [
    'back',
    'partial',
    'rest',
  ])
  assert.deepEqual(
    [rest.partnerRole, (rest.related as Row).returnOf, (rest.related as Row).returns],
    ['customer', { id: r.delivery, name: shipped.name }, []],
  )

  // Only deliveries return, and a return id cannot point at another transfer.
  assert.equal(r.key(await r.createReturn('of-a-return', 'partial')), 'stock.error.returnOnlyDelivery')
  assert.equal(r.key(await r.createReturn('opening:picking')), 'stock.error.returnIdTaken')
})

test('K19 returned goods come back at the delivered value and the sales line delivers less', async (t) => {
  const r = await seed(t)
  for (const [id, accountType, reconcile] of [
    ['156', 'asset_current', false],
    ['151', 'asset_current', false],
    ['1541', 'asset_current', false],
    ['632', 'expense_direct_cost', false],
    ['33811', 'liability_current', true],
    ['13811', 'asset_receivable', true],
  ] as const)
    await r.save('account.saveAccount', { id, code: id, name: id, accountType, reconcile })
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
  assert.equal((await r.deliver()).ok, true)
  assert.deepEqual(await r.held(), ['7', '7000'])
  // A dearer receipt moves the average to 17,000 / 12 before the customer sends one back.
  await r.save('stock.createPicking', { id: 'dear', name: 'dear', pickingTypeId: 'wh:incoming' })
  await r.save('stock.addMove', {
    id: 'dear-move',
    pickingId: 'dear',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '5',
  })
  await r.save('stock.confirmPicking', { id: 'dear' })
  await r.save('stock.saveMoveLine', { id: 'dear-line', moveId: 'dear-move', quantity: '5' })
  await r.save('stock.setReceiptUnitCost', { id: 'dear-line', unitCost: '2000' })
  assert.equal((await r.call('stock.completePicking', { id: 'dear', createBackorder: false })).ok, true)
  assert.deepEqual(await r.held(), ['12', '17000'])

  assert.equal((await r.createReturn('back')).ok, true)
  assert.equal((await r.receive('back', '1')).ok, true)
  assert.deepEqual(await r.held(), ['13', '18000'])
  const [layer] = await r.app.adapter!.all(
    sql(`SELECT kind, value, "unitCost" FROM stock_valuation_layer WHERE "pickingId" = ?`),
    ['back'],
  )
  assert.deepEqual([layer!.kind, Number(layer!.value), Number(layer!.unitCost)], ['return', 1000, 1000])
  const lines = await r.app.adapter!.all(
    sql(`SELECT "accountId", debit, credit FROM account_move_line WHERE "moveId" = ? ORDER BY sequence`),
    ['stock-valuation:back'],
  )
  assert.deepEqual(
    lines.map((row) => [row.accountId, Number(row.debit), Number(row.credit)]),
    [
      ['156', 1000, 0],
      ['632', 0, 1000],
    ],
  )
  await r.save('sale.syncDeliveries', { id: 'order' })
  const order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal((order.lines as Row[])[0]!.qtyDelivered, '2')
})

test('K25 a sales line costs what its goods took out and the rest at the average; a return moves the cost', async (t) => {
  const r = await seed(t)
  const cost = async () => {
    const [row] = (await r.call('sale.getLineCosts', { id: 'order' })) as unknown as Row[]
    return Number(row!.unitCost)
  }
  const catalogue = async () =>
    Number((await r.app.adapter!.all(sql(`SELECT "standardPrice" FROM product_cost`)))[0]!.standardPrice)
  // One of the three leaves at 1,000; the two left wait on a backorder.
  const picking = await r.call('stock.getPicking', { id: r.delivery })
  const moveLine = ((picking.moves as Row[])[0]!.lines as Row[])[0]!
  await r.save('stock.saveMoveLine', { id: moveLine.id, moveId: r.deliveryMove.id, quantity: '1' })
  assert.equal((await r.call('stock.completePicking', { id: r.delivery, createBackorder: true })).ok, true)
  assert.equal(await cost(), 1000)
  // A dearer receipt: 19,000 for 14, so the two still to deliver count at 1,357.
  await r.save('stock.createPicking', { id: 'dear', name: 'dear', pickingTypeId: 'wh:incoming' })
  await r.save('stock.addMove', {
    id: 'dear-move',
    pickingId: 'dear',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '5',
  })
  await r.save('stock.confirmPicking', { id: 'dear' })
  await r.save('stock.saveMoveLine', { id: 'dear-line', moveId: 'dear-move', quantity: '5' })
  await r.save('stock.setReceiptUnitCost', { id: 'dear-line', unitCost: '2000' })
  assert.equal((await r.call('stock.completePicking', { id: 'dear', createBackorder: false })).ok, true)
  assert.equal(await catalogue(), 1357)
  await r.save('sale.syncDeliveries', { id: 'order' })
  assert.equal(await cost(), 1238)
  // The backorder takes 2 × 19,000 ÷ 14 = 2,714: (1,000 + 2,714) ÷ 3 again.
  const [{ id: backorder }] = (await r.app.adapter!.all(
    sql(`SELECT id FROM stock_picking WHERE "backorderId" = ?`),
    [r.delivery],
  )) as Row[]
  const rest = ((await r.call('stock.getPicking', { id: backorder })).moves as Row[])[0]!
  await r.save('stock.reserveMove', { id: rest.id })
  assert.equal((await r.call('stock.completePicking', { id: backorder, createBackorder: false })).ok, true)
  assert.equal(await cost(), 1238)
  // One comes back at the 1,000 it left with: the average goes to 17,286 ÷ 13 and the catalogue cost
  // follows it, and the line counts that one at today's average: (2,714 + 1,330) ÷ 3.
  assert.equal((await r.createReturn('back')).ok, true)
  assert.equal((await r.receive('back', '1')).ok, true)
  assert.deepEqual(await r.held(), ['13', '17286'])
  assert.equal(await catalogue(), 1330)
  await r.save('sale.syncDeliveries', { id: 'order' })
  assert.equal(await cost(), 1348)
  // Selling one more on the grid keeps what left at its value: (2,714 + 2 × 1,330) ÷ 4.
  const order = await r.call('sale.getOrder', { id: 'order' })
  const grid = await r.call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: order.revision,
    changes: {
      added: [],
      removed: [],
      order: null,
      updated: [{ id: (order.lines as Row[])[0]!.id, values: { productUomQty: '4' } }],
    },
  })
  assert.equal(grid.ok, true)
  assert.equal(await cost(), 1344)
})

test('a transfer validated with nothing ticked goes as held; one holding nothing has nothing to complete', async (t) => {
  const r = await seed(t)
  // Nothing ticked as picked: the three held leave, as the mock does, with no backorder.
  assert.equal((await r.call('stock.validatePicking', { id: r.delivery })).ok, true)
  const done = await r.call('stock.getPicking', { id: r.delivery })
  assert.deepEqual([done.state, (done.moves as Row[])[0]!.quantity], ['done', '3'])
  assert.deepEqual(await r.held(), ['7', '7000'])
  assert.equal(
    (await r.app.adapter!.all(sql(`SELECT id FROM stock_picking WHERE "backorderId" = ?`), [r.delivery]))
      .length,
    0,
  )
  // A delivery nothing was held for is refused and stays as it was.
  await r.save('stock.createPicking', { id: 'idle', name: 'idle', pickingTypeId: 'wh:outgoing' })
  await r.save('stock.addMove', {
    id: 'idle-move',
    pickingId: 'idle',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '2',
  })
  await r.save('stock.confirmPicking', { id: 'idle' })
  assert.equal(r.key(await r.call('stock.validatePicking', { id: 'idle' })), 'stock.error.nothingDone')
  assert.equal((await r.call('stock.getPicking', { id: 'idle' })).state, 'confirmed')
})

test('K19 returning goods needs the right to create transfers, and the record offers it only then', async (t) => {
  const r = await seed(t)
  assert.equal((await r.deliver()).ok, true)
  await r.fixture('user.saveRole', { id: 'reader', name: 'Reader' })
  await r.fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'reader' })
  for (const fnKey of ['stock.listPickings', 'stock.getPicking'])
    await r.fixture('user.grantFunction', { id: fnKey, roleId: 'reader', fnKey })
  const reader = r.app.client.anonymous()
  await reader.login({ login: 'reader', password: 'test-password' })
  const refused = await reader.request('/_ket/fn/stock.createReturn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: r.delivery, returnId: 'sneaky' }),
  })
  assert.equal(refused.status, 403)
  const context = async (client: typeof reader) =>
    (await (await client.request(`/admin/stock/transfer/${r.delivery}/context?lang=en`)).json()).data
  assert.equal((await context(reader)).permissions.createReturn, false)
  const owner = await context(r.app.client)
  assert.equal(owner.permissions.createReturn, true)
  assert.equal(owner.record.returnable, true)
  // The return's page opens the delivery in the reader's language, company and branch.
  assert.equal((await r.createReturn('back')).ok, true)
  const back = (await (await r.app.client.request('/admin/stock/transfer/back/context?lang=en')).json()).data
  assert.deepEqual(back.related.returnOf, {
    id: r.delivery,
    name: owner.record.name,
    href: `/admin/stock/transfers/${encodeURIComponent(r.delivery)}?lang=en`,
  })
  assert.deepEqual(
    (await context(r.app.client)).related.returns.map((row: Row) => row.href),
    ['/admin/stock/transfers/back?lang=en'],
  )
})
