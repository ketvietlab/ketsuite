import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, migrateOne, type Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

async function catalogue(t: Parameters<typeof setup>[0]) {
  const r = await setup(t)
  await r.save('product.saveCategory', { id: 'root', name: 'Hàng hóa' })
  await r.save('product.saveCategory', { id: 'child', name: 'Áo', parentId: 'root' })
  for (const [id, name, values] of [
    [
      'color',
      'Màu',
      [
        { id: 'red', name: 'Đỏ' },
        { id: 'blue', name: 'Xanh' },
      ],
    ],
    [
      'size',
      'Cỡ',
      [
        { id: 'small', name: 'Nhỏ' },
        { id: 'large', name: 'Lớn' },
      ],
    ],
  ] as const)
    await r.save('product.saveAttributeDraft', {
      id,
      name,
      displayType: 'select',
      createVariant: 'always',
      values,
    })
  await r.save('product.saveRecord', {
    id: 'tee',
    name: 'Áo thun',
    defaultCode: 'TEE',
    type: 'goods',
    uomId: 'each',
    categoryId: 'child',
    listPrice: '200',
    saleOk: true,
  })
  await r.save('product.configureAttributes', {
    templateId: 'tee',
    lines: [
      { attributeId: 'color', values: [{ valueId: 'red' }, { valueId: 'blue' }] },
      { attributeId: 'size', values: [{ valueId: 'small' }, { valueId: 'large' }] },
    ],
  })
  await r.save('product.saveRecord', {
    id: 'bag',
    name: 'Túi',
    defaultCode: 'BAG',
    type: 'goods',
    uomId: 'each',
    categoryId: 'root',
    listPrice: '50',
    saleOk: true,
  })
  await r.save('product.configureAttributes', {
    templateId: 'bag',
    lines: [{ attributeId: 'color', values: [{ valueId: 'red' }] }],
  })
  const read = (input: Row = {}) => r.call('sale.getCatalogue', { id: 'order', ...input })
  return { ...r, read }
}

test('D27 catalogue facets use category descendants and OR within / AND across attributes', async (t) => {
  const r = await catalogue(t)
  const all = await r.read()
  assert.equal(all.total, 6)
  assert.equal((all.categories as Row[]).find((row) => row.id === 'root')!.count, 5)
  assert.equal((all.categories as Row[]).find((row) => row.id === 'child')!.name, 'Hàng hóa / Áo')
  assert.equal((await r.read({ categoryId: 'root' })).total, 5)
  const result = await r.read({ valueIds: ['red', 'blue', 'small'] })
  assert.equal(result.total, 2)
  assert.ok((result.rows as Row[]).every((row) => String(row.name).includes('Nhỏ')))
  const color = (result.attributes as Row[]).find((row) => row.id === 'color')!
  assert.deepEqual(
    (color.values as Row[]).map((value) => value.count),
    [1, 1],
  )
  const size = (result.attributes as Row[]).find((row) => row.id === 'size')!
  assert.deepEqual(
    (size.values as Row[]).map((value) => value.count),
    [2, 2],
  )
  assert.equal((await r.read({ valueIds: ['red'] })).total, 3)
})

test('D27 catalogue finds accent-free names, codes and package barcodes without invalidating empty filters', async (t) => {
  const r = await catalogue(t)
  assert.equal((await r.read({ search: 'ao thun', valueIds: ['red', 'small'] })).total, 1)
  assert.equal((await r.read({ search: 'BAG' })).total, 1)
  await r.save('product.addProductUom', { productId: r.productId, uomId: 'box', barcode: '4006381333931' })
  assert.equal((await r.read({ search: '4006381333931' })).total, 1)
  const empty = await r.read({ search: 'absent', valueIds: ['red'] })
  assert.equal(empty.ok, true)
  assert.equal(empty.total, 0)
  assert.deepEqual(
    ((empty.attributes as Row[])[0]!.values as Row[]).map((row) => row.count),
    [0],
  )
})

