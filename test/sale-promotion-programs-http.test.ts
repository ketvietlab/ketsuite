import { migrateSalePromotionPrograms } from '../packages/ketsuite/src/modules/loyalty_sale/program-migration.ts'
import assert from 'node:assert/strict'
import { compose, migrateOne, schemaFromManifest, renderSql, confirmManualMigration } from '@ketvietlab/ketjs'
import { test } from 'node:test'
import { setup } from './fixtures/sale/commerce.ts'
import { permissions } from '../packages/ketsuite/src/permission-catalogue/loyalty_sale.ts'
import { legacyModules } from './fixtures/legacy-modules.ts'
const values = { name: 'Autumn promotion', programType: 'promotion' }
test('D31c Sales program saves canonical records atomically without a placeholder product', async (t) => {
  const r = await setup(t)
  const before = await r.app.adapter!.all('SELECT id FROM product_product')
  const saved = await r.save('loyalty_sale.saveProgram', { values: { ...values, productIds: [r.productId] } })
  assert.equal(saved.revision, 1)
  const data = await r.call('loyalty_sale.getProgram', { id: saved.id })
  assert.equal(data.name, values.name)
  assert.equal(data.programType, 'promotion')
  assert.equal(data.active, true)
  assert.equal(data.discount, '10')
  assert.deepEqual(data.productIds, [r.productId])
  assert.equal(data.lineProductId, null)
  assert.deepEqual(await r.app.adapter!.all('SELECT id FROM product_product'), before)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_rule')).length, 1)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_reward')).length, 1)
  assert.equal(Boolean((await r.app.adapter!.all('SELECT * FROM loyalty_program'))[0]!.availablePos), false)
})
test('D31c revision conflict and invalid references roll back every configuration row', async (t) => {
  const r = await setup(t)
  const saved = await r.save('loyalty_sale.saveProgram', { values })
  const original = await r.call('loyalty_sale.getProgram', { id: saved.id })
  for (const input of [
    { expectedRevision: 0, values: { ...values, name: 'Stale' } },
    { expectedRevision: 1, values: { ...values, name: 'Bad reference', productIds: ['missing'] } },
    { expectedRevision: 1, values: { ...values, startDate: '2026-12-01', endDate: '2026-11-01' } },
    { expectedRevision: 1, values: { ...values, discount: '101' } },
  ]) {
    assert.equal((await r.call('loyalty_sale.saveProgram', { id: saved.id, ...input })).ok, false)
    assert.deepEqual(await r.call('loyalty_sale.getProgram', { id: saved.id }), original)
  }
  const updated = await r.save('loyalty_sale.saveProgram', {
    id: saved.id,
    expectedRevision: 1,
    values: { ...values, name: 'Changed', discount: '20' },
  })
  assert.equal(updated.revision, 2)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_rule')).length, 1)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_reward')).length, 1)
})
test('D31c archive retains names, rules and links; code uniqueness includes inactive programs', async (t) => {
  const r = await setup(t)
  const saved = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Ưu đãi', programType: 'promo_code', code: 'sale_10', productIds: [r.productId] },
  })
  await r.save('loyalty_sale.setProgramActive', { id: saved.id, expectedRevision: 1, active: false })
  const archived = await r.call('loyalty_sale.getProgram', { id: saved.id })
  assert.equal(archived.active, false)
  assert.deepEqual(archived.productIds, [r.productId])
  assert.equal(archived.code, 'SALE_10')
  for (const draft of [
    { name: 'ƯU ĐÃI'.normalize('NFD'), programType: 'promotion' },
    { name: 'Other', programType: 'promo_code', code: 'SALE_10' },
  ])
    assert.equal((await r.call('loyalty_sale.saveProgram', { values: draft })).ok, false)
  assert.equal(
    (await r.call('loyalty_sale.setProgramActive', { id: saved.id, expectedRevision: 1, active: true })).ok,
    false,
  )
  await r.save('loyalty_sale.setProgramActive', { id: saved.id, expectedRevision: 2, active: true })
})
test('D31c same-name concurrent creation accepts exactly one writer', async (t) => {
  const r = await setup(t)
  const results = await Promise.all([
    r.call('loyalty_sale.saveProgram', { values }),
    r.call('loyalty_sale.saveProgram', { values }),
  ])
  assert.equal(results.filter((row) => row.ok === true).length, 1)
  assert.equal(results.filter((row) => row.ok === false).length, 1)
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_program')).length, 1)
})
test('D31c company isolation and bounded lists do not expose the other company', async (t) => {
  const r = await setup(t)
  const foreign = await r.fixture('loyalty_sale.saveProgram', { values }, 'other')
  assert.equal(foreign.ok, true)
  assert.equal(await r.call('loyalty_sale.getProgram', { id: foreign.id }), null)
  assert.equal(
    (await r.call('loyalty_sale.saveProgram', { id: foreign.id, expectedRevision: 1, values })).ok,
    false,
  )
  for (const name of ['Alpha', 'Beta', 'Gamma'])
    await r.save('loyalty_sale.saveProgram', { values: { ...values, name } })
  const page = await r.call('loyalty_sale.listPrograms', { page: 99, pageSize: 2 })
  assert.equal(page.total, 3)
  assert.equal(page.page, 2)
  assert.equal((page.rows as unknown[]).length, 1)
})
test('D31c quotation operators cannot gain configuration or backfill through their bundle', () => {
  assert.deepEqual(permissions.functions.applyCode, ['operate', 'operate'])
  assert.deepEqual(permissions.functions.applyReward, ['operate', 'operate'])
  assert.equal(permissions.functions.backfill[0], 'configure')
  assert.equal(permissions.functions.saveProgram[0], 'configure')
  assert.equal(permissions.functions.getProgram[0], 'read')
})

