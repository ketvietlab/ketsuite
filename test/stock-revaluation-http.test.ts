import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('product.setCost', { productId: r.productId, standardPrice: '1000' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor' })
  const transfer = async (
    id: string,
    type: 'incoming' | 'outgoing',
    quantity: string,
    partnerId?: string,
  ) => {
    await r.save('stock.createPicking', { id, name: id, pickingTypeId: `wh:${type}` })
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
  /** A completed receipt of two at 1500 from the vendor. */
  const receive = async (id = 'receipt') => {
    const line = await transfer(id, 'incoming', '2', 'vendor')
    await r.save('stock.setReceiptUnitCost', { id: line, unitCost: '1500' })
    assert.equal((await complete(id)).ok, true)
  }
  const held = async () => {
    const rows = await r.app.adapter!.all(sql(`SELECT quantity, value FROM stock_product_valuation`))
    return rows.length ? [String(Number(rows[0]!.quantity)), String(Number(rows[0]!.value))] : null
  }
  const catalogueCost = async () =>
    Number((await r.app.adapter!.all(sql(`SELECT "standardPrice" FROM product_cost`)))[0]!.standardPrice)
  const revalue = (args: Row) =>
    r.call('stock.revaluePicking', {
      id: 'receipt',
      revaluationId: 'adjust',
      moveId: 'receipt-move',
      amount: '600',
      account: 'supplier',
      reason: 'Vendor corrected the price',
      ...args,
    })
  const refusal = async (args: Row) => ((await revalue(args)).errors as Row[] | undefined)?.[0]
  const rows = async (table: string, where = '') =>
    (await r.app.adapter!.all(sql(`SELECT * FROM ${table} ${where}`))).length
  return { ...r, transfer, complete, receive, held, catalogueCost, revalue, refusal, rows }
}

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
  await r.save('stock.saveAccountingSetting', {
    journalId: 'kho',
    valuationAccountId: '156',
    supplierAccountId: '151',
    productionAccountId: '1541',
    cogsAccountId: '632',
    gainAccountId: '33811',
    lossAccountId: '13811',
  })
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

test('K63 raising a received line moves the value held, the average cost and posts goods against the vendor, once', async (t) => {
  const r = await seed(t)
  await books(r)
  await r.receive()
  assert.deepEqual(await r.held(), ['2', '3000'])
  assert.equal((await r.revalue({})).ok, true)
  assert.deepEqual(await r.held(), ['2', '3600'])
  // New sales lines price from the adjusted average.
  assert.equal(await r.catalogueCost(), 1800)
  const [entry] = await r.app.adapter!.all(
    `SELECT name, state, "journalId", "sourceModule", ref FROM account_move WHERE id = 'stock-revaluation:adjust'`,
  )
  assert.deepEqual(
    { ...entry },
    { name: 'KHO/2030/00002', state: 'posted', journalId: 'kho', sourceModule: 'stock', ref: 'receipt' },
  )
  assert.deepEqual(await entryLines(r, 'stock-revaluation:adjust'), [
    ['156', 600, 0, 'vendor'],
    ['151', 0, 600, 'vendor'],
  ])
  // The receipt keeps what it was received at, and lists the adjustment beside it.
  const valued = await r.call('stock.getPickingValuation', { id: 'receipt' })
  assert.equal(valued.total, '3000')
  assert.equal(valued.accountMoveName, 'KHO/2030/00001')
  assert.deepEqual(
    (valued.revaluations as Row[]).map((row) => [
      row.product,
      row.amount,
      row.account,
      row.reason,
      row.accountMoveName,
    ]),
    [['[GOODS] Goods', '600', 'supplier', 'Vendor corrected the price', 'KHO/2030/00002']],
  )
  assert.deepEqual(valued.revaluable, [{ moveId: 'receipt-move', label: '[GOODS] Goods' }])
  // A retried post of the same adjustment writes nothing more, also as the record page posts it, keyed.
  assert.deepEqual(await r.revalue({}), { ok: true, id: 'adjust' })
  const keyed = await r.app.client.request('/_ket/fn/stock.revaluePicking?lang=vi', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'record-post-1' },
    body: JSON.stringify({
      id: 'receipt',
      revaluationId: 'adjust',
      moveId: 'receipt-move',
      amount: '600',
      account: 'supplier',
      reason: 'Vendor corrected the price',
    }),
  })
  assert.equal(keyed.status, 200)
  assert.deepEqual(await r.held(), ['2', '3600'])
  assert.equal(await r.rows('stock_valuation_layer', `WHERE kind = 'revaluation'`), 1)
  // Accounting cannot reverse what stock owns.
  const reversed = await r.call('account.reverseMove', { id: 'stock-revaluation:adjust', reversalId: 'undo' })
  assert.equal(((reversed.errors as Row[])[0] as Row).code, 'account.error.moveSourceOwned')
})

