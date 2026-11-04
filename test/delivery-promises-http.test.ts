import { civilDate } from '../packages/ketsuite/src/modules/company/civil-date.ts'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, schemaFromManifest } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

async function seed(t: TestContext, policy = 'direct', commitmentDate?: string) {
  const r = await boot(t)
  await r.save('partner.savePartner', { id: 'buyer', name: 'Buyer', kind: 'company' })
  await r.save('partner.grantRole', { id: 'buyer-role', partnerId: 'buyer', role: 'customer' })
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  for (const [id, type, saleDelay] of [
    ['fast', 'goods', 2],
    ['slow', 'goods', 5],
    ['service', 'service', 365],
  ] as const)
    await r.save('product.saveRecord', {
      id,
      name: id,
      defaultCode: id.toUpperCase(),
      type,
      uomId: 'each',
      listPrice: '100',
      saleOk: true,
      saleDelay,
    })
  await r.save('sale.createOrder', {
    id: 'order',
    partnerId: 'buyer',
    warehouseId: 'wh',
    dateOrder: '2026-10-01T00:00:00.000Z',
    shippingPolicy: policy,
    ...(commitmentDate ? { commitmentDate } : {}),
  })
  const add = async (product: string) =>
    r.save('sale.addLine', {
      id: product + '-line',
      orderId: 'order',
      productId: product + ':default',
      productUomId: 'each',
      productUomQty: '1',
    })
  const order = () => r.call('sale.getOrder', { id: 'order' })
  return { ...r, add, order }
}

test('P51 product days validate, inherit in every SKU projection and retain revision on refused edits', async (t) => {
  const r = await seed(t)
  const template = await r.call('product.getTemplate', { id: 'fast' })
  assert.equal(template.saleDelay, 2)
  await r.save('product.duplicateTemplate', { id: 'copy', name: 'Copy', sourceId: 'fast' })
  const duplicate = await r.call('product.templateModalContext', { sourceId: 'fast' })
  assert.equal(((duplicate.data as Row).record as Row).saleDelay, 2)
  assert.equal((await r.call('product.getTemplate', { id: 'copy' })).saleDelay, 2)
  assert.equal((await r.call('product.getVariant', { id: 'fast:default' })).saleDelay, 2)
  assert.equal(
    ((await r.call('product.listVariants', { templateId: 'fast' })) as unknown as Row[])[0]!.saleDelay,
    2,
  )
  const refused = await r.call('product.saveRecord', {
    id: 'fast',
    name: 'fast',
    type: 'goods',
    saleDelay: 366,
    expectedRevisionId: template.revisionId,
  })
  assert.equal(refused.ok, false)
  assert.equal((await r.call('product.getTemplate', { id: 'fast' })).revisionId, template.revisionId)
  await r.save('product.saveRecord', {
    id: 'fast',
    name: 'fast',
    type: 'goods',
    saleDelay: 0,
    expectedRevisionId: template.revisionId,
  })
  assert.equal((await r.call('product.getVariant', { id: 'fast:default' })).saleDelay, 0)
})

test('P51 quotation uses earliest or latest goods date and ignores services', async (t) => {
  const r = await seed(t)
  await r.add('fast')
  await r.add('slow')
  await r.add('service')
  let order = await r.order()
  assert.equal(order.expectedDate, '2026-10-03')
  await r.save('sale.saveDeliveryPromise', {
    id: 'order',
    expectedRevision: order.revision,
    shippingPolicy: 'one',
  })
  order = await r.order()
  assert.equal(order.expectedDate, '2026-10-06')
  // A date that does not exist never reaches the function: the input contract refuses it.
  await assert.rejects(
    () =>
      r.call('sale.saveDeliveryPromise', {
        id: 'order',
        expectedRevision: order.revision,
        commitmentDate: '2027-02-30',
      }),
    (error: unknown) => (error as { status?: number }).status === 422,
  )
  assert.deepEqual(await r.order(), order)
  assert.equal(
    (
      await r.call('sale.saveDeliveryPromise', {
        id: 'order',
        expectedRevision: order.revision,
        commitmentDate: '2026-09-30T00:00:00Z',
      })
    ).ok,
    false,
  )
})

test('P51 confirmation anchors lead time without rewriting the historical order date and replay is stable', async (t) => {
  const r = await seed(t, 'one')
  await r.add('fast')
  await r.add('slow')
  const confirmed = await r.save('sale.confirmOrder', { id: 'order' })
  const order = await r.order()
  assert.equal(order.dateOrder, '2026-10-01T00:00:00.000Z')
  const expected = new Date(Date.parse(civilDate(String(order.confirmedAt))) + 5 * 86400000)
    .toISOString()
    .slice(0, 10)
  assert.equal(order.expectedDate, expected)
  const picking = await r.call('stock.getPicking', { id: confirmed.pickingId })
  assert.equal(picking.scheduledDate, new Date(expected + 'T00:00:00+07:00').toISOString())
  assert.equal(picking.moveType, 'one')
  await r.save('sale.confirmOrder', { id: 'order' })
  assert.equal((await r.order()).confirmedAt, order.confirmedAt)
})

