import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, migrateOne, schemaFromManifest, type Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

async function seeded(t: Parameters<typeof setup>[0]) {
  const r = await setup(t)
  for (const [id, displayType, name, sequence] of [
    ['section', 'section', 'Optional equipment', 100],
    ['note', 'note', 'Keep this note', 300],
    ['next', 'section', 'Main service', 500],
  ] as const)
    await r.save('sale.addLine', { id, orderId: 'order', displayType, name, sequence, productUomQty: '0' })
  await r.save('account.saveTax', {
    id: 'vat',
    name: 'VAT',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await r.save('sale.addLine', {
    id: 'goods-line',
    orderId: 'order',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '2',
    priceUnit: '100',
    sequence: 200,
    taxIds: ['vat'],
  })
  await r.save('sale.addLine', {
    id: 'free-line',
    orderId: 'order',
    name: 'Installation',
    productUomQty: '1',
    priceUnit: '100',
    sequence: 400,
  })
  await r.save('sale.addLine', {
    id: 'main-line',
    orderId: 'order',
    name: 'Main service',
    productUomQty: '1',
    priceUnit: '50',
    sequence: 600,
  })
  const read = () => r.call('sale.getOrder', { id: 'order' })
  const select = async (sectionIds: string[], revision?: unknown) =>
    r.call('sale.setOptionalSections', {
      id: 'order',
      sectionIds,
      expectedRevision: revision ?? (await read()).revision,
    })
  return { ...r, read, select }
}

test('D25 transition resets only section contents; replay and uncheck preserve subsequently selected quantities', async (t) => {
  const r = await seeded(t)
  assert.equal(Number((await r.read()).amountTotal), 370)
  assert.equal((await r.select(['section'])).ok, true)
  let order = await r.read()
  const find = (id: string) => (order.lines as Row[]).find((line) => line.id === id)!
  assert.equal(Number(order.amountTotal), 50)
  assert.equal(find('section').optionalSection, true)
  assert.equal(Number(find('goods-line').productUomQty), 0)
  assert.equal(Number(find('free-line').productUomQty), 0, 'notes do not end a section')
  assert.equal(Number(find('main-line').productUomQty), 1)
  await r.save('sale.updateLine', { id: 'goods-line', expectedRevision: order.revision, productUomQty: '3' })
  order = await r.read()
  const version = order.revision
  assert.equal((await r.select(['section'])).ok, true)
  order = await r.read()
  assert.equal(order.revision, version)
  assert.equal(Number(find('goods-line').productUomQty), 3)
  assert.equal((await r.select([])).ok, true)
  order = await r.read()
  assert.equal(Number(find('goods-line').productUomQty), 3)
  assert.equal(find('section').optionalSection, false)
  assert.equal((await r.select(['section'])).ok, true)
  order = await r.read()
  assert.equal(Number(find('goods-line').productUomQty), 0)
})

test('D25 marking another section optional leaves the quantities set in one already optional', async (t) => {
  const r = await seeded(t)
  assert.equal((await r.select(['section'])).ok, true)
  let order = await r.read()
  const find = (id: string) => (order.lines as Row[]).find((line) => line.id === id)!
  await r.save('sale.updateLine', { id: 'goods-line', expectedRevision: order.revision, productUomQty: '3' })
  assert.equal((await r.select(['section', 'next'])).ok, true)
  order = await r.read()
  assert.equal(Number(find('goods-line').productUomQty), 3)
  assert.equal(Number(find('main-line').productUomQty), 0)
  assert.equal(find('next').optionalSection, true)
})

test('D25 ownership, stale versions and concurrent writes are enforced atomically', async (t) => {
  const r = await seeded(t)
  const before = await r.read()
  for (const ids of [['note'], ['unknown'], ['section', 'section']])
    assert.equal((await r.select(ids)).ok, false)
  assert.equal(
    (
      await r.fixture(
        'sale.setOptionalSections',
        { id: 'order', sectionIds: ['section'], expectedRevision: before.revision },
        'other',
      )
    ).ok,
    false,
  )
  assert.deepEqual(await r.read(), before)
  const results = await Promise.all([
    r.select(['section'], before.revision),
    r.select(['next'], before.revision),
  ])
  assert.equal(results.filter((row) => row.ok).length, 1)
  assert.equal((await r.select([], before.revision)).ok, false)
})

test('D25 zero and structural rows survive confirmation without fulfillment or structural costs', async (t) => {
  const r = await seeded(t)
  assert.equal((await r.select(['section'])).ok, true)
  await r.save('sale.removeLine', { id: 'free-line' })
  await r.save('sale.removeLine', { id: 'main-line' })
  await r.save('sale.saveConfiguration', { requireProduct: true, expectedRevision: 0 })
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: (await r.read()).revision })
  assert.equal(((await r.read()).lines as Row[]).length, 4)
  assert.equal((await r.app.adapter!.all('SELECT id FROM stock_move')).length, 0)
  const costs = (await r.app.client.call<Row[]>('sale.getLineCosts', { id: 'order' })).value
  assert.deepEqual(
    costs.map((line) => line.lineId),
    ['goods-line'],
  )
  assert.equal((await r.select([])).ok, false)
})