test('D31c cheapest reward discounts one untaxed unit and removal retains manual discounts', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '5', priceUnit: '100' })
  const saved = await r.save('loyalty_sale.saveProgram', {
    values: { ...values, discount: '50', discountApplicability: 'cheapest' },
  })
  const rewards = await r.app.adapter!.all('SELECT id FROM loyalty_reward')
  const applied = await r.call('loyalty_sale.applyReward', {
    orderId: 'order',
    programId: saved.id,
    rewardId: rewards[0]!.id,
  })
  assert.equal(applied.ok, true, JSON.stringify(applied))
  let order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(order.amountUntaxed, '450')
  const reward = (order.lines as Record<string, unknown>[]).find((row) => row.loyaltyRewardId)
  assert.equal(reward?.productId, null)
  assert.equal(reward?.priceSubtotal, '-50')
  await r.save('sale.applyDiscount', {
    id: 'order',
    expectedRevision: order.revision,
    mode: 'amount',
    value: '10',
  })
  order = await r.call('sale.getOrder', { id: 'order' })
  // The manual 10 reduces each unit from 100 to 98; half of the cheapest is 49.
  assert.equal(order.amountUntaxed, '441')
  await r.save('loyalty_sale.removeReward', {
    orderId: 'order',
    programId: saved.id,
    expectedRevision: order.revision,
  })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(order.amountUntaxed, '490')
})
test('D31c buy X get Y creates a normally fulfilled free product at list price and 100 percent discount', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '7', priceUnit: '100' })
  const saved = await r.save('loyalty_sale.saveProgram', {
    values: {
      ...values,
      programType: 'buy_x_get_y',
      minimumQuantity: '3',
      rewardProductId: r.productId,
      rewardProductQuantity: '2',
    },
  })
  const reward = (await r.app.adapter!.all('SELECT id FROM loyalty_reward'))[0]!
  await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: saved.id, rewardId: reward.id })
  const order = await r.call('sale.getOrder', { id: 'order' })
  const line = (order.lines as Record<string, unknown>[]).find((row) => row.loyaltyRewardId)!
  assert.equal(line.productUomQty, '4')
  assert.equal(line.priceUnit, '100')
  assert.equal(line.discount, '100')
  assert.equal(line.priceSubtotal, '0')
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: order.revision })
  const moves = await r.app.adapter!.all('SELECT * FROM stock_move')
  assert.ok(
    moves.some((move) => move.saleLineId === line.id),
    'gift follows normal fulfilment',
  )
})
test('D31c legacy configuration endpoints cannot overwrite the Sales profile or its revision', async (t) => {
  const r = await setup(t)
  const saved = await r.save('loyalty_sale.saveProgram', { values })
  const before = await r.call('loyalty_sale.getProgram', { id: saved.id })
  for (const [fn, input] of [
    ['loyalty.program.archive', { id: saved.id, active: false }],
    [
      'loyalty.program.configure',
      {
        id: saved.id,
        expectedVersion: 1,
        entity: 'program',
        values: { name: 'Legacy edit', programType: 'promotion' },
      },
    ],
    ['loyalty.program.transition', { id: saved.id, expectedVersion: 1, action: 'archive' }],
  ] as const)
    assert.equal((await r.call(fn, input)).ok, false)
  assert.deepEqual(await r.call('loyalty_sale.getProgram', { id: saved.id }), before)
})
test('D31c cancellation frees a Sales counted use for the next quotation', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  const saved = await r.save('loyalty_sale.saveProgram', { values: { ...values, maxUsage: 1 } })
  const reward = (await r.app.adapter!.all('SELECT id FROM loyalty_reward'))[0]!
  await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: saved.id, rewardId: reward.id })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('sale.cancelOrder', { id: 'order' })
  await r.save('sale.createOrder', { id: 'next', partnerId: 'buyer', warehouseId: 'wh' })
  await r.add({
    id: 'next-line',
    orderId: 'next',
    productUomId: 'each',
    productUomQty: '2',
    priceUnit: '100',
  })
  await r.save('loyalty_sale.applyReward', { orderId: 'next', programId: saved.id, rewardId: reward.id })
  await r.save('sale.confirmOrder', { id: 'next' })
  assert.equal((await r.call('loyalty_sale.getProgram', { id: saved.id })).uses, 1)
})

