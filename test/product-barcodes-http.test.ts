import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, schemaFromManifest, sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { validGtin } from '../packages/ketsuite/src/modules/product/barcodes.ts'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'
import { legacyModules } from './fixtures/legacy-modules.ts'

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
  await save('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'each', relativeFactor: '6' })
  await save('uom.saveUnit', { id: 'carton', name: 'Carton', relativeUomId: 'each', relativeFactor: '24' })
  const create = (id: string, defaultCode: string) =>
    call('product.saveRecord', { id, name: id, type: 'goods', defaultCode, uomId: 'each' })
  const get = async (id: string): Promise<Row> => {
    const template = await call('product.getTemplate', { id })
    const defaultVariant = (template.variants as Row[]).find((row) => row.combinationKey === '')
    return { ...template, defaultCode: defaultVariant?.defaultCode, barcode: defaultVariant?.barcode }
  }
  return { app, deployment, fixture, call, save, create, get }
}

const refused = (result: Row, code: string) => {
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.equal((result.errors as Row[])[0]?.code, `product.error.template.${code}`, JSON.stringify(result))
}
const GTIN = ['96385074', '036000291452', '4006381333931', '012345678905']

test('GS1 accepts the four GTIN lengths and rejects invalid check digits and syntax', () => {
  for (const code of [...GTIN, '0036000291452', '00036000291452']) assert.equal(validGtin(code), true, code)
  for (const code of ['', '123456789', 'ABCDEFGHIJKLM', '4006381333932', ' 96385074', '9638507'])
    assert.equal(validGtin(code), false, code)
})

test('Commerce barcode writes validate GS1 and roll back the complete record on refusal', async (t) => {
  const { app, create, call, save, get } = await boot(t)
  await create('first', 'FIRST')
  const before = await get('first')
  for (const [fn, input] of [
    [
      'product.saveTemplate',
      { id: 'first', name: 'Changed', type: 'goods', expectedRevisionId: before.revisionId },
    ],
    [
      'product.saveRecord',
      { id: 'first', name: 'Changed', type: 'goods', expectedRevisionId: before.revisionId },
    ],
    ['product.saveVariant', { id: 'first:default', templateId: 'first' }],
    ['product.setBarcode', { productId: 'first:default' }],
    ['product.addProductUom', { productId: 'first:default', uomId: 'box' }],
    ['product.setProductUom', { productId: 'first:default', uomId: 'box' }],
  ] as const)
    refused(await call(fn, { ...input, barcode: '4006381333932' }), 'barcodeFormat')
  assert.equal((await get('first')).name, 'first')
  assert.equal((await get('first')).revisionId, before.revisionId)
  assert.equal((await app.adapter!.all('SELECT id FROM product_barcode_claim')).length, 0)
  await save('product.setBarcode', { productId: 'first:default', barcode: GTIN[0] })
  const withBarcode = await get('first')
  assert.notEqual(withBarcode.revisionId, before.revisionId)
  await save('product.setBarcode', { productId: 'first:default', barcode: GTIN[0] })
  assert.equal((await get('first')).revisionId, withBarcode.revisionId, 'no-op preserves the revision')
  await save('product.setBarcode', { productId: 'first:default', barcode: null })
  assert.equal((await app.adapter!.all('SELECT id FROM product_barcode_claim')).length, 0)
})

test('Commerce uses one barcode namespace across SKUs and packaging, including padded GTINs', async (t) => {
  const { app, create, call, save, fixture, get } = await boot(t)
  await create('one', 'ONE')
  await create('two', 'TWO')
  await save('product.setBarcode', { productId: 'one:default', barcode: GTIN[1] })
  refused(
    await call('product.addProductUom', { productId: 'two:default', uomId: 'box', barcode: '0036000291452' }),
    'barcodeTaken',
  )
  await save('product.addProductUom', { productId: 'two:default', uomId: 'box', barcode: GTIN[2] })
  refused(await call('product.setBarcode', { productId: 'one:default', barcode: GTIN[2] }), 'barcodeTaken')
  const found = (await app.client.call<Row[]>('product.listVariants', { search: GTIN[2] })).value
  assert.deepEqual(
    found.map((row) => row.id),
    ['two:default'],
  )
  const listed = await call('product_backend.searchTemplates', {
    href: `/admin/product/templates?q=${GTIN[2]}`,
  })
  assert.deepEqual(
    (listed.rows as Row[]).map((row) => row.id),
    ['two'],
  )
  await save('product.archiveTemplate', {
    id: 'two',
    active: false,
    reason: 'No longer sold',
    expectedRevisionId: (await get('two')).revisionId,
    confirmed: true,
  })
  refused(await call('product.setBarcode', { productId: 'one:default', barcode: GTIN[2] }), 'barcodeTaken')
  await fixture(
    'product.saveTemplate',
    { id: 'other', name: 'Other', type: 'goods', barcode: GTIN[1] },
    'other',
  )
  const other = (await fixture('product.getTemplate', { id: 'other' }, 'other')) as Row
  assert.equal((other.variants as Row[])[0]!.barcode, GTIN[1])
})

