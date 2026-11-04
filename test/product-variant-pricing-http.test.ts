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

const size = {
  id: 'size',
  name: 'Size',
  displayType: 'select',
  createVariant: 'always',
  values: [
    { id: 'small', name: 'S' },
    { id: 'large', name: 'L' },
  ],
}
const sized = (templateId: string) => ({
  templateId,
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

async function sizedGoods(t: TestContext) {
  const booted = await boot(t)
  await booted.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await booted.save('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Buyer' })
  await booted.save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    listPrice: '100',
  })
  await booted.save('product.saveAttributeDraft', size)
  await booted.save('product.configureAttributes', sized('goods'))
  const setup = async () =>
    ((await booted.call('product.templateModalContext', { id: 'goods', locale: 'en' })).data as Row)
      .variantSetup as { lines: Row[]; variants: Row[] }
  const large = (await setup()).variants.find((row) => (row.valueIds as Row).size === 'large')!
  const small = (await setup()).variants.find((row) => (row.valueIds as Row).size === 'small')!
  const editLarge = async (change: Row) => {
    const current = await setup()
    return booted.call('product.saveVariantSetup', {
      templateId: 'goods',
      lines: current.lines,
      variants: current.variants.map((row) => (row.id === large.id ? { ...row, ...change } : row)),
    })
  }
  let line = 0
  const quoted = async (productId: unknown) => {
    line += 1
    await booted.save('sale.createOrder', { id: `quote-${line}`, partnerId: 'buyer', warehouseId: 'wh' })
    const added = await booted.save('sale.addLine', {
      id: `quote-${line}-line`,
      orderId: `quote-${line}`,
      productId,
      productUomId: 'each',
      productUomQty: '1',
    })
    return Number(added.priceUnit)
  }
  return { ...booted, setup, large: String(large.id), small: String(small.id), editLarge, quoted }
}

test('Commerce sells a variant at the template price plus extras unless it has its own price', async (t) => {
  const { save, call, setup, large, small, editLarge, quoted } = await sizedGoods(t)
  assert.equal(await quoted(small), 100)
  assert.equal(await quoted(large), 130, 'the large size carries its extra into the order')

  assert.notEqual((await editLarge({ listPrice: '125' })).ok, false)
  assert.equal(await quoted(large), 125, 'its own price replaces template price plus extras')
  assert.equal(await quoted(small), 100, 'other variants keep their price')
  const shown = ((await call('product.templateModalContext', { id: 'goods', locale: 'en' })).data as Row)
    .variants as Row[]
  const row = shown.find((variant) => variant.id === large)!
  assert.deepEqual([row.price, row.basePrice, row.listPriceOverride], ['125', '130', '125'])
  const current = await setup()
  const omitted = await call('product.saveVariantSetup', {
    templateId: 'goods',
    lines: current.lines,
    variants: current.variants.map(({ listPrice: _price, hsCode: _hs, ...rest }) => rest),
  })
  assert.notEqual(omitted.ok, false)
  assert.equal(await quoted(large), 125, 'a client that does not send the price keeps the stored one')

  // A pricelist rule based on the list price starts from the variant's price.
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  await save('pricing.savePricelistItem', {
    id: 'retail:all',
    pricelistId: 'retail',
    appliedOn: '3_global',
    base: 'list_price',
    computePrice: 'percentage',
    percentPrice: '10',
  })
  const priced = async (productId: string) =>
    Number((await call('pricing.priceFor', { pricelistId: 'retail', productId, quantity: '1' })).price)
  assert.equal(await priced(large), 112.5)
  assert.notEqual((await editLarge({ listPrice: null })).ok, false)
  assert.equal(await priced(large), 117, 'clearing its own price returns to price plus extras')
  assert.equal(await quoted(large), 130)
})