test('D31c coupon batch has CP codes, scoped partner, atomic count bounds and cancellation restores redemption', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  const saved = await r.save('loyalty_sale.saveProgram', { values: { ...values, programType: 'coupons' } })
  for (const count of [0, 101])
    assert.equal(
      (await r.call('loyalty_sale.generateCoupons', { id: saved.id, expectedRevision: 1, count })).ok,
      false,
    )
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_wallet')).length, 0)
  const batch = await r.save('loyalty_sale.generateCoupons', {
    id: saved.id,
    expectedRevision: 1,
    count: 2,
    partnerId: 'buyer',
  })
  const codes = batch.codes as string[]
  assert.equal(codes.length, 2)
  assert.ok(codes.every((code) => /^CP-[A-Z0-9]{8}$/.test(code)))
  assert.equal(new Set(codes).size, 2)
  await r.save('loyalty_sale.applyCode', { orderId: 'order', code: codes[0]!.toLowerCase() })
  const reward = (await r.app.adapter!.all('SELECT id FROM loyalty_reward'))[0]!
  await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: saved.id, rewardId: reward.id })
  await r.save('sale.confirmOrder', { id: 'order' })
  let wallet = (await r.app.adapter!.all('SELECT * FROM loyalty_wallet')).find(
    (row) => row.code === codes[0],
  )!
  assert.equal(Number(wallet.balance), 0)
  assert.equal(Boolean(wallet.active), false)
  await r.save('sale.cancelOrder', { id: 'order' })
  wallet = (await r.app.adapter!.all('SELECT * FROM loyalty_wallet')).find((row) => row.code === codes[0])!
  assert.equal(Number(wallet.balance), 1)
  assert.equal(Boolean(wallet.active), true)
})
test('D31c loyalty earns floor of the final total after discounts and creates TT card only at first earning', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '5', priceUnit: '100' })
  await r.save('loyalty_sale.saveProgram', {
    values: { ...values, programType: 'loyalty', pointStep: '100', pointAmount: '3' },
  })
  const before = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.applyDiscount', {
    id: 'order',
    expectedRevision: before.revision,
    mode: 'amount',
    value: '110',
  })
  await r.save('sale.confirmOrder', { id: 'order' })
  const wallets = await r.app.adapter!.all('SELECT * FROM loyalty_wallet')
  assert.equal(wallets.length, 1)
  assert.equal(Number(wallets[0]!.balance), 9)
  assert.match(String(wallets[0]!.code), /^TT-[A-Z0-9]{8}$/)
  await r.save('sale.cancelOrder', { id: 'order' })
  assert.equal(Number((await r.app.adapter!.all('SELECT balance FROM loyalty_wallet'))[0]!.balance), 0)
})
test('D31c next-order coupon is DS, issued once, and unused issuance is cancelled with the source sale', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  await r.save('loyalty_sale.saveProgram', { values: { ...values, programType: 'next_order_coupons' } })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('sale.confirmOrder', { id: 'order' })
  let wallets = await r.app.adapter!.all('SELECT * FROM loyalty_wallet')
  assert.equal(wallets.length, 1)
  assert.match(String(wallets[0]!.code), /^DS-[A-Z0-9]{8}$/)
  assert.equal(Number(wallets[0]!.balance), 1)
  await r.save('sale.cancelOrder', { id: 'order' })
  wallets = await r.app.adapter!.all('SELECT * FROM loyalty_wallet')
  assert.equal(Boolean(wallets[0]!.active), false)
  assert.equal(Number(wallets[0]!.balance), 0)
})

