import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('D31e ordinary quotation writers automatically apply and recalculate eligible promotions', async (t) => {
  const r = await setup(t)
  const program = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Two or more', minimumQuantity: '2', discount: '10' },
  })
  await r.add({ productUomId: 'each', productUomQty: '2', priceUnit: '100' })
  let order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountUntaxed), 180)
  assert.equal((order.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 1)
  await r.save('sale.updateLine', { id: 'line', expectedRevision: order.revision, productUomQty: '3' })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountUntaxed), 270)
  await r.save('sale.updateLine', { id: 'line', expectedRevision: order.revision, productUomQty: '1' })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountUntaxed), 100)
  assert.equal((order.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 0)
  const app = (await r.app.adapter!.all('SELECT "rewardId", "pointsSpent" FROM loyalty_application')).find(
    (row) => row.rewardId === null,
  )!
  assert.ok(app, String(program.id))
  assert.equal(Number(app.pointsSpent), 0)
})

test('D31e removing one split reward row removes the full application and preserves dismissal on later edits', async (t) => {
  const r = await setup(t)
  await r.save('account.saveTax', {
    id: 'vat',
    name: 'VAT',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Split discount', discount: '10' } })
  await r.add({ productUomId: 'each', productUomQty: '1', priceUnit: '100', taxIds: ['vat'] })
  await r.save('sale.addLine', {
    id: 'free',
    orderId: 'order',
    name: 'Advice',
    productUomQty: '1',
    priceUnit: '100',
    taxIds: [],
  })
  let order = await r.call('sale.getOrder', { id: 'order' })
  const rewards = (order.lines as Row[]).filter((row) => row.loyaltyApplicationId)
  assert.equal(rewards.length, 2)
  await r.save('sale.removeLine', { id: rewards[0]!.id })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal((order.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 0)
  assert.equal(Number(order.amountTotal), 210)
  await r.save('sale.updateLine', { id: 'line', expectedRevision: order.revision, productUomQty: '2' })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal((order.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 0)
  assert.equal(Number(order.amountTotal), 320)
})

test('D31e refused benefit materialization rolls back the ordinary line and quotation revision', async (t) => {
  const r = await setup(t)
  await r.save('sale.saveDraft', {
    id: 'order',
    partnerId: 'buyer',
    warehouseId: 'wh',
    expectedRevision: 0,
    lines: Array.from({ length: 99 }, (_, index) => ({
      id: 'held-' + index,
      productId: r.productId,
      productUomId: 'each',
      productUomQty: '1',
    })),
  })
  await r.save('loyalty_sale.saveProgram', {
    values: {
      name: 'Automatic gift',
      programType: 'buy_x_get_y',
      minimumQuantity: '1',
      rewardProductId: r.productId,
    },
  })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const refused = await r.add({ productUomId: 'each', productUomQty: '2' })
  assert.equal(refused.ok, false)
  assert.match(JSON.stringify(refused), /gridTooMany/)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  assert.equal((await r.app.adapter!.all('SELECT id FROM loyalty_application')).length, 0)
})

test('D31e template create/apply and cancelled reset rebuild benefits without replaying an existing quotation', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Template benefit', discount: '10' } })
  await r.save('sale_template.saveTemplate', {
    id: 'template',
    name: 'Two goods',
    expectedRevision: 0,
    lines: [{ productId: r.productId, productUomId: 'each', productUomQty: '2' }],
    teamIds: [],
  })
  await r.save('sale_template.createQuotation', {
    id: 'new',
    partnerId: 'buyer',
    warehouseId: 'wh',
    templateId: 'template',
  })
  const created = await r.call('sale.getOrder', { id: 'new' })
  assert.equal(Number(created.amountTotal), 180)
  await r.save('sale_template.createQuotation', {
    id: 'new',
    partnerId: 'buyer',
    warehouseId: 'wh',
    templateId: 'missing',
  })
  assert.deepEqual(await r.call('sale.getOrder', { id: 'new' }), created)
  await r.save('sale_template.applyQuotation', {
    id: 'order',
    templateId: 'template',
    expectedRevision: 0,
    expectedTemplateRevision: 1,
  })
  let order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 180)
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: order.revision })
  await r.save('sale.cancelOrder', { id: 'order' })
  await r.save('sale.resetOrder', { id: 'order' })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(order.state, 'draft')
  assert.equal(Number(order.amountTotal), 180)
})

