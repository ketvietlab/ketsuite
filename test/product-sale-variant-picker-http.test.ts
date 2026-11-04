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

// P29: an order line picks a variant by its full name — the product's name and the values
// that make it — and the choice follows the catalogue as variants are added, stop selling
// or are renamed.

type Variant = { id: string; displayName: string; defaultCode: string | null }

async function shirts(t: TestContext) {
  const booted = await boot(t)
  const { save } = booted
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Buyer' })
  await save('product.saveRecord', {
    id: 'tee',
    name: 'Áo thun',
    type: 'goods',
    defaultCode: 'TEE',
    uomId: 'each',
    listPrice: '100',
    saleOk: true,
  })
  await save('product.saveRecord', {
    id: 'mug',
    name: 'Cốc sứ',
    type: 'goods',
    defaultCode: 'MUG',
    uomId: 'each',
    saleOk: true,
  })
  await save('product.saveAttributeDraft', {
    id: 'size',
    name: 'Cỡ',
    displayType: 'select',
    createVariant: 'always',
    values: [
      { id: 'small', name: 'Nhỏ' },
      { id: 'large', name: 'Lớn' },
      { id: 'xl', name: 'Rất lớn' },
    ],
  })
  const sizes = (ids: string[]) => ({
    templateId: 'tee',
    lines: [{ attributeId: 'size', values: ids.map((valueId) => ({ valueId, priceExtra: '0' })) }],
  })
  await save('product.configureAttributes', sizes(['small', 'large']))
  const picker = async (search = '') =>
    ((await booted.call('product.listVariants', { saleOk: true, search })) as unknown as Variant[])
      .map((row) => row.displayName)
      .sort()
  return { ...booted, sizes, picker }
}

test('Commerce names every sellable variant in full and finds them by the product, accents optional (P29)', async (t) => {
  const { picker } = await shirts(t)
  assert.deepEqual(await picker(), ['Áo thun Lớn', 'Áo thun Nhỏ', 'Cốc sứ'].sort())
  assert.deepEqual(
    await picker('ao thun'),
    ['Áo thun Lớn', 'Áo thun Nhỏ'],
    'the product name finds every size',
  )
  assert.deepEqual(await picker('thun lon'), ['Áo thun Lớn'], 'the full name is searched as one')
  assert.deepEqual(await picker('mug'), ['Cốc sứ'], 'codes still find their variant')
})

test('Commerce lists picker choices by product name, then in the attribute value order (P29)', async (t) => {
  const { call, save, sizes } = await shirts(t)
  await save('product.configureAttributes', sizes(['small', 'large', 'xl']))
  await save('product.saveRecord', {
    id: 'apron',
    name: 'Ấm trà',
    type: 'goods',
    defaultCode: 'TEA',
    uomId: 'each',
    saleOk: true,
  })
  // The picker shows the first few and "More…", in the order the list reads: Ấ beside A, before
  // C, and the sizes small to large as the attribute lists them rather than by stored id.
  const shown = ((await call('product.listVariants', { saleOk: true })) as unknown as Variant[]).map(
    (row) => row.displayName,
  )
  assert.deepEqual(shown, ['Áo thun Nhỏ', 'Áo thun Lớn', 'Áo thun Rất lớn', 'Ấm trà', 'Cốc sứ'])
})

test('Commerce keeps the order line choices in step with new, archived and renamed variants (P29)', async (t) => {
  const { app, call, save, sizes, picker } = await shirts(t)
  // A new size is a new choice.
  await save('product.configureAttributes', sizes(['small', 'large', 'xl']))
  assert.deepEqual(await picker('ao thun'), ['Áo thun Lớn', 'Áo thun Nhỏ', 'Áo thun Rất lớn'])
  // A size that stops selling is no longer offered.
  const setup = ((await call('product.templateModalContext', { id: 'tee', locale: 'vi' })).data as Row)
    .variantSetup as { lines: Row[]; variants: Row[] }
  const stopped = await save('product.saveVariantSetup', {
    templateId: 'tee',
    lines: setup.lines,
    variants: setup.variants.map((row) =>
      (row.valueIds as Row).size === 'xl' ? { ...row, active: false } : row,
    ),
  })
  assert.notEqual(stopped.ok, false)
  assert.deepEqual(await picker('ao thun'), ['Áo thun Lớn', 'Áo thun Nhỏ'])
  // A renamed product renames its choices.
  const revision = String((await call('product.getTemplate', { id: 'tee' })).revisionId)
  await save('product.saveRecord', {
    id: 'tee',
    name: 'Áo phông',
    type: 'goods',
    expectedRevisionId: revision,
  })
  assert.deepEqual(await picker('ao'), ['Áo phông Lớn', 'Áo phông Nhỏ'])

  // The quotation page offers the same choices, in full, and nothing that no longer sells:
  // its add row reads them from the order's context.
  await save('sale.createOrder', { id: 'q1', partnerId: 'buyer', warehouseId: 'wh' })
  const page = await app.client.get('/admin/sales/record/q1/context?lang=vi', {
    headers: { accept: 'application/json' },
  })
  assert.equal(page.status, 200)
  const offered = (
    (await page.json()) as { data: { choices: { variants: Row[] } } }
  ).data.choices.variants.map((row) => String(row.displayName))
  assert.ok(offered.includes('Áo phông Lớn'), 'the large size is offered in full')
  assert.ok(offered.includes('Áo phông Nhỏ'), 'the small size is offered in full')
  assert.ok(!offered.some((name) => name.includes('Rất lớn')), 'an archived size is not offered')
})

