import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, schemaFromManifest, type Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
async function seed(t: TestContext, shelfLifeMonths: number | null = 1) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', {
    templateId: 'goods',
    isStorable: true,
    tracking: 'lot',
    shelfLifeMonths,
    bestBeforeDays: 7,
    removalDays: 5,
    alertDays: 10,
  })
  const receipt = async (id = 'receipt', extra: Row = {}) => {
    await r.save('stock.createPicking', { id, name: id, pickingTypeId: 'wh:incoming', ...extra })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: '5',
    })
    await r.save('stock.confirmPicking', { id })
  }
  await receipt()
  const prepare = (extra: Row = {}) =>
    r.call('stock.prepareReceiptLot', { id: 'receipt-line', moveId: 'receipt-move', quantity: '5', ...extra })
  const complete = (id = 'receipt') => r.call('stock.completePicking', { id, createBackorder: false })
  const lots = async () => (await r.call('stock.listLots', { productId: r.productId })) as unknown as Row[]
  return { ...r, receipt, prepare, complete, lots }
}
test('K30 receipt drafts create no lots; completion atomically assigns the civil-day name and month-clamped expiry', async (t) => {
  const r = await seed(t)
  assert.equal((await r.prepare()).ok, true)
  assert.deepEqual(await r.lots(), [])
  assert.equal((await r.prepare()).ok, true)
  assert.equal((await r.complete()).ok, true)
  const [lot] = await r.lots()
  assert.equal(lot!.name, '300131')
  assert.equal(lot!.expirationDate, '2030-02-27T17:00:00.000Z')
  assert.equal(lot!.removalDate, '2030-02-22T17:00:00.000Z')
  assert.equal(lot!.alertDate, '2030-02-17T17:00:00.000Z')
  assert.equal((await r.complete()).ok, true)
  assert.equal((await r.lots()).length, 1)
  const quants = await r.app.adapter!.all(`SELECT quantity FROM stock_quant WHERE "locationId" = 'wh:stock'`)
  assert.equal(Number(quants[0]!.quantity), 5)
})
test('K30 named existing lots retain expiry and refuse a conflicting receipt date', async (t) => {
  const r = await seed(t)
  await r.save('stock.createLot', {
    id: 'known',
    productId: r.productId,
    name: 'BATCH-1',
    expirationDate: '2031-02-01T00:00:00.000Z',
  })
  const before = await r.lots()
  assert.equal((await r.prepare({ name: 'BATCH-1', expirationDate: '2031-02-02' })).ok, false)
  assert.equal((await r.prepare({ name: 'BATCH-1', expirationDate: '2031-02-01' })).ok, true)
  assert.equal((await r.complete()).ok, true)
  assert.deepEqual(await r.lots(), before)
  const picking = await r.call('stock.getPicking', { id: 'receipt' })
  assert.equal(((picking.moves as Row[])[0]!.lines as Row[])[0]!.lotId, 'known')
  // An undated draft naming that lot already displays the expiry completion will keep.
  await r.receipt('second')
  assert.equal((await r.prepare({ id: 'second-line', moveId: 'second-move', name: 'BATCH-1' })).ok, true)
  const draft = await r.call('stock.getPicking', { id: 'second' })
  const line = ((draft.moves as Row[])[0]!.lines as Row[])[0]!
  assert.equal(line.lotId, null)
  assert.equal(line.receiptExpiryDate, '2031-02-01')
})
test('K30 invalid or expired new lot input never writes a draft or lot', async (t) => {
  const r = await seed(t, null)
  for (const args of [
    {},
    { name: '!bad', expirationDate: '2031-01-01' },
    { name: 'A'.repeat(41), expirationDate: '2031-01-01' },
    { expirationDate: '2030-02-30' },
    { expirationDate: '2030-01-31' },
    { expirationDate: '2029-12-31' },
  ])
    assert.equal((await r.prepare(args)).ok, false, JSON.stringify(args))
  assert.deepEqual(await r.lots(), [])
  assert.equal(
    (await r.app.adapter!.all(`SELECT id FROM stock_move_line WHERE "pickingId" = 'receipt'`)).length,
    0,
  )
})
test('K30 completion rechecks expiry and rolls back lots plus stock when the whole receipt exceeds demand', async (t) => {
  const r = await seed(t)
  assert.equal((await r.prepare({ quantity: '3' })).ok, true)
  assert.equal((await r.prepare({ id: 'receipt-line-2', quantity: '3' })).ok, true)
  assert.equal((await r.complete()).ok, false)
  assert.deepEqual(await r.lots(), [])
  assert.equal(
    (await r.app.adapter!.all(`SELECT id FROM stock_quant WHERE "productId" = 'goods:default'`)).length,
    0,
  )
  assert.equal((await r.call('stock.getPicking', { id: 'receipt' })).state, 'confirmed')
})
test('K30 an explicitly dated draft cannot create an expired lot on a later completion day', async (t) => {
  const r = await seed(t)
  assert.equal((await r.prepare({ expirationDate: '2030-02-01' })).ok, true)
  t.mock.timers.setTime(new Date('2030-02-01T05:00:00.000Z').getTime())
  assert.equal((await r.complete()).ok, false)
  assert.deepEqual(await r.lots(), [])
})
test('K30 concurrent receipts allocate distinct generated names and completion retries do not duplicate lots', async (t) => {
  const r = await seed(t)
  await r.receipt('second')
  assert.equal((await r.prepare()).ok, true)
  assert.equal((await r.prepare({ id: 'second-line', moveId: 'second-move' })).ok, true)
  const ids = ['receipt', 'second']
  const results = await Promise.allSettled(ids.map((id) => r.complete(id)))
  for (const [i, result] of results.entries())
    if (result.status === 'rejected' || result.value.ok !== true)
      assert.equal((await r.complete(ids[i])).ok, true)
  assert.deepEqual((await r.lots()).map((lot) => lot.name).sort(), ['300131', '300131-2'])
  for (const id of ids) assert.equal((await r.complete(id)).ok, true)
  assert.equal((await r.lots()).length, 2)
})
test('K30 production receipts set manufacturing date; wrong directions and line ownership are refused', async (t) => {
  const r = await seed(t)
  await r.save('stock.saveLocation', { id: 'factory', name: 'Factory', usage: 'production' })
  await r.receipt('factory-receipt', { locationId: 'factory' })
  assert.equal((await r.prepare({ id: 'factory-line', moveId: 'factory-receipt-move' })).ok, true)
  assert.equal((await r.complete('factory-receipt')).ok, true)
  assert.equal((await r.lots())[0]!.manufacturingDate, '2030-01-30T17:00:00.000Z')
  assert.equal((await r.prepare({ id: 'factory-line' })).ok, false)
  // A current revision must not let one move's draft line be re-parented onto another move.
  await r.receipt('second')
  assert.equal((await r.prepare({ id: 'second-line', moveId: 'second-move', quantity: '2' })).ok, true)
  const second = await r.call('stock.getPicking', { id: 'second' })
  const foreign = ((second.moves as Row[])[0]!.lines as Row[])[0]!
  const moved = await r.prepare({ id: 'second-line', expectedRevision: foreign.receiptRevision })
  assert.equal(((moved.errors as Row[])[0] as Row).messageKey, 'stock.error.receiptLineOwnership')
  assert.deepEqual(await r.call('stock.getPicking', { id: 'second' }), second)
  await r.receipt('outgoing', { pickingTypeId: 'wh:outgoing' })
  const outgoing = await r.prepare({ id: 'out-line', moveId: 'outgoing-move' })
  assert.equal(((outgoing.errors as Row[])[0] as Row).messageKey, 'stock.error.receiptLotOnly')
})