test('D31e code materializes immediately and explicit removal remains dismissed until reapplication', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const program = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Coupon', programType: 'coupons' },
  })
  const batch = await r.save('loyalty_sale.generateCoupons', {
    id: program.id,
    expectedRevision: 1,
    count: 1,
    partnerId: 'buyer',
  })
  const code = (batch.codes as string[])[0]!
  await r.save('loyalty_sale.applyCode', { orderId: 'order', code })
  let order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 180)
  await r.save('loyalty_sale.removeReward', {
    orderId: 'order',
    programId: program.id,
    expectedRevision: order.revision,
  })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 200)
  await r.save('sale.updateLine', { id: 'line', expectedRevision: order.revision, productUomQty: '3' })
  assert.equal(Number((await r.call('sale.getOrder', { id: 'order' })).amountTotal), 300)
  await r.save('loyalty_sale.applyCode', { orderId: 'order', code })
  assert.equal(Number((await r.call('sale.getOrder', { id: 'order' })).amountTotal), 270)
})

test('D31e a no-op quotation edit refreshes archived benefits and advances revision exactly when facts change', async (t) => {
  const r = await setup(t)
  const program = await r.save('loyalty_sale.saveProgram', { values: { name: 'Archive me' } })
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const order = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.setOptionalSections', { id: 'order', expectedRevision: order.revision, sectionIds: [] })
  assert.equal((await r.call('sale.getOrder', { id: 'order' })).revision, order.revision)
  await r.save('loyalty_sale.setProgramActive', { id: program.id, expectedRevision: 1, active: false })
  const saved = await r.save('sale.setOptionalSections', {
    id: 'order',
    expectedRevision: order.revision,
    sectionIds: [],
  })
  const after = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(after.amountTotal), 200)
  assert.equal(after.revision, Number(order.revision) + 1)
  assert.equal(saved.revision, after.revision)
})

test('D31e distinct programs retain their own point reservations through apply, edit and removal', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const programs: Row[] = []
  for (const id of ['one', 'two']) {
    const program = await r.save('loyalty_sale.saveProgram', {
      values: { name: id, programType: 'loyalty', requiredPoints: '10', pointStep: '100000', discount: '5' },
    })
    programs.push(program)
    await r.save('loyalty.wallet.create', {
      id,
      programId: program.id,
      partnerId: 'buyer',
      initialBalance: '20',
    })
    const rewards = await r.app.adapter!.all('SELECT id, "programId" FROM loyalty_reward')
    const reward = rewards.find((row) => row.programId === program.id)!
    await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: program.id, rewardId: reward.id })
  }
  const held = () => r.app.adapter!.all('SELECT id, reserved FROM loyalty_wallet ORDER BY id')
  assert.deepEqual(
    (await held()).map((row) => Number(row.reserved)),
    [10, 10],
  )
  const order = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.updateLine', { id: 'line', expectedRevision: order.revision, productUomQty: '3' })
  assert.deepEqual(
    (await held()).map((row) => Number(row.reserved)),
    [10, 10],
  )
  await r.save('loyalty_sale.removeReward', { orderId: 'order', programId: programs[0]!.id })
  assert.deepEqual(
    (await held()).map((row) => Number(row.reserved)),
    [0, 10],
  )
  assert.equal(Number((await r.call('sale.getOrder', { id: 'order' })).amountTotal), 285)
  const firstReward = (await r.app.adapter!.all('SELECT id, "programId" FROM loyalty_reward')).find(
    (row) => row.programId === programs[0]!.id,
  )!
  await r.save('loyalty_sale.applyReward', {
    orderId: 'order',
    programId: programs[0]!.id,
    rewardId: firstReward.id,
  })
  // Exercise the shared producer without the Sales rebuild, which could mask an over-broad release.
  await r.save('loyalty.removeReward', { orderType: 'sale', orderId: 'order', programId: programs[0]!.id })
  assert.deepEqual(
    (await held()).map((row) => Number(row.reserved)),
    [0, 10],
  )
})

test('D31e changing customer releases the old membership wallet and uses only the new customer balance', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const program = await r.save('loyalty_sale.saveProgram', {
    values: {
      name: 'Membership',
      programType: 'loyalty',
      requiredPoints: '10',
      pointStep: '100000',
      discount: '5',
    },
  })
  await r.save('loyalty.wallet.create', {
    id: 'old-wallet',
    programId: program.id,
    partnerId: 'buyer',
    initialBalance: '20',
  })
  const reward = (await r.app.adapter!.all('SELECT id FROM loyalty_reward'))[0]!
  await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: program.id, rewardId: reward.id })
  await r.save('partner.savePartner', { id: 'new-buyer', kind: 'company', name: 'New buyer' })
  await r.save('partner.grantRole', { id: 'new-buyer-role', partnerId: 'new-buyer', role: 'customer' })
  await r.save('loyalty.wallet.create', {
    id: 'new-wallet',
    programId: program.id,
    partnerId: 'new-buyer',
    initialBalance: '15',
  })
  const order = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.saveDraft', {
    id: 'order',
    partnerId: 'new-buyer',
    warehouseId: 'wh',
    expectedRevision: order.revision,
    lines: order.lines,
  })
  const wallets = await r.app.adapter!.all('SELECT id, reserved FROM loyalty_wallet')
  assert.equal(Number(wallets.find((row) => row.id === 'old-wallet')!.reserved), 0)
  assert.equal(Number(wallets.find((row) => row.id === 'new-wallet')!.reserved), 10)
  assert.equal(Number((await r.call('sale.getOrder', { id: 'order' })).amountTotal), 190)
})

