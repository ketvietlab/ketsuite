import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

async function seed(t: TestContext, cost: string | null = '1000') {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  if (cost) await r.save('product.setCost', { productId: r.productId, standardPrice: cost })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor' })
  const transfer = async (
    id: string,
    type: 'incoming' | 'outgoing',
    quantity: string,
    partnerId?: string,
  ) => {
    await r.save('stock.createPicking', { id, name: id, pickingTypeId: `wh:${type}` })
    // Sales and purchases name the partner on their transfers; stock has no command for it.
    if (partnerId)
      await r.app.adapter!.run(sql(`UPDATE stock_picking SET "partnerId" = ? WHERE id = ?`), [partnerId, id])
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: quantity,
    })
    await r.save('stock.confirmPicking', { id })
    if (type === 'incoming')
      await r.save('stock.saveMoveLine', { id: `${id}-line`, moveId: `${id}-move`, quantity })
    else await r.save('stock.reserveMove', { id: `${id}-move` })
    const picking = await r.call('stock.getPicking', { id })
    return String(((picking.moves as Row[])[0]!.lines as Row[])[0]!.id)
  }
  const complete = (id: string) => r.call('stock.completePicking', { id, createBackorder: false })
  const held = async () => {
    const rows = await r.app.adapter!.all(sql(`SELECT quantity, value FROM stock_product_valuation`))
    return rows.length ? [String(Number(rows[0]!.quantity)), String(Number(rows[0]!.value))] : null
  }
  const catalogueCost = async () =>
    Number((await r.app.adapter!.all(sql(`SELECT "standardPrice" FROM product_cost`)))[0]!.standardPrice)
  const count = (id: string, countedQuantity: string) =>
    r.call('stock.adjustInventory', {
      id,
      productId: r.productId,
      locationId: 'wh:stock',
      inventoryLocationId: 'count',
      countedQuantity,
      productUomId: 'each',
    })
  return { ...r, transfer, complete, held, catalogueCost, count }
}

test('K22 one company average: counts and receipts add value, issues take their share and the last units take the rest', async (t) => {
  const r = await seed(t)
  assert.equal((await r.count('opening', '4')).ok, true)
  assert.deepEqual(await r.held(), ['4', '4000'])
  const line = await r.transfer('receipt', 'incoming', '6')
  assert.equal((await r.call('stock.setReceiptUnitCost', { id: line, unitCost: '1500' })).ok, true)
  assert.equal((await r.complete('receipt')).ok, true)
  assert.deepEqual(await r.held(), ['10', '13000'])
  // New sales lines price from the average the receipt produced.
  assert.equal(await r.catalogueCost(), 1300)
  await r.transfer('first-out', 'outgoing', '3')
  assert.equal((await r.complete('first-out')).ok, true)
  assert.deepEqual(await r.held(), ['7', '9100'])
  const valued = await r.call('stock.getPickingValuation', { id: 'first-out' })
  assert.equal(valued.total, '3900')
  assert.deepEqual(
    (valued.lines as Row[]).map((row) => [row.kind, row.quantity, row.value]),
    [['delivery', '3', '3900']],
  )
  const listed = await r.call('stock.listValuation', {})
  assert.deepEqual(
    (listed.rows as Row[]).map((row) => [row.quantity, row.averageCost, row.value]),
    [['7', '1300', '9100']],
  )
  assert.equal(listed.totalValue, '9100')
  await r.transfer('last-out', 'outgoing', '7')
  assert.equal((await r.complete('last-out')).ok, true)
  assert.deepEqual(await r.held(), ['0', '0'])
  assert.equal((await r.call('stock.getPickingValuation', { id: 'last-out' })).total, '9100')
  assert.equal(((await r.call('stock.listValuation', {})).rows as Row[]).length, 0)
})

test('K22 rounded shares leave no remainder on the goods value', async (t) => {
  const r = await seed(t, null)
  const line = await r.transfer('receipt', 'incoming', '3')
  assert.equal((await r.call('stock.setReceiptUnitCost', { id: line, unitCost: '333.34' })).ok, true)
  assert.equal((await r.complete('receipt')).ok, true)
  assert.deepEqual(await r.held(), ['3', '1000'])
  const shares: unknown[] = []
  // Two of three units take two thirds of the value (667), not twice the rounded average (666).
  for (const [id, quantity] of [
    ['a', '2'],
    ['b', '1'],
  ]) {
    await r.transfer(id!, 'outgoing', quantity!)
    assert.equal((await r.complete(id!)).ok, true)
    shares.push((await r.call('stock.getPickingValuation', { id })).total)
  }
  assert.deepEqual(shares, ['667', '333'])
  assert.deepEqual(await r.held(), ['0', '0'])
})