test('K30 nullable receipt-intent migration preserves old lines and is replayable', async (t) => {
  const r = await seed(t)
  await r.save('stock.createLot', {
    id: 'old',
    productId: r.productId,
    name: 'OLD',
    expirationDate: '2031-01-01T00:00:00.000Z',
  })
  await r.save('stock.saveMoveLine', {
    id: 'old-line',
    moveId: 'receipt-move',
    quantity: '2',
    lotId: 'old',
    picked: true,
  })
  const adapter = r.app.adapter!
  const manifest = compose(r.deployment.modules, { headless: true, companies: true })
  const legacy = schemaFromManifest(manifest)
  const fields = ['receiptLotName', 'receiptExpirationDate']
  for (const field of fields) {
    delete legacy.tables.stock_move_line!.columns[field]
    await adapter.exec(`ALTER TABLE stock_move_line DROP COLUMN "${field}"`)
  }
  const before = await adapter.all('SELECT * FROM stock_move_line')
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(legacy)],
  )
  assert.equal((await migrateOne(adapter, manifest)).filter((change) => change.op === 'ADD_COLUMN').length, 2)
  const after = await adapter.all('SELECT * FROM stock_move_line')
  assert.deepEqual(
    after.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)))),
    before.map((row) => ({ ...row })),
  )
  assert.ok(after.every((row) => fields.every((field) => row[field] == null)))
  assert.deepEqual(await migrateOne(adapter, manifest), [])
})
test('K30 receipt preparation needs its own grant and cannot target another company move', async (t) => {
  const r = await seed(t)
  await r.fixture('user.saveRole', { id: 'receiver', name: 'Receiver' })
  await r.fixture('user.createUser', {
    id: 'receiver',
    login: 'receiver',
    password: 'test-password',
    name: 'Receiver',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'receiver-company', userId: 'receiver', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'receiver-role', userId: 'receiver', roleId: 'receiver' })
  const client = r.app.client.anonymous()
  await client.login({ login: 'receiver', password: 'test-password' })
  const args = { id: 'receipt-line', moveId: 'receipt-move', quantity: '5' }
  await assert.rejects(
    () => client.call('stock.prepareReceiptLot', args),
    (error: unknown) => (error as { status?: number }).status === 403,
  )
  await r.fixture('user.grantFunction', {
    id: 'receiver-prepare',
    roleId: 'receiver',
    fnKey: 'stock.prepareReceiptLot',
  })
  assert.equal((await client.call<Row>('stock.prepareReceiptLot', args)).value.ok, true)
  assert.equal((await r.fixture('stock.prepareReceiptLot', { ...args, id: 'foreign' }, 'other')).ok, false)
  assert.deepEqual(await r.lots(), [])
})
test('K30 zero completion does not create a lot for a prepared receipt line', async (t) => {
  const r = await seed(t)
  assert.equal((await r.prepare()).ok, true)
  assert.equal(
    (
      await r.call('stock.completePicking', {
        id: 'receipt',
        quantities: [{ moveLineId: 'receipt-line', quantity: 0 }],
        createBackorder: false,
      })
    ).ok,
    true,
  )
  assert.deepEqual(await r.lots(), [])
})