for (const command of ['sale.applyLineGrid', 'sale.saveCatalogueDraft', 'sale.setCatalogueQuantity']) {
  test(`D31e ${command} updates native benefits in the same quotation`, async (t) => {
    const r = await setup(t)
    await r.save('loyalty_sale.saveProgram', { values: { name: command, minimumQuantity: '2' } })
    await r.add({ productUomId: 'each', productUomQty: '1' })
    const order = await r.call('sale.getOrder', { id: 'order' })
    const input =
      command === 'sale.setCatalogueQuantity'
        ? { productId: r.productId, quantity: '3' }
        : {
            changes: {
              added: [],
              updated: [{ id: 'line', values: { productUomQty: '3' } }],
              removed: [],
              order: null,
            },
          }
    await r.save(command, { id: 'order', expectedRevision: order.revision, ...input })
    assert.equal(Number((await r.call('sale.getOrder', { id: 'order' })).amountTotal), 270)
  })
}

test('D31e competing ordinary edits commit one revision and one complete benefit set', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Concurrent' } })
  await r.add({ productUomId: 'each', productUomQty: '1' })
  const order = await r.call('sale.getOrder', { id: 'order' })
  const results = await Promise.all(
    ['2', '3'].map((productUomQty) =>
      r.call('sale.updateLine', { id: 'line', expectedRevision: order.revision, productUomQty }),
    ),
  )
  assert.equal(results.filter((row) => row.ok === true).length, 1)
  assert.equal(results.filter((row) => row.ok === false).length, 1)
  const after = await r.call('sale.getOrder', { id: 'order' })
  assert.ok([180, 270].includes(Number(after.amountTotal)))
  assert.equal((after.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 1)
})

test('D31e stacked promotions consume remaining tax-group bases after the manual discount and confirm unchanged', async (t) => {
  const r = await setup(t)
  for (const [id, amount] of [
    ['vat8', '8'],
    ['vat10', '10'],
  ])
    await r.save('account.saveTax', { id, name: id, typeTaxUse: 'sale', amountType: 'percent', amount })
  for (const name of ['First half', 'Second half'])
    await r.save('loyalty_sale.saveProgram', { values: { name, discount: '50' } })
  await r.add({ productUomId: 'each', productUomQty: '1', priceUnit: '100', taxIds: ['vat8'] })
  await r.save('sale.addLine', {
    id: 'second',
    orderId: 'order',
    name: 'Services',
    productUomQty: '1',
    priceUnit: '200',
    taxIds: ['vat10'],
  })
  let order = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.applyDiscount', {
    id: 'order',
    expectedRevision: order.revision,
    mode: 'amount',
    value: '30',
  })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountUntaxed), 67)
  assert.equal((order.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 4)
  const before = order.amountTotal
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: order.revision })
  assert.equal((await r.call('sale.getOrder', { id: 'order' })).amountTotal, before)
})

test('D31e a fully discounted quotation omits additional monetary rewards instead of becoming negative', async (t) => {
  const r = await setup(t)
  for (const name of ['All', 'Additional'])
    await r.save('loyalty_sale.saveProgram', { values: { name, discount: '100' } })
  await r.add({ productUomId: 'each', productUomQty: '1' })
  let order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 0)
  assert.equal((order.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 1)
  await r.save('sale.updateLine', { id: 'line', expectedRevision: order.revision, productUomQty: '2' })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 0)
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: order.revision })
})

test('D31e confirmation rejects a newly eligible automatic program until the quotation is refreshed', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2' })
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Added after quote' } })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const refused = await r.call('sale.confirmOrder', { id: 'order', expectedRevision: before.revision })
  assert.equal(refused.ok, false)
  assert.match(JSON.stringify(refused), /ineligible/)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  assert.equal((await r.app.adapter!.all('SELECT id FROM stock_picking')).length, 0)
  await r.save('sale.setOptionalSections', { id: 'order', expectedRevision: before.revision, sectionIds: [] })
  const refreshed = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(refreshed.amountTotal), 180)
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: refreshed.revision })
})

