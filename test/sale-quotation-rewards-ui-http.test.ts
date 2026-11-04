import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('D31f native code errors distinguish missing, minimum quantity and already applied while retaining the quote', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '1' })
  await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Code', programType: 'promo_code', code: 'SAVE10', minimumQuantity: '2' },
  })
  const before = await r.call('sale.getOrder', { id: 'order' })
  for (const [code, reason] of [
    [' ', 'codeRequired'],
    ['UNKNOWN', 'codeNotFound'],
    ['SAVE10', 'codeQuantity'],
  ]) {
    const result = await r.call('loyalty_sale.applyCode', { orderId: 'order', code })
    assert.equal(result.ok, false)
    assert.match(JSON.stringify(result), new RegExp(reason!))
    assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  }
  await r.save('sale.updateLine', { id: 'line', expectedRevision: before.revision, productUomQty: '2' })
  await r.save('loyalty_sale.applyCode', { orderId: 'order', code: ' save10 ' })
  const applied = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(applied.amountTotal), 180)
  const duplicate = await r.call('loyalty_sale.applyCode', { orderId: 'order', code: 'SAVE10' })
  assert.match(JSON.stringify(duplicate), /codeApplied/)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), applied)
})

test('D31f quotation benefit read is scoped, read-only and retains historical applied facts', async (t) => {
  const r = await setup(t)
  const program = await r.save('loyalty_sale.saveProgram', { values: { name: 'Automatic' } })
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const read = await r.call('loyalty_sale.getQuotationBenefits', { orderId: 'order' })
  assert.equal((read.applied as Row[])[0]!.programId, program.id)
  assert.equal((read.applied as Row[])[0]!.discountAmount, '20')
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  assert.equal((await r.app.adapter!.all('SELECT id FROM loyalty_wallet')).length, 0)
  assert.equal(await r.fixture('loyalty_sale.getQuotationBenefits', { orderId: 'order' }, 'other'), null)
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: before.revision })
  await r.save('loyalty_sale.setProgramActive', { id: program.id, expectedRevision: 1, active: false })
  const historical = await r.call('loyalty_sale.getQuotationBenefits', { orderId: 'order' })
  assert.equal((historical.applied as Row[])[0]!.discountAmount, '20')
  assert.equal((historical.available as Row[]).length, 0)
})

for (const [name, values, expected] of [
  ['amount', { minimumAmount: '1000' }, 'codeAmount'],
  ['date', { startDate: '2099-01-01' }, 'codeDate'],
  ['nothing', {}, 'codeNothing'],
] as const) {
  test(`D31f code reports ${name} eligibility without changing the quotation`, async (t) => {
    const r = await setup(t)
    await r.add({ productUomId: 'each', productUomQty: '2' })
    await r.save('loyalty_sale.saveProgram', {
      values: { name, programType: 'promo_code', code: 'CHECK10', ...values },
    })
    if (name === 'nothing') {
      const order = await r.call('sale.getOrder', { id: 'order' })
      await r.save('sale.applyDiscount', {
        id: 'order',
        expectedRevision: order.revision,
        mode: 'amount',
        value: '200',
      })
    }
    const before = await r.call('sale.getOrder', { id: 'order' })
    const result = await r.call('loyalty_sale.applyCode', { orderId: 'order', code: 'CHECK10' })
    assert.equal(result.ok, false)
    assert.match(JSON.stringify(result), new RegExp(expected))
    assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  })
}

test('D31f coupon customer, expiry and used failures remain distinct', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const program = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Coupons', programType: 'coupons' },
  })
  await r.save('partner.savePartner', { id: 'another', kind: 'company', name: 'Another customer' })
  const foreign = await r.save('loyalty_sale.generateCoupons', {
    id: program.id,
    expectedRevision: (await r.call('loyalty_sale.getProgram', { id: program.id })).revision,
    count: 1,
    partnerId: 'another',
  })
  const apply = (code: unknown, orderId = 'order') => r.call('loyalty_sale.applyCode', { orderId, code })
  assert.match(JSON.stringify(await apply((foreign.codes as string[])[0])), /codeCustomer/)
  const expiring = await r.save('loyalty_sale.generateCoupons', {
    id: program.id,
    expectedRevision: (await r.call('loyalty_sale.getProgram', { id: program.id })).revision,
    count: 1,
    partnerId: 'buyer',
    expiresOn: '2090-01-01',
  })
  await r.save('sale.createOrder', {
    id: 'future',
    partnerId: 'buyer',
    warehouseId: 'wh',
    dateOrder: '2091-01-01T00:00:00Z',
  })
  await r.add({ id: 'future-line', orderId: 'future', productUomId: 'each', productUomQty: '2' })
  assert.match(JSON.stringify(await apply((expiring.codes as string[])[0], 'future')), /codeExpired/)
  const batch = await r.save('loyalty_sale.generateCoupons', {
    id: program.id,
    expectedRevision: (await r.call('loyalty_sale.getProgram', { id: program.id })).revision,
    count: 1,
    partnerId: 'buyer',
  })
  const code = (batch.codes as string[])[0]
  assert.equal((await apply(code)).ok, true)
  await r.save('sale.confirmOrder', { id: 'order' })
  assert.match(JSON.stringify(await apply(code, 'future')), /codeUsed/)
})

