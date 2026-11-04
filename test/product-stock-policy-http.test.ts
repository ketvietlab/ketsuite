import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'

test('Commerce refuses stock setup and cost changes with physical positions, across every write path', async (t) => {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const fixture = async (fn: string, input: Row) =>
    (await app.fixture.call<Row>(fn, input, { scope: { company: 'acme', branches: null } })).value
  await fixture('partner.savePartner', { id: 'company-party', kind: 'company', name: 'Example Company' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'company-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'test-password',
    name: 'Owner',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'owner-company', userId: 'owner', companyId: 'acme' })
  await app.client.login({ login: 'owner', password: 'test-password' })
  const call = async (fn: string, input: Row = {}) => (await app.client.call<Row>(fn, input)).value
  const save = async (fn: string, input: Row) => {
    const result = await call(fn, input)
    assert.notEqual(result.ok, false, JSON.stringify(result))
    return result
  }
  await save('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await save('stock.saveLocation', { id: 'transit', name: 'Transit', usage: 'transit' })
  for (const id of ['sample', 'race', 'storable-race'])
    await save('product.saveRecord', {
      id,
      name: id,
      type: 'goods',
      uomId: 'each',
      defaultCode: id.toUpperCase(),
      isStorable: true,
      tracking: 'none',
      costPrice: '20',
    })
  const record = async () => ({
    ...(await call('product.getTemplate', { id: 'sample' })),
    ...(await call('stock.getProductConfig', { templateId: 'sample' })),
  })
  const count = (quantity: string, locationId = 'wh:stock', id = 'sample') =>
    save('stock.adjustInventory', {
      id: `${id}-${locationId}-${quantity}`,
      productId: `${id}:default`,
      locationId,
      inventoryLocationId: 'adjustment',
      countedQuantity: quantity,
      productUomId: 'each',
    })
  await count('5')
  const before = await record()
  for (const input of [
    { isStorable: true, tracking: 'lot' },
    { isStorable: false, tracking: 'none' },
  ]) {
    const result = await call('stock.configureProduct', { templateId: 'sample', ...input })
    assert.equal(result.ok, false)
    assert.equal((result.errors as Row[])[0]?.code, 'product.error.template.stockLocked')
  }
  assert.deepEqual(await record(), before, 'refused edits leave both revisions unchanged')
  const refusedCost = await call('product.setCost', { productId: 'sample:default', standardPrice: '30' })
  assert.equal(refusedCost.ok, false)
  await save('product.setCost', { productId: 'sample:default', standardPrice: '20.0' })
  assert.deepEqual(await record(), before, 'unchanged cost remains a no-op')
  for (const extra of [{ tracking: 'lot' }, { costPrice: '30' }, { costPrice: '-1' }]) {
    const result = await call('product.saveRecord', {
      id: 'sample',
      name: 'Must roll back',
      type: 'goods',
      isStorable: true,
      tracking: 'none',
      expectedRevisionId: before.revisionId,
      ...extra,
    })
    assert.equal(result.ok, false)
    assert.deepEqual(await record(), before, 'a failed stock/cost group rolls general fields back')
  }
  const native = {
    id: 'sample:default',
    templateId: 'sample',
    name: 'Native must roll back',
    kind: 'storable',
    uomId: 'each',
    salePrice: '100',
    saleOk: true,
    purchaseOk: true,
    pointOfSale: true,
    tracking: 'none',
    sku: 'SAMPLE',
    expectedRevision: Number(before.inventoryRevision ?? 0),
  }
  for (const extra of [{ tracking: 'lot' }, { cost: '30' }]) {
    const result = await call('stock.saveInventoryProduct', { ...native, ...extra })
    assert.equal(result.ok, false)
    assert.deepEqual(await record(), before)
  }
  await count('0')
  // Template tracking sees stock on an individually archived sibling SKU too.
  await save('product.saveVariant', {
    id: 'sample-secondary',
    templateId: 'sample',
    combinationKey: 'manual:secondary',
    defaultCode: 'SECONDARY',
  })
  await save('stock.adjustInventory', {
    id: 'secondary-stock',
    productId: 'sample-secondary',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '2',
    productUomId: 'each',
  })
  await app.adapter!.exec("UPDATE product_product SET active = false WHERE id = 'sample-secondary'")
  assert.equal(
    (await call('stock.configureProduct', { templateId: 'sample', isStorable: true, tracking: 'lot' })).ok,
    false,
  )
  await save('product.setCost', { productId: 'sample:default', standardPrice: '25' })
  await save('stock.adjustInventory', {
    id: 'secondary-clear',
    productId: 'sample-secondary',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '0',
    productUomId: 'each',
  })
  // Negative physical positions from historical over-deliveries also block setup.
  await app.adapter!.exec(
    `UPDATE stock_quant SET quantity = '-1' WHERE "productId" = 'sample:default' AND "locationId" = 'wh:stock'`,
  )
  assert.equal(
    (await call('stock.configureProduct', { templateId: 'sample', isStorable: true, tracking: 'lot' })).ok,
    false,
  )
  await app.adapter!.exec(
    `UPDATE stock_quant SET quantity = '0' WHERE "productId" = 'sample:default' AND "locationId" = 'wh:stock'`,
  )
  await count('2', 'transit')
  assert.equal(
    (await call('stock.configureProduct', { templateId: 'sample', isStorable: true, tracking: 'lot' })).ok,
    false,
  )
  await count('0', 'transit')
  await save('product.setCost', { productId: 'sample:default', standardPrice: '30' })
  assert.equal(
    (await call('product.setCost', { productId: 'sample:default', standardPrice: '-1' })).ok,
    false,
  )
  await save('stock.configureProduct', { templateId: 'sample', isStorable: true, tracking: 'lot' })
  assert.equal((await record()).tracking, 'lot')

  // Two real HTTP commands race for the same template. They cannot both succeed:
  // stock under the old tracking mode must not appear after the new mode commits.
  for (const config of [
    { templateId: 'race', isStorable: true, tracking: 'lot' },
    { templateId: 'storable-race', isStorable: false, tracking: 'none' },
  ]) {
    const outcomes = await Promise.allSettled([
      call('stock.configureProduct', config),
      call('stock.adjustInventory', {
        id: `${config.templateId}-count`,
        productId: `${config.templateId}:default`,
        locationId: 'wh:stock',
        inventoryLocationId: 'adjustment',
        countedQuantity: '1',
        productUomId: 'each',
      }),
    ])
    const successes = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled' && outcome.value.ok === true,
    )
    assert.equal(successes.length, 1, JSON.stringify(outcomes))
    const race = await call('stock.getProductConfig', { templateId: config.templateId })
    const quants = (
      await app.client.call<Row[]>('stock.listQuants', {
        productId: `${config.templateId}:default`,
        locationId: 'wh:stock',
      })
    ).value
    assert.ok(
      (race.isStorable === true && race.tracking === 'none') ||
        quants.every((quant) => Number(quant.quantity) === 0),
    )
  }
})
