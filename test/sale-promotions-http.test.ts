import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, type Row, type Route, type ServeContext } from '@ketvietlab/ketjs'
import { orderWorkflowFunction } from '../packages/ketsuite/src/modules/sale_backend/record/workflow.ts'
import sale from '../packages/ketsuite/src/modules/sale/index.ts'
import { saleWithLoyalty } from '../packages/ketsuite/src/modules/loyalty_sale/sale-with-loyalty.ts'
import { functions as loyaltySaleFunctions } from '../packages/ketsuite/src/modules/loyalty_sale/functions/index.ts'
import { setup } from './fixtures/sale/commerce.ts'

async function prepared(t: TestContext, future = false) {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  await r.save('loyalty.program.save', {
    id: 'program',
    name: 'Commerce reward',
    programType: 'loyalty',
    currency: 'VND',
    appliesOn: future ? 'future' : 'current',
    trigger: 'auto',
    availableSale: true,
    availablePos: false,
  })
  await r.save('loyalty.rule.save', {
    id: 'rule',
    programId: 'program',
    pointAmount: '5',
    pointMode: 'order',
    minimumQuantity: '1',
    minimumAmount: '0',
    taxMode: 'excl',
    mode: 'auto',
  })
  await r.save('loyalty.reward.save', {
    id: 'reward',
    programId: 'program',
    description: 'Commerce benefit',
    rewardType: 'discount',
    discount: '10',
    discountMode: 'percent',
    discountApplicability: 'order',
    requiredPoints: '5',
  })
  const order = () => r.call('sale.getOrder', { id: 'order' })
  const apply = async () =>
    r.call('loyalty_sale.applyReward', {
      orderId: 'order',
      programId: 'program',
      rewardId: 'reward',
      expectedRevision: (await order()).revision,
    })
  return { ...r, order, apply }
}

for (const endpoint of ['sale.confirmOrder', 'loyalty_sale.confirmOrder']) {
  test(`D31b ${endpoint} rolls back order, lifecycle and picking when an applied program is no longer eligible`, async (t) => {
    const r = await prepared(t)
    assert.equal((await r.apply()).ok, true)
    const before = await r.order()
    await r.app.adapter!.exec(`UPDATE loyalty_program SET active = FALSE WHERE id = 'program'`)
    const refused = await r.call(endpoint, { id: 'order', expectedRevision: before.revision })
    assert.equal(refused.ok, false)
    assert.deepEqual(await r.order(), before)
    for (const table of ['stock_picking', 'stock_move', 'sale_order_lifecycle_event', 'loyalty_ledger_entry'])
      assert.equal((await r.app.adapter!.all('SELECT * FROM ' + table)).length, 0, table)
    assert.equal(
      (await r.app.adapter!.all(`SELECT state FROM loyalty_application WHERE "orderId" = 'order'`))[0]!.state,
      'draft',
    )
  })
}

test('D31b failed reward materialization rolls back the application and quotation revision', async (t) => {
  const r = await prepared(t)
  await r.app.adapter!.exec(
    `UPDATE loyalty_reward SET "lineProductId" = 'missing-product' WHERE id = 'reward'`,
  )
  const before = await r.order()
  assert.equal((await r.apply()).ok, false)
  assert.deepEqual(await r.order(), before)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_application')).length, 0)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_reservation')).length, 0)
})

