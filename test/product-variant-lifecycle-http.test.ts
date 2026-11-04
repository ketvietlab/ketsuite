import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'
async function boot(t: TestContext) {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const fixture = async (fn: string, input: Row, company = 'acme') =>
    (await app.fixture.call<Row>(fn, input, { scope: { company, branches: null } })).value
  for (const id of ['acme', 'other']) {
    await fixture('partner.savePartner', { id: `${id}-party`, kind: 'company', name: id })
    await fixture('company.saveCompany', { id, partnerId: `${id}-party`, currency: 'VND' })
  }
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'test-password',
    name: 'Owner',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'owner-acme', userId: 'owner', companyId: 'acme' })
  await app.client.login({ login: 'owner', password: 'test-password' })
  const call = async (fn: string, input: Row) => (await app.client.call<Row>(fn, input)).value
  const save = async (fn: string, input: Row) => {
    const result = await call(fn, input)
    assert.notEqual(result.ok, false, JSON.stringify(result))
    return result
  }
  await save('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
  const create = (id: string, defaultCode: string) =>
    call('product.saveRecord', { id, name: id, type: 'goods', defaultCode, uomId: 'each' })
  return { app, deployment, fixture, call, save, create }
}

const definition = {
  id: 'color',
  name: 'Color',
  displayType: 'select',
  createVariant: 'always',
  values: [
    { id: 'red', name: 'Red' },
    { id: 'blue', name: 'Blue' },
    { id: 'green', name: 'Green' },
  ],
}
const configuration = (valueIds: string[]) => ({
  templateId: 'goods',
  lines: [{ attributeId: 'color', values: valueIds.map((valueId) => ({ valueId })) }],
})

test('Commerce keeps the original stocked SKU for the first combination and allocates unused suffixes', async (t) => {
  const { app, save, create, call } = await boot(t)
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    isStorable: true,
    tracking: 'none',
    barcode: '4006381333931',
    costPrice: '20',
  })
  await save('stock.adjustInventory', {
    id: 'opening',
    productId: 'goods:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '5',
    productUomId: 'each',
  })
  await create('taken', 'GOODSA')
  await save('product.saveAttributeDraft', definition)
  const result = await save('product.configureAttributes', configuration(['red', 'blue']))
  assert.equal(result.createdVariants, 1)
  let variants = (await call('product.getTemplate', { id: 'goods' })).variants as Row[]
  const original = variants.find((row) => row.combinationKey === 'red')!
  assert.equal(original.id, 'goods:default')
  assert.equal(original.defaultCode, 'GOODS')
  assert.equal(original.barcode, '4006381333931')
  assert.equal(variants.find((row) => row.combinationKey === 'blue')?.defaultCode, 'GOODSB')
  const quantities = await app.adapter!.all(
    'SELECT "productId", quantity FROM stock_quant WHERE "locationId" = \'wh:stock\'',
  )
  assert.equal(quantities[0]?.productId, 'goods:default')
  assert.equal(Number(quantities[0]?.quantity), 5)
  await save('product.configureAttributes', configuration(['red', 'blue', 'green']))
  variants = (await call('product.getTemplate', { id: 'goods' })).variants as Row[]
  assert.equal(variants.find((row) => row.combinationKey === 'red')?.id, original.id)
  assert.equal(variants.find((row) => row.combinationKey === 'green')?.defaultCode, 'GOODSC')
  // The product page still saves: the original SKU is a variant now, not a default to recreate.
  const renamed = await call('product.saveRecord', {
    id: 'goods',
    name: 'Goods renamed',
    type: 'goods',
    expectedRevisionId: (await call('product.getTemplate', { id: 'goods' })).revisionId,
  })
  assert.notEqual(renamed.ok, false, JSON.stringify(renamed.errors))
  const after = (await call('product.getTemplate', { id: 'goods' })) as Row
  assert.equal(after.name, 'Goods renamed')
  assert.deepEqual(
    (after.variants as Row[]).map((row) => [row.combinationKey, row.defaultCode, row.barcode ?? null]).sort(),
    variants.map((row) => [row.combinationKey, row.defaultCode, row.barcode ?? null]).sort(),
    'saving the page leaves every variant identity as it was',
  )
})