test('D31f membership cards are visible without exposing unrelated customer coupons or promotion token points', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Automatic' } })
  const member = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Member', programType: 'loyalty' },
  })
  await r.save('loyalty.wallet.create', {
    id: 'member',
    programId: member.id,
    partnerId: 'buyer',
    initialBalance: '20',
  })
  const coupon = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Unrelated coupons', programType: 'coupons' },
  })
  await r.save('loyalty_sale.generateCoupons', {
    id: coupon.id,
    expectedRevision: 1,
    count: 2,
    partnerId: 'buyer',
  })
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const result = await r.call('loyalty_sale.getQuotationBenefits', { orderId: 'order' })
  assert.equal(result.pointsEarned, 0)
  assert.deepEqual(
    (result.cards as Row[]).map((row) => row.id),
    ['member'],
  )
  assert.equal((result.cards as Row[])[0]!.available, 20)
})

test('D31f quotation context respects read-only grants and carries translated benefit and delivery messages', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Visible' } })
  await r.add({ productUomId: 'each', productUomQty: '2' })
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
  for (const fnKey of ['sale.getOrder'])
    await r.fixture('user.grantFunction', { id: 'grant-' + fnKey, roleId: 'viewer-role', fnKey })
  const viewer = r.app.client.anonymous()
  await viewer.login({ login: 'viewer', password: 'test-password' })
  const hidden = await viewer.get('/admin/sales/record/order/context?company=acme&lang=vi')
  const hiddenData = (await hidden.json()) as { data: { benefits: unknown; permissions: Row } }
  assert.equal(hiddenData.data.benefits, null)
  assert.equal(hiddenData.data.permissions.benefitRead, false)
  await r.fixture('user.grantFunction', {
    id: 'grant-benefits',
    roleId: 'viewer-role',
    fnKey: 'loyalty_sale.getQuotationBenefits',
  })
  const response = await viewer.get('/admin/sales/record/order/context?company=acme&lang=vi')
  assert.equal(response.status, 200)
  const result = (await response.json()) as {
    data: { permissions: Row; benefits: { applied: Row[] } }
    messages: Row
  }
  assert.equal(result.data.permissions.benefitRead, true)
  for (const key of ['benefitCode', 'benefitApply']) assert.equal(result.data.permissions[key], false)
  assert.equal(result.data.benefits.applied.length, 1)
  assert.equal(result.messages['loyalty_sale.error.codeNotFound'], 'Không tìm thấy mã này.')
  assert.equal(result.messages['stock_backend.state.done'], 'Hoàn tất')
  for (const [fn, input] of [
    ['applyCode', { orderId: 'order', code: 'FORGED' }],
    ['applyReward', { orderId: 'order', programId: 'program', rewardId: 'reward' }],
    ['removeReward', { orderId: 'order', programId: 'program' }],
  ] as const)
    await assert.rejects(
      viewer.call('loyalty_sale.' + fn, input),
      (error: unknown) => (error as { status: number }).status === 403,
    )
})