test('Commerce adds variant extras to a fixed price for the whole product, not to a variant price (P30)', async (t) => {
  const { save, call, large, small, editLarge } = await sizedGoods(t)
  await save('pricing.savePricelist', { id: 'promo', name: 'Promo' })
  await save('pricing.savePricelistItem', {
    id: 'promo:goods',
    pricelistId: 'promo',
    appliedOn: '1_product',
    templateId: 'goods',
    computePrice: 'fixed',
    fixedPrice: '200',
  })
  const priced = async (productId: string) =>
    Number((await call('pricing.priceFor', { pricelistId: 'promo', productId, quantity: '1' })).price)
  assert.equal(await priced(small), 200)
  assert.equal(await priced(large), 230, 'the large size keeps its extra on a product-wide fixed price')
  assert.notEqual((await editLarge({ listPrice: '125' })).ok, false)
  assert.equal(await priced(large), 230, "a variant's own price does not replace a fixed rule")
  await save('pricing.savePricelistItem', {
    id: 'promo:large',
    pricelistId: 'promo',
    appliedOn: '0_product_variant',
    productId: large,
    computePrice: 'fixed',
    fixedPrice: '150',
  })
  assert.equal(await priced(large), 150, 'a fixed price for one variant is that price')
  assert.equal(await priced(small), 200)
})

test('Commerce validates a variant price and HS code and keeps HS codes with stock setup', async (t) => {
  const { fixture, call, editLarge, large, app } = await sizedGoods(t)
  const negative = await editLarge({ listPrice: '-5' })
  assert.deepEqual(
    (negative.errors as Row[]).map((issue) => issue.code),
    ['product.error.variant.listPrice'],
  )
  const short = await editLarge({ hsCode: '12' })
  assert.deepEqual(
    (short.errors as Row[]).map((issue) => issue.code),
    ['product.error.variant.hsCode'],
  )
  assert.notEqual((await editLarge({ hsCode: '3304.99.30' })).ok, false)
  const [stored] = (await app.adapter!.all(
    `SELECT "hsCode", "listPriceOverride" FROM product_product WHERE id = '${large}'`,
  )) as Row[]
  assert.equal(stored?.hsCode, '33049930', 'dots in a written customs code are dropped')
  // A template and its variants read customs codes by one rule: four to ten digits.
  assert.notEqual((await editLarge({ hsCode: '3304' })).ok, false)
  const template = async (hsCode: string) =>
    call('product.saveRecord', {
      id: 'goods',
      name: 'Goods',
      type: 'goods',
      expectedRevisionId: (await call('product.getTemplate', { id: 'goods' })).revisionId,
      hsCode,
    })
  const heading = await template('3304')
  assert.notEqual(heading.ok, false, JSON.stringify(heading.errors))
  assert.deepEqual(
    ((await template('330')).errors as Row[]).map((issue) => issue.code),
    ['product.error.template.hsCode'],
  )
  assert.notEqual((await editLarge({ hsCode: '3304.99.30' })).ok, false)

  // Price belongs to whoever edits variants; the HS code also needs stock setup.
  await fixture('user.saveRole', { id: 'variants-only', name: 'Variants only' })
  for (const fnKey of ['product.saveVariantSetup', 'product.templateModalContext', 'product.getTemplate'])
    await fixture('user.grantFunction', { id: `variants-only:${fnKey}`, roleId: 'variants-only', fnKey })
  await fixture('user.createUser', {
    id: 'editor',
    login: 'editor',
    name: 'Editor',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'editor-acme', userId: 'editor', companyId: 'acme' })
  await fixture('user.assignRole', { id: 'editor-variants', userId: 'editor', roleId: 'variants-only' })
  const asEditor = async (change: Row) => {
    const setup = ((await call('product.templateModalContext', { id: 'goods', locale: 'en' })).data as Row)
      .variantSetup as { lines: Row[]; variants: Row[] }
    return app.fixture.call<Row>(
      'product.saveVariantSetup',
      {
        templateId: 'goods',
        lines: setup.lines,
        variants: setup.variants.map((row) => (row.id === large ? { ...row, ...change } : row)),
      },
      { actor: 'editor', scope: { company: 'acme', branches: null } },
    )
  }
  assert.notEqual((await asEditor({ listPrice: '140' })).value.ok, false)
  await assert.rejects(() => asEditor({ hsCode: '33049931' }), { code: 'E_FN_NOT_PERMITTED' })
  const [after] = (await app.adapter!.all(
    `SELECT "hsCode", "listPriceOverride" FROM product_product WHERE id = '${large}'`,
  )) as Row[]
  assert.equal(after?.hsCode, '33049930', 'the refused HS code changed nothing')
  assert.equal(Number(after?.listPriceOverride), 140)
})

