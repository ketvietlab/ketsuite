import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, migrateOne, schemaFromManifest, type Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

const copy = async (r: Awaited<ReturnType<typeof setup>>, id = 'copy', sourceId = 'order') => {
  const source = await r.call('sale.getOrder', { id: sourceId })
  return r.save('sale.copyOrder', { id, sourceId, expectedRevision: source.revision ?? 0 })
}

test('D31g copying a confirmed order starts a new dated draft without execution history', async (t) => {
  const r = await setup(t)
  await r.save('sale.createOrder', {
    id: 'historical',
    partnerId: 'buyer',
    warehouseId: 'wh',
    dateOrder: '2020-01-01T00:00:00Z',
    validityDate: '2020-01-15T00:00:00Z',
    clientOrderRef: 'CUSTOMER-OLD',
    notes: 'Commercial note',
  })
  await r.add({ id: 'old-line', orderId: 'historical', productUomId: 'each' })
  const draft = await r.call('sale.getOrder', { id: 'historical' })
  await r.save('sale.confirmOrder', { id: 'historical', expectedRevision: draft.revision })
  const source = await r.call('sale.getOrder', { id: 'historical' })
  const start = Date.now()
  await copy(r, 'copy', 'historical')
  const result = await r.call('sale.getOrder', { id: 'copy' })
  assert.equal(result.state, 'draft')
  assert.equal(result.locked, false)
  assert.ok(Date.parse(String(result.dateOrder)) >= start - 1000)
  assert.equal(Date.parse(String(result.validityDate)) - Date.parse(String(result.dateOrder)), 14 * 86400000)
  assert.equal(result.clientOrderRef, null)
  assert.equal(result.confirmedAt, null)
  assert.equal(result.notes, 'Commercial note')
  assert.notEqual(result.name, source.name)
  assert.deepEqual(result.pickings, [])
  assert.deepEqual(result.invoices, [])
  const line = (result.lines as Row[])[0]!
  assert.notEqual(line.id, 'old-line')
  assert.equal(Number(line.qtyDelivered), 0)
  assert.equal(Number(line.qtyInvoiced), 0)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'historical' }), source)
})

test('D31g copy replays once, rejects stale or conflicting requests and isolates companies', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each' })
  const source = await r.call('sale.getOrder', { id: 'order' })
  const input = { id: 'copy', sourceId: 'order', expectedRevision: source.revision }
  await r.save('sale.copyOrder', input)
  const before = await r.call('sale.getOrder', { id: 'copy' })
  await r.save('sale.copyOrder', input)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'copy' }), before)
  for (const change of [{ expectedRevision: -1 }, { sourceId: 'missing' }])
    assert.match(JSON.stringify(await r.call('sale.copyOrder', { ...input, ...change })), /copyConflict/)
  assert.match(
    JSON.stringify(await r.call('sale.copyOrder', { ...input, id: 'stale', expectedRevision: -1 })),
    /orderChanged/,
  )
  assert.match(JSON.stringify(await r.call('sale.copyOrder', { ...input, id: 'order' })), /copyConflict/)
  assert.match(
    JSON.stringify(await r.fixture('sale.copyOrder', { ...input, id: 'foreign' }, 'other')),
    /copySource/,
  )
  assert.equal(await r.call('sale.getOrder', { id: 'stale' }), null)
  assert.equal((await r.app.adapter!.all('SELECT id FROM sale_order_copy')).length, 1)
})

