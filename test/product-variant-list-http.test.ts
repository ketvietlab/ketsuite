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
  return { app, deployment, fixture, call, save }
}

// One stocked product in two sizes, a one-SKU service and an archived product.
async function catalogue(t: TestContext) {
  const booted = await boot(t)
  const { save } = booted
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await save('product.saveRecord', {
    id: 'tee',
    name: 'Áo thun',
    type: 'goods',
    defaultCode: 'TEE',
    uomId: 'each',
    isStorable: true,
    tracking: 'none',
    listPrice: '100',
    barcode: '4006381333931',
  })
  await save('product.saveAttributeDraft', {
    id: 'size',
    name: 'Cỡ',
    displayType: 'select',
    createVariant: 'always',
    values: [
      { id: 'small', name: 'Nhỏ' },
      { id: 'large', name: 'Lớn' },
    ],
  })
  await save('product.configureAttributes', {
    templateId: 'tee',
    lines: [
      {
        attributeId: 'size',
        values: [
          { valueId: 'small', priceExtra: '0' },
          { valueId: 'large', priceExtra: '30' },
        ],
      },
    ],
  })
  await save('product.saveRecord', {
    id: 'tailoring',
    name: 'Dịch vụ may đo',
    type: 'service',
    defaultCode: 'SEW',
    uomId: 'each',
    listPrice: '50',
  })
  await save('product.saveRecord', {
    id: 'old',
    name: 'Mẫu cũ',
    type: 'goods',
    defaultCode: 'OLD',
    uomId: 'each',
  })
  await save('product.archiveTemplate', {
    id: 'old',
    active: false,
    reason: 'Discontinued',
    expectedRevisionId: (await booted.call('product.getTemplate', { id: 'old' })).revisionId,
    confirmed: true,
  })
  const large = (await booted.call('product.getTemplate', { id: 'tee' })).variants as Row[]
  const largeId = String(large.find((row) => row.combinationKey === 'large')!.id)
  await save('stock.adjustInventory', {
    id: 'count-large',
    productId: largeId,
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '5',
    productUomId: 'each',
  })
  return { ...booted, largeId }
}

const list = (
  call: (fn: string, input: Row) => Promise<Row>,
  input: Row = {},
  fn = 'stock_backend.searchProductVariants',
) =>
  call(fn, input) as Promise<{
    total: number
    page: number
    pages: number
    rows: Row[]
    counts: Row
    categories: Row[]
    isEmpty: boolean
    money: boolean
    stock: boolean
    query: Row
  }>

test('Commerce lists every SKU once, priced and stocked, under its product (P13)', async (t) => {
  const { app, call, largeId } = await catalogue(t)
  // Two of the five are promised to an order: on hand stays, available drops.
  await app.adapter!.run(
    `UPDATE stock_quant SET "reservedQuantity" = 2 WHERE "productId" = '${largeId}' AND "locationId" = 'wh:stock'`,
  )
  const all = await list(call)
  assert.equal(all.stock, true)
  assert.equal(all.money, true)
  assert.equal(all.isEmpty, false)
  // The resting default of the sized product is not a SKU; the archived one waits under its filter.
  assert.deepEqual(
    all.rows.map((row) => [row.name, row.values, row.code, row.price]),
    [
      ['Áo thun', 'Nhỏ', 'TEE', '100'],
      ['Áo thun', 'Lớn', 'TEEA', '130'],
      ['Dịch vụ may đo', '', 'SEW', '50'],
    ].sort((a, b) => a[0]!.localeCompare(b[0]!) || a[2]!.localeCompare(b[2]!)),
  )
  const large = all.rows.find((row) => row.id === largeId)!
  assert.deepEqual([large.onHand, large.available], [5, 3])
  assert.equal(all.rows.find((row) => row.code === 'SEW')!.onHand, null, 'a service keeps no stock')
  assert.deepEqual(all.counts, { active: 3, archived: 1, goods: 2, service: 1, combo: 0 })

  // Search folds accents and covers codes, barcodes, product names and attribute values.
  assert.deepEqual(
    (await list(call, { q: 'lon' })).rows.map((row) => row.code),
    ['TEEA'],
  )
  assert.deepEqual((await list(call, { q: 'ao thun' })).total, 2)
  assert.deepEqual(
    (await list(call, { q: '4006381333931' })).rows.map((row) => row.code),
    ['TEE'],
  )
  assert.deepEqual(
    (await list(call, { q: 'sew' })).rows.map((row) => row.code),
    ['SEW'],
  )

  assert.deepEqual(
    (await list(call, { type: 'service' })).rows.map((row) => row.code),
    ['SEW'],
  )
  const archived = await list(call, { status: 'archived' })
  assert.deepEqual(
    archived.rows.map((row) => [row.code, row.active]),
    [['OLD', false]],
  )

  const byCode = await list(call, { sort: 'code', dir: 'desc', pageSize: 2 })
  assert.deepEqual(
    byCode.rows.map((row) => row.code),
    ['TEEA', 'TEE'],
  )
  assert.equal(byCode.pages, 2)
  const clamped = await list(call, { sort: 'code', dir: 'desc', pageSize: 2, page: 9 })
  assert.deepEqual([clamped.page, clamped.rows.map((row) => row.code)], [2, ['SEW']])

  // Without stock answering, there are no stock figures at all.
  const plain = await list(call, {}, 'product_backend.searchVariants')
  assert.equal(plain.stock, false)
  assert.equal(
    plain.rows.every((row) => row.onHand === null && row.available === null),
    true,
  )
})