test('Commerce concurrent SKU and packaging claims have one winner with no orphaned writes', async (t) => {
  const { app, create, call } = await boot(t)
  await create('one', 'ONE')
  await create('two', 'TWO')
  const results = await Promise.all([
    call('product.setBarcode', { productId: 'one:default', barcode: GTIN[2] }),
    call('product.addProductUom', { productId: 'two:default', uomId: 'box', barcode: GTIN[2] }),
  ])
  assert.equal(results.filter((result) => result.ok === true).length, 1)
  refused(results.find((result) => result.ok === false)!, 'barcodeTaken')
  assert.equal((await app.adapter!.all('SELECT id FROM product_barcode_claim')).length, 1)
  const owners = await app.adapter!.all(
    'SELECT barcode FROM product_product UNION ALL SELECT barcode FROM product_product_uom',
  )
  assert.equal(owners.filter((row) => row.barcode === GTIN[2]).length, 1)
})

test('Commerce packaging swaps are atomic and clearing a packaging frees its barcode', async (t) => {
  const { app, create, call, save } = await boot(t)
  await create('one', 'ONE')
  for (const uomId of ['box', 'carton']) await save('product.addTemplateUom', { templateId: 'one', uomId })
  const productId = 'one:default'
  await save('product.setPackagingBarcodes', {
    productId,
    barcodes: [
      { uomId: 'box', barcode: GTIN[0] },
      { uomId: 'carton', barcode: GTIN[2] },
    ],
  })
  await save('product.setPackagingBarcodes', {
    productId,
    barcodes: [
      { uomId: 'box', barcode: GTIN[2] },
      { uomId: 'carton', barcode: GTIN[0] },
    ],
  })
  const before = await app.adapter!.all('SELECT * FROM product_product_uom ORDER BY id')
  const invalid = await call('product.setPackagingBarcodes', {
    productId,
    barcodes: [
      { uomId: 'box', barcode: GTIN[1] },
      { uomId: 'carton', barcode: 'INVALID' },
    ],
  })
  refused(invalid, 'barcodeFormat')
  // The refusal names the packaging row it came from, so the form marks that row's field.
  assert.equal((invalid.errors as Row[])[0]?.field, 'barcodes.1.barcode')
  assert.deepEqual(await app.adapter!.all('SELECT * FROM product_product_uom ORDER BY id'), before)
  // A packaging barcode another SKU holds is refused on its row, in the packaging's words.
  await save('product.setBarcode', { productId, barcode: GTIN[3] })
  const taken = await call('product.setPackagingBarcodes', {
    productId,
    barcodes: [
      { uomId: 'box', barcode: GTIN[2] },
      { uomId: 'carton', barcode: GTIN[3] },
    ],
  })
  assert.deepEqual(taken.errors, [
    { field: 'barcodes.1.barcode', code: 'product.error.packaging.barcodeTaken' },
  ])
  assert.deepEqual(await app.adapter!.all('SELECT * FROM product_product_uom ORDER BY id'), before)
  await save('product.setBarcode', { productId, barcode: null })
  await save('product.removeTemplateUom', { templateId: 'one', uomId: 'box' })
  await save('product.setBarcode', { productId, barcode: GTIN[2] })
})

test('Commerce variant setup swaps GTINs atomically and rejects a later invalid row', async (t) => {
  const { app, create, save, call } = await boot(t)
  await create('sizes', 'SIZES')
  await save('product.saveAttribute', {
    id: 'size',
    name: 'Size',
    createVariant: 'always',
    displayType: 'radio',
  })
  for (const id of ['small', 'large'])
    await save('product.saveAttributeValue', { id, attributeId: 'size', name: id })
  const lines = [
    {
      attributeId: 'size',
      values: [
        { valueId: 'small', priceExtra: '0' },
        { valueId: 'large', priceExtra: '0' },
      ],
    },
  ]
  await save('product.saveVariantSetup', {
    templateId: 'sizes',
    lines,
    variants: [
      { valueIds: { size: 'small' }, defaultCode: 'SIZE-S', barcode: GTIN[0], active: true },
      { valueIds: { size: 'large' }, defaultCode: 'SIZE-L', barcode: GTIN[2], active: true },
    ],
  })
  const rows = await app.adapter!.all(
    'SELECT * FROM product_product WHERE "templateId" = \'sizes\' AND "combinationKey" <> \'\' ORDER BY id',
  )
  const variants = rows.map((row, index) => ({
    id: row.id,
    valueIds: { size: row.combinationKey },
    defaultCode: row.defaultCode,
    barcode: rows[1 - index]!.barcode,
    active: true,
  }))
  await save('product.saveVariantSetup', { templateId: 'sizes', lines, variants })
  const before = await app.adapter!.all('SELECT * FROM product_product ORDER BY id')
  refused(
    await call('product.saveVariantSetup', {
      templateId: 'sizes',
      lines,
      variants: variants.map((row, index) => ({ ...row, barcode: index ? 'BAD' : GTIN[1] })),
    }),
    'barcodeFormat',
  )
  assert.deepEqual(await app.adapter!.all('SELECT * FROM product_product ORDER BY id'), before)
  assert.equal(before.find((row) => row.id === rows[0]!.id)!.barcode, rows[1]!.barcode)
})