test('D27 catalogue uses the first commercial line packaging and discounted price, otherwise the order pricelist', async (t) => {
  const r = await setup(t)
  await r.add({ sequence: 100, priceUnit: '1200', discount: '10' })
  await r.add({ id: 'second', sequence: 200, productUomId: 'each', priceUnit: '999', productUomQty: '8' })
  const current = (await r.call('sale.getCatalogue', { id: 'order' })).rows as Row[]
  assert.deepEqual(
    [current[0]!.lineId, current[0]!.quantity, current[0]!.unitId, current[0]!.price],
    ['line', '2', 'box', '1080'],
  )
  await r.save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await r.save('pricing.savePricelistItem', {
    id: 'rule',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId: r.productId,
    computePrice: 'fixed',
    fixedPrice: '90',
  })
  await r.save('sale.createOrder', {
    id: 'priced',
    partnerId: 'buyer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  const priced = (await r.call('sale.getCatalogue', { id: 'priced' })).rows as Row[]
  assert.equal(priced[0]!.price, '90')
  assert.equal(priced[0]!.unitId, 'each')
  assert.equal(JSON.stringify(current).includes('unitCost'), false)
})

test('D27 catalogue excludes inactive, non-selling and combo templates and isolates active company', async (t) => {
  const r = await setup(t)
  for (const [id, type, _active, saleOk] of [
    ['inactive', 'goods', false, true],
    ['purchase', 'goods', true, false],
  ] as const)
    await r.save('product.saveRecord', {
      id,
      name: id,
      defaultCode: id.toUpperCase(),
      type,
      saleOk,
      uomId: 'each',
    })
  await r.save('product.saveCombo', {
    id: 'choice',
    name: 'Choice',
    items: [{ productId: r.productId, extraPrice: '0' }],
  })
  await r.save('product.saveRecord', {
    id: 'combo',
    name: 'Combo',
    defaultCode: 'COMBO',
    type: 'combo',
    saleOk: true,
    uomId: 'each',
    comboIds: ['choice'],
  })
  await r.save('product.archiveTemplate', {
    id: 'inactive',
    active: false,
    reason: 'Discontinued',
    expectedRevisionId: (await r.call('product.getTemplate', { id: 'inactive' })).revisionId,
    confirmed: true,
  })
  await r.fixture(
    'product.saveRecord',
    { id: 'foreign', name: 'Secret', defaultCode: 'FOREIGN', type: 'goods', saleOk: true, uomId: 'each' },
    'other',
  )
  const result = await r.app.fixture.call<Row>(
    'sale.getCatalogue',
    { id: 'order' },
    { scope: { company: 'acme', companies: ['acme', 'other'], branches: null } },
  )
  assert.equal(result.value.total, 1)
  assert.equal(JSON.stringify(result.value).includes('Secret'), false)
  assert.equal(
    (
      await r.app.fixture.call(
        'sale.getCatalogue',
        { id: 'order' },
        { scope: { company: 'other', companies: ['acme', 'other'], branches: null } },
      )
    ).value,
    null,
  )
})

test('D27 catalogue bounds pages and rejects unknown or duplicate facet values', async (t) => {
  const r = await catalogue(t)
  for (const valueIds of [['red', 'red'], ['missing'], { red: true }])
    assert.equal((await r.read({ valueIds })).ok, false)
  assert.equal((await r.read({ categoryId: 'missing' })).ok, false)
  assert.equal((await r.read({ search: 'x'.repeat(121) })).ok, false)
  for (let i = 0; i < 22; i++)
    await r.save('product.saveRecord', {
      id: 'item-' + i,
      name: 'Item ' + i,
      defaultCode: 'ITEM' + i,
      type: 'goods',
      saleOk: true,
      uomId: 'each',
      listPrice: '10',
    })
  const first = await r.read(),
    second = await r.read({ page: 2 })
  assert.equal(first.total, 28)
  assert.equal((first.rows as Row[]).length, 24)
  assert.equal((second.rows as Row[]).length, 4)
  assert.equal(new Set([...(first.rows as Row[]), ...(second.rows as Row[])].map((row) => row.id)).size, 28)
})

async function quantityFixture(t: Parameters<typeof setup>[0]) {
  const r = await setup(t)
  const order = () => r.call('sale.getOrder', { id: 'order' })
  const quantity = async (quantity: string, input: Row = {}) =>
    r.call('sale.setCatalogueQuantity', {
      id: 'order',
      productId: r.productId,
      quantity,
      expectedRevision: (await order()).revision,
      ...input,
    })
  return { ...r, order, quantity }
}

test('D27 quantities append, update the first duplicate, remove zero and preserve no-op revisions', async (t) => {
  const r = await quantityFixture(t)
  const initial = await r.order()
  assert.equal((await r.quantity('0')).revision, initial.revision)
  assert.equal((await r.quantity('2')).ok, true)
  const first = (await r.order()).lines as Row[]
  assert.equal(first.length, 1)
  assert.equal(first[0]!.productUomId, 'each')
  assert.equal(first[0]!.priceAutomatic, true)
  await r.add({ id: 'duplicate', productUomId: 'each', sequence: 999, priceUnit: '75' })
  assert.equal((await r.quantity('3')).ok, true)
  let lines = (await r.order()).lines as Row[]
  assert.equal(lines.find((row) => row.id === first[0]!.id)!.productUomQty, '3')
  assert.equal(lines.find((row) => row.id === 'duplicate')!.productUomQty, '2')
  const held = await r.order()
  assert.equal((await r.quantity('3')).revision, held.revision)
  assert.equal((await r.quantity('0')).ok, true)
  lines = (await r.order()).lines as Row[]
  assert.deepEqual(
    lines.map((row) => row.id),
    ['duplicate'],
  )
})

test('D27 automatic quantities requote tiers while manual and legacy prices remain unchanged', async (t) => {
  const r = await quantityFixture(t)
  await r.save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  for (const [id, minQuantity, fixedPrice] of [
    ['base', '0', '90'],
    ['bulk', '5', '70'],
  ])
    await r.save('pricing.savePricelistItem', {
      id,
      pricelistId: 'retail',
      appliedOn: '0_product_variant',
      productId: r.productId,
      computePrice: 'fixed',
      minQuantity,
      fixedPrice,
    })
  await r.app.adapter!.run(`UPDATE sale_order SET "pricelistId" = 'retail' WHERE id = 'order'`)
  assert.equal((await r.quantity('2')).ok, true)
  assert.equal(((await r.order()).lines as Row[])[0]!.priceUnit, '90')
  assert.equal((await r.quantity('5')).ok, true)
  let line = ((await r.order()).lines as Row[])[0]!
  assert.equal(line.priceUnit, '70')
  await r.save('sale.updateLine', {
    id: line.id,
    expectedRevision: (await r.order()).revision,
    productUomQty: '5',
    priceUnit: '83',
  })
  assert.equal((await r.quantity('7')).ok, true)
  line = ((await r.order()).lines as Row[])[0]!
  assert.equal(line.priceUnit, '83')
  assert.equal(line.priceAutomatic, false)
  await r.app.adapter!.run(
    `UPDATE sale_order_line SET "priceAutomatic" = NULL WHERE id = ${r.app.adapter!.name === 'postgres' ? '$1' : '?'}`,
    [line.id],
  )
  assert.equal((await r.quantity('8')).ok, true)
  assert.equal(((await r.order()).lines as Row[])[0]!.priceUnit, '83')
})

test('D27 quantity rejects stale revision, invalid amounts, other company and simultaneous writers', async (t) => {
  const r = await quantityFixture(t)
  const revision = (await r.order()).revision
  assert.equal((await r.quantity('-1')).ok, false)
  const results = await Promise.allSettled(
    ['2', '3'].map((quantity) => r.quantity(quantity, { expectedRevision: revision })),
  )
  assert.equal(
    results.filter((result) => result.status === 'fulfilled' && result.value.ok === true).length,
    1,
  )
  assert.equal(((await r.order()).lines as Row[]).length, 1)
  assert.equal((await r.quantity('4', { expectedRevision: revision })).ok, false)
  const foreign = await r.app.fixture.call<Row>(
    'sale.setCatalogueQuantity',
    { id: 'order', productId: r.productId, quantity: '4', expectedRevision: (await r.order()).revision },
    { scope: { company: 'other', companies: ['acme', 'other'], branches: null } },
  )
  assert.equal(foreign.value.ok, false)
})

test('D27 confirmed quantities resize demand, freeze history prices and refuse detaching stock references', async (t) => {
  const r = await quantityFixture(t)
  await r.quantity('2')
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('product.saveRecord', {
    id: 'goods',
    expectedRevisionId: (await r.call('product.getTemplate', { id: 'goods' })).revisionId,
    name: 'Goods',
    defaultCode: 'GOODS',
    type: 'goods',
    uomId: 'each',
    saleOk: true,
    listPrice: '777',
  })
  assert.equal((await r.quantity('4')).ok, true)
  const line = ((await r.order()).lines as Row[])[0]!
  assert.equal(line.priceUnit, '100')
  const moves = await r.app.adapter!.all(
    `SELECT * FROM stock_move WHERE "saleLineId" = ${r.app.adapter!.name === 'postgres' ? '$1' : '?'}`,
    [line.id],
  )
  assert.equal(moves.length, 1)
  assert.equal(moves[0]!.productUomQty, '4')
  const before = await r.order()
  assert.equal((await r.quantity('0')).ok, false)
  assert.deepEqual(await r.order(), before)
  await r.save('product.saveRecord', {
    id: 'second',
    name: 'Second',
    defaultCode: 'SECOND',
    type: 'goods',
    saleOk: true,
    uomId: 'each',
    listPrice: '20',
  })
  assert.equal((await r.quantity('3', { productId: 'second:default' })).ok, true)
  const lines = (await r.order()).lines as Row[]
  assert.equal(lines.length, 2)
  const added = lines.find((row) => row.productId === 'second:default')!
  const demand = await r.app.adapter!.all(
    `SELECT * FROM stock_move WHERE "saleLineId" = ${r.app.adapter!.name === 'postgres' ? '$1' : '?'}`,
    [added.id],
  )
  assert.equal(demand[0]!.productUomQty, '3')
})

test('D27 saves pending grid and delivery drafts atomically and leaves failures unchanged', async (t) => {
  const r = await quantityFixture(t)
  await r.add({ priceUnit: '100' })
  const before = await r.order()
  const changes = {
    added: [],
    updated: [{ id: 'line', values: { productUomQty: '5' } }],
    removed: [],
    order: null,
  }
  const invalid = await r.call('sale.saveCatalogueDraft', {
    id: 'order',
    expectedRevision: before.revision,
    changes,
    shippingPolicy: 'invalid',
  })
  assert.equal(invalid.ok, false)
  assert.deepEqual(await r.order(), before)
  const saved = await r.call('sale.saveCatalogueDraft', {
    id: 'order',
    expectedRevision: before.revision,
    changes,
    shippingPolicy: 'one',
  })
  assert.equal(saved.ok, true)
  const after = await r.order()
  assert.equal(after.shippingPolicy, 'one')
  assert.equal((after.lines as Row[])[0]!.productUomQty, '5')
  assert.equal(
    (await r.call('sale.saveCatalogueDraft', { id: 'order', expectedRevision: before.revision, changes })).ok,
    false,
  )
  assert.deepEqual(await r.order(), after)
})

test('D27 ordinary readers can browse but cannot change quantity or save a parent draft', async (t) => {
  const r = await quantityFixture(t)
  await r.fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'read-role', name: 'Reader' })
  for (const fnKey of ['sale.getCatalogue', 'sale.getOrder'])
    await r.fixture('user.grantFunction', { id: fnKey, roleId: 'read-role', fnKey })
  await r.fixture('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'read-role' })
  const reader = r.app.client.anonymous()
  await reader.login({ login: 'reader', password: 'test-password' })
  const result = (await reader.call<Row>('sale.getCatalogue', { id: 'order' })).value
  assert.equal(result.ok, true)
  for (const fn of ['sale.setCatalogueQuantity', 'sale.saveCatalogueDraft'])
    await assert.rejects(
      () => reader.call(fn, { id: 'order', productId: r.productId, quantity: '1', expectedRevision: 0 }),
      (error: unknown) => (error as { status: number }).status === 403,
    )
  const page = await reader.get('/admin/sales/catalogue/order?lang=en')
  assert.equal(page.status, 200)
  const markup = await page.text()
  assert.ok(markup.includes('read-only catalogue'))
  assert.equal(markup.includes('data-sku='), false)
})

test('D27 active-company catalogue route keeps facets, help and scope in native links', async (t) => {
  const r = await catalogue(t)
  const page = await r.app.client.get(
    '/admin/sales/catalogue/order?lang=en&categoryId=root&valueIds=red&search=ao',
  )
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.ok(html.includes('sale-catalogue-help'))
  assert.ok(html.includes('Catalogue'))
  assert.ok(html.includes('name="valueIds"'))
  assert.ok(html.includes('sale.catalogue'))
  assert.equal((await r.app.client.get('/admin/sales/catalogue/missing?lang=en')).status, 404)
})

test('D27 refuses locked, cancelled and externally managed orders without changing their lines', async (t) => {
  const r = await quantityFixture(t)
  await r.quantity('2')
  for (const patch of [
    'locked = TRUE',
    "locked = FALSE, state = 'cancel'",
    "state = 'draft', \"orderAuthority\" = 'external'",
  ]) {
    await r.app.adapter!.run(`UPDATE sale_order SET ${patch} WHERE id = 'order'`)
    const before = await r.order()
    assert.equal((await r.quantity('3')).ok, false)
    assert.equal(
      (
        await r.call('sale.saveCatalogueDraft', {
          id: 'order',
          expectedRevision: before.revision,
          shippingPolicy: 'one',
        })
      ).ok,
      false,
    )
    assert.deepEqual(await r.order(), before)
  }
})

test('D27 rejects malformed price intent and null parent drafts atomically', async (t) => {
  const r = await quantityFixture(t)
  await r.add({ priceUnit: '100' })
  const before = await r.order()
  for (const changes of [
    null,
    {
      added: [],
      removed: [],
      order: null,
      updated: [{ id: 'line', values: { priceAutomatic: 'true', productUomQty: '5' } }],
    },
  ]) {
    assert.equal(
      (
        await r.call('sale.saveCatalogueDraft', {
          id: 'order',
          expectedRevision: before.revision,
          changes,
          shippingPolicy: 'one',
        })
      ).ok,
      false,
    )
    assert.deepEqual(await r.order(), before)
  }
})

test('D27 invoice references protect quantities even before cached invoice quantities sync', async (t) => {
  const r = await quantityFixture(t)
  await r.quantity('4')
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
  await r.app.adapter!.run(`UPDATE sale_order_line SET "qtyInvoiced" = '0' WHERE "orderId" = 'order'`)
  const before = await r.order()
  assert.equal((await r.quantity('3')).ok, false)
  assert.deepEqual(await r.order(), before)
  assert.equal((await r.quantity('5')).ok, true)
})

test('D27 delivered source moves protect quantities and preserve backorders with stale caches', async (t) => {
  const r = await quantityFixture(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'opening',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'each',
  })
  await r.quantity('4')
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  const moves = (await r.order()).moves as Row[]
  for (const move of moves) await r.save('stock.reserveMove', { id: move.id })
  const moveLines = await r.app.adapter!.all('SELECT id FROM stock_move_line')
  await r.save('stock.completePicking', {
    id: 'order:delivery',
    quantities: moveLines.map((row) => ({ moveLineId: row.id, quantity: 2 })),
    createBackorder: true,
  })
  await r.app.adapter!.run(`UPDATE sale_order_line SET "qtyDelivered" = '0' WHERE "orderId" = 'order'`)
  const before = await r.order()
  assert.equal((await r.quantity('1')).ok, false)
  assert.deepEqual(await r.order(), before)
  assert.equal((await r.quantity('5')).ok, true)
  const updated = (await r.order()).moves as Row[]
  assert.equal(updated.find((row) => row.state === 'done')!.quantity, '2')
  assert.equal(
    updated
      .filter((row) => !['done', 'cancel'].includes(String(row.state)))
      .reduce((sum, row) => sum + Number(row.productUomQty), 0),
    3,
  )
})