test('D31b native confirmation earns once; cancellation reverses the same ledger and stock atomically', async (t) => {
  const r = await prepared(t, true)
  await r.save('sale.confirmOrder', { id: 'order' })
  const confirmed = await r.order()
  assert.equal(confirmed.state, 'sale')
  assert.equal(confirmed.loyaltyState, 'finalized')
  assert.equal(confirmed.loyaltyPointsEarned, '5')
  const ledger = await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry')
  assert.equal(ledger.length, 1)
  await r.save('loyalty_sale.confirmOrder', { id: 'order' })
  assert.deepEqual(await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry'), ledger)
  assert.deepEqual(await r.order(), confirmed)
  await r.save('sale.cancelOrder', { id: 'order', expectedRevision: confirmed.revision })
  const cancelled = await r.order()
  assert.equal(cancelled.state, 'cancel')
  assert.equal(cancelled.loyaltyState, 'reversed')
  assert.ok((await r.app.adapter!.all('SELECT state FROM stock_move')).every((row) => row.state === 'cancel'))
  const wallets = await r.app.adapter!.all('SELECT balance FROM loyalty_wallet')
  assert.equal(Number(wallets[0]!.balance), 0)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry')).length, 2)
  await r.save('loyalty_sale.cancelOrder', { id: 'order' })
  assert.deepEqual(await r.order(), cancelled)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry')).length, 2)
})

test('D31b reward commands reject stale revisions and confirmed quotations without changing their applications', async (t) => {
  const r = await prepared(t)
  const revision = (await r.order()).revision
  assert.equal((await r.apply()).ok, true)
  const before = await r.order()
  assert.equal(
    (
      await r.call('loyalty_sale.removeReward', {
        orderId: 'order',
        programId: 'program',
        expectedRevision: revision,
      })
    ).ok,
    false,
  )
  assert.deepEqual(await r.order(), before)
  await r.save('sale.confirmOrder', { id: 'order' })
  const frozen = await r.order()
  const applications = await r.app.adapter!.all('SELECT * FROM loyalty_application')
  for (const [fn, extra] of [
    ['applyReward', { rewardId: 'reward' }],
    ['removeReward', {}],
    ['applyCode', { code: 'ANY' }],
  ] as [string, Row][])
    assert.equal(
      (
        await r.call('loyalty_sale.' + fn, {
          orderId: 'order',
          ...(fn === 'applyCode' ? {} : { programId: 'program' }),
          ...extra,
        })
      ).ok,
      false,
    )
  assert.deepEqual(await r.order(), frozen)
  assert.deepEqual(await r.app.adapter!.all('SELECT * FROM loyalty_application'), applications)
})

test('D31b Commerce confirmation accepts structural, productless and manual-discount rows in its loyalty snapshot', async (t) => {
  const r = await setup(t)
  await r.save('sale.addLine', {
    id: 'section',
    orderId: 'order',
    name: 'Services',
    displayType: 'section',
    productUomQty: '0',
  })
  await r.save('sale.addLine', {
    id: 'free',
    orderId: 'order',
    name: 'Consulting',
    productUomQty: '1',
    priceUnit: '100',
  })
  const before = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.applyDiscount', {
    id: 'order',
    expectedRevision: before.revision,
    mode: 'amount',
    value: '10',
  })
  await r.save('sale.confirmOrder', { id: 'order' })
  const order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(order.state, 'sale')
  assert.equal(order.amountTotal, '90')
})

test('D31b competing reward writes accept only one quotation revision', async (t) => {
  const r = await prepared(t)
  const revision = (await r.order()).revision
  const results = await Promise.all(
    [1, 2].map(() =>
      r.call('loyalty_sale.applyReward', {
        orderId: 'order',
        programId: 'program',
        rewardId: 'reward',
        expectedRevision: revision,
      }),
    ),
  )
  assert.equal(results.filter((result) => result.ok === true).length, 1)
  assert.equal(results.filter((result) => result.ok === false).length, 1)
  const order = await r.order()
  assert.equal(Number(order.revision), Number(revision) + 1)
  assert.equal((order.lines as Row[]).filter((line) => line.lineKind === 'reward').length, 1)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_application')).length, 1)
})

test('D31b Commerce composes native grants while the adapter retains its public function keys', async () => {
  assert.deepEqual(
    Object.keys(loyaltySaleFunctions).sort(),
    [
      'applyCode',
      'applyReward',
      'backfill',
      'cancelOrder',
      'confirmOrder',
      'evaluateOrder',
      'generateCoupons',
      'getQuotationBenefits',
      'searchProgramReferences',
      'listProgramCards',
      'getProgram',
      'listPrograms',
      'saveProgram',
      'setProgramActive',
      'refundOrder',
      'removeReward',
    ].sort(),
  )
  const composed = saleWithLoyalty()
  assert.equal(sale.functions.confirmOrder!.effects!.includes('read:loyalty.Application'), false)
  const req = {} as Parameters<Route>[1]
  const ctx = {
    live: async () => ({
      functions: {
        'sale.confirmOrder': composed.functions.confirmOrder,
        'sale.cancelOrder': composed.functions.cancelOrder,
        'loyalty_sale.confirmOrder': loyaltySaleFunctions.confirmOrder,
        'loyalty_sale.cancelOrder': loyaltySaleFunctions.cancelOrder,
      },
    }),
  } as unknown as ServeContext
  assert.equal(await orderWorkflowFunction(ctx, req, 'confirmOrder'), 'sale.confirmOrder')
  assert.equal(await orderWorkflowFunction(ctx, req, 'cancelOrder'), 'sale.cancelOrder')
})