test('D31g copy recomputes current benefits and drops expired reusable codes', async (t) => {
  const r = await setup(t)
  await r.save('sale.createOrder', {
    id: 'past',
    partnerId: 'buyer',
    warehouseId: 'wh',
    dateOrder: '2020-01-01T00:00:00Z',
  })
  await r.save('loyalty_sale.saveProgram', {
    values: {
      name: 'Expired code',
      programType: 'promo_code',
      code: 'PAST10',
      endDate: '2020-12-31',
      discount: '10',
    },
  })
  await r.add({ id: 'past-line', orderId: 'past', productUomId: 'each' })
  await r.save('loyalty_sale.applyCode', { orderId: 'past', code: 'PAST10' })
  const source = await r.call('sale.getOrder', { id: 'past' })
  assert.equal(Number(source.amountTotal), 180)
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Current automatic', discount: '20' } })
  await copy(r, 'copy', 'past')
  const result = await r.call('sale.getOrder', { id: 'copy' })
  assert.equal(Number(result.amountTotal), 160)
  const benefits = await r.call('loyalty_sale.getQuotationBenefits', { orderId: 'copy' })
  assert.equal((benefits.applied as Row[]).length, 1)
  assert.equal((benefits.applied as Row[])[0]!.name, 'Current automatic')
  assert.deepEqual(await r.call('sale.getOrder', { id: 'past' }), source)
})

test('D31g copy retains valid reusable codes but does not copy coupon reservations', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Reusable', programType: 'promo_code', code: 'KEEP10', discount: '10' },
  })
  await r.add({ productUomId: 'each' })
  await r.save('loyalty_sale.applyCode', { orderId: 'order', code: 'KEEP10' })
  await copy(r)
  assert.equal(Number((await r.call('sale.getOrder', { id: 'copy' })).amountTotal), 180)
  const coupons = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Card', programType: 'coupons' },
  })
  const batch = await r.save('loyalty_sale.generateCoupons', {
    id: coupons.id,
    expectedRevision: 1,
    count: 1,
    partnerId: 'buyer',
  })
  await r.save('loyalty_sale.applyCode', { orderId: 'order', code: (batch.codes as string[])[0] })
  const ledgers = await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry')
  await copy(r, 'without-card')
  assert.equal(Number((await r.call('sale.getOrder', { id: 'without-card' })).amountTotal), 180)
  assert.deepEqual(await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry'), ledgers)
  await r.save('sale.cancelOrder', { id: 'order' })
  await copy(r, 'cancelled-copy')
  assert.equal(Number((await r.call('sale.getOrder', { id: 'cancelled-copy' })).amountTotal), 180)
})

test('D31g refused copying rolls back the new order, lines and receipt', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each' })
  const context = await r.call('product.templateModalContext', { id: 'goods', locale: 'en' })
  await r.save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    uomId: 'each',
    saleOk: false,
    expectedRevisionId: ((context.data as Row).record as Row).revisionId,
  })
  const source = await r.call('sale.getOrder', { id: 'order' })
  const result = await r.call('sale.copyOrder', {
    id: 'copy',
    sourceId: 'order',
    expectedRevision: source.revision,
  })
  assert.equal(result.ok, false)
  assert.equal(await r.call('sale.getOrder', { id: 'copy' }), null)
  assert.equal((await r.app.adapter!.all('SELECT id FROM sale_order_copy')).length, 0)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), source)
})

test('D31g copying structural, optional and free lines preserves intent with rebuilt tax discounts', async (t) => {
  const r = await setup(t)
  await r.save('account.saveTax', {
    id: 'vat',
    name: 'VAT',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await r.save('sale.addLine', {
    id: 'section',
    orderId: 'order',
    displayType: 'section',
    name: 'Optional',
    productUomQty: '0',
    sequence: 1,
  })
  await r.add({ productUomId: 'each', productUomQty: '0', sequence: 2 })
  await r.save('sale.addLine', {
    id: 'next',
    orderId: 'order',
    displayType: 'section',
    name: 'Services',
    productUomQty: '0',
    sequence: 3,
  })
  await r.save('sale.addLine', {
    id: 'free',
    orderId: 'order',
    name: 'Advice',
    productUomQty: '2',
    priceUnit: '100',
    taxIds: ['vat'],
    sequence: 4,
  })
  await r.save('sale.addLine', {
    id: 'note',
    orderId: 'order',
    displayType: 'note',
    name: 'Detailed terms',
    productUomQty: '0',
    sequence: 5,
  })
  const beforeOptional = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.setOptionalSections', {
    id: 'order',
    expectedRevision: beforeOptional.revision,
    sectionIds: ['section'],
  })
  const source = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.applyDiscount', {
    id: 'order',
    expectedRevision: source.revision,
    mode: 'amount',
    value: '20',
  })
  await copy(r)
  const result = await r.call('sale.getOrder', { id: 'copy' })
  assert.equal(Number(result.amountTotal), 198)
  const lines = result.lines as Row[]
  assert.equal(lines.find((row) => row.name === 'Optional')!.optionalSection, true)
  assert.equal(Number(lines.find((row) => row.productId === r.productId)!.productUomQty), 0)
  assert.equal(lines.find((row) => row.name === 'Advice')!.productId, null)
  assert.equal(lines.find((row) => row.name === 'Detailed terms')!.displayType, 'note')
  assert.equal(lines.filter((row) => row.lineKind === 'discount').length, 1)
})