test('D31e optional section transition drops benefits without trying to edit immutable reward quantities', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Section benefit' } })
  await r.save('sale.addLine', {
    id: 'section',
    orderId: 'order',
    displayType: 'section',
    name: 'Optional',
    productUomQty: '0',
    sequence: 100,
  })
  await r.add({ productUomId: 'each', productUomQty: '2', sequence: 200 })
  const before = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.setOptionalSections', {
    id: 'order',
    expectedRevision: before.revision,
    sectionIds: ['section'],
  })
  const after = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(after.amountTotal), 0)
  assert.equal((after.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 0)
})

test('D31e variant matrix and inserted section template recalculate automatic benefits', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Matrix benefit' } })
  await r.save('product.saveAttributeDraft', {
    id: 'color',
    name: 'Color',
    createVariant: 'always',
    displayType: 'select',
    values: [
      { id: 'red', name: 'Red' },
      { id: 'blue', name: 'Blue' },
    ],
  })
  await r.save('product.saveRecord', {
    id: 'matrix',
    name: 'Matrix',
    defaultCode: 'MATRIX',
    type: 'goods',
    uomId: 'each',
    saleOk: true,
    listPrice: '100',
    saleVariantMode: 'matrix',
  })
  await r.save('product.configureAttributes', {
    templateId: 'matrix',
    lines: [{ attributeId: 'color', values: [{ valueId: 'red' }, { valueId: 'blue' }] }],
  })
  const matrix = await r.call('sale.getVariantMatrix', { id: 'order', templateId: 'matrix' })
  await r.save('sale.setVariantMatrix', {
    id: 'order',
    templateId: 'matrix',
    expectedRevision: (matrix.order as Row).revision,
    matrixRevision: matrix.matrixRevision,
    quantities: [{ productId: (matrix.rows as Row[])[0]!.id, quantity: '2' }],
  })
  let order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 180)
  await r.save('sale_template.saveTemplate', {
    id: 'section-template',
    name: 'Section',
    kind: 'section',
    expectedRevision: 0,
    lines: [{ productId: r.productId, productUomId: 'each', productUomQty: '1' }],
    teamIds: [],
  })
  await r.save('sale_template.addSection', {
    id: 'order',
    templateId: 'section-template',
    expectedRevision: order.revision,
    expectedTemplateRevision: 1,
  })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 270)
  const rows = order.lines as Row[]
  assert.ok(rows[rows.length - 1]!.loyaltyApplicationId)
})

test('D31e membership reserves the full spend before earning and confirmed benefits stay frozen', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const program = await r.save('loyalty_sale.saveProgram', {
    values: {
      name: 'Earn after spend',
      programType: 'loyalty',
      requiredPoints: '10',
      pointStep: '100',
      discount: '5',
    },
  })
  await r.save('loyalty.wallet.create', {
    id: 'wallet',
    programId: program.id,
    partnerId: 'buyer',
    initialBalance: '20',
  })
  const reward = (await r.app.adapter!.all('SELECT id FROM loyalty_reward'))[0]!
  await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: program.id, rewardId: reward.id })
  let order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.loyaltyPointsEarned), 1)
  assert.equal(Number((await r.app.adapter!.all('SELECT reserved FROM loyalty_wallet'))[0]!.reserved), 10)
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: order.revision })
  assert.equal(Number((await r.app.adapter!.all('SELECT balance FROM loyalty_wallet'))[0]!.balance), 11)
  order = await r.call('sale.getOrder', { id: 'order' })
  const benefits = (order.lines as Row[]).filter((row) => row.loyaltyApplicationId)
  await r.save('loyalty_sale.setProgramActive', { id: program.id, expectedRevision: 1, active: false })
  await r.save('sale.setCatalogueQuantity', {
    id: 'order',
    productId: r.productId,
    quantity: '3',
    expectedRevision: order.revision,
  })
  const after = await r.call('sale.getOrder', { id: 'order' })
  assert.deepEqual(
    (after.lines as Row[]).filter((row) => row.loyaltyApplicationId),
    benefits,
  )
  assert.equal(after.loyaltyState, 'finalized')
})

test('D31e replaying draft creation preserves its original benefits after a program changes', async (t) => {
  const r = await setup(t)
  const program = await r.save('loyalty_sale.saveProgram', { values: { name: 'Replay benefit' } })
  const input = {
    id: 'created',
    create: true,
    partnerId: 'buyer',
    warehouseId: 'wh',
    lines: [{ id: 'created-line', productId: r.productId, productUomId: 'each', productUomQty: '2' }],
  }
  await r.save('sale.saveDraft', input)
  const original = await r.call('sale.getOrder', { id: 'created' })
  assert.equal(Number(original.amountTotal), 180)
  await r.save('loyalty_sale.setProgramActive', { id: program.id, expectedRevision: 1, active: false })
  await r.save('sale.saveDraft', input)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'created' }), original)
})