test('Commerce order line pickers search the server, so a typed name without accents still finds its variant (P29)', async (t) => {
  const { app, call, save } = await shirts(t)
  await save('product.saveRecord', {
    id: 'yarn',
    name: 'Sợi len',
    type: 'goods',
    defaultCode: 'YARN',
    uomId: 'each',
    purchaseOk: true,
  })
  await save('product.saveRecord', {
    id: 'gift',
    name: 'Thiệp tặng',
    type: 'goods',
    defaultCode: 'GIFT',
    uomId: 'each',
    saleOk: true,
    purchaseOk: false,
  })
  await save('stock.saveLocation', { id: 'supplier', name: 'Supplier', usage: 'supplier' })
  await save('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' })
  await save('stock.savePickingType', {
    id: 'receipt',
    name: 'Receipt',
    code: 'incoming',
    defaultLocationSrcId: 'supplier',
    defaultLocationDestId: 'stock',
  })
  await save('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor' })
  await save('sale.createOrder', { id: 'q1', partnerId: 'buyer', warehouseId: 'wh' })
  await save('purchase.createOrder', { id: 'po1', partnerId: 'vendor', pickingTypeId: 'receipt' })
  // The RFQ's line grid opens with every purchasable variant in full and searches the rest
  // (purchase-line-grid-ui.test.tsx); a product that is not bought is not offered.
  const order = await app.client.get('/admin/purchase/record/po1/context?lang=vi', {
    headers: { accept: 'application/json' },
  })
  assert.equal(order.status, 200)
  const bought = ((await order.json()) as { data: { choices: { variants: Row[] } } }).data.choices.variants
  const names = bought.map((row) => String(row.name))
  assert.ok(names.includes('Sợi len · YARN'), 'a purchasable product is offered by its name and code')
  assert.ok(
    names.some((name) => name.startsWith('Áo thun Nhỏ')),
    'a purchasable size is offered by its full name',
  )
  assert.ok(!names.some((name) => name.includes('Thiệp tặng')), 'a product that is not bought is not offered')
  // Each carries its product's unit, which a new line takes.
  assert.deepEqual([...new Set(bought.map((row) => row.uomId))], ['each'])
  const searched = (await call('product.listVariants', {
    purchaseOk: true,
    search: 'soi len',
  })) as unknown as Row[]
  assert.deepEqual(
    searched.map((row) => [row.displayName, row.uomId]),
    [['Sợi len', 'each']],
  )

  // The line keeps the name the picker showed, not just the product's.
  const small = ((await call('product.listVariants', { search: 'thun nho' })) as unknown as Variant[])[0]!
  await save('sale.addLine', {
    id: 'q1-small',
    orderId: 'q1',
    productId: small.id,
    productUomQty: '1',
    productUomId: 'each',
  })
  await save('purchase.addLine', {
    id: 'po1-small',
    orderId: 'po1',
    productId: small.id,
    productQty: '1',
    productUomId: 'each',
  })
  const lineNames = async (fn: string, id: string) =>
    (((await call(fn, { id })).lines as Row[]) ?? []).map((line) => line.name)
  assert.deepEqual(await lineNames('sale.getOrder', 'q1'), ['Áo thun Nhỏ'])
  assert.deepEqual(await lineNames('purchase.getOrder', 'po1'), ['Áo thun Nhỏ'])
})

test('Commerce quotation and RFQ pages carry their own guide, in the reader language', async (t) => {
  const { app, save } = await shirts(t)
  await save('stock.saveLocation', { id: 'supplier', name: 'Supplier', usage: 'supplier' })
  await save('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' })
  await save('stock.savePickingType', {
    id: 'receipt',
    name: 'Receipt',
    code: 'incoming',
    defaultLocationSrcId: 'supplier',
    defaultLocationDestId: 'stock',
  })
  await save('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor' })
  await save('sale.createOrder', { id: 'q1', partnerId: 'buyer', warehouseId: 'wh' })
  await save('purchase.createOrder', { id: 'po1', partnerId: 'vendor', pickingTypeId: 'receipt' })
  for (const [path, id, vi, en] of [
    ['/admin/sales/quotations/q1', 'sale-order-help', 'Báo giá và đơn bán', 'Quotations and sales orders'],
    [
      '/admin/purchase/rfqs/po1',
      'purchase-order-help',
      'Yêu cầu báo giá và đơn mua',
      'RFQs and purchase orders',
    ],
  ] as const)
    for (const [lang, title, search] of [
      ['vi', vi, 'không cần gõ dấu'],
      ['en', en, 'accents are optional'],
    ] as const) {
      const html = await (await app.client.get(`${path}?lang=${lang}`)).text()
      assert.equal((html.match(new RegExp(`id="${id}"`, 'gu')) ?? []).length, 1, `${path} has one guide`)
      assert.ok(html.includes(title), `${path} ${lang} guide title`)
      assert.ok(html.includes(search), `${path} ${lang} guide explains the product search`)
      assert.match(html, /mermaid/u, `${path} ${lang} guide keeps its diagram`)
    }
})