test('D31g membership spending and earned history stay on the source; copied confirmation earns afresh', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each' })
  const program = await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Member', programType: 'loyalty', requiredPoints: '10', pointStep: '100', discount: '5' },
  })
  await r.save('loyalty.wallet.create', {
    id: 'member',
    programId: program.id,
    partnerId: 'buyer',
    initialBalance: '20',
  })
  const reward = (await r.app.adapter!.all('SELECT id FROM loyalty_reward'))[0]!
  await r.save('loyalty_sale.applyReward', { orderId: 'order', programId: program.id, rewardId: reward.id })
  const source = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: source.revision })
  const ledgers = await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry ORDER BY id')
  const wallets = await r.app.adapter!.all('SELECT * FROM loyalty_wallet ORDER BY id')
  await copy(r)
  assert.deepEqual(await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry ORDER BY id'), ledgers)
  assert.deepEqual(await r.app.adapter!.all('SELECT * FROM loyalty_wallet ORDER BY id'), wallets)
  const result = await r.call('sale.getOrder', { id: 'copy' })
  assert.equal(Number(result.amountTotal), 200)
  assert.equal((result.lines as Row[]).filter((row) => row.loyaltyApplicationId).length, 0)
  await r.save('sale.confirmOrder', { id: 'copy', expectedRevision: result.revision })
  const earned = await r.app.adapter!.all('SELECT * FROM loyalty_ledger_entry ORDER BY id')
  assert.equal(earned.length, ledgers.length + 1)
})

test('D31g copying retains optional template preferences and reprices only automatic lines', async (t) => {
  const r = await setup(t)
  await r.save('sale_template.saveTemplate', {
    id: 'template',
    name: 'Signature and deposit',
    expectedRevision: 0,
    requireSignature: true,
    requirePayment: true,
    prepaymentPercent: '30',
    teamIds: [],
    lines: [{ productId: r.productId, productUomId: 'each', productUomQty: '2' }],
  })
  await r.save('sale_template.applyQuotation', {
    id: 'order',
    templateId: 'template',
    expectedRevision: 0,
    expectedTemplateRevision: 1,
  })
  await r.add({ id: 'manual', productUomId: 'each', productUomQty: '1', priceUnit: '77' })
  // Advance catalogue pricing without changing the historical quotation.
  await r.app.adapter!.exec("UPDATE product_template SET \"listPrice\" = '150' WHERE id = 'goods'")
  const source = await r.call('sale.getOrder', { id: 'order' })
  await copy(r)
  const result = await r.call('sale.getOrder', { id: 'copy' })
  assert.equal(result.templateSignature, true)
  assert.equal(result.templatePayment, true)
  assert.equal(Number(result.templatePrepaymentPercent), 30)
  assert.equal(Number(result.amountTotal), 377)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), source)
})

test('D31g simultaneous retries create one copy and one benefit application', async (t) => {
  const r = await setup(t)
  await r.save('loyalty_sale.saveProgram', { values: { name: 'Automatic', discount: '10' } })
  await r.add({ productUomId: 'each' })
  const source = await r.call('sale.getOrder', { id: 'order' })
  const input = { id: 'copy', sourceId: 'order', expectedRevision: source.revision }
  const result = await Promise.all([r.call('sale.copyOrder', input), r.call('sale.copyOrder', input)])
  assert.ok(
    result.every((row) => row.ok === true),
    JSON.stringify(result),
  )
  const copied = await r.call('sale.getOrder', { id: 'copy' })
  assert.equal(Number(copied.amountTotal), 180)
  assert.equal((copied.lines as Row[]).length, 2)
  assert.equal((await r.app.adapter!.all('SELECT id FROM sale_order_copy')).length, 1)
})