test('D31c Sales reward allocates exact untaxed minor units across VAT groups', async (t) => {
  const r = await setup(t)
  for (const [id, amount] of [
    ['vat8', '8'],
    ['vat10', '10'],
  ])
    await r.save('account.saveTax', { id, name: id, typeTaxUse: 'sale', amountType: 'percent', amount })
  await r.add({ id: 'a', productUomId: 'each', productUomQty: '1', priceUnit: '100', taxIds: ['vat8'] })
  await r.add({ id: 'b', productUomId: 'each', productUomQty: '1', priceUnit: '200', taxIds: ['vat10'] })
  const saved = await r.save('loyalty_sale.saveProgram', {
    values: { ...values, discountMode: 'per_order', discount: '101' },
  })
  const reward = (await r.app.adapter!.all('SELECT id FROM loyalty_reward'))[0]!
  await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: saved.id, rewardId: reward.id })
  const order = await r.call('sale.getOrder', { id: 'order' })
  const lines = (order.lines as Record<string, unknown>[]).filter((row) => row.loyaltyRewardId)
  assert.deepEqual(
    lines.map((row) => row.priceSubtotal),
    ['-33', '-68'],
  )
  assert.equal(order.amountUntaxed, '199')
  assert.equal(order.amountTotal, '217')
  await r.save('sale.confirmOrder', { id: 'order' })
})
test('D31c category descendants and actual Product tags match without legacy loyalty tags', async (t) => {
  const r = await setup(t)
  await r.save('product.saveCategory', { id: 'root', name: 'Root' })
  await r.save('product.saveCategory', { id: 'child', name: 'Child', parentId: 'root' })
  await r.save('product.saveTag', { id: 'featured', name: 'Featured' })
  const goods = await r.call('product.getTemplate', { id: 'goods' })
  await r.save('product.saveRecord', {
    id: 'goods',
    expectedRevisionId: goods.revisionId,
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    listPrice: '100',
    saleOk: true,
    categoryId: 'child',
    tagIds: ['featured'],
  })
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  for (const [name, filter] of [
    ['Category', { categoryIds: ['root'] }],
    ['Tag', { tagIds: ['featured'] }],
  ] as const) {
    const saved = await r.save('loyalty_sale.saveProgram', {
      values: { ...values, name, ...filter, minimumQuantity: '2' },
    })
    const result = await r.call('loyalty_sale.evaluateOrder', { orderId: 'order' })
    assert.ok((result.programs as Record<string, unknown>[]).some((row) => row.programId === saved.id))
  }
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_product_tag')).length, 0)
  await r.fixture('product.saveTag', { id: 'foreign-tag', name: 'Foreign' }, 'other')
  assert.equal(
    (
      await r.call('loyalty_sale.saveProgram', {
        values: { ...values, name: 'Foreign', tagIds: ['foreign-tag'] },
      })
    ).ok,
    false,
  )
})
test('D31c a combo contributes its parent quantity once, never the sum of child quantities', async (t) => {
  const r = await setup(t)
  for (const id of ['choice-a', 'choice-b'])
    await r.save('product.saveCombo', { id, name: id, items: [{ productId: r.productId, extraPrice: '0' }] })
  await r.save('product.saveRecord', {
    id: 'combo',
    name: 'Combo',
    defaultCode: 'COMBO',
    type: 'combo',
    uomId: 'each',
    comboIds: ['choice-a', 'choice-b'],
    listPrice: '100',
    saleOk: true,
  })
  await r.save('sale.addLine', {
    id: 'combo-line',
    orderId: 'order',
    productId: 'combo:default',
    productUomId: 'each',
    productUomQty: '2',
  })
  const saved = await r.save('loyalty_sale.saveProgram', { values: { ...values, minimumQuantity: '3' } })
  assert.equal(
    Array.isArray((await r.call('loyalty_sale.evaluateOrder', { orderId: 'order' })).programs),
    true,
  )
  let result = await r.call('loyalty_sale.evaluateOrder', { orderId: 'order' })
  assert.equal((result.programs as unknown[]).length, 0)
  await r.save('loyalty_sale.saveProgram', {
    id: saved.id,
    expectedRevision: 1,
    values: { ...values, minimumQuantity: '2' },
  })
  result = await r.call('loyalty_sale.evaluateOrder', { orderId: 'order' })
  assert.equal((result.programs as unknown[]).length, 1)
})
test('D31c a program with cards cannot change its type', async (t) => {
  const r = await setup(t)
  const saved = await r.save('loyalty_sale.saveProgram', { values: { ...values, programType: 'coupons' } })
  await r.save('loyalty_sale.generateCoupons', { id: saved.id, expectedRevision: 1, count: 1 })
  assert.equal(
    (await r.call('loyalty_sale.saveProgram', { id: saved.id, expectedRevision: 2, values })).ok,
    false,
  )
  assert.equal((await r.call('loyalty_sale.getProgram', { id: saved.id })).programType, 'coupons')
})