test('D31f code reports a wrong price list and exhausted program usage', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2' })
  await r.save('pricing.savePricelist', { id: 'vip', name: 'VIP', currency: 'VND' })
  await r.save('loyalty_sale.saveProgram', {
    values: { name: 'VIP code', programType: 'promo_code', code: 'VIP10', pricelistIds: ['vip'] },
  })
  assert.match(
    JSON.stringify(await r.call('loyalty_sale.applyCode', { orderId: 'order', code: 'VIP10' })),
    /codePricelist/,
  )
  await r.save('loyalty_sale.saveProgram', {
    values: { name: 'One use', programType: 'promo_code', code: 'ONCE10', maxUsage: 1 },
  })
  await r.save('loyalty_sale.applyCode', { orderId: 'order', code: 'ONCE10' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('sale.createOrder', { id: 'next', partnerId: 'buyer', warehouseId: 'wh' })
  await r.add({ id: 'next-line', orderId: 'next', productUomId: 'each', productUomQty: '2' })
  assert.match(
    JSON.stringify(await r.call('loyalty_sale.applyCode', { orderId: 'next', code: 'ONCE10' })),
    /codeUsage/,
  )
})

test('D31f card projection follows reserved membership spending and cancelled DS issuance', async (t) => {
  const r = await setup(t)
  const member = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Member', programType: 'loyalty', requiredPoints: '10', pointStep: '100', discount: '5' },
  })
  await r.save('loyalty.wallet.create', {
    id: 'member',
    programId: member.id,
    partnerId: 'buyer',
    initialBalance: '20',
  })
  await r.add({ productUomId: 'each', productUomQty: '2' })
  let read = await r.call('loyalty_sale.getQuotationBenefits', { orderId: 'order' })
  const reward = ((read.available as Row[])[0]!.rewards as Row[])[0]!
  await r.save('loyalty_sale.applyReward', {
    orderId: 'order',
    programId: member.id,
    rewardId: reward.rewardId,
  })
  read = await r.call('loyalty_sale.getQuotationBenefits', { orderId: 'order' })
  assert.equal(read.pointsEarned, 1)
  assert.equal(read.pointsSpent, 10)
  assert.equal((read.cards as Row[])[0]!.available, 10)
  await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Next order', programType: 'next_order_coupons' },
  })
  await r.save('sale.confirmOrder', { id: 'order' })
  read = await r.call('loyalty_sale.getQuotationBenefits', { orderId: 'order' })
  assert.equal(read.pointsEarned, 1)
  assert.equal(read.pointsSpent, 10)
  assert.equal((read.cards as Row[]).find((row) => row.id === 'member')!.available, 11)
  const coupon = (read.cards as Row[]).find((row) => row.type === 'next_order_coupons')!
  assert.match(String(coupon.code), /^DS-/)
  assert.equal(coupon.state, 'active')
  await r.save('sale.cancelOrder', { id: 'order' })
  read = await r.call('loyalty_sale.getQuotationBenefits', { orderId: 'order' })
  assert.equal((read.cards as Row[]).find((row) => row.id === 'member')!.available, 20)
  assert.equal((read.cards as Row[]).find((row) => row.id === coupon.id)!.state, 'cancelled')
})

test('D31f retrying code and removal with the same intent does not duplicate reward rows or revisions', async (t) => {
  const r = await setup(t)
  const program = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Replay', programType: 'promo_code', code: 'RETRY10' },
  })
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const apply = () =>
    r.app.client.call<Row>(
      'loyalty_sale.applyCode',
      { orderId: 'order', expectedRevision: before.revision, code: 'RETRY10' },
      { idempotencyKey: 'code-intent' },
    )
  const applied = (await apply()).value
  assert.equal(applied.ok, true)
  assert.deepEqual((await apply()).value, applied)
  const order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal((order.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 1)
  const remove = () =>
    r.app.client.call<Row>(
      'loyalty_sale.removeReward',
      { orderId: 'order', expectedRevision: order.revision, programId: program.id },
      { idempotencyKey: 'remove-intent' },
    )
  const removed = (await remove()).value
  assert.equal(removed.ok, true)
  const after = await r.call('sale.getOrder', { id: 'order' })
  assert.deepEqual((await remove()).value, removed)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), after)
  assert.equal(Number(after.amountTotal), 200)
})

test('D31f inactive program and insufficient membership points have explicit code errors', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const promo = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Inactive', programType: 'promo_code', code: 'OFF10' },
  })
  await r.save('loyalty_sale.setProgramActive', { id: promo.id, expectedRevision: 1, active: false })
  const before = await r.call('sale.getOrder', { id: 'order' })
  assert.match(
    JSON.stringify(await r.call('loyalty_sale.applyCode', { orderId: 'order', code: 'OFF10' })),
    /codeInactive/,
  )
  const member = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Member', programType: 'loyalty', requiredPoints: '10', pointStep: '1000' },
  })
  await r.save('loyalty.wallet.create', {
    id: 'member',
    programId: member.id,
    partnerId: 'buyer',
    initialBalance: '1',
  })
  const card = (await r.app.adapter!.all('SELECT code FROM loyalty_wallet'))[0]!
  assert.match(
    JSON.stringify(await r.call('loyalty_sale.applyCode', { orderId: 'order', code: card.code })),
    /codePoints/,
  )
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
})