test('P51 commitment overrides dispatch, clearing it restores forecast, stale and locked writes refuse', async (t) => {
  const r = await seed(t, 'direct', '2027-01-20T00:00:00.000Z')
  await r.add('fast')
  const confirmed = await r.save('sale.confirmOrder', { id: 'order' })
  assert.equal(
    (await r.call('stock.getPicking', { id: confirmed.pickingId })).scheduledDate,
    '2027-01-20T00:00:00.000Z',
  )
  let order = await r.order()
  await r.save('sale.saveDeliveryPromise', {
    id: 'order',
    expectedRevision: order.revision,
    commitmentDate: '2027-02-01',
  })
  assert.equal(
    (await r.call('stock.getPicking', { id: confirmed.pickingId })).scheduledDate,
    '2027-01-31T17:00:00.000Z',
  )
  order = await r.order()
  await r.save('sale.saveDeliveryPromise', {
    id: 'order',
    expectedRevision: order.revision,
    commitmentDate: null,
  })
  assert.equal(
    (await r.call('stock.getPicking', { id: confirmed.pickingId })).scheduledDate,
    new Date(String((await r.order()).expectedDate) + 'T00:00:00+07:00').toISOString(),
  )
  assert.equal(
    (
      await r.call('sale.saveDeliveryPromise', {
        id: 'order',
        expectedRevision: order.revision,
        shippingPolicy: 'one',
      })
    ).ok,
    false,
  )
  await r.save('sale.lockOrder', { id: 'order', locked: true })
  order = await r.order()
  assert.equal(
    (
      await r.call('sale.saveDeliveryPromise', {
        id: 'order',
        expectedRevision: order.revision,
        commitmentDate: '2027-02-01T00:00:00Z',
      })
    ).ok,
    false,
  )
})

test('P51 service-only orders have no expected delivery or stock picking', async (t) => {
  const r = await seed(t)
  await r.add('service')
  assert.equal((await r.order()).expectedDate, null)
  const confirmed = await r.save('sale.confirmOrder', { id: 'order' })
  assert.equal(confirmed.pickingId, undefined)
  assert.equal((await r.order()).expectedDate, null)
})

test('P51 saveDraft preserves omitted plan fields and rejects invalid replacements atomically', async (t) => {
  const r = await seed(t, 'one', '2027-01-20T00:00:00.000Z')
  await r.add('fast')
  const before = await r.order()
  const args = {
    id: 'order',
    partnerId: 'buyer',
    warehouseId: 'wh',
    expectedRevision: before.revision,
    lines: [{ id: 'fast-line', productId: 'fast:default', productUomId: 'each', productUomQty: '3' }],
  }
  assert.equal((await r.call('sale.saveDraft', { ...args, shippingPolicy: 'invalid' })).ok, false)
  assert.deepEqual(await r.order(), before)
  await r.save('sale.saveDraft', args)
  const after = await r.order()
  assert.equal(after.shippingPolicy, 'one')
  assert.equal(after.commitmentDate, before.commitmentDate)
  await r.save('sale.saveDraft', {
    ...args,
    expectedRevision: after.revision,
    commitmentDate: null,
    shippingPolicy: 'direct',
  })
  assert.equal((await r.order()).commitmentDate, null)
})

test('P51 live catalogue lead changes, null defaults and same-day commitments retain the order date', async (t) => {
  const r = await seed(t)
  await r.add('fast')
  const template = await r.call('product.getTemplate', { id: 'fast' })
  await r.save('product.saveRecord', {
    id: 'fast',
    name: 'fast',
    type: 'goods',
    saleDelay: null,
    expectedRevisionId: template.revisionId,
  })
  assert.equal((await r.order()).expectedDate, '2026-10-01')
  await r.app.adapter!.run(
    `UPDATE sale_order SET "dateOrder" = '2026-10-01T12:00:00.000Z' WHERE id = 'order'`,
  )
  const order = await r.order()
  await r.save('sale.saveDeliveryPromise', {
    id: 'order',
    expectedRevision: order.revision,
    commitmentDate: '2026-10-01',
  })
  assert.equal((await r.order()).dateOrder, '2026-10-01T12:00:00.000Z')
})

test('P51 competing plan writes have one winner and another company cannot change it', async (t) => {
  const r = await seed(t)
  await r.add('fast')
  const order = await r.order()
  const results = await Promise.allSettled(
    ['direct', 'one'].map((shippingPolicy) =>
      r.call('sale.saveDeliveryPromise', { id: 'order', expectedRevision: order.revision, shippingPolicy }),
    ),
  )
  assert.equal(
    results.filter((result) => result.status === 'fulfilled' && result.value.ok === true).length,
    1,
  )
  const after = await r.order()
  assert.equal(Number(after.revision), Number(order.revision) + 1)
  assert.equal(
    (
      await r.fixture(
        'sale.saveDeliveryPromise',
        { id: 'order', expectedRevision: after.revision, shippingPolicy: 'one' },
        'other',
      )
    ).ok,
    false,
  )
  assert.deepEqual(await r.order(), after)
})

