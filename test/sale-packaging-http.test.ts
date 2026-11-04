import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('Commerce sale refuses a same-tree unit not enabled for the variant (P36)', async (t) => {
  const { app, add } = await setup(t)
  const result = await add({ productUomId: 'case' })
  assert.equal(result.ok, false)
  assert.equal((result.errors as Row[])[0]!.field, 'productUomId')
  assert.equal((await app.adapter!.all('SELECT id FROM sale_order_line')).length, 0)
})

test('a packaging a quotation line counts in keeps its conversion once the product lets go of it (P34)', async (t) => {
  const { add, call, save } = await setup(t)
  assert.equal((await add()).ok, true)
  // Adding the packaging fixed the unit for good: the line still counts in boxes of 12 after
  // the packaging leaves the product, and the units screen still calls it in use.
  await save('product.removeTemplateUom', { templateId: 'goods', uomId: 'box' })
  const changed = await call('uom.saveUnit', {
    id: 'box',
    name: 'Box of 12',
    relativeUomId: 'each',
    relativeFactor: '6',
  })
  assert.equal(changed.ok, false)
  assert.deepEqual(
    (changed.errors as Row[]).map((error) => [error.field, error.code]),
    [['relativeFactor', 'uom.error.conversionLocked']],
  )
  const context = (await call('product_backend.unitContext', { id: 'box', locale: 'en' })) as {
    data: { usage: Row }
  }
  assert.equal(context.data.usage.inUse, true)
})

test('Commerce sale prices one packaging, while an explicit negotiated price is already per packaging (P36)', async (t) => {
  const { add, call } = await setup(t)
  assert.equal((await add()).priceUnit, '1200')
  assert.equal((await add({ id: 'negotiated', priceUnit: '1100' })).priceUnit, '1100')
  const order = await call('sale.getOrder', { id: 'order' })
  assert.equal(Number(order.amountTotal), 4600)
  assert.equal((order.lines as Row[])[0]!.productUomName, 'Box of 12')
})

