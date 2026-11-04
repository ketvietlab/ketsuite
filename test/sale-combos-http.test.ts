import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { compose, migrateOne, schemaFromManifest } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
import { comboShares } from '../packages/ketsuite/src/modules/sale/combo-lines.ts'

async function seed(t: TestContext) {
  const run = await setup(t)
  for (const [id, price] of [
    ['second', '200'],
    ['alternative', '300'],
  ])
    await run.save('product.saveRecord', {
      id,
      name: id,
      type: 'goods',
      defaultCode: id.toUpperCase(),
      uomId: 'each',
      listPrice: price,
      saleOk: true,
    })
  await run.save('product.saveCombo', {
    id: 'choice-a',
    name: 'Choice A',
    items: [
      { productId: 'goods:default', extraPrice: '0' },
      { productId: 'alternative:default', extraPrice: '10' },
    ],
  })
  await run.save('product.saveCombo', {
    id: 'choice-b',
    name: 'Choice B',
    items: [{ productId: 'second:default', extraPrice: '2' }],
  })
  await run.save('product.saveRecord', {
    id: 'combo',
    name: 'Combo',
    defaultCode: 'COMBO',
    type: 'combo',
    uomId: 'each',
    comboIds: ['choice-a', 'choice-b'],
    listPrice: '101',
    saleOk: true,
  })
  const add = (extra: Row = {}) =>
    run.save('sale.addLine', {
      id: 'parent',
      orderId: 'order',
      productId: 'combo:default',
      productUomId: 'each',
      productUomQty: '2',
      ...extra,
    })
  const order = () => run.call('sale.getOrder', { id: 'order' })
  const grid = async (changes: Row) =>
    run.call('sale.applyLineGrid', {
      id: 'order',
      expectedRevision: (await order()).revision,
      changes: { added: [], updated: [], removed: [], order: null, ...changes },
    })
  return { ...run, add, order, grid }
}

test('R10 exact allocation retains every minor unit and adds item extras', () => {
  assert.deepEqual(comboShares('101', ['100', '200'], ['0', '2'], 'VND'), ['33', '70'])
  assert.deepEqual(comboShares('5', ['0', '0', '0'], ['0', '0', '0'], 'VND'), ['1', '1', '3'])
  assert.deepEqual(comboShares('0.05', ['0.1', '0.2'], ['0', '0'], 'USD'), ['0.01', '0.04'])
  assert.deepEqual(comboShares('9007199254740993', ['1', '1'], ['0', '0'], 'VND'), [
    '4503599627370496',
    '4503599627370497',
  ])
})

test('R10 additive line schema preserves legacy quotations and replays safely', async (t) => {
  const run = await setup(t)
  await run.add()
  const adapter = run.app.adapter!
  const manifest = compose(run.deployment.modules, { headless: true, companies: true })
  const schema = schemaFromManifest(manifest)
  const fields = ['comboBasePrice', 'comboParentId', 'comboChoiceId']
  const legacy = structuredClone(schema)
  for (const field of fields) delete legacy.tables.sale_order_line!.columns[field]
  if (adapter.name !== 'postgres') {
    const indexes = await adapter.all(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sale_order_line'`,
    )
    for (const index of indexes)
      if (fields.some((field) => String(index.sql).includes(field)))
        await adapter.exec(`DROP INDEX "${String(index.name).replaceAll('"', '""')}"`)
  }
  for (const field of fields) await adapter.exec(`ALTER TABLE sale_order_line DROP COLUMN "${field}"`)
  const before = await adapter.all('SELECT * FROM sale_order_line')
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(legacy)],
  )
  const changes = await migrateOne(adapter, manifest)
  assert.equal(changes.filter((change) => change.op === 'ADD_COLUMN').length, 3)
  const after = await adapter.all('SELECT * FROM sale_order_line')
  assert.deepEqual(
    after.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)))),
    before.map((row) => ({ ...row })),
  )
  assert.ok(after.every((row) => fields.every((field) => row[field] == null)))
  assert.deepEqual(await migrateOne(adapter, manifest), [])
})