test('D25 invoices include only positive commercial quantities; account quote still rejects zero', async (t) => {
  const r = await seeded(t)
  assert.equal((await r.select(['section'])).ok, true)
  await r.save('sale.confirmOrder', { id: 'order' })
  for (const [id, code, accountType] of [
    ['revenue', 'REV', 'income'],
    ['receivable', 'REC', 'asset_receivable'],
  ])
    await r.save('account.saveAccount', { id, code, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  await r.save('sale.createInvoice', {
    id: 'invoice',
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  const lines = await r.app.adapter!.all(
    'SELECT "saleLineId", quantity FROM account_move_line WHERE "saleLineId" IS NOT NULL',
  )
  assert.equal(lines.length, 1)
  assert.equal(lines[0]!.saleLineId, 'main-line')
  assert.equal(Number(lines[0]!.quantity), 1)
  assert.equal((await r.call('account.quoteLine', { quantity: '0', priceUnit: '10', taxIds: [] })).ok, false)
})

test('D25 grid accepts structural rows and rejects forged kind, amounts or optional flags', async (t) => {
  const r = await setup(t)
  const grid = async (values: Row) =>
    r.call('sale.applyLineGrid', {
      id: 'order',
      expectedRevision: (await r.call('sale.getOrder', { id: 'order' })).revision,
      changes: { added: [{ id: 'new', index: 0, values }], updated: [], removed: [], order: null },
    })
  for (const values of [
    { displayType: 'section', name: ' ', productUomQty: 0 },
    { displayType: 'section', name: 'Forged', productUomQty: 1 },
    { displayType: 'section', name: 'Forged', productUomQty: 0, productId: r.productId },
    { displayType: 'section', name: 'Forged', productUomQty: 0, optionalSection: true },
    { displayType: 'other', name: 'Forged', productUomQty: 0 },
  ])
    assert.equal((await grid(values)).ok, false)
  assert.equal((await grid({ displayType: 'section', name: '  Section  ', productUomQty: 0 })).ok, true)
  const order = await r.call('sale.getOrder', { id: 'order' })
  const line = (order.lines as Row[])[0]!
  assert.equal(line.name, 'Section')
  assert.equal(line.optionalSection, false)
  assert.equal(Number(order.amountTotal), 0)
  assert.equal((await r.call('sale.confirmOrder', { id: 'order' })).ok, false)
  assert.equal(
    (await r.call('sale.updateLine', { id: line.id, expectedRevision: order.revision, productUomQty: '2' }))
      .ok,
    false,
  )
})

test('D25 optional writes require grants and reject locked quotations', async (t) => {
  const r = await seeded(t)
  await r.fixture('user.createUser', {
    id: 'viewer',
    login: 'viewer',
    password: 'test-password',
    name: 'Viewer',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'viewer-company', userId: 'viewer', companyId: 'acme' })
  const viewer = r.app.client.anonymous()
  await viewer.login({ login: 'viewer', password: 'test-password' })
  await assert.rejects(
    () => viewer.call('sale.setOptionalSections', { id: 'order', sectionIds: [], expectedRevision: 0 }),
    (error: unknown) => (error as { status: number }).status === 403,
  )
  await r.app.adapter!.exec(`UPDATE sale_order SET locked = TRUE WHERE id = 'order'`)
  assert.equal((await r.select(['section'])).ok, false)
})

test('D25 additive nullable schema preserves existing rows and replays without changes', async (t) => {
  const r = await setup(t)
  await r.add()
  const adapter = r.app.adapter!
  const manifest = compose(r.deployment.modules, { headless: true, companies: true })
  const schema = schemaFromManifest(manifest)
  const fields = ['displayType', 'optionalSection']
  const legacy = structuredClone(schema)
  for (const field of fields) {
    delete legacy.tables.sale_order_line!.columns[field]
    await adapter.exec(`ALTER TABLE sale_order_line DROP COLUMN "${field}"`)
  }
  const before = await adapter.all('SELECT * FROM sale_order_line')
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(legacy)],
  )
  assert.equal((await migrateOne(adapter, manifest)).filter((change) => change.op === 'ADD_COLUMN').length, 2)
  const after = await adapter.all('SELECT * FROM sale_order_line')
  assert.deepEqual(
    after.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)))),
    before.map((row) => ({ ...row })),
  )
  assert.deepEqual(await migrateOne(adapter, manifest), [])
})

test('D25 optional combo parents zero their children and can restore selected quantities', async (t) => {
  const r = await setup(t)
  await r.save('product.saveCombo', {
    id: 'choice',
    name: 'Choice',
    items: [{ productId: r.productId, extraPrice: '5' }],
  })
  await r.save('product.saveRecord', {
    id: 'combo',
    name: 'Combo',
    defaultCode: 'COMBO',
    type: 'combo',
    uomId: 'each',
    comboIds: ['choice'],
    listPrice: '100',
    saleOk: true,
  })
  await r.save('sale.addLine', {
    id: 'section',
    orderId: 'order',
    displayType: 'section',
    name: 'Equipment',
    productUomQty: '0',
    sequence: 100,
  })
  await r.save('sale.addLine', {
    id: 'parent',
    orderId: 'order',
    productId: 'combo:default',
    productUomId: 'each',
    productUomQty: '2',
    sequence: 200,
  })
  let order = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.setOptionalSections', {
    id: 'order',
    expectedRevision: order.revision,
    sectionIds: ['section'],
  })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 0)
  for (const line of order.lines as Row[]) assert.equal(Number(line.productUomQty), 0)
  await r.save('sale.updateLine', { id: 'parent', expectedRevision: order.revision, productUomQty: '3' })
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 315)
  assert.equal(Number((order.lines as Row[]).find((line) => line.comboParentId)!.productUomQty), 3)
})

test('D25 optional selection preserves historical references on a reopened quotation', async (t) => {
  const r = await seeded(t)
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.app.adapter!.run("UPDATE sale_order SET state = 'draft' WHERE id = 'order'")
  const before = await r.read()
  const moves = await r.app.adapter!.all('SELECT * FROM stock_move')
  assert.equal((await r.select(['section'])).ok, false)
  assert.deepEqual(await r.read(), before)
  assert.deepEqual(await r.app.adapter!.all('SELECT * FROM stock_move'), moves)
})