test('K22 stock held before valuation opens at its catalogue cost, and a blank receipt price takes the average', async (t) => {
  const r = await seed(t, '2000')
  assert.equal((await r.count('opening', '5')).ok, true)
  // Stock counted before valuation existed carries no running value yet.
  await r.app.adapter!.run(sql(`DELETE FROM stock_valuation_layer`))
  await r.app.adapter!.run(sql(`DELETE FROM stock_product_valuation`))
  const before = await r.call('stock.listValuation', {})
  assert.deepEqual(
    (before.rows as Row[]).map((row) => [row.quantity, row.averageCost, row.value]),
    [['5', '2000', '10000']],
  )
  await r.transfer('blank-receipt', 'incoming', '5')
  assert.equal((await r.complete('blank-receipt')).ok, true)
  assert.deepEqual(await r.held(), ['10', '20000'])
  await r.transfer('out', 'outgoing', '2')
  assert.equal((await r.complete('out')).ok, true)
  assert.equal((await r.call('stock.getPickingValuation', { id: 'out' })).total, '4000')
  // A shortfall is valued at the average and leaves 156 against the shortage account.
  assert.equal((await r.count('short', '7')).ok, true)
  assert.deepEqual(await r.held(), ['7', '14000'])
})

async function books(r: Awaited<ReturnType<typeof seed>>) {
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
  await r.save('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' })
  return {
    journalId: 'kho',
    valuationAccountId: '156',
    supplierAccountId: '151',
    productionAccountId: '1541',
    cogsAccountId: '632',
    gainAccountId: '33811',
    lossAccountId: '13811',
  }
}

const entryLines = async (r: Awaited<ReturnType<typeof seed>>, moveId: string) =>
  (
    await r.app.adapter!.all(
      sql(
        `SELECT "accountId", debit, credit, "partnerId" FROM account_move_line WHERE "moveId" = ? ORDER BY sequence`,
      ),
      [moveId],
    )
  ).map((row) => [row.accountId, Number(row.debit), Number(row.credit), row.partnerId ?? null])

test('K23 completed receipts and deliveries post one stock-journal entry that accounting cannot reverse', async (t) => {
  const r = await seed(t)
  const setting = await books(r)
  assert.deepEqual(
    ((await r.call('stock.saveAccountingSetting', { ...setting, cogsAccountId: null })).errors as Row[])[0],
    { field: 'cogsAccountId', messageKey: 'stock.error.valuationAccountMissing' },
  )
  assert.equal(
    ((await r.call('stock.saveAccountingSetting', { ...setting, journalId: 'sales' })).errors as Row[])[0]!
      .messageKey,
    'stock.error.valuationJournalInvalid',
  )
  await r.save('stock.saveAccountingSetting', setting)
  const line = await r.transfer('receipt', 'incoming', '2', 'vendor')
  await r.save('stock.setReceiptUnitCost', { id: line, unitCost: '1500' })
  assert.equal((await r.complete('receipt')).ok, true)
  const [receiptEntry] = await r.app.adapter!.all(
    `SELECT name, state, "journalId", "sourceModule", ref FROM account_move WHERE id = 'stock-valuation:receipt'`,
  )
  assert.deepEqual(
    { ...receiptEntry },
    { name: 'KHO/2030/00001', state: 'posted', journalId: 'kho', sourceModule: 'stock', ref: 'receipt' },
  )
  assert.deepEqual(await entryLines(r, 'stock-valuation:receipt'), [
    ['156', 3000, 0, 'vendor'],
    ['151', 0, 3000, 'vendor'],
  ])
  await r.transfer('out', 'outgoing', '1')
  assert.equal((await r.complete('out')).ok, true)
  assert.deepEqual(await entryLines(r, 'stock-valuation:out'), [
    ['632', 1500, 0, null],
    ['156', 0, 1500, null],
  ])
  const valued = await r.call('stock.getPickingValuation', { id: 'out' })
  assert.equal(valued.accountMoveName, 'KHO/2030/00002')
  const reversed = await r.call('account.reverseMove', { id: 'stock-valuation:out', reversalId: 'undo' })
  assert.equal(((reversed.errors as Row[])[0] as Row).code, 'account.error.moveSourceOwned')
  // Nor does the entry page offer it.
  const entry = await r.app.client.request('/admin/accounting/entries/stock-valuation%3Aout?lang=en')
  assert.equal(entry.status, 200)
  const page = await entry.text()
  assert.match(page, /KHO\/2030\/00002/)
  assert.doesNotMatch(page, /name="action" value="reverse"/)
  // It opens the transfer it came from (K25), for whoever may read transfers.
  assert.match(page, /From stock transfer/)
  assert.match(page, /href="\/admin\/stock\/transfers\/out\?lang=en"/)
  assert.equal((await r.app.adapter!.all(sql(`SELECT id FROM account_move WHERE id = 'undo'`))).length, 0)
  await r.fixture('user.saveRole', { id: 'ledger', name: 'Ledger' })
  await r.fixture('user.createUser', {
    id: 'ledger',
    login: 'ledger',
    password: 'test-password',
    name: 'Ledger',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'ledger-company', userId: 'ledger', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'ledger-role', userId: 'ledger', roleId: 'ledger' })
  for (const fnKey of ['account.getMove', 'account.listAccounts'])
    await r.fixture('user.grantFunction', { id: fnKey, roleId: 'ledger', fnKey })
  const ledger = r.app.client.anonymous()
  await ledger.login({ login: 'ledger', password: 'test-password' })
  const read = await ledger.request('/admin/accounting/entries/stock-valuation%3Aout?lang=en')
  assert.equal(read.status, 200)
  const theirs = await read.text()
  assert.match(theirs, /KHO\/2030\/00002/)
  assert.doesNotMatch(theirs, /From stock transfer/)
})