test('Commerce duplicates a product with its attribute lines and fresh variants', async (t) => {
  const { save, call, app, setup, fixture } = await sizedGoods(t)
  const held = await setup()
  const customs: Record<string, string> = { small: '33049930', large: '33049990' }
  await save('product.saveVariantSetup', {
    templateId: 'goods',
    lines: held.lines,
    variants: held.variants.map((row) => ({ ...row, hsCode: customs[String((row.valueIds as Row).size)] })),
  })
  const context = await call('product.templateModalContext', { sourceId: 'goods', locale: 'en' })
  const data = context.data as Row
  assert.equal(data.duplicateCount, 2)
  const lines = data.duplicateLines as Row[]
  assert.deepEqual(lines, sized('goods').lines)
  await save('product.saveRecord', {
    id: 'copy',
    name: 'Copy',
    type: 'goods',
    defaultCode: 'COPY',
    uomId: 'each',
    listPrice: '200',
  })
  await save('product.configureAttributes', { templateId: 'copy', lines, duplicateSourceId: 'goods' })
  const rows = (await app.adapter!.all(
    'SELECT id, "defaultCode", barcode, "hsCode", active FROM product_product WHERE "templateId" = \'copy\' ORDER BY "defaultCode"',
  )) as Row[]
  // Each copied variant keeps the HS code of the source variant with the same values (#1663).
  assert.deepEqual(
    rows.map((row) => [row.defaultCode, row.barcode ?? null, row.hsCode ?? null]),
    [
      ['COPY', null, '33049930'],
      ['COPYA', null, '33049990'],
    ],
  )
  // HS codes are stock fields: a copier without stock setup gets the variants, not the codes.
  await fixture('user.saveRole', { id: 'catalogue-only', name: 'Catalogue only' })
  for (const fnKey of ['product.saveRecord', 'product.saveTemplate', 'product.configureAttributes'])
    await fixture('user.grantFunction', { id: `catalogue-only:${fnKey}`, roleId: 'catalogue-only', fnKey })
  await fixture('user.createUser', { id: 'clerk', login: 'clerk', name: 'Clerk', defaultCompanyId: 'acme' })
  await fixture('user.grantCompany', { id: 'clerk-acme', userId: 'clerk', companyId: 'acme' })
  await fixture('user.assignRole', { id: 'clerk-catalogue', userId: 'clerk', roleId: 'catalogue-only' })
  const asClerk = (fn: string, input: Row) =>
    app.fixture.call<Row>(fn, input, { actor: 'clerk', scope: { company: 'acme', branches: null } })
  const plain = { name: 'Clerk copy', type: 'goods', defaultCode: 'CLERK', uomId: 'each', listPrice: '200' }
  assert.notEqual((await asClerk('product.saveRecord', { id: 'clerk-copy', ...plain })).value.ok, false)
  const made = await asClerk('product.configureAttributes', {
    templateId: 'clerk-copy',
    lines,
    duplicateSourceId: 'goods',
  })
  assert.notEqual(made.value.ok, false, JSON.stringify(made.value.errors))
  assert.deepEqual(
    (
      (await app.adapter!.all(
        'SELECT "hsCode" FROM product_product WHERE "templateId" = \'clerk-copy\' AND "combinationKey" <> \'\'',
      )) as Row[]
    ).map((row) => row.hsCode ?? null),
    [null, null],
  )
  const prices = ((await call('product.templateModalContext', { id: 'copy', locale: 'en' })).data as Row)
    .variants as Row[]
  assert.deepEqual(prices.map((row) => Number(row.price)).sort(), [200, 230])
})