test('Commerce sale applies a base-unit pricelist price once per item in the packaging (P36)', async (t) => {
  const { save, add, productId } = await setup(t)
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await save('pricing.savePricelistItem', {
    id: 'rule',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId,
    computePrice: 'fixed',
    fixedPrice: '90',
  })
  await save('sale.createOrder', {
    id: 'priced',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  assert.equal((await add({ orderId: 'priced' })).priceUnit, '1080')
})

test('Commerce sale converts cost-based prices and very small package factors without exponent notation (P36)', async (t) => {
  const { save, add, call, productId, app } = await setup(t)
  await save('product.setCost', { productId, standardPrice: '60' })
  await save('pricing.savePricelist', { id: 'cost-plus', name: 'Cost plus' })
  await save('pricing.savePricelistItem', {
    id: 'cost-rule',
    pricelistId: 'cost-plus',
    appliedOn: '0_product_variant',
    productId,
    computePrice: 'formula',
    base: 'standard_price',
    priceDiscount: '-25',
  })
  await save('sale.createOrder', {
    id: 'cost-order',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'cost-plus',
  })
  assert.equal((await add({ orderId: 'cost-order' })).priceUnit, '900')
  const [cost] = await app.adapter!.all('SELECT "standardPrice" FROM product_cost')
  assert.equal(Number(cost!.standardPrice), 60, 'stored cost stays per product unit')
  await save('uom.saveUnit', {
    id: 'bulk',
    name: 'Bulk unit',
    relativeUomId: 'each',
    relativeFactor: '100000000',
  })
  await save('product.saveRecord', {
    id: 'bulk-goods',
    name: 'Bulk goods',
    type: 'goods',
    defaultCode: 'BULK',
    uomId: 'bulk',
    listPrice: '100',
    saleOk: true,
  })
  await save('product.addTemplateUom', { templateId: 'bulk-goods', uomId: 'each' })
  const variants = (await call('product.listVariants', { templateId: 'bulk-goods' })) as unknown as Row[]
  await assert.doesNotReject(async () => {
    assert.equal(
      (await add({ id: 'tiny-line', productId: variants[0]!.id, productUomId: 'each' })).priceUnit,
      '0.000001',
    )
  })
})

test('Commerce packaged delivery stays in product units, delivered and invoiced quantities stay in line units (P36)', async (t) => {
  const { app, save, add, call, productId } = await setup(t)
  await save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await save('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await save('stock.adjustInventory', {
    id: 'opening',
    productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '36',
    productUomId: 'each',
  })
  await save('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: 'delivery' })
  assert.equal((await add({ priceUnit: '1200' })).ok, true)
  await save('sale.confirmOrder', { id: 'order' })
  // P35: removing an offer must not rewrite or break the confirmed document's units.
  const packaging = await call('product.getPackagingGrid', { templateId: 'goods' })
  await save('product.savePackagingGrid', {
    templateId: 'goods',
    expectedRevisionId: packaging.revision,
    changes: { removed: (packaging.rows as Row[]).map((row) => row.id) },
  })
  assert.ok(
    !(await app.client.call<Row[]>('sale.listLineUnits', { productId })).value.some(
      (row) => row.id === 'box',
    ),
  )
  const [move] = await app.adapter!.all(
    `SELECT "productUomId", "productUomQty" FROM stock_move WHERE "saleLineId" = 'line'`,
  )
  assert.equal(move!.productUomId, 'each')
  assert.equal(Number(move!.productUomQty), 24)
  await save('stock.confirmPicking', { id: 'order:delivery' })
  await save('stock.reserveMove', { id: 'line:delivery' })
  await save('stock.completePicking', { id: 'order:delivery' })
  await save('sale.syncDeliveries', { id: 'order' })
  const order = await call('sale.getOrder', { id: 'order' })
  assert.equal(Number((order.lines as Row[])[0]!.qtyDelivered), 2)
  for (const [id, code, accountType] of [
    ['revenue', 'REV', 'income'],
    ['receivable', 'REC', 'asset_receivable'],
  ])
    await save('account.saveAccount', { id, code, name: id, accountType })
  await save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  await save('sale.createInvoice', {
    id: 'invoice',
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  const [invoiced] = await app.adapter!.all(
    `SELECT "productUomId", quantity, "priceUnit" FROM account_move_line WHERE "saleLineId" = 'line'`,
  )
  assert.equal(invoiced!.productUomId, 'box')
  assert.equal(Number(invoiced!.quantity), 2)
  assert.equal(Number(invoiced!.priceUnit), 1200)
})

test('Commerce packaging choices follow variant links, active units, search and the active company (P36)', async (t) => {
  const { call, save, fixture, productId } = await setup(t)
  await save('product.saveAttributeDraft', {
    id: 'size',
    name: 'Size',
    displayType: 'select',
    createVariant: 'always',
    values: [
      { id: 'small', name: 'Small' },
      { id: 'large', name: 'Large' },
    ],
  })
  await save('product.configureAttributes', {
    templateId: 'goods',
    lines: [
      {
        attributeId: 'size',
        values: [
          { valueId: 'small', priceExtra: '0' },
          { valueId: 'large', priceExtra: '0' },
        ],
      },
    ],
  })
  const variants = (await call('product.listVariants', { templateId: 'goods' })) as unknown as Row[]
  const second = variants.find((row) => row.id !== productId)!
  await save('product.addProductUom', { productId, uomId: 'case' })
  const ids = async (id: unknown, input: Row = {}) =>
    ((await call('sale.listLineUnits', { productId: id, ...input })) as unknown as Row[]).map((row) => row.id)
  assert.deepEqual(await ids(productId), ['each', 'box', 'case'])
  assert.deepEqual(await ids(second.id), ['each', 'box'])
  assert.deepEqual(await ids(productId, { search: 'CASE', limit: 1 }), ['case'])
  assert.deepEqual(await ids(productId, { search: 'nothing' }), [])
  assert.deepEqual(await fixture('sale.listLineUnits', { productId }, 'other'), [])
  assert.deepEqual(await ids('missing'), [])
  await save('uom.saveUnit', {
    id: 'case',
    name: 'Case of 24',
    relativeUomId: 'each',
    relativeFactor: '24',
    active: false,
  })
  assert.deepEqual(await ids(productId), ['each', 'box'])
})

test('Commerce saveDraft rolls back the whole replacement when a line uses an unlinked unit (P36)', async (t) => {
  const { call, add, app, productId } = await setup(t)
  assert.equal((await add()).ok, true)
  const before = await call('sale.getOrder', { id: 'order' })
  const rejected = await call('sale.saveDraft', {
    id: 'order',
    partnerId: 'buyer',
    warehouseId: 'wh',
    expectedRevision: before.revision,
    lines: [
      { id: 'first', productId, productUomQty: '1', productUomId: 'box' },
      { id: 'bad', productId, productUomQty: '1', productUomId: 'case' },
    ],
  })
  assert.equal(rejected.ok, false)
  assert.equal((rejected.errors as Row[])[0]!.field, 'productUomId')
  assert.deepEqual(await call('sale.getOrder', { id: 'order' }), before)
  assert.equal((await app.adapter!.all('SELECT id FROM sale_order_line')).length, 1)
})

test('Commerce quotation refuses a forged unit POST and lists line units through the same policy (P36)', async (t) => {
  const { app, call, productId } = await setup(t)
  const response = await app.client.post(
    '/admin/sales/quotations/order?lang=en',
    new URLSearchParams({ action: 'add-line', productId, productUomId: 'case', productUomQty: '1' }),
    { redirect: 'manual' },
  )
  assert.equal(response.headers.get('location'), '/admin/sales/quotations/order?lang=en&invalid=1')
  // The page's unit picker lists through the same policy (sale-packaging-modal.test.tsx).
  const units = (await call('sale.listLineUnits', { productId })) as unknown as Row[]
  assert.ok(units.some((unit) => unit.id === 'box'))
  assert.ok(!units.some((unit) => unit.id === 'case'))
  assert.equal((await app.adapter!.all('SELECT id FROM sale_order_line')).length, 0)
})

test('Commerce partial and backorder deliveries convert once, preserve fractions, and replay without inflating delivered quantity (P36)', async (t) => {
  const { app, save, add, call, productId } = await setup(t)
  await save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await save('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await save('stock.adjustInventory', {
    id: 'opening',
    productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '36',
    productUomId: 'each',
  })
  assert.equal((await add()).ok, true)
  await save('sale.confirmOrder', { id: 'order' })
  await save('stock.confirmPicking', { id: 'order:delivery' })
  await save('stock.reserveMove', { id: 'line:delivery' })
  const [moveLine] = await app.adapter!.all(`SELECT id FROM stock_move_line WHERE "moveId" = 'line:delivery'`)
  const delivered = await save('stock.completePicking', {
    id: 'order:delivery',
    quantities: [{ moveLineId: moveLine!.id, quantity: 1 }],
    createBackorder: true,
  })
  const quantity = async () =>
    Number(((await call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!.qtyDelivered)
  await save('sale.syncDeliveries', { id: 'order' })
  assert.equal(await quantity(), 0.083)
  await save('sale.syncDeliveries', { id: 'order' })
  assert.equal(await quantity(), 0.083)
  const [backorderMove] = await app.adapter!.all(
    `SELECT id FROM stock_move WHERE "saleLineId" = 'line' AND state = 'confirmed'`,
  )
  await save('stock.reserveMove', { id: backorderMove!.id })
  await save('stock.completePicking', { id: delivered.backorderId })
  await save('sale.syncDeliveries', { id: 'order' })
  assert.equal(await quantity(), 2)
})

test('Commerce unit discovery is permission-checked and never exposes product costs (P36)', async (t) => {
  const { fixture, app, productId } = await setup(t)
  await fixture('user.createUser', {
    id: 'viewer',
    login: 'viewer',
    password: 'viewer-test-password',
    name: 'Viewer',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'viewer-company', userId: 'viewer', companyId: 'acme' })
  const viewer = app.client.anonymous()
  await viewer.login({ login: 'viewer', password: 'viewer-test-password' })
  await assert.rejects(
    () => viewer.call('sale.listLineUnits', { productId }),
    (error: unknown) => {
      assert.equal((error as { status: number }).status, 403)
      return true
    },
  )
  const result = await app.fixture.call(
    'sale.listLineUnits',
    { productId },
    { scope: { company: 'acme', branches: null }, allow: ['sale.listLineUnits'] },
  )
  for (const unit of result.value as Row[]) assert.deepEqual(Object.keys(unit).sort(), ['id', 'name'])
})