test('K23 a locked period refuses completion and rolls back stock, value and entry', async (t) => {
  const r = await seed(t)
  await r.save('stock.saveAccountingSetting', await books(r))
  assert.equal((await r.count('opening', '4')).ok, true)
  await r.transfer('out', 'outgoing', '1')
  await r.save('account.changePeriodLock', {
    id: 'close-january',
    scope: 'all',
    through: '2030-01-31',
    reason: 'Close',
  })
  const refused = await r.complete('out')
  assert.equal(((refused.errors as Row[])[0] as Row).messageKey, 'stock.error.valuationPeriodLocked')
  assert.notEqual((await r.call('stock.getPicking', { id: 'out' })).state, 'done')
  assert.deepEqual(await r.held(), ['4', '4000'])
  const quants = await r.app.adapter!.all(
    sql(`SELECT quantity FROM stock_quant WHERE "locationId" = 'wh:stock'`),
  )
  assert.equal(Number(quants[0]!.quantity), 4)
  assert.equal(
    (await r.app.adapter!.all(sql(`SELECT id FROM account_move WHERE id = 'stock-valuation:out'`))).length,
    0,
  )
})

test('K24 only open supplier or production receipt lines take a non-negative unit cost', async (t) => {
  const r = await seed(t)
  assert.equal((await r.count('opening', '4')).ok, true)
  const outgoing = await r.transfer('out', 'outgoing', '1')
  const key = async (args: Row) =>
    (((await r.call('stock.setReceiptUnitCost', args)).errors as Row[])[0] as Row).messageKey
  assert.equal(await key({ id: outgoing, unitCost: '10' }), 'stock.error.receiptUnitCostOnly')
  // A transfer between owned warehouses moves value at the average; it takes no price either.
  await r.save('stock.saveWarehouse', { id: 'east', name: 'East', code: 'EA' })
  await r.save('stock.createPicking', {
    id: 'to-east',
    name: 'to-east',
    pickingTypeId: 'wh:outgoing',
    locationDestId: 'east:stock',
  })
  await r.save('stock.addMove', {
    id: 'to-east-move',
    pickingId: 'to-east',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '1',
  })
  await r.save('stock.confirmPicking', { id: 'to-east' })
  await r.save('stock.reserveMove', { id: 'to-east-move' })
  const internal = (await r.call('stock.getPicking', { id: 'to-east' })) as Row
  const internalLine = String(((internal.moves as Row[])[0]!.lines as Row[])[0]!.id)
  assert.equal(await key({ id: internalLine, unitCost: '10' }), 'stock.error.receiptUnitCostOnly')
  const line = await r.transfer('receipt', 'incoming', '1')
  assert.equal(await key({ id: line, unitCost: '-1' }), 'stock.error.receiptUnitCostInvalid')
  assert.equal(await key({ id: line, unitCost: '1e3' }), 'stock.error.receiptUnitCostInvalid')
  assert.equal(
    (await r.call('stock.setReceiptUnitCost', { id: line, unitCost: '1200.50' })).unitCost,
    '1200.5',
  )
  // The warehouse's own reads never carry a price (K25).
  for (const read of [
    await r.call('stock.getPicking', { id: 'receipt' }),
    await r.call('stock.getPickingView', { id: 'receipt' }),
  ])
    assert.doesNotMatch(JSON.stringify(read), /unitCost|priceUnit|1200/)
  assert.equal((await r.call('stock.setReceiptUnitCost', { id: line, unitCost: '' })).unitCost, null)
  assert.equal((await r.complete('receipt')).ok, true)
  assert.equal(await key({ id: line, unitCost: '10' }), 'stock.error.receiptUnitCostOnly')
  // Blank, so the receipt took the average held when it completed.
  assert.equal((await r.call('stock.getPickingValuation', { id: 'receipt' })).total, '1000')
})