test('P51 completed, cancelled and externally owned transfers are not rescheduled', async (t) => {
  const r = await seed(t)
  await r.add('fast')
  const result = await r.save('sale.confirmOrder', { id: 'order' })
  const adapter = r.app.adapter!
  const initial = await r.call('stock.getPicking', { id: result.pickingId })
  for (const state of ['done', 'cancel']) {
    await adapter.run(`UPDATE stock_picking SET state = '${state}'`)
    const order = await r.order()
    await r.save('sale.saveDeliveryPromise', {
      id: 'order',
      expectedRevision: order.revision,
      commitmentDate: '2027-02-01',
    })
    assert.equal(
      (await r.call('stock.getPicking', { id: result.pickingId })).scheduledDate,
      initial.scheduledDate,
    )
  }
  await adapter.run(`UPDATE stock_picking SET state = 'draft'`)
  await adapter.run(`UPDATE sale_order SET "stockAuthority" = 'external'`)
  let order = await r.order()
  await r.save('sale.saveDeliveryPromise', {
    id: 'order',
    expectedRevision: order.revision,
    commitmentDate: '2027-03-01',
  })
  assert.equal(
    (await r.call('stock.getPicking', { id: result.pickingId })).scheduledDate,
    initial.scheduledDate,
  )
  await adapter.run(`UPDATE sale_order SET "orderAuthority" = 'external'`)
  order = await r.order()
  assert.equal(
    (
      await r.call('sale.saveDeliveryPromise', {
        id: 'order',
        expectedRevision: order.revision,
        shippingPolicy: 'one',
      })
    ).ok,
    false,
  )
})

test('P51 delivery columns migrate additively and replay without rewriting legacy records', async (t) => {
  const r = await seed(t)
  await r.add('fast')
  const adapter = r.app.adapter!
  const manifest = compose(r.deployment.modules, { headless: true, companies: true })
  const legacy = structuredClone(schemaFromManifest(manifest))
  const fields = {
    sale_order: ['confirmedAt', 'commitmentDate', 'shippingPolicy'],
    product_template: ['saleDelay'],
  }
  for (const [table, columns] of Object.entries(fields))
    for (const column of columns) {
      delete legacy.tables[table]!.columns[column]
      await adapter.exec(`ALTER TABLE ${table} DROP COLUMN "${column}"`)
    }
  const before = await adapter.all('SELECT * FROM sale_order')
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(legacy)],
  )
  assert.equal((await migrateOne(adapter, manifest)).filter((change) => change.op === 'ADD_COLUMN').length, 4)
  const after = await adapter.all('SELECT * FROM sale_order')
  assert.deepEqual(
    after.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => !fields.sale_order.includes(key))),
    ),
    before.map((row) => ({ ...row })),
  )
  assert.deepEqual(await migrateOne(adapter, manifest), [])
  assert.equal((await r.order()).expectedDate, '2026-10-01')
})

test('P51 quotation operator can edit delivery plans, warehouse operators and auditors cannot', async (t) => {
  const r = await seed(t)
  await r.add('fast')
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  for (const role of ['sales-representative', 'warehouse-operator', 'tenant-auditor']) {
    await r.fixture('user.createUser', {
      id: role,
      login: role,
      name: role,
      password: 'test-password',
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${role}-company`, userId: role, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${role}-role`, userId: role, roleId: `commerce.${role}` })
    await r.app.client.login({ login: role, password: 'test-password' })
    const order = await r.fixture('sale.getOrder', { id: 'order' })
    const input = { id: 'order', expectedRevision: order.revision, shippingPolicy: 'one' }
    if (role === 'sales-representative') await r.save('sale.saveDeliveryPromise', input)
    else
      await assert.rejects(
        () => r.call('sale.saveDeliveryPromise', input),
        (error: { status?: number }) => error.status === 403,
      )
  }
})

test('P51 expected dates follow the company civil day across midnight, leap days and DST', async (t) => {
  const r = await seed(t)
  await r.add('fast')
  await r.app.adapter!.run(`UPDATE sale_order SET "dateOrder" = '2028-02-28T20:30:00.000Z'`)
  assert.equal((await r.order()).expectedDate, '2028-03-02')
  await r.app.adapter!.run(
    `UPDATE company_company SET "accountingTimezone" = 'America/New_York' WHERE id = 'acme'`,
  )
  await r.app.adapter!.run(`UPDATE sale_order SET "dateOrder" = '2026-03-07T04:30:00.000Z'`)
  assert.equal((await r.order()).expectedDate, '2026-03-08')
  await r.save('sale.createOrder', {
    id: 'local-day',
    partnerId: 'buyer',
    warehouseId: 'wh',
    dateOrder: '2026-10-23',
    commitmentDate: '2026-10-25',
  })
  await r.save('sale.addLine', {
    id: 'local-line',
    orderId: 'local-day',
    productId: 'fast:default',
    productUomId: 'each',
    productUomQty: '1',
  })
  const local = await r.call('sale.getOrder', { id: 'local-day' })
  assert.equal(local.expectedDate, '2026-10-25')
  assert.equal(local.commitmentDay, '2026-10-25')
  assert.equal(local.commitmentDate, '2026-10-25T04:00:00.000Z')
})