test('Commerce refuses dropping a stocked combination with its name and rolls back the whole setup', async (t) => {
  const { save, call } = await boot(t)
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    isStorable: true,
    tracking: 'none',
  })
  await save('product.saveAttributeDraft', definition)
  await save('product.configureAttributes', configuration(['red', 'blue']))
  await save('stock.adjustInventory', {
    id: 'opening',
    productId: 'goods:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '5',
    productUomId: 'each',
  })
  const before = await call('product.getTemplate', { id: 'goods' })
  const refused = await call('product.configureAttributes', configuration(['blue']))
  assert.equal(refused.ok, false)
  const [issue] = refused.errors as Row[]
  assert.equal(issue?.code, 'product.error.variant.stocked')
  assert.match(String(((issue?.params ?? {}) as Row).variant), /Goods · Red · GOODS/)
  assert.deepEqual(await call('product.getTemplate', { id: 'goods' }), before)
  await save('product.configureAttributes', { templateId: 'goods', lines: [] })
  const restored = (await call('product.getTemplate', { id: 'goods' })).variants as Row[]
  assert.equal(restored.find((row) => row.active)?.id, 'goods:default')
  assert.equal(restored.find((row) => row.active)?.combinationKey, '')
})

test('Commerce refuses dropping a quoted SKU and archiving the final active variant', async (t) => {
  const { save, create, call } = await boot(t)
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Buyer' })
  await create('goods', 'GOODS')
  await save('product.saveAttributeDraft', definition)
  await save('product.configureAttributes', configuration(['red', 'blue']))
  const order = await save('sale.createOrder', { id: 'quote', partnerId: 'buyer', warehouseId: 'wh' })
  await save('sale.addLine', {
    id: 'quote-line',
    orderId: order.id,
    productId: 'goods:default',
    productUomId: 'each',
    productUomQty: '1',
    priceUnit: '10',
  })
  const quoted = await call('product.configureAttributes', configuration(['blue']))
  assert.equal((quoted.errors as Row[])[0]?.code, 'product.error.variant.openDocuments')
  const context = await call('product.templateModalContext', { id: 'goods', locale: 'en' })
  const setup = (context.data as Row).variantSetup as Row
  const last = await call('product.saveVariantSetup', {
    templateId: 'goods',
    lines: setup.lines,
    variants: (setup.variants as Row[]).map((row) => ({ ...row, active: false })),
  })
  assert.deepEqual(last.errors, [
    { field: 'variants', code: 'product.error.variant.lastActive', params: { product: 'goods' } },
  ])
  // A refusal shows to people in both languages, never as the server's own wording.
  const messages = context.messages as Record<string, string>
  for (const key of ['stocked', 'openDocuments', 'lastActive'])
    assert.ok(messages[`product.error.variant.${key}`], `missing en message for ${key}`)
})

const variantRows = async (app: Awaited<ReturnType<typeof boot>>['app']) =>
  (await app.adapter!.all(
    'SELECT id, active, "defaultCode", "combinationKey" FROM product_product WHERE "templateId" = \'goods\'',
  )) as Row[]
const isActive = (row: Row) => row.active === true || row.active === 1 || row.active === 't'