test('K24 the unit cost of a line not yet received follows its quantity to the backorder', async (t) => {
  const r = await seed(t)
  const line = await r.transfer('split', 'incoming', '2', 'vendor')
  await r.save('stock.setReceiptUnitCost', { id: line, unitCost: '1500' })
  // Completing only what was picked receives nothing and leaves both units for later.
  const first = await r.call('stock.completePicking', {
    id: 'split',
    createBackorder: true,
    pickedOnly: true,
  })
  assert.equal(first.ok, true)
  assert.deepEqual(await r.held(), ['0', '0'])
  const backorder = await r.call('stock.getPicking', { id: first.backorderId })
  const move = (backorder.moves as Row[])[0]!
  await r.save('stock.saveMoveLine', { id: 'split-rest', moveId: move.id, quantity: '2' })
  assert.equal((await r.complete(String(first.backorderId))).ok, true)
  assert.deepEqual(await r.held(), ['2', '3000'])
})

test('K24 a purchase receipt is valued at the agreed net price per stock unit and its bill clears the receipt account', async (t) => {
  const r = await seed(t)
  const setting = await books(r)
  await r.save('stock.saveAccountingSetting', setting)
  await r.save('partner.grantRole', { id: 'vendor-role', partnerId: 'vendor', role: 'supplier' })
  await r.save('purchase.createOrder', { id: 'po', partnerId: 'vendor', pickingTypeId: 'wh:incoming' })
  await r.save('purchase.addLine', {
    id: 'po:line',
    orderId: 'po',
    productId: r.productId,
    productQty: '2',
    productUomId: 'box',
    priceUnit: '1300',
    discount: '10',
  })
  await r.save('purchase.confirmOrder', { id: 'po' })
  const [move] = await r.app.adapter!.all(
    sql(`SELECT id, "pickingId", "priceUnit" FROM stock_move WHERE "purchaseLineId" = 'po:line'`),
  )
  // 2 boxes × 1300 less 10% = 2340 for 24 pieces.
  assert.equal(Number(move!.priceUnit), 97.5)
  await r.save('stock.saveMoveLine', { id: 'po-line', moveId: move!.id, quantity: '24' })
  assert.equal((await r.complete(String(move!.pickingId))).ok, true)
  assert.equal((await r.call('stock.getPickingValuation', { id: move!.pickingId })).total, '2340')
  assert.equal(await r.catalogueCost(), 98)
  for (const [id, accountType] of [
    ['3311', 'liability_payable'],
    ['642', 'expense'],
  ] as const)
    await r.save('account.saveAccount', { id, code: id, name: id, accountType, reconcile: id === '3311' })
  await r.save('account.saveJournal', { id: 'purchases', name: 'Purchases', code: 'PUR', type: 'purchase' })
  const bill = await r.call('purchase.createVendorBill', {
    id: 'bill',
    orderId: 'po',
    journalId: 'purchases',
    expenseAccountId: '151',
    payableAccountId: '3311',
  })
  assert.notEqual(bill.ok, false, JSON.stringify(bill))
  // Without stock posting the clearing account is not an expense account and stays refused.
  await r.save('stock.saveAccountingSetting', { ...setting, journalId: null })
  const refused = await r.call('purchase.createVendorBill', {
    id: 'bill-2',
    orderId: 'po',
    journalId: 'purchases',
    expenseAccountId: '151',
    payableAccountId: '3311',
  })
  assert.equal(((refused.errors as Row[])[0] as Row).field, 'expenseAccountId')
})