test('R10 competing combo edits serialize by order revision and a foreign company cannot mutate children', async (t) => {
  const run = await seed(t)
  await run.add()
  const before = await run.order()
  const child = (before.lines as Row[]).find((row) => row.comboChoiceId === 'choice-a')!
  const results = await Promise.allSettled([
    run.call('sale.updateLine', {
      id: child.id,
      expectedRevision: before.revision,
      productId: 'alternative:default',
    }),
    run.call('sale.updateLine', { id: 'parent', expectedRevision: before.revision, productUomQty: '3' }),
  ])
  assert.equal(
    results.filter((result) => result.status === 'fulfilled' && result.value.ok === true).length,
    1,
  )
  const after = await run.order()
  assert.equal((after.lines as Row[]).length, 3)
  assert.ok(
    (after.lines as Row[]).every(
      (row) => row.productUomQty === (after.lines as Row[]).find((row) => row.id === 'parent')!.productUomQty,
    ),
  )
  assert.equal(
    (
      await run.fixture(
        'sale.updateLine',
        { id: child.id, expectedRevision: after.revision, productId: 'alternative:default' },
        'other',
      )
    ).ok,
    false,
  )
  assert.deepEqual(await run.order(), after)
})

test('R10 confirmation racing combo insertion cannot omit its item moves', async (t) => {
  const run = await seed(t)
  const results = await Promise.allSettled([
    run.call('sale.addLine', {
      id: 'parent',
      orderId: 'order',
      productId: 'combo:default',
      productUomId: 'each',
      productUomQty: '1',
    }),
    run.call('sale.confirmOrder', { id: 'order' }),
  ])
  assert.ok(results.some((result) => result.status === 'fulfilled' && result.value.ok === true))
  let order = await run.order()
  if (order.state !== 'sale') {
    if (!(order.lines as Row[]).length) await run.add()
    await run.save('sale.confirmOrder', { id: 'order' })
    order = await run.order()
  }
  assert.equal((order.lines as Row[]).length, 3)
  assert.equal((order.moves as Row[]).length, 2)
  assert.ok((order.moves as Row[]).every((move) => move.productId !== 'combo:default'))
})

