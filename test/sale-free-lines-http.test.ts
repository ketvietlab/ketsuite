import { migrateSaleFreeLines } from '../packages/ketsuite/src/modules/sale/free-lines-migration.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compose,
  migrateOne,
  confirmManualMigration,
  schemaFromManifest,
  renderSql,
  type Row,
} from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
import { legacyModules } from './fixtures/legacy-modules.ts'
const free = {
  id: 'free',
  orderId: 'order',
  name: 'On-site advice',
  productUomQty: '2',
  priceUnit: '100',
  discount: '10',
}

test('D24 free lines retain taxes and exact amounts without creating products, stock or cost rows', async (t) => {
  const r = await setup(t)
  const count = (await r.app.adapter!.all('SELECT id FROM product_product')).length
  await r.save('account.saveTax', {
    id: 'vat',
    name: 'VAT',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await r.save('sale.addLine', { ...free, taxIds: ['vat'] })
  const order = await r.call('sale.getOrder', { id: 'order' })
  const line = (order.lines as Row[])[0]!
  assert.equal(line.productId, null)
  assert.equal(line.productUomId, null)
  assert.equal(line.name, free.name)
  assert.equal(Number(order.amountUntaxed), 180)
  assert.equal(Number(order.amountTotal), 198)
  assert.deepEqual(line.taxIds, ['vat'])
  assert.equal((await r.app.adapter!.all('SELECT id FROM product_product')).length, count)
  assert.equal((await r.app.adapter!.all('SELECT id FROM sale_order_line_cost')).length, 0)
  const costs = (await r.app.client.call<Row[]>('sale.getLineCosts', { id: 'order' })).value
  assert.equal(costs[0]!.unitCost, '0')
  assert.equal(Number(costs[0]!.margin), 180)
  assert.equal('margin' in line, false, 'margin stays behind the cost reader')
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: order.revision })
  assert.equal((await r.app.adapter!.all('SELECT id FROM stock_move')).length, 0)
  await r.save('sale.syncDeliveries', { id: 'order' })
  assert.equal(Number(((await r.call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!.qtyDelivered), 0)
})

test('D24 policy defaults off, gates confirmation with line name, and remains company-scoped', async (t) => {
  const r = await setup(t)
  assert.equal((await r.call('sale.getConfiguration', {})).requireProduct, false)
  await r.save('sale.addLine', free)
  await r.save('sale.saveConfiguration', { requireProduct: true, expectedRevision: 0 })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const refused = await r.call('sale.confirmOrder', { id: 'order', expectedRevision: before.revision })
  assert.equal(refused.ok, false)
  assert.deepEqual((refused.errors as Row[])[0]!.params, { name: free.name })
  assert.equal((await r.call('sale.getOrder', { id: 'order' })).revision, before.revision)
  assert.equal(
    (await r.call('sale.saveConfiguration', { requireProduct: false, expectedRevision: 0 })).ok,
    false,
  )
  assert.equal((await r.fixture('sale.getConfiguration', {}, 'other')).requireProduct, false)
  await r.save('sale.saveConfiguration', { requireProduct: false, expectedRevision: 1 })
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: before.revision })
})

test('D24 free lines invoice ordered quantity with no catalogue or delivery identity', async (t) => {
  const r = await setup(t)
  await r.save('sale.addLine', free)
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
  const [line] = await r.app.adapter!.all(
    `SELECT "productId", "productUomId", quantity, "priceUnit", name FROM account_move_line WHERE "saleLineId" = 'free'`,
  )
  assert.equal(line!.productId, null)
  assert.equal(line!.productUomId, null)
  assert.equal(line!.name, free.name)
  assert.equal(Number(line!.quantity), 2)
  assert.equal(Number(line!.priceUnit), 100)
  const order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(order.invoiceStatus, 'invoiced')
  assert.equal(Number((order.lines as Row[])[0]!.qtyInvoiced), 2)
})