test('K25 K26 the stock value screen reads one paged answer, by warehouse, and stays locked without the right', async (t) => {
  const r = await seed(t)
  assert.equal((await r.count('opening', '4')).ok, true)
  await r.save('stock.saveWarehouse', { id: 'east', name: 'East', code: 'EA' })
  const east = await r.call('stock.adjustInventory', {
    id: 'east-opening',
    productId: r.productId,
    locationId: 'east:stock',
    inventoryLocationId: 'count',
    countedQuantity: '1',
    productUomId: 'each',
  })
  assert.equal(east.ok, true)
  const read = async (href: string, client = r.app.client) => {
    const response = await client.request('/admin/stock/valuation/data?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ href }),
    })
    return { status: response.status, value: response.status === 200 ? (await response.json()).value : null }
  }
  const all = (await read('/admin/stock/valuation?lang=en')).value
  assert.deepEqual(
    all.rows.map((row: Row) => [row.name, row.quantityText, row.averageCostText, row.valueText]),
    [['Goods', '5', '₫1,000', '₫5,000']],
  )
  assert.equal(all.totalText, '₫5,000')
  assert.deepEqual(all.warehouses.map((row: Row) => `${row.id}:${row.active}`).sort(), [
    ':true',
    'east:false',
    'wh:false',
  ])
  const wh = all.warehouses.find((row: Row) => row.id === 'wh')
  const inWarehouse = (await read(wh.href)).value
  assert.equal(inWarehouse.query.warehouse, 'wh')
  // A warehouse shows its own quantity and its share of the company value.
  assert.deepEqual(
    inWarehouse.rows.map((row: Row) => [row.quantityText, row.valueText]),
    [['4', '₫4,000']],
  )
  assert.equal(inWarehouse.totalText, '₫4,000')
  const none = (await read('/admin/stock/valuation?q=missing')).value
  assert.deepEqual([none.total, none.totalText, none.isEmpty], [0, '₫0', false])
  const page = await r.app.client.request('/admin/stock/valuation?lang=en')
  assert.equal(page.status, 200)
  const markup = await page.text()
  assert.match(markup, /stock\.valuation-results/)
  assert.match(markup, /stock-valuation-help/)
  assert.doesNotMatch(markup, /4,000/)

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
  assert.equal((await read('/admin/stock/valuation', keeper)).status, 403)
  const locked = await keeper.request('/admin/stock/valuation?lang=en')
  assert.equal(locked.status, 403)
  assert.match(await locked.text(), /Your role cannot see stock value/)
  const context = async (client: typeof keeper) =>
    (await (await client.request('/admin/stock/transfer/opening:picking/context?lang=en')).json()).data
  assert.equal((await context(r.app.client)).valuation.total, '4000')
  assert.equal((await context(keeper)).valuation, null)
  const denied = await keeper.request('/_ket/fn/stock.getPickingValuation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'opening:picking' }),
  })
  assert.equal(denied.status, 403)
})

test('K25 the commerce job roles: managers, accountants and auditors read stock value, storekeepers do not', async (t) => {
  const r = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const status = async (roleId: string, fn: string, args: Row) => {
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
    const response = await client.request(`/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })
    return response.status
  }
  const reads = {
    'commerce.warehouse-manager': 200,
    'commerce.accountant': 200,
    'commerce.tenant-auditor': 200,
    'commerce.warehouse-operator': 403,
    'commerce.sales-representative': 403,
  }
  for (const [roleId, expected] of Object.entries(reads))
    assert.equal(await status(roleId, 'stock.listValuation', {}), expected, roleId)
})

test('K23 the stock accounting page saves the journal and accounts, and keeps a refused draft', async (t) => {
  const r = await seed(t)
  const setting = await books(r)
  const page = await r.app.client.request('/admin/stock/accounting?lang=en')
  assert.equal(page.status, 200)
  const markup = await page.text()
  assert.match(markup, /stock-accounting-help/)
  assert.match(markup, /name="journalId"/)
  assert.match(markup, /KHO · Kho/)
  const post = (body: Record<string, string>) =>
    r.app.client.request('/admin/stock/accounting?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      redirect: 'manual',
    })
  const refused = await post({ ...setting, cogsAccountId: '' })
  assert.equal(refused.status, 422)
  const again = await refused.text()
  assert.match(again, /Stock accounting is missing an account/)
  // The refused picker names the error the form prints under it.
  const errorId = again.match(/aria-describedby="([^"]*cogsAccountId-error)"/)?.[1]
  assert.ok(errorId)
  assert.match(again, new RegExp(`data-ui="form-error" id="${errorId}"`))
  assert.match(again, /value="kho"/)
  assert.equal((await r.call('stock.getAccountingSetting', {})).journalId, null)
  const saved = await post(setting)
  assert.equal(saved.status, 303)
  assert.match(String(saved.headers.get('location')), /\/admin\/stock\/accounting\?.*saved=1/)
  assert.equal((await r.call('stock.getAccountingSetting', {})).cogsAccountId, '632')
})