test('K30 concurrent receipt draft edits reject stale input and exact replay remains a no-op', async (t) => {
  const r = await seed(t)
  assert.equal((await r.prepare({ quantity: '2' })).ok, true)
  const before = await r.call('stock.getPicking', { id: 'receipt' })
  const line = ((before.moves as Row[])[0]!.lines as Row[])[0]!
  const results = await Promise.all(
    ['3', '4'].map((quantity) => r.prepare({ quantity, expectedRevision: line.receiptRevision })),
  )
  assert.equal(results.filter((result) => result.ok === true).length, 1)
  assert.equal((await r.prepare({ quantity: '1', expectedRevision: line.receiptRevision })).ok, false)
  const after = await r.call('stock.getPicking', { id: 'receipt' })
  const saved = ((after.moves as Row[])[0]!.lines as Row[])[0]!
  assert.equal(
    (await r.prepare({ quantity: saved.quantity, expectedRevision: line.receiptRevision })).ok,
    true,
  )
  assert.deepEqual(await r.call('stock.getPicking', { id: 'receipt' }), after)
  assert.deepEqual(await r.lots(), [])
})

test('C24 a lot the picked grid names is created when the page completes the receipt', async (t) => {
  const r = await seed(t)
  const saved = await r.call('stock.savePickingLines', {
    id: 'receipt',
    lines: [
      {
        id: 'grid-line',
        moveId: 'receipt-move',
        quantity: '5',
        name: 'SR-3001',
        expirationDate: '2031-01-31',
        picked: true,
      },
    ],
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const line = ((await r.call('stock.getPicking', { id: 'receipt' })).moves as Row[])[0]!.lines as Row[]
  assert.deepEqual(
    line.map((row) => [row.id, Number(row.quantity), row.receiptLotName]),
    [['grid-line', 5, 'SR-3001']],
  )
  const done = await r.call('stock.validatePicking', { id: 'receipt', backorder: 'create' })
  assert.equal(done.ok, true, JSON.stringify(done))
  // Named and dated as typed: the expiry is that civil day in Hà Nội.
  assert.deepEqual(
    (await r.lots()).map((lot) => [lot.name, lot.expirationDate]),
    [['SR-3001', '2031-01-30T17:00:00.000Z']],
  )
})