test('D24 native grid supports named free rows and rejects incomplete or forged rows atomically', async (t) => {
  const r = await setup(t)
  const grid = async (values: Row) =>
    r.call('sale.applyLineGrid', {
      id: 'order',
      expectedRevision: (await r.call('sale.getOrder', { id: 'order' })).revision,
      changes: { added: [{ id: 'new', index: 0, values }], updated: [], removed: [], order: null },
    })
  for (const values of [
    { name: ' ', productUomQty: 1 },
    { name: 'Wrong unit', productUomQty: 1, productUomId: 'each' },
    { name: 'x'.repeat(501), productUomQty: 1 },
    { name: 'Bad qty', productUomQty: -1 },
    { name: 'Forged', productUomQty: 1, companyId: 'other' },
  ]) {
    assert.equal((await grid(values)).ok, false)
    assert.equal(((await r.call('sale.getOrder', { id: 'order' })).lines as Row[]).length, 0)
  }
  assert.equal((await grid({ name: 'Advice', productUomQty: 2, priceUnit: '123.45', discount: 10 })).ok, true)
  const line = ((await r.call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!
  assert.equal(line.productId, null)
  assert.equal(line.name, 'Advice')
  assert.equal(line.priceUnit, '123.45')
})

test('D24 free-line migration preserves existing product lines and accepts nullable identities afterwards', async (t) => {
  const r = await setup(t)
  await r.add()
  const before = await r.app.adapter!.all('SELECT * FROM sale_order_line')
  const old = legacyModules(
    r.deployment.modules.map((module) => {
      if (typeof module === 'string' || module.name !== 'sale') return module
      const line = module.models!.OrderLine!
      const { Configuration: _configuration, ...legacyModels } = module.models!
      return {
        ...module,
        models: {
          ...legacyModels,
          OrderLine: {
            ...line,
            fields: {
              ...line.fields,
              productId: 'ref:product.Product',
              productUomId: 'ref:uom.Unit',
            },
          },
        },
      }
    }),
  )
  const legacy = compose(old, { headless: true, companies: true })
  await r.app.adapter!.tx(async (tx) => {
    if (tx.name === 'postgres') {
      await tx.exec(
        'ALTER TABLE sale_order_line ALTER COLUMN "productId" SET NOT NULL, ALTER COLUMN "productUomId" SET NOT NULL',
      )
    } else {
      const table = schemaFromManifest(legacy).tables.sale_order_line!
      const columns = Object.keys(table.columns)
        .map((field) => `"${field}"`)
        .join(', ')
      const indexes = await tx.all(
        "SELECT sql FROM sqlite_master WHERE tbl_name = 'sale_order_line' AND type = 'index' AND sql IS NOT NULL",
      )
      for (const sql of renderSql(
        [{ op: 'CREATE_TABLE', table: 'sale_order_line_legacy', columns: table.columns, destructive: false }],
        tx,
      ))
        await tx.exec(sql)
      await tx.exec(`INSERT INTO sale_order_line_legacy (${columns}) SELECT ${columns} FROM sale_order_line`)
      await tx.exec('DROP TABLE sale_order_line')
      await tx.exec('ALTER TABLE sale_order_line_legacy RENAME TO sale_order_line')
      for (const row of indexes) await tx.exec(String(row.sql))
    }
    await tx.exec('DROP TABLE sale_configuration')
    await confirmManualMigration(tx, legacy)
  })
  const target = compose(r.deployment.modules, { headless: true, companies: true })
  await assert.rejects(() => migrateOne(r.app.adapter!, target), /hand-written data migration/)
  const adapter = r.app.adapter!
  await assert.rejects(
    () =>
      migrateSaleFreeLines(
        {
          ...adapter,
          tx: (fn) =>
            adapter.tx((tx) =>
              fn({
                ...tx,
                exec: async (sql) => {
                  if (sql.startsWith('CREATE TABLE "sale_configuration"'))
                    throw new Error('injected DDL failure')
                  return tx.exec(sql)
                },
              }),
            ),
        },
        target,
      ),
    /injected DDL failure/,
  )
  assert.deepEqual(await adapter.all('SELECT * FROM sale_order_line'), before)
  assert.equal((await migrateSaleFreeLines(r.app.adapter!, target)).state, 'applied')
  assert.equal((await migrateSaleFreeLines(r.app.adapter!, target)).state, 'already-applied')
  assert.deepEqual(await r.app.adapter!.all('SELECT * FROM sale_order_line'), before)
  await r.save('sale.addLine', free)
  assert.deepEqual(
    await migrateOne(r.app.adapter!, compose(r.deployment.modules, { headless: true, companies: true })),
    [],
  )
})

test('D24 configuration writers require grants, isolate companies and serialize concurrent revisions', async (t) => {
  const r = await setup(t)
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
  for (const [fn, args] of [
    ['sale.saveConfiguration', { requireProduct: true, expectedRevision: 0 }],
    ['sale.getLineCosts', { id: 'order' }],
  ] as const)
    await assert.rejects(
      () => viewer.call(fn, args),
      (error: unknown) => (error as { status: number }).status === 403,
    )
  await r.fixture('user.saveRole', { id: 'config-reader', name: 'Configuration reader' })
  await r.fixture('user.grantFunction', {
    id: 'config-read',
    roleId: 'config-reader',
    fnKey: 'sale.getConfiguration',
  })
  await r.fixture('user.assignRole', {
    id: 'config-reader-assignment',
    userId: 'viewer',
    roleId: 'config-reader',
  })
  const response = await viewer.get('/admin/sales/configuration/context?lang=en')
  assert.equal(response.status, 200)
  const body = (await response.json()) as { data: { save: boolean; record: Row } }
  assert.equal(body.data.save, false)
  assert.equal(body.data.record.requireProduct, false)
  const values = await Promise.all([
    r.call('sale.saveConfiguration', { requireProduct: true, expectedRevision: 0 }),
    r.call('sale.saveConfiguration', { requireProduct: true, expectedRevision: 0 }),
  ])
  assert.equal(values.filter((value) => value.ok).length, 1)
  assert.equal((await r.call('sale.getConfiguration', {})).revision, 1)
  assert.equal((await r.fixture('sale.getConfiguration', {}, 'other')).requireProduct, false)
  await r.fixture('sale.saveConfiguration', { requireProduct: true, expectedRevision: 0 }, 'other')
  assert.equal((await r.fixture('sale.getConfiguration', {}, 'other')).requireProduct, true)
})

test('D24 mixed goods and free rows preserve fulfilment and tax edits without changing free line identity', async (t) => {
  const r = await setup(t)
  await r.add()
  await r.save('sale.addLine', free)
  let order = await r.call('sale.getOrder', { id: 'order' })
  await r.save('sale.updateLine', {
    id: 'free',
    expectedRevision: order.revision,
    productUomQty: '3',
    priceUnit: '200',
  })
  order = await r.call('sale.getOrder', { id: 'order' })
  const line = (order.lines as Row[]).find((line) => line.id === 'free')!
  assert.equal(line.name, free.name)
  assert.equal(Number(line.priceSubtotal), 540)
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: order.revision })
  const moves = await r.app.adapter!.all('SELECT "saleLineId" FROM stock_move')
  assert.deepEqual(
    moves.map((move) => move.saleLineId),
    ['line'],
  )
  await r.save('sale.syncDeliveries', { id: 'order' })
  assert.equal(
    Number(
      ((await r.call('sale.getOrder', { id: 'order' })).lines as Row[]).find((line) => line.id === 'free')!
        .qtyDelivered,
    ),
    0,
  )
})