test('D31c nullable Sales profile upgrades preserve legacy loyalty records and replay safely', async (t) => {
  const r = await setup(t)
  await r.save('loyalty.program.save', {
    id: 'legacy',
    name: 'Legacy',
    programType: 'promotion',
    currency: 'VND',
  })
  await r.save('loyalty.rule.save', {
    id: 'legacy-rule',
    programId: 'legacy',
    pointAmount: '1',
    pointMode: 'order',
    minimumQuantity: '1',
    minimumAmount: '0',
    taxMode: 'excl',
    mode: 'auto',
  })
  await r.save('loyalty.reward.save', {
    id: 'legacy-reward',
    programId: 'legacy',
    description: 'Legacy',
    rewardType: 'discount',
    discount: '10',
    discountMode: 'percent',
    discountApplicability: 'order',
    requiredPoints: '1',
  })
  const fields = { Program: 'salePolicyVersion', Rule: 'salePointStep', Wallet: 'saleExpiresOn' }
  const legacy = legacyModules(
    r.deployment.modules.map((module) => {
      if (typeof module === 'string' || module.name !== 'loyalty') return module
      const models = { ...module.models }
      for (const name of ['ProgramNamespace', 'RuleCategory', 'RuleTag']) delete models[name]
      for (const [name, field] of Object.entries(fields)) {
        const model = models[name]!,
          next = { ...model.fields }
        delete next[field]
        models[name] = { ...model, fields: next }
      }
      models.Reward = {
        ...models.Reward!,
        fields: { ...models.Reward!.fields, lineProductId: 'ref:product.Product' },
      }
      return { ...module, models }
    }),
  )
  const oldManifest = compose(
    legacy.map((module) =>
      typeof module === 'string'
        ? module
        : {
            ...module,
            jobs: Object.fromEntries(
              Object.entries(module.jobs ?? {}).map(([key, job]) => [
                key,
                {
                  ...job,
                  effects: job.effects?.filter(
                    (effect) => !['read:loyalty.RuleCategory', 'read:loyalty.RuleTag'].includes(effect),
                  ),
                },
              ]),
            ),
          },
    ),
    { headless: true, companies: true },
  )
  await r.app.adapter!.tx(async (tx) => {
    for (const [table, field] of [
      ['loyalty_program', 'salePolicyVersion'],
      ['loyalty_rule', 'salePointStep'],
      ['loyalty_wallet', 'saleExpiresOn'],
    ])
      await tx.exec(`ALTER TABLE ${table} DROP COLUMN "${field}"`)
    for (const table of ['loyalty_program_namespace', 'loyalty_rule_category', 'loyalty_rule_tag'])
      await tx.exec('DROP TABLE ' + table)
    if (tx.name === 'postgres')
      await tx.exec('ALTER TABLE loyalty_reward ALTER COLUMN "lineProductId" SET NOT NULL')
    else {
      const table = schemaFromManifest(oldManifest).tables.loyalty_reward!
      const columns = Object.keys(table.columns)
        .map((field) => `"${field}"`)
        .join(', ')
      const indexes = await tx.all(
        "SELECT sql FROM sqlite_master WHERE tbl_name = 'loyalty_reward' AND type = 'index' AND sql IS NOT NULL",
      )
      for (const statement of renderSql(
        [{ op: 'CREATE_TABLE', table: 'loyalty_reward_legacy', columns: table.columns, destructive: false }],
        tx,
      ))
        await tx.exec(statement)
      await tx.exec(`INSERT INTO loyalty_reward_legacy (${columns}) SELECT ${columns} FROM loyalty_reward`)
      await tx.exec('DROP TABLE loyalty_reward')
      await tx.exec('ALTER TABLE loyalty_reward_legacy RENAME TO loyalty_reward')
      for (const index of indexes) await tx.exec(String(index.sql))
    }
    await confirmManualMigration(tx, oldManifest)
  })
  const tables = ['loyalty_program', 'loyalty_rule', 'loyalty_reward']
  const before = await Promise.all(tables.map((table) => r.app.adapter!.all('SELECT * FROM ' + table)))
  const manifest = compose(r.deployment.modules, { headless: true, companies: true })
  await assert.rejects(migrateOne(r.app.adapter!, manifest), /hand-written data migration/)
  const unrelated = compose(
    r.deployment.modules.map((module) =>
      typeof module === 'string' || module.name !== 'loyalty'
        ? module
        : {
            ...module,
            models: {
              ...module.models,
              Program: {
                ...module.models!.Program!,
                fields: { ...module.models!.Program!.fields, unrelated: 'text?' },
              },
            },
          },
    ),
    { headless: true, companies: true },
  )
  await assert.rejects(migrateSalePromotionPrograms(r.app.adapter!, unrelated), /Unrelated schema changes/)
  const adapter = r.app.adapter!
  await assert.rejects(
    migrateSalePromotionPrograms(
      {
        ...adapter,
        tx: (fn) =>
          adapter.tx((tx) =>
            fn({
              ...tx,
              exec: async (sql) => {
                if (sql.startsWith('CREATE TABLE "loyalty_program_namespace"'))
                  throw new Error('injected migration failure')
                return tx.exec(sql)
              },
            }),
          ),
      },
      manifest,
    ),
    /injected migration failure/,
  )
  assert.deepEqual(await Promise.all(tables.map((table) => adapter.all('SELECT * FROM ' + table))), before)
  assert.equal((await migrateSalePromotionPrograms(r.app.adapter!, manifest)).state, 'applied')
  assert.equal((await migrateSalePromotionPrograms(r.app.adapter!, manifest)).state, 'already-applied')
  for (const [index, table] of tables.entries()) {
    const rows = await r.app.adapter!.all('SELECT * FROM ' + table)
    const stripped = rows.map(({ salePolicyVersion: _profile, salePointStep: _step, ...row }) => row)
    assert.deepEqual(
      stripped,
      before[index]!.map((row) => ({ ...row })),
    )
  }
  const schema = schemaFromManifest(manifest)
  assert.ok(schema.tables.loyalty_rule_category)
  assert.ok(schema.tables.loyalty_rule_tag)
  assert.deepEqual(await migrateOne(r.app.adapter!, manifest), [])
  await r.save('loyalty_sale.saveProgram', { values })
})
test('D31c HTTP readers can inspect programs but cannot configure, issue cards or backfill', async (t) => {
  const r = await setup(t)
  const saved = await r.save('loyalty_sale.saveProgram', { values })
  await r.fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'reader-role', name: 'Reader' })
  await r.fixture('user.assignRole', { id: 'reader-link', userId: 'reader', roleId: 'reader-role' })
  await r.fixture('user.grantFunction', {
    id: 'reader-get',
    roleId: 'reader-role',
    fnKey: 'loyalty_sale.getProgram',
  })
  const client = r.app.client.anonymous()
  await client.login({ login: 'reader', password: 'test-password' })
  assert.equal(
    (await client.call<Record<string, unknown>>('loyalty_sale.getProgram', { id: saved.id })).value.name,
    values.name,
  )
  for (const [fn, input] of [
    ['saveProgram', { values }],
    ['setProgramActive', { id: saved.id, expectedRevision: 1, active: false }],
    ['generateCoupons', { id: saved.id, expectedRevision: 1, count: 1 }],
    ['backfill', { dryRun: true }],
  ] as const)
    await assert.rejects(
      client.call('loyalty_sale.' + fn, input),
      (error: unknown) => (error as { status: number }).status === 403,
    )
})