test('D31g copy action and API require quotation write permission', async (t) => {
  const r = await setup(t)
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
  await r.fixture('user.grantFunction', { id: 'grant-read', roleId: 'viewer-role', fnKey: 'sale.getOrder' })
  const viewer = r.app.client.anonymous()
  await viewer.login({ login: 'viewer', password: 'test-password' })
  const response = await viewer.get('/admin/sales/record/order/context?company=acme&lang=en')
  const body = (await response.json()) as { data: { permissions: Row } }
  assert.equal(body.data.permissions.copyOrder, false)
  await assert.rejects(
    viewer.call('sale.copyOrder', { id: 'copy', sourceId: 'order', expectedRevision: 0 }),
    (error: unknown) => (error as { status: number }).status === 403,
  )
  assert.equal(await r.call('sale.getOrder', { id: 'copy' }), null)
})

test('D31g combo copies keep chosen products but regenerate child identities and fulfilment', async (t) => {
  const r = await setup(t)
  await r.save('product.saveRecord', {
    id: 'alternative',
    name: 'Alternative',
    defaultCode: 'ALT',
    type: 'goods',
    uomId: 'each',
    listPrice: '200',
    saleOk: true,
  })
  await r.save('product.saveCombo', {
    id: 'choice',
    name: 'Choose',
    items: [
      { productId: r.productId, extraPrice: '0' },
      { productId: 'alternative:default', extraPrice: '10' },
    ],
  })
  await r.save('product.saveRecord', {
    id: 'combo',
    name: 'Combo',
    defaultCode: 'COMBO',
    type: 'combo',
    uomId: 'each',
    listPrice: '100',
    comboIds: ['choice'],
    saleOk: true,
  })
  await r.add({ productId: 'combo:default', productUomId: 'each' })
  let source = await r.call('sale.getOrder', { id: 'order' })
  const child = (source.lines as Row[]).find((row) => row.comboParentId)!
  await r.save('sale.updateLine', {
    id: child.id,
    expectedRevision: source.revision,
    productId: 'alternative:default',
  })
  source = await r.call('sale.getOrder', { id: 'order' })
  await copy(r)
  const result = await r.call('sale.getOrder', { id: 'copy' })
  const lines = result.lines as Row[],
    newChild = lines.find((row) => row.comboParentId)!
  assert.equal(lines.length, 2)
  assert.equal(newChild.productId, 'alternative:default')
  assert.notEqual(newChild.id, child.id)
  assert.notEqual(newChild.comboParentId, 'line')
  assert.equal(Number(newChild.qtyDelivered), 0)
  assert.equal(Number(newChild.qtyInvoiced), 0)
  assert.equal(result.amountTotal, source.amountTotal)
})

test('D31g a failed benefit rebuild rolls back every copied row and the receipt', async (t) => {
  const r = await setup(t)
  await r.save('sale.saveDraft', {
    id: 'order',
    partnerId: 'buyer',
    warehouseId: 'wh',
    expectedRevision: 0,
    lines: Array.from({ length: 100 }, (_, i) => ({
      id: 'source-' + i,
      productId: r.productId,
      productUomId: 'each',
      productUomQty: '1',
    })),
  })
  await r.save('loyalty_sale.saveProgram', {
    values: {
      name: 'Fresh gift',
      programType: 'buy_x_get_y',
      minimumQuantity: '1',
      rewardProductId: r.productId,
    },
  })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const result = await r.call('sale.copyOrder', {
    id: 'copy',
    sourceId: 'order',
    expectedRevision: before.revision,
  })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result), /gridTooMany/)
  assert.equal(await r.call('sale.getOrder', { id: 'copy' }), null)
  assert.equal((await r.app.adapter!.all('SELECT id FROM sale_order_copy')).length, 0)
  assert.equal((await r.app.adapter!.all('SELECT id FROM loyalty_application')).length, 0)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
})