test('D27 nullable automatic-price migration preserves legacy prices and replays safely', async (t) => {
  const r = await quantityFixture(t)
  await r.add({ priceUnit: '83' })
  const legacyModules = r.deployment.modules.map((module) => {
    if (typeof module === 'string' || module.name !== 'sale') return module
    const line = module.models!.OrderLine!
    const { priceAutomatic: _automatic, ...fields } = line.fields
    return { ...module, models: { ...module.models, OrderLine: { ...line, fields } } }
  })
  await migrateOne(r.app.adapter!, compose(legacyModules, { headless: true, companies: true }), {
    allowDestructive: true,
  })
  const before = await r.app.adapter!.all('SELECT * FROM sale_order_line')
  const target = compose(r.deployment.modules, { headless: true, companies: true })
  await migrateOne(r.app.adapter!, target)
  const after = await r.app.adapter!.all('SELECT * FROM sale_order_line')
  assert.equal(after[0]!.priceAutomatic, null)
  assert.deepEqual(
    after.map(({ priceAutomatic: _mode, ...line }) => line),
    before.map((line) => ({ ...line })),
  )
  assert.deepEqual(await migrateOne(r.app.adapter!, target), [])
  assert.equal((await r.quantity('3')).ok, true)
  assert.equal(((await r.order()).lines as Row[])[0]!.priceUnit, '83')
})