test('R10 picked demand cannot shrink and concurrent invoices cannot bill the same items twice', async (t) => {
  const run = await seed(t)
  for (const id of ['goods', 'second'])
    await run.save('stock.configureProduct', { templateId: id, isStorable: true, tracking: 'none' })
  await run.save('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  for (const id of ['goods', 'second'])
    await run.save('stock.adjustInventory', {
      id: `opening-${id}`,
      productId: `${id}:default`,
      locationId: 'wh:stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '10',
      productUomId: 'each',
    })
  await run.add()
  await run.save('sale.confirmOrder', { id: 'order' })
  const order = await run.order()
  await run.save('stock.confirmPicking', { id: 'order:delivery' })
  for (const move of order.moves as Row[]) await run.save('stock.reserveMove', { id: move.id })
  const [picked] = await run.app.adapter!.all(
    `SELECT id, "moveId", quantity FROM stock_move_line WHERE "pickingId" = 'order:delivery' LIMIT 1`,
  )
  await run.save('stock.saveMoveLine', {
    id: picked!.id,
    moveId: picked!.moveId,
    quantity: picked!.quantity,
    picked: true,
  })
  const before = await run.order()
  assert.equal(
    (
      await run.call('sale.updateLine', {
        id: 'parent',
        expectedRevision: before.revision,
        productUomQty: '1',
      })
    ).ok,
    false,
  )
  assert.deepEqual(await run.order(), before)
  for (const [id, code, accountType] of [
    ['revenue', 'REV', 'income'],
    ['receivable', 'REC', 'asset_receivable'],
  ])
    await run.save('account.saveAccount', { id, code, name: id, accountType })
  await run.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  const invoice = {
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  }
  const results = await Promise.allSettled(
    ['invoice-a', 'invoice-b'].map((id) => run.call('sale.createInvoice', { id, ...invoice })),
  )
  assert.equal(
    results.filter((result) => result.status === 'fulfilled' && result.value.ok === true).length,
    1,
  )
  const after = await run.order()
  assert.ok((after.lines as Row[]).filter((row) => row.comboParentId).every((row) => row.qtyInvoiced === '2'))
  assert.equal((after.invoices as Row[]).length, 1)
})

test('R10 creates one child per choice and replays without duplicates', async (t) => {
  const run = await seed(t)
  await run.add()
  let order = await run.order()
  const lines = order.lines as Row[]
  assert.equal(lines.length, 3)
  const parent = lines.find((line) => line.id === 'parent')!
  assert.equal(parent.priceUnit, '0')
  assert.equal(parent.comboBasePrice, '101')
  assert.equal(order.amountUntaxed, '206')
  assert.deepEqual(
    lines
      .filter((line) => line.comboParentId)
      .map((line) => [line.productId, line.priceUnit, line.productUomQty]),
    [
      ['goods:default', '33', '2'],
      ['second:default', '70', '2'],
    ],
  )
  await run.add()
  order = await run.order()
  assert.equal((order.lines as Row[]).length, 3)
  // Cost is captured for what ships, the children; the combo line itself sells nothing of its own.
  const costs = (await run.call('sale.getLineCosts', { id: 'order' })) as unknown as Row[]
  const children = (order.lines as Row[]).filter((line) => line.comboParentId)
  assert.deepEqual(
    costs.map((cost) => [cost.lineId, cost.productId]).sort(),
    children.map((line) => [line.id, line.productId]).sort(),
  )
})

test('R10 grid changes offered items, inherits parent values, and restores removed children', async (t) => {
  const run = await seed(t)
  await run.add()
  const first = ((await run.order()).lines as Row[]).find((line) => line.comboChoiceId === 'choice-a')!
  assert.equal(
    (await run.grid({ updated: [{ id: first.id, values: { productId: 'alternative:default' } }] })).ok,
    true,
  )
  let lines = (await run.order()).lines as Row[]
  assert.deepEqual(
    lines.filter((line) => line.comboParentId).map((line) => line.priceUnit),
    ['70', '43'],
  )
  for (const values of [
    { priceUnit: '1' },
    { productUomQty: '3' },
    { discount: '5' },
    { productUomId: 'box' },
    { productId: 'second:default' },
  ]) {
    assert.equal((await run.grid({ updated: [{ id: first.id, values }] })).ok, false)
    assert.deepEqual((await run.order()).lines, lines)
  }
  assert.equal((await run.grid({ removed: [first.id] })).ok, true)
  lines = (await run.order()).lines as Row[]
  assert.equal(lines.length, 3)
  assert.equal(lines.find((line) => line.id === first.id)?.productId, 'alternative:default')
  assert.equal(
    (
      await run.grid({
        updated: [{ id: 'parent', values: { productUomQty: '3', discount: '10', priceUnit: '200' } }],
      })
    ).ok,
    true,
  )
  lines = (await run.order()).lines as Row[]
  assert.ok(lines.every((line) => line.productUomQty === '3' && line.discount === '10'))
  await run.save('sale.removeLine', { id: 'parent' })
  assert.equal(((await run.order()).lines as Row[]).length, 0)
})

test('R10 refuses an unavailable item atomically without leaving a parent', async (t) => {
  const run = await seed(t)
  const second = await run.call('product.getTemplate', { id: 'second' })
  await run.save('product.saveTemplate', {
    id: 'second',
    name: 'second',
    type: 'goods',
    saleOk: false,
    expectedRevisionId: second.revisionId,
  })
  const result = await run.call('sale.addLine', {
    id: 'parent',
    orderId: 'order',
    productId: 'combo:default',
    productUomId: 'each',
    productUomQty: '1',
  })
  assert.equal(result.ok, false)
  assert.equal(((await run.order()).lines as Row[]).length, 0)
})

test('R10 applies a combo-specific pricelist once and edits a single child without touching ordinary lines', async (t) => {
  const run = await seed(t)
  await run.save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await run.save('pricing.savePricelistItem', {
    id: 'rule',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId: 'combo:default',
    computePrice: 'fixed',
    fixedPrice: '90',
  })
  await run.save('sale.createOrder', {
    id: 'priced',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  await run.add({ orderId: 'priced' })
  const priced = await run.call('sale.getOrder', { id: 'priced' })
  assert.equal((priced.lines as Row[]).find((row) => row.comboBasePrice != null)?.comboBasePrice, '90')
  assert.equal(priced.amountUntaxed, '184')
  await run.add({ id: 'second-parent' })
  const ordinary = {
    id: 'ordinary',
    orderId: 'order',
    productId: 'goods:default',
    productUomId: 'each',
    productUomQty: '1',
    priceUnit: '999',
  }
  await run.save('sale.addLine', ordinary)
  const before = await run.order()
  const child = (before.lines as Row[]).find((row) => row.comboChoiceId === 'choice-a')!
  await run.save('sale.updateLine', {
    id: child.id,
    expectedRevision: before.revision,
    productId: 'alternative:default',
  })
  const after = await run.order()
  assert.equal((after.lines as Row[]).find((row) => row.id === child.id)?.priceUnit, '70')
  assert.deepEqual(
    (after.lines as Row[]).find((row) => row.id === 'ordinary'),
    (before.lines as Row[]).find((row) => row.id === 'ordinary'),
  )
})

test('R10 delivery and invoice use items only, preserve partial delivery and reject historical edits', async (t) => {
  const run = await seed(t)
  await run.save('sale.saveDeliveryPromise', {
    id: 'order',
    expectedRevision: (await run.order()).revision,
    shippingPolicy: 'one',
    commitmentDate: '2027-01-20T00:00:00.000Z',
  })
  for (const id of ['goods', 'second']) {
    await run.save('stock.configureProduct', { templateId: id, isStorable: true, tracking: 'none' })
    await run.save('sale.setInvoicePolicy', { templateId: id, invoicePolicy: 'delivery' })
  }
  await run.save('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  for (const id of ['goods', 'second'])
    await run.save('stock.adjustInventory', {
      id: `opening-${id}`,
      productId: `${id}:default`,
      locationId: 'wh:stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '10',
      productUomId: 'each',
    })
  await run.add()
  await run.save('sale.confirmOrder', { id: 'order' })
  let order = await run.order()
  const moves = order.moves as Row[]
  assert.equal(moves.length, 2)
  assert.ok(moves.every((move) => move.productId !== 'combo:default'))
  await run.save('stock.confirmPicking', { id: 'order:delivery' })
  for (const move of moves) await run.save('stock.reserveMove', { id: move.id })
  const moveLines = await run.app.adapter!.all('SELECT id FROM stock_move_line')
  const done = await run.save('stock.completePicking', {
    id: 'order:delivery',
    quantities: moveLines.map((row) => ({ moveLineId: row.id, quantity: 1 })),
    createBackorder: true,
  })
  assert.ok(done.backorderId)
  await run.save('sale.syncDeliveries', { id: 'order' })
  order = await run.order()
  const children = (order.lines as Row[]).filter((row) => row.comboParentId)
  assert.ok(children.every((row) => row.qtyDelivered === '1'))
  for (const [id, code, accountType] of [
    ['revenue', 'REV', 'income'],
    ['receivable', 'REC', 'asset_receivable'],
  ])
    await run.save('account.saveAccount', { id, code, name: id, accountType })
  await run.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  const invoice = {
    id: 'invoice',
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  }
  await run.save('sale.createInvoice', invoice)
  await run.save('sale.createInvoice', invoice)
  const invoiceLines = await run.app.adapter!.all(
    'SELECT "productId", quantity FROM account_move_line WHERE "saleLineId" IS NOT NULL',
  )
  assert.equal(invoiceLines.length, 2)
  assert.ok(invoiceLines.every((row) => row.productId !== 'combo:default' && Number(row.quantity) === 1))
  const before = await run.order()
  for (const change of [
    { id: children[0]!.id, productId: 'alternative:default' },
    { id: 'parent', productUomQty: '0.5' },
  ])
    assert.equal(
      (await run.call('sale.updateLine', { expectedRevision: before.revision, ...change })).ok,
      false,
    )
  assert.equal((await run.call('sale.removeLine', { id: 'parent' })).ok, false)
  assert.deepEqual(await run.order(), before)
  await run.save('sale.updateLine', { id: 'parent', expectedRevision: before.revision, priceUnit: '500' })
  const repriced = await run.order()
  assert.equal((repriced.lines as Row[]).find((row) => row.id === 'parent')?.comboBasePrice, '500')
  assert.deepEqual(
    (repriced.lines as Row[]).filter((row) => row.comboParentId),
    (before.lines as Row[]).filter((row) => row.comboParentId),
  )
  assert.equal(repriced.amountTotal, before.amountTotal)
  await run.save('sale.updateLine', {
    id: 'parent',
    expectedRevision: repriced.revision,
    productUomQty: '1.5',
  })
  const reduced = await run.order()
  assert.ok((reduced.lines as Row[]).every((row) => row.productUomQty === '1.5'))
  const pending = (reduced.moves as Row[]).filter((row) => !['done', 'cancel'].includes(String(row.state)))
  assert.equal(pending.length, 2)
  assert.ok(pending.every((row) => Number(row.productUomQty) === 0.5))
  assert.deepEqual(
    (reduced.lines as Row[]).filter((row) => row.comboParentId).map((row) => row.priceUnit),
    children.map((row) => row.priceUnit),
  )
  await run.save('sale.updateLine', { id: 'parent', expectedRevision: reduced.revision, productUomQty: '1' })
  const finished = await run.order()
  assert.ok((finished.moves as Row[]).every((row) => ['done', 'cancel'].includes(String(row.state))))
  const quants = await run.app.adapter!.all('SELECT "reservedQuantity" FROM stock_quant')
  assert.ok(quants.every((row) => Number(row.reservedQuantity) === 0))
  await run.save('sale.updateLine', { id: 'parent', expectedRevision: finished.revision, productUomQty: '2' })
  const increased = await run.order()
  const extra = (increased.moves as Row[]).filter((row) => !['done', 'cancel'].includes(String(row.state)))
  assert.equal(extra.length, 2)
  const extraPicking = await run.call('stock.getPicking', { id: extra[0]!.pickingId })
  assert.equal(extraPicking.scheduledDate, '2027-01-20T00:00:00.000Z')
  assert.equal(extraPicking.moveType, 'one')
  assert.ok(extra.every((row) => Number(row.productUomQty) === 1 && row.productId !== 'combo:default'))
})

test('D33b confirmed combo grid resizes parent demand but keeps child commercial history fixed', async (t) => {
  const r = await seed(t)
  await r.add()
  await r.save('sale.confirmOrder', { id: 'order' })
  const before = await r.order()
  const child = (before.lines as Row[]).find((line) => line.comboParentId)!
  assert.equal((await r.grid({ updated: [{ id: 'parent', values: { productUomQty: 3 } }] })).ok, true)
  const after = await r.order()
  assert.ok((after.lines as Row[]).every((line) => line.productUomQty === '3'))
  assert.equal((after.moves as Row[]).length, (before.moves as Row[]).length)
  assert.ok((after.moves as Row[]).every((move) => Number(move.productUomQty) === 3))
  for (const update of [
    { id: child.id, values: { priceUnit: '1' } },
    { id: 'parent', values: { priceUnit: '1' } },
  ]) {
    assert.equal((await r.grid({ updated: [update] })).ok, false)
    assert.deepEqual(await r.order(), after)
  }
})
test('D33b combo reductions inspect source invoices even when cached invoicing is stale', async (t) => {
  const r = await seed(t)
  await r.add()
  await r.save('sale.confirmOrder', { id: 'order' })
  for (const [id, accountType] of [
    ['revenue', 'income'],
    ['receivable', 'asset_receivable'],
  ])
    await r.save('account.saveAccount', { id, code: id, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  await r.save('sale.createInvoice', {
    id: 'invoice',
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  await r.app.adapter!.exec(`UPDATE sale_order_line SET "qtyInvoiced" = '0' WHERE "orderId" = 'order'`)
  const before = await r.order()
  assert.equal((await r.grid({ updated: [{ id: 'parent', values: { productUomQty: 1 } }] })).ok, false)
  assert.deepEqual(await r.order(), before)
})

// C25 (owner 25/10): a confirmed combo leaves its order with all its items, never one of them alone,
// and only while nothing of it was delivered or invoiced.
test('C25 an undelivered confirmed combo is removed with its items and what they waited for', async (t) => {
  const r = await seed(t)
  await r.add()
  await r.save('sale.confirmOrder', { id: 'order' })
  const before = await r.order()
  const child = (before.lines as Row[]).find((line) => line.comboParentId)!
  const alone = await r.grid({ removed: [String(child.id)] })
  assert.deepEqual(
    [(alone.errors as Row[])[0]!.messageKey, (alone.errors as Row[])[0]!.params],
    ['sale.error.comboItemRemove', { name: 'Combo' }],
  )
  assert.deepEqual(await r.order(), before)
  assert.equal((await r.grid({ removed: ['parent'] })).ok, true)
  assert.deepEqual((await r.order()).lines, [])
  const moves = (await r.app.adapter!.all(`SELECT state, "saleLineId" FROM stock_move`)) as Row[]
  assert.ok(moves.length > 0)
  assert.ok(moves.every((move) => move.state === 'cancel' && move.saleLineId == null))
})

test('C25 an invoiced confirmed combo stays on its order', async (t) => {
  const r = await seed(t)
  await r.add()
  await r.save('sale.confirmOrder', { id: 'order' })
  for (const [id, accountType] of [
    ['revenue', 'income'],
    ['receivable', 'asset_receivable'],
  ])
    await r.save('account.saveAccount', { id, code: id, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  await r.save('sale.createInvoice', {
    id: 'invoice',
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  const before = await r.order()
  const refused = await r.grid({ removed: ['parent'] })
  assert.deepEqual(
    [(refused.errors as Row[])[0]!.messageKey, (refused.errors as Row[])[0]!.params],
    ['sale.error.lineSettled', { name: 'Combo' }],
  )
  assert.deepEqual(await r.order(), before)
})

test('K-CONSU a confirmed combo of goods not kept in stock shrinks after its delivery holds them', async (t) => {
  const r = await seed(t)
  for (const templateId of ['goods', 'second'])
    await r.save('stock.configureProduct', { templateId, isStorable: false, tracking: 'none' })
  await r.add()
  await r.save('sale.confirmOrder', { id: 'order' })
  const before = await r.order()
  const pickingIds = [...new Set((before.moves as Row[]).map((move) => String(move.pickingId)))]
  for (const id of pickingIds) {
    await r.save('stock.confirmPicking', { id })
    await r.save('stock.assignPicking', { id })
  }
  const shrunk = await r.grid({ updated: [{ id: 'parent', values: { productUomQty: 1 } }] })
  assert.equal(shrunk.ok, true, JSON.stringify(shrunk))
  const after = await r.order()
  assert.ok((after.moves as Row[]).every((move) => Number(move.productUomQty) === 1))
  for (const id of pickingIds) {
    const lines = ((await r.call('stock.getPicking', { id })).moves as Row[]).flatMap(
      (move) => move.lines as Row[],
    )
    assert.ok(
      lines.every((line) => Number(line.quantity) === 1),
      JSON.stringify(lines),
    )
  }
})