test('D31g competing sources cannot both claim the same destination', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each' })
  await r.save('sale.createOrder', { id: 'second', partnerId: 'buyer', warehouseId: 'wh' })
  await r.add({ id: 'second-line', orderId: 'second', productUomId: 'each', productUomQty: '3' })
  const [one, two] = await Promise.all(['order', 'second'].map((id) => r.call('sale.getOrder', { id })))
  const results = await Promise.all([
    r.call('sale.copyOrder', { id: 'copy', sourceId: 'order', expectedRevision: one!.revision }),
    r.call('sale.copyOrder', { id: 'copy', sourceId: 'second', expectedRevision: two!.revision }),
  ])
  assert.equal(results.filter((row) => row.ok === true).length, 1)
  assert.match(JSON.stringify(results.find((row) => row.ok === false)), /copyConflict/)
  const result = await r.call('sale.getOrder', { id: 'copy' })
  assert.equal((result.lines as Row[]).length, 1)
  assert.ok([200, 300].includes(Number(result.amountTotal)))
})

test('D31g an ID already owned by another company cannot be reused for a copy', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each' })
  await r.fixture(
    'partner.savePartner',
    { id: 'foreign-buyer', name: 'Foreign buyer', kind: 'company' },
    'other',
  )
  await r.fixture(
    'stock.saveWarehouse',
    { id: 'foreign-wh', name: 'Foreign warehouse', code: 'FWH' },
    'other',
  )
  await r.fixture(
    'sale.createOrder',
    { id: 'occupied', partnerId: 'foreign-buyer', warehouseId: 'foreign-wh' },
    'other',
  )
  const source = await r.call('sale.getOrder', { id: 'order' })
  const foreign = await r.fixture('sale.getOrder', { id: 'occupied' }, 'other')
  const result = await r.call('sale.copyOrder', {
    id: 'occupied',
    sourceId: 'order',
    expectedRevision: source.revision,
  })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result), /copyConflict/)
  assert.equal(await r.call('sale.getOrder', { id: 'occupied' }), null)
  assert.deepEqual(await r.fixture('sale.getOrder', { id: 'occupied' }, 'other'), foreign)
  assert.equal((await r.app.adapter!.all('SELECT id FROM sale_order_copy')).length, 0)
})

test('D31g the copy receipt migrates additively without rewriting existing orders', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each' })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const manifest = compose(r.deployment.modules, { headless: true, companies: true })
  const legacy = schemaFromManifest(manifest)
  delete legacy.tables.sale_order_copy
  const adapter = r.app.adapter!
  await adapter.exec('DROP TABLE sale_order_copy')
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(legacy)],
  )
  const changes = await migrateOne(adapter, manifest)
  assert.equal(
    changes.filter((change) => change.op === 'CREATE_TABLE' && change.table === 'sale_order_copy').length,
    1,
  )
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  assert.deepEqual(await migrateOne(adapter, manifest), [])
  await copy(r)
  assert.equal((await r.app.adapter!.all('SELECT id FROM sale_order_copy')).length, 1)
})

test('D31g copying keeps the source ordering when legacy lines share a sequence', async (t) => {
  const r = await setup(t)
  await r.save('sale.saveDraft', {
    id: 'order',
    partnerId: 'buyer',
    warehouseId: 'wh',
    expectedRevision: 0,
    lines: Array.from({ length: 10 }, (_, i) => ({
      id: 'free-' + i,
      name: 'Advice ' + i,
      productUomQty: '1',
      priceUnit: '10',
      sequence: 10,
    })),
  })
  await r.app.adapter!.exec('UPDATE sale_order_line SET sequence = 10 WHERE "orderId" = \'order\'')
  const source = await r.call('sale.getOrder', { id: 'order' })
  await copy(r)
  const result = await r.call('sale.getOrder', { id: 'copy' })
  assert.deepEqual(
    (result.lines as Row[]).map((row) => row.name),
    (source.lines as Row[]).map((row) => row.name),
  )
})