test('Commerce inventory writer uses the same GTIN reservation and rolls back invalid creates', async (t) => {
  const { app, create, call, save } = await boot(t)
  await create('one', 'ONE')
  await save('product.setBarcode', { productId: 'one:default', barcode: GTIN[1] })
  const native = {
    id: 'native',
    templateId: 'native-template',
    name: 'Native',
    kind: 'consumable',
    tracking: 'none',
    uomId: 'each',
    salePrice: '10',
    saleOk: true,
    purchaseOk: true,
    pointOfSale: true,
    create: true,
    sku: 'NATIVE',
  }
  refused(await call('stock.saveInventoryProduct', { ...native, barcode: 'BAD' }), 'barcodeFormat')
  refused(await call('stock.saveInventoryProduct', { ...native, barcode: '0036000291452' }), 'barcodeTaken')
  assert.equal(
    (await app.adapter!.all("SELECT id FROM product_template WHERE id = 'native-template'")).length,
    0,
  )
  await save('stock.saveInventoryProduct', { ...native, barcode: GTIN[2] })
  refused(
    await call('product.addProductUom', { productId: 'one:default', uomId: 'box', barcode: GTIN[2] }),
    'barcodeTaken',
  )
})

test('Commerce barcode migration preserves legacy values and detects legacy packaging collisions', async (t) => {
  const { app, deployment, create, call, save, get } = await boot(t)
  await create('old-a', 'OLD-A')
  await create('old-b', 'OLD-B')
  await save('product.addProductUom', { productId: 'old-a:default', uomId: 'box' })
  const adapter = app.adapter!
  const manifest = compose(deployment.modules, { headless: true, companies: true })
  const oldModules = legacyModules(
    deployment.modules.map((module) => {
      if (typeof module === 'string' || module.name !== 'product') return module
      const { BarcodeClaim: _claim, ...models } = module.models!
      return { ...module, version: '0.2.2', models }
    }),
  )
  await adapter.exec('DROP TABLE product_barcode_claim')
  await adapter.exec("UPDATE product_product SET barcode = 'LEGACY-A' WHERE id = 'old-a:default'")
  await adapter.exec("UPDATE product_product_uom SET barcode = '0036000291452'")
  const placeholder = adapter.name === 'postgres' ? '$1' : '?'
  await adapter.run(`UPDATE ket_migration SET schema = ${placeholder} WHERE id = 1`, [
    JSON.stringify(schemaFromManifest(compose(oldModules, { headless: true, companies: true }))),
  ])
  await migrateOne(adapter, manifest)
  assert.equal((await get('old-a')).barcode, 'LEGACY-A')
  await save('product.saveTemplate', {
    id: 'old-a',
    name: 'Legacy rename',
    type: 'goods',
    barcode: 'LEGACY-A',
    expectedRevisionId: (await get('old-a')).revisionId,
  })
  refused(await call('product.setBarcode', { productId: 'old-b:default', barcode: GTIN[1] }), 'barcodeTaken')
  await save('product.setProductUom', { productId: 'old-a:default', uomId: null })
  await save('product.setBarcode', { productId: 'old-b:default', barcode: GTIN[1] })
  assert.deepEqual(await migrateOne(adapter, manifest), [])
})

test('Commerce catalogue-only editor may preserve a barcode but cannot change it', async (t) => {
  const { app, fixture, create, call, save, get } = await boot(t)
  await create('one', 'ONE')
  await save('product.setBarcode', { productId: 'one:default', barcode: GTIN[1] })
  await fixture('user.createUser', {
    id: 'editor',
    login: 'editor',
    password: 'test-password',
    name: 'Editor',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'editor-acme', userId: 'editor', companyId: 'acme' })
  await fixture('user.saveRole', { id: 'editor-role', name: 'Editor' })
  for (const fnKey of [
    'product.getTemplate',
    'product.saveTemplate',
    'product.saveRecord',
    'product.saveVariant',
  ])
    await fixture('user.grantFunction', { id: `editor:${fnKey}`, roleId: 'editor-role', fnKey })
  await fixture('user.assignRole', { id: 'editor-role', userId: 'editor', roleId: 'editor-role' })
  await app.client.login({ login: 'editor', password: 'test-password' })
  const before = await get('one')
  await assert.rejects(
    () =>
      call('product.saveRecord', {
        id: 'one',
        name: 'Denied',
        type: 'goods',
        barcode: GTIN[2],
        expectedRevisionId: before.revisionId,
      }),
    /permission|forbidden|quyền|may not|not permitted/i,
  )
  await assert.rejects(
    () => call('product.setBarcode', { productId: 'one:default', barcode: GTIN[2] }),
    /permission|forbidden|quyền|may not|not permitted/i,
  )
  await save('product.saveRecord', {
    id: 'one',
    name: 'Renamed',
    type: 'goods',
    barcode: GTIN[1],
    expectedRevisionId: before.revisionId,
  })
  assert.equal((await get('one')).barcode, GTIN[1])
})