test('D31c coupon expiry, partner and pricing currency are checked before writes', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  await r.save('pricing.savePricelist', { id: 'usd', name: 'Legacy currency' })
  // Synthetic legacy data: current Pricing commands already reject foreign currency.
  await r.app.adapter!.exec("UPDATE pricing_pricelist SET currency = 'USD' WHERE id = 'usd'")
  assert.equal(
    (await r.call('loyalty_sale.saveProgram', { values: { ...values, pricelistIds: ['usd'] } })).ok,
    false,
  )
  const saved = await r.save('loyalty_sale.saveProgram', { values: { ...values, programType: 'coupons' } })
  const expired = await r.save('loyalty_sale.generateCoupons', {
    id: saved.id,
    expectedRevision: 1,
    count: 1,
    expiresOn: '2000-01-01',
  })
  const foreignPartner = await r.save('loyalty_sale.generateCoupons', {
    id: saved.id,
    expectedRevision: 2,
    count: 1,
    partnerId: 'acme-party',
  })
  const before = await r.call('sale.getOrder', { id: 'order' })
  for (const batch of [expired, foreignPartner]) {
    assert.equal(
      (await r.call('loyalty_sale.applyCode', { orderId: 'order', code: (batch.codes as string[])[0] })).ok,
      false,
    )
    assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  }
  assert.equal((await r.app.adapter!.all('SELECT * FROM loyalty_application')).length, 0)
})