test('Commerce hides variant costs from a reader who may not see them (P13/P16)', async (t) => {
  const { fixture, app } = await catalogue(t)
  await fixture('user.saveRole', { id: 'variant-reader', name: 'Variant reader' })
  await fixture('user.grantFunction', {
    id: 'variant-reader:list',
    roleId: 'variant-reader',
    fnKey: 'product_backend.searchVariants',
  })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'reader-acme', userId: 'reader', companyId: 'acme' })
  await fixture('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'variant-reader' })
  const as = (fn: string) =>
    app.fixture.call<Row>(fn, {}, { actor: 'reader', scope: { company: 'acme', branches: null } })
  const seen = (await as('product_backend.searchVariants')).value as Row
  assert.equal(seen.money, false)
  assert.equal(
    (seen.rows as Row[]).every((row) => row.cost === null),
    true,
  )
  assert.equal((seen.rows as Row[]).length, 3, 'the reader still sees every SKU and its price')
})

test('Commerce lists a product’s own row while it sells and hides it while it rests (P13)', async (t) => {
  const { call, save } = await boot(t)
  await save('product.saveRecord', {
    id: 'cap',
    name: 'Mũ',
    type: 'goods',
    defaultCode: 'CAP',
    uomId: 'each',
    listPrice: '80',
  })
  await save('product.saveAttributeDraft', {
    id: 'colour',
    name: 'Màu',
    displayType: 'select',
    createVariant: 'always',
    values: [
      { id: 'red', name: 'Đỏ' },
      { id: 'blue', name: 'Xanh' },
    ],
  })
  const colours = {
    templateId: 'cap',
    lines: [
      {
        attributeId: 'colour',
        values: [
          { valueId: 'red', priceExtra: '0' },
          { valueId: 'blue', priceExtra: '0' },
        ],
      },
    ],
  }
  await save('product.configureAttributes', colours)
  const shown = async () =>
    (await list(call, { status: 'all' }, 'product_backend.searchVariants')).rows
      .map((row) => `${row.values || '-'}:${row.active ? 'on' : 'off'}`)
      .sort()
  assert.deepEqual(await shown(), ['Xanh:on', 'Đỏ:on'])

  // Dropping every colour puts the original row back on sale, and it is listed; the unused
  // colours are gone.
  await save('product.configureAttributes', { templateId: 'cap', lines: [] })
  assert.deepEqual(await shown(), ['-:on'])

  // Colours set up with red not selling: the original row cannot become red, so it rests
  // beside the colours, inactive, and is not a SKU.
  const setup = await save('product.saveVariantSetup', {
    templateId: 'cap',
    lines: colours.lines,
    variants: [
      { id: null, valueIds: { colour: 'red' }, weight: '0', volume: '0', active: false },
      { id: null, valueIds: { colour: 'blue' }, weight: '0', volume: '0', active: true },
    ],
  })
  assert.equal(setup.ok, true)
  assert.deepEqual(await shown(), ['Xanh:on', 'Đỏ:off'], 'the resting original row is not listed')

  // A product that gains a SKU by hand still sells its own row: both are listed.
  await save('product.saveRecord', {
    id: 'scarf',
    name: 'Khăn',
    type: 'goods',
    defaultCode: 'SCARF',
    uomId: 'each',
  })
  await save('product.saveVariant', { id: 'scarf-wide', templateId: 'scarf', defaultCode: 'SCARF-W' })
  const scarves = await list(call, { q: 'khan', status: 'all' }, 'product_backend.searchVariants')
  assert.deepEqual(
    scarves.rows.map((row) => [row.code, row.active]),
    [
      ['SCARF', true],
      ['SCARF-W', true],
    ],
  )
})

test('Commerce names every variant with its attributes in the product’s line order (P13)', async (t) => {
  const { call, save } = await boot(t)
  await save('product.saveRecord', {
    id: 'sock',
    name: 'Tất',
    type: 'goods',
    defaultCode: 'SOCK',
    uomId: 'each',
  })
  await save('product.saveAttributeDraft', {
    id: 'colour',
    name: 'Màu',
    displayType: 'select',
    createVariant: 'always',
    values: [
      { id: 'red', name: 'Đỏ' },
      { id: 'blue', name: 'Xanh' },
    ],
  })
  await save('product.saveAttributeDraft', {
    id: 'size',
    name: 'Cỡ',
    displayType: 'select',
    createVariant: 'always',
    values: [
      { id: 's', name: 'S' },
      { id: 'xl', name: 'XL' },
    ],
  })
  const line = (attributeId: string, ids: string[]) => ({
    attributeId,
    values: ids.map((valueId) => ({ valueId, priceExtra: '0' })),
  })
  await save('product.configureAttributes', {
    templateId: 'sock',
    lines: [line('colour', ['red', 'blue']), line('size', ['s', 'xl'])],
  })
  // Lines read by attribute sequence, then name, as the product page lists them: Cỡ before Màu,
  // for every variant, whichever value sorts first.
  const rows = (await list(call, { q: 'tat' }, 'product_backend.searchVariants')).rows
  assert.deepEqual(
    rows.map((row) => row.values).sort(),
    ['S · Xanh', 'S · Đỏ', 'XL · Xanh', 'XL · Đỏ'].sort(),
  )
})