test('D31b a quotation viewer cannot apply a reward or confirm through either endpoint', async (t) => {
  const r = await prepared(t)
  await r.fixture('user.createUser', {
    id: 'viewer',
    login: 'viewer',
    password: 'test-password',
    name: 'Viewer',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'viewer-company', userId: 'viewer', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'viewer-role', name: 'Viewer' })
  await r.fixture('user.assignRole', { id: 'viewer-link', userId: 'viewer', roleId: 'viewer-role' })
  await r.fixture('user.grantFunction', { id: 'viewer-read', roleId: 'viewer-role', fnKey: 'sale.getOrder' })
  const client = r.app.client.anonymous()
  await client.login({ login: 'viewer', password: 'test-password' })
  const before = await r.order()
  for (const endpoint of [
    'sale.confirmOrder',
    'loyalty_sale.confirmOrder',
    'sale.cancelOrder',
    'loyalty_sale.cancelOrder',
  ])
    await assert.rejects(() => client.call(endpoint, { id: 'order' }), { status: 403 })
  await assert.rejects(
    () =>
      client.call('loyalty_sale.applyReward', { orderId: 'order', programId: 'program', rewardId: 'reward' }),
    { status: 403 },
  )
  assert.deepEqual(await r.order(), before)
})

test('D31b cancellation rolls stock and order back when a ledger reversal conflicts', async (t) => {
  const r = await prepared(t, true)
  await r.save('sale.confirmOrder', { id: 'order' })
  const before = await r.order()
  // Simulate a persisted conflicting reversal from a previous integration.
  await r.app.adapter!.exec(`INSERT INTO loyalty_ledger_entry (id, "companyId", "walletId", operation, amount, "balanceDelta", "sourceType", "sourceId", "sourceOperation", "sourceKey", "descriptionCode", "reversedEntryId", "createdAt")
    SELECT id || ':reverse', "companyId", "walletId", 'reverse', amount, '999', "sourceType", "sourceId", 'reverse:' || id, "sourceKey" || ':reverse', 'loyalty.ledger.description.reverse', id, "createdAt" FROM loyalty_ledger_entry`)
  const ledger = await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry ORDER BY id')
  const moves = await r.app.adapter!.all('SELECT * FROM stock_move ORDER BY id')
  assert.equal((await r.call('sale.cancelOrder', { id: 'order' })).ok, false)
  assert.deepEqual(await r.order(), before)
  assert.deepEqual(await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry ORDER BY id'), ledger)
  assert.deepEqual(await r.app.adapter!.all('SELECT * FROM stock_move ORDER BY id'), moves)
})

test('D31b native record commands preserve the Sale grant and submitted revision with loyalty installed', async (t) => {
  const r = await prepared(t, true)
  await r.fixture('user.createUser', {
    id: 'approver',
    login: 'approver',
    password: 'test-password',
    name: 'Approver',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'approver-company', userId: 'approver', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'approver-role', name: 'Approver' })
  await r.fixture('user.assignRole', { id: 'approver-link', userId: 'approver', roleId: 'approver-role' })
  await r.fixture('user.grantFunction', {
    id: 'approver-confirm',
    roleId: 'approver-role',
    fnKey: 'sale.confirmOrder',
  })
  const client = r.app.client.anonymous()
  await client.login({ login: 'approver', password: 'test-password' })
  const before = await r.order()
  const post = (revision: unknown) =>
    client.post(
      '/admin/sales/order-command',
      JSON.stringify({ command: 'confirmOrder', id: 'order', expectedRevision: revision }),
      { headers: { 'content-type': 'application/json' } },
    )
  assert.equal((await post(0)).status, 200)
  assert.deepEqual(await r.order(), before)
  assert.equal((await post(before.revision)).status, 200)
  const confirmed = await r.order()
  assert.equal(confirmed.state, 'sale')
  assert.equal(confirmed.loyaltyState, 'finalized')
  assert.equal(confirmed.loyaltyPointsEarned, '5')
})

test('D31b re-confirming a cancelled quotation earns a new ledger cycle exactly once', async (t) => {
  const r = await prepared(t, true)
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('sale.cancelOrder', { id: 'order' })
  await r.save('sale.resetOrder', { id: 'order' })
  await r.save('sale.confirmOrder', { id: 'order' })
  assert.equal(Number((await r.app.adapter!.all('SELECT balance FROM loyalty_wallet'))[0]!.balance), 5)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry')).length, 3)
  const pickings = await r.app.adapter!.all('SELECT state FROM stock_picking')
  assert.equal(pickings.length, 2)
  assert.equal(pickings.filter((row) => row.state === 'cancel').length, 1)
  assert.equal(
    (await r.app.adapter!.all('SELECT state FROM stock_move')).filter((row) => row.state !== 'cancel').length,
    1,
  )
  await r.save('sale.confirmOrder', { id: 'order' })
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry')).length, 3)
  await r.save('sale.cancelOrder', { id: 'order' })
  assert.equal(Number((await r.app.adapter!.all('SELECT balance FROM loyalty_wallet'))[0]!.balance), 0)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry')).length, 4)
})

test('D31b competing orders cannot both consume the final program use', async (t) => {
  const r = await prepared(t)
  await r.app.adapter!.exec(
    `UPDATE loyalty_program SET "programType" = 'promotion', "designVersion" = 1, "configVersion" = 0, "limitUsage" = TRUE, "maxUsage" = 1, "usageCount" = 0 WHERE id = 'program'`,
  )
  await r.app.adapter!.exec(`UPDATE loyalty_reward SET "requiredPoints" = '1' WHERE id = 'reward'`)
  await r.save('sale.createOrder', { id: 'second', partnerId: 'buyer', warehouseId: 'wh' })
  await r.save('sale.addLine', {
    id: 'second-line',
    orderId: 'second',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '2',
    priceUnit: '100',
  })
  assert.equal((await r.apply()).ok, true)
  await r.save('loyalty_sale.applyReward', { orderId: 'second', programId: 'program', rewardId: 'reward' })
  const results = await Promise.all(['order', 'second'].map((id) => r.call('sale.confirmOrder', { id })))
  assert.equal(results.filter((row) => row.ok === true).length, 1)
  assert.equal(results.filter((row) => row.ok === false).length, 1)
  assert.equal(
    Number(
      (await r.app.adapter!.all(`SELECT "usageCount" FROM loyalty_program WHERE id = 'program'`))[0]!
        .usageCount,
    ),
    1,
  )
  assert.equal((await r.app.adapter!.all(`SELECT * FROM sale_order WHERE state = 'sale'`)).length, 1)
  assert.equal((await r.app.adapter!.all('SELECT * FROM stock_picking')).length, 1)
})

test('D31b reserved points can be spent again after cancellation without reusing the old ledger entry', async (t) => {
  const r = await prepared(t, true)
  await r.save('loyalty.wallet.create', {
    id: 'card',
    programId: 'program',
    partnerId: 'buyer',
    initialBalance: '10',
  })
  assert.equal((await r.apply()).ok, true)
  await r.save('sale.confirmOrder', { id: 'order' })
  assert.equal(
    Number((await r.app.adapter!.all(`SELECT balance FROM loyalty_wallet WHERE id = 'card'`))[0]!.balance),
    10,
  )
  await r.save('sale.cancelOrder', { id: 'order' })
  await r.save('sale.resetOrder', { id: 'order' })
  assert.equal((await r.apply()).ok, true)
  assert.equal(
    Number((await r.app.adapter!.all(`SELECT reserved FROM loyalty_wallet WHERE id = 'card'`))[0]!.reserved),
    5,
  )
  await r.save('sale.confirmOrder', { id: 'order' })
  const wallet = (
    await r.app.adapter!.all(`SELECT balance, reserved FROM loyalty_wallet WHERE id = 'card'`)
  )[0]!
  assert.equal(Number(wallet.balance), 10)
  assert.equal(Number(wallet.reserved), 0)
  const spends = await r.app.adapter!.all(`SELECT id FROM loyalty_ledger_entry WHERE operation = 'redeem'`)
  assert.equal(spends.length, 2)
  assert.notEqual(spends[0]!.id, spends[1]!.id)
  await r.save('sale.cancelOrder', { id: 'order' })
  assert.equal(
    Number((await r.app.adapter!.all(`SELECT balance FROM loyalty_wallet WHERE id = 'card'`))[0]!.balance),
    10,
  )
})

test('D31b enabling Commerce loyalty adds nullable fields and preserves legacy sale facts', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  const legacy = r.deployment.modules.filter(
    (module) =>
      typeof module === 'string' || !['loyalty_sale', 'sale_promotion_backend'].includes(module.name),
  )
  // This downgrade only constructs a synthetic pre-adapter fixture, never tenant data.
  await migrateOne(r.app.adapter!, compose(legacy, { headless: true, companies: true }), {
    allowDestructive: true,
  })
  const tables = ['sale_order', 'sale_order_line']
  const before = await Promise.all(
    tables.map((table) => r.app.adapter!.all('SELECT * FROM ' + table + ' ORDER BY id')),
  )
  const target = compose(r.deployment.modules, { headless: true, companies: true })
  await migrateOne(r.app.adapter!, target)
  const fields = [
    ['loyaltyState', 'loyaltyPointsEarned', 'loyaltyPointsSpent'],
    ['loyaltyApplicationId', 'loyaltyRewardId', 'loyaltyPointsCost'],
  ]
  for (const [index, table] of tables.entries()) {
    const after = await r.app.adapter!.all('SELECT * FROM ' + table + ' ORDER BY id')
    for (const row of after) for (const field of fields[index]!) assert.equal(row[field], null)
    assert.deepEqual(
      after.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !fields[index]!.includes(key))),
      ),
      before[index]!.map((row) => ({ ...row })),
    )
  }
  assert.deepEqual(await migrateOne(r.app.adapter!, target), [])
})