test('Commerce deletes a never-used dropped SKU, archives one with history and restores it by combination', async (t) => {
  const { app, save, create } = await boot(t)
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Buyer' })
  await create('goods', 'GOODS')
  await save('product.saveAttributeDraft', definition)
  await save('product.configureAttributes', configuration(['red', 'blue', 'green']))
  const green = (await variantRows(app)).find((row) => row.combinationKey === 'green')!
  const blue = (await variantRows(app)).find((row) => row.combinationKey === 'blue')!
  assert.equal(blue.defaultCode, 'GOODSA')
  assert.equal(green.defaultCode, 'GOODSB')
  const order = await save('sale.createOrder', { id: 'history', partnerId: 'buyer', warehouseId: 'wh' })
  await save('sale.addLine', {
    id: 'history-line',
    orderId: order.id,
    productId: green.id,
    productUomId: 'each',
    productUomQty: '1',
    priceUnit: '10',
  })
  await save('sale.cancelOrder', { id: order.id })
  await save('product.configureAttributes', configuration(['red']))
  let rows = await variantRows(app)
  assert.equal(
    rows.some((row) => row.id === blue.id),
    false,
    'an unreferenced SKU leaves no identity behind',
  )
  const archived = rows.find((row) => row.id === green.id)!
  assert.equal(isActive(archived), false)
  assert.equal(archived.defaultCode, 'GOODSB', 'the cancelled order line still names the archived SKU')
  await save('product.configureAttributes', configuration(['red', 'blue', 'green']))
  rows = await variantRows(app)
  const restored = rows.find((row) => row.combinationKey === 'green')!
  assert.equal(restored.id, green.id)
  assert.equal(isActive(restored), true)
  assert.equal(restored.defaultCode, 'GOODSB')
  assert.equal(
    rows.find((row) => row.combinationKey === 'blue')?.defaultCode,
    'GOODSA',
    'a deleted SKU frees its code',
  )
  assert.equal(rows.filter((row) => isActive(row)).length, 3, JSON.stringify(rows))
})

test('Commerce serializes competing configurations and stock writes on one template', async (t) => {
  const { app, save, call } = await boot(t)
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    isStorable: true,
    tracking: 'none',
  })
  await save('product.saveAttributeDraft', definition)
  await save('product.configureAttributes', configuration(['red', 'blue']))
  // One interleaving is rarely hit; repeat the race and check the invariant each round.
  let overlapped = 0
  for (let round = 0; round < 8; round += 1) {
    await save('product.configureAttributes', configuration(['red', 'blue']))
    const blue = (await variantRows(app)).find((row) => row.combinationKey === 'blue' && isActive(row))!
    await save('stock.adjustInventory', {
      id: `clear-${round}`,
      productId: blue.id,
      locationId: 'wh:stock',
      inventoryLocationId: 'adjustment',
      countedQuantity: '0',
      productUomId: 'each',
    })
    const outcomes = await Promise.allSettled([
      call('stock.adjustInventory', {
        id: `race-${round}`,
        productId: blue.id,
        locationId: 'wh:stock',
        inventoryLocationId: 'adjustment',
        countedQuantity: '3',
        productUomId: 'each',
      }),
      call('product.configureAttributes', configuration(['red'])),
      call('product.configureAttributes', configuration(['red', 'blue', 'green'])),
    ])
    assert.ok(outcomes.some((outcome) => outcome.status === 'fulfilled' && outcome.value.ok !== false))
    const losers = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []))
    for (const loser of losers)
      assert.equal((loser as { body?: Row }).body?.code, 'conflict', `round ${round}: ${String(loser)}`)
    if (losers.length >= 2) overlapped += 1
    const active = (await variantRows(app)).filter(isActive)
    const codes = active.map((row) => String(row.defaultCode))
    assert.equal(new Set(codes).size, codes.length, `round ${round}: duplicate active codes ${codes}`)
    const stocked = (await app.adapter!.all(
      'SELECT "productId", quantity FROM stock_quant WHERE "locationId" = \'wh:stock\'',
    )) as Row[]
    for (const quant of stocked.filter((row) => Number(row.quantity) > 0))
      assert.ok(
        active.some((row) => row.id === quant.productId),
        `round ${round}: stock ${quant.quantity} sits on a retired SKU ${String(quant.productId)}`,
      )
    const keys = active.map((row) => String(row.combinationKey)).sort()
    assert.ok(
      [['red'], ['blue', 'red'], ['blue', 'green', 'red']].some((set) => set.join() === keys.join()),
      `round ${round}: unexpected combinations ${keys}`,
    )
    if (stocked.some((row) => row.productId === blue.id && Number(row.quantity) > 0))
      await save('stock.adjustInventory', {
        id: `drain-${round}`,
        productId: blue.id,
        locationId: 'wh:stock',
        inventoryLocationId: 'adjustment',
        countedQuantity: '0',
        productUomId: 'each',
      })
  }
  // SQLite runs these requests one after another; PostgreSQL overlaps them, and
  // overlapping writers must lose with a conflict instead of both committing.
  if (process.env.KET_COMMERCE_PG) assert.ok(overlapped > 0, 'no round serialized overlapping writers')
})