test('K63 lowering takes value off what is still held, never below nought, against the cost of sales', async (t) => {
  const r = await seed(t)
  await books(r)
  await r.receive()
  await r.transfer('out', 'outgoing', '1')
  assert.equal((await r.complete('out')).ok, true)
  assert.deepEqual(await r.held(), ['1', '1500'])
  assert.deepEqual(await r.refusal({ revaluationId: 'too-much', amount: '-2000', account: 'cogs' }), {
    field: 'amount',
    messageKey: 'stock.error.revaluationBelowZero',
  })
  assert.deepEqual(await r.held(), ['1', '1500'])
  assert.equal((await r.revalue({ revaluationId: 'lower', amount: '-300', account: 'cogs' })).ok, true)
  assert.deepEqual(await r.held(), ['1', '1200'])
  assert.equal(await r.catalogueCost(), 1200)
  assert.deepEqual(await entryLines(r, 'stock-revaluation:lower'), [
    ['632', 300, 0, 'vendor'],
    ['156', 0, 300, 'vendor'],
  ])
  // Surplus and shortage take the other side of a raise or a cut the same way.
  assert.equal((await r.revalue({ revaluationId: 'surplus', amount: '50', account: 'gain' })).ok, true)
  assert.deepEqual(await entryLines(r, 'stock-revaluation:surplus'), [
    ['156', 50, 0, 'vendor'],
    ['33811', 0, 50, 'vendor'],
  ])
  assert.equal((await r.revalue({ revaluationId: 'short', amount: '-1250', account: 'loss' })).ok, true)
  assert.deepEqual(await entryLines(r, 'stock-revaluation:short'), [
    ['13811', 1250, 0, 'vendor'],
    ['156', 0, 1250, 'vendor'],
  ])
  assert.deepEqual(await r.held(), ['1', '0'])
})

test('K63 only a valued line of a completed receipt takes an adjustment, with a whole amount, an account and a reason', async (t) => {
  const r = await seed(t)
  await r.transfer('open', 'incoming', '1')
  assert.deepEqual(await r.refusal({ id: 'open', moveId: 'open-move' }), {
    field: 'id',
    messageKey: 'stock.error.revaluationReceiptOnly',
  })
  await r.receive()
  assert.equal((await r.refusal({ revaluationId: ' ' }))!.messageKey, 'stock.error.revaluationReceiptOnly')
  await r.transfer('out', 'outgoing', '1')
  assert.equal((await r.complete('out')).ok, true)
  // A delivery took value out; it is no receipt line.
  for (const args of [{ id: 'out', moveId: 'out-move' }, { moveId: 'out-move' }, { moveId: 'nope' }])
    assert.deepEqual(await r.refusal(args), {
      field: 'moveId',
      messageKey: 'stock.error.revaluationReceiptOnly',
    })
  for (const amount of ['0', '-0', 'abc', '1.5', '1e3', '', '1234567890123456'])
    assert.deepEqual(
      await r.refusal({ amount }),
      {
        field: 'amount',
        messageKey: 'stock.error.revaluationAmountInvalid',
      },
      amount,
    )
  assert.deepEqual(await r.refusal({ account: 'bank' }), {
    field: 'account',
    messageKey: 'stock.error.revaluationAccountInvalid',
  })
  assert.deepEqual(await r.refusal({ reason: '  ' }), {
    field: 'reason',
    messageKey: 'stock.error.revaluationReasonRequired',
  })
  // Once the goods have all gone there is nothing held to carry the adjustment.
  await r.transfer('rest', 'outgoing', '1')
  assert.equal((await r.complete('rest')).ok, true)
  assert.deepEqual(await r.refusal({}), { field: 'moveId', messageKey: 'stock.error.revaluationNothingHeld' })
  assert.equal(await r.rows('stock_revaluation'), 0)
  assert.equal(await r.rows('stock_valuation_layer', `WHERE kind = 'revaluation'`), 0)
})

test('K63 a locked period refuses the adjustment and leaves value, cost and records as they were', async (t) => {
  const r = await seed(t)
  await books(r)
  await r.receive()
  await r.save('account.changePeriodLock', {
    id: 'close-january',
    scope: 'all',
    through: '2030-01-31',
    reason: 'Close',
  })
  assert.equal((await r.refusal({}))!.messageKey, 'stock.error.valuationPeriodLocked')
  assert.deepEqual(await r.held(), ['2', '3000'])
  assert.equal(await r.catalogueCost(), 1500)
  assert.equal(await r.rows('stock_revaluation'), 0)
  assert.equal(await r.rows('stock_valuation_layer', `WHERE kind = 'revaluation'`), 0)
  assert.equal(await r.rows('account_move', `WHERE id = 'stock-revaluation:adjust'`), 0)
})

test('K63 without stock accounting the adjustment still moves the value held, with no entry', async (t) => {
  const r = await seed(t)
  await r.receive()
  assert.equal((await r.revalue({ account: 'gain' })).ok, true)
  assert.deepEqual(await r.held(), ['2', '3600'])
  const [row] = await r.app.adapter!.all(
    sql(`SELECT amount, account, "accountMoveId" FROM stock_revaluation`),
  )
  assert.deepEqual([Number(row!.amount), row!.account, row!.accountMoveId ?? null], [600, 'gain', null])
  assert.equal(await r.rows('account_move'), 0)
})

test('K63 accountants adjust a receipt value; storekeepers and sales do not, and the record offers it only then', async (t) => {
  const r = await seed(t)
  await r.receive()
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const login = async (roleId: string) => {
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
  const statuses = {
    'commerce.accountant': 200,
    'commerce.warehouse-manager': 403,
    'commerce.warehouse-operator': 403,
    'commerce.sales-representative': 403,
  }
  for (const [roleId, expected] of Object.entries(statuses)) {
    const client = await login(roleId)
    const response = await client.request('/_ket/fn/stock.revaluePicking', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'receipt',
        revaluationId: roleId,
        moveId: 'receipt-move',
        amount: '10',
        account: 'supplier',
        reason: 'Price',
      }),
    })
    assert.equal(response.status, expected, roleId)
    const context = await client.request('/admin/stock/transfer/receipt/context?lang=en')
    if (context.status !== 200) continue
    const data = (await context.json()).data
    assert.equal(Boolean(data.permissions.revaluePicking), expected === 200, roleId)
    if (expected === 200) {
      assert.deepEqual(data.choices.revaluable, [{ id: 'receipt-move', name: '[GOODS] Goods' }])
      assert.equal(data.valuation.revaluations.length, 1)
    }
  }
  assert.deepEqual(await r.held(), ['2', '3010'])
})
