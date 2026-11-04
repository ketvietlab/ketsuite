import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, schemaFromManifest, sqliteStore } from '@ketvietlab/ketjs'
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
  const create = (id: string, defaultCode: string) =>
    call('product.saveRecord', { id, name: id, type: 'goods', defaultCode })
  const get = async (id: string): Promise<Row> => {
    const template = await call('product.getTemplate', { id })
    const defaultVariant = (template.variants as Row[]).find((row) => row.combinationKey === '')
    return { ...template, defaultCode: defaultVariant?.defaultCode }
  }
  return { app, deployment, fixture, call, save, create, get }
}

const refused = (result: Row, code: string) => {
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.equal((result.errors as Row[])[0]?.code, `product.error.template.${code}`)
}

test('Commerce codes are validated across template, variant and inventory writes without losing old codes', async (t) => {
  const { app, fixture, call, save, create, get } = await boot(t)
  for (const code of ['', 'A', '-AB', 'BAD CODE', 'MÃ-01', 'X'.repeat(21)]) {
    refused(await create(`invalid-${code}`, code), code ? 'codeFormat' : 'codeRequired')
  }
  assert.equal((await app.adapter!.all('SELECT id FROM product_template')).length, 0)
  await create('alpha', 'ALPHA')
  await create('beta', 'BETA')
  await assert.rejects(
    app.adapter!.exec("UPDATE product_product SET \"codeKey\" = 'ALPHA' WHERE id = 'beta:default'"),
    /unique/i,
    'the physical index also refuses a conflicting assignment',
  )
  refused(await create('collision', 'ALPHA'), 'codeTaken')
  // P22: what is typed is saved in capitals, so a lowercase code is the same code.
  refused(await create('collision-lower', 'alpha'), 'codeTaken')
  await create('typed', ' kd-02 ')
  assert.equal((await get('typed')).defaultCode, 'KD-02')
  const before = await get('beta')
  refused(
    await call('product.saveTemplate', {
      id: 'beta',
      name: 'Must roll back',
      type: 'goods',
      defaultCode: 'ALPHA',
      expectedRevisionId: before.revisionId,
    }),
    'codeTaken',
  )
  assert.equal((await get('beta')).revisionId, before.revisionId)
  assert.equal((await get('beta')).name, 'beta')
  refused(
    await call('product.saveVariant', { id: 'beta:default', templateId: 'beta', defaultCode: 'ALPHA' }),
    'codeTaken',
  )
  refused(
    await call('product.saveVariant', { id: 'beta:default', templateId: 'beta', sku: 'bad code' }),
    'codeFormat',
  )
  refused(
    await call('product.saveVariant', { id: 'beta:default', templateId: 'beta', defaultCode: null }),
    'codeRequired',
  )
  await save('product.saveVariant', { id: 'beta:default', templateId: 'beta', weight: '2' })
  assert.equal((await get('beta')).defaultCode, 'BETA', 'omitted code must not erase identity')
  await save('product.saveVariant', { id: 'beta:default', templateId: 'beta', defaultCode: 'BETA-NEW' })
  assert.notEqual(
    (await get('beta')).revisionId,
    before.revisionId,
    'code changes invalidate the record page',
  )
  const stale = await call('product.saveTemplate', {
    id: 'beta',
    name: 'Stale page',
    type: 'goods',
    defaultCode: 'BETA',
    expectedRevisionId: before.revisionId,
  })
  assert.equal(stale.ok, false)
  await Promise.all([
    save('product.saveVariant', { id: 'beta:default', templateId: 'beta', defaultCode: 'BETA-RACE' }),
    save('product.saveVariant', { id: 'beta:default', templateId: 'beta', weight: '4' }),
  ])
  const concurrent = (
    await app.adapter!.all(
      'SELECT "defaultCode", "codeKey", weight FROM product_product WHERE id = \'beta:default\'',
    )
  )[0]!
  assert.equal(concurrent.defaultCode, 'BETA-RACE')
  assert.equal(concurrent.codeKey, 'BETA-RACE')
  assert.equal(Number(concurrent.weight), 4)
  await create('released', 'BETA')
  await app.adapter!.exec("UPDATE product_product SET active = false WHERE id = 'alpha:default'")
  refused(await create('archived-collision', 'ALPHA'), 'codeTaken')
  const other = await fixture(
    'product.saveTemplate',
    { id: 'other-alpha', name: 'Other Alpha', type: 'goods', defaultCode: 'ALPHA' },
    'other',
  )
  assert.equal(other.ok, true, 'codes are unique within the active company, not across companies')
  await save('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
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
  }
  refused(await call('stock.saveInventoryProduct', { ...native, sku: 'ALPHA' }), 'codeTaken')
  refused(await call('stock.saveInventoryProduct', { ...native, sku: null }), 'codeRequired')
  await save('stock.saveInventoryProduct', { ...native, sku: 'NATIVE-01' })
  refused(await create('native-collision', 'NATIVE-01'), 'codeTaken')
})

test('Commerce serializes competing code assignments and rolls the losing aggregate back', async (t) => {
  const { app, create } = await boot(t)
  const results = await Promise.all([create('left', 'SAME-CODE'), create('right', 'SAME-CODE')])
  assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results))
  refused(results.find((result) => !result.ok)!, 'codeTaken')
  assert.equal((await app.adapter!.all('SELECT id FROM product_template')).length, 1)
  assert.equal((await app.adapter!.all('SELECT id FROM product_product')).length, 1)
})

test('Commerce variant setup changes codes atomically, supports swaps, and preserves omitted values', async (t) => {
  const { app, save, call, create } = await boot(t)
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
      { valueIds: { size: 'small' }, defaultCode: 'SIZE-S', weight: '0', volume: '0', active: true },
      { valueIds: { size: 'large' }, defaultCode: 'SIZE-L', weight: '0', volume: '0', active: true },
    ],
  })
  const rows = await app.adapter!.all(
    'SELECT id, "defaultCode", "combinationKey" FROM product_product WHERE "templateId" = \'sizes\' AND "combinationKey" <> \'\' ORDER BY "defaultCode"',
  )
  const variants = rows.map((row) => ({
    id: row.id,
    valueIds: { size: row.combinationKey },
    defaultCode: row.defaultCode,
    weight: '0',
    volume: '0',
    active: true,
  }))
  const rejected = await call('product.saveVariantSetup', {
    templateId: 'sizes',
    lines,
    variants: variants.map((row) => ({ ...row, defaultCode: 'SIZES' })),
  })
  refused(rejected, 'codeTaken')
  await save('product.saveVariantSetup', {
    templateId: 'sizes',
    lines,
    variants: variants.map((row, index) => ({ ...row, defaultCode: variants[1 - index]!.defaultCode })),
  })
  const swapped = await app.adapter!.all(
    'SELECT id, "defaultCode", "codeKey" FROM product_product WHERE "templateId" = \'sizes\' AND "combinationKey" <> \'\' ORDER BY "defaultCode"',
  )
  assert.equal(swapped[0]?.id, rows[1]?.id)
  assert.ok(swapped.every((row) => row.defaultCode === row.codeKey))
  const pg = app.adapter!.name === 'postgres'
  if (pg) {
    await app.adapter!.exec(
      `CREATE FUNCTION reject_code_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."codeKey" = 'FAIL-CODE' THEN RAISE EXCEPTION 'injected code failure'; END IF; RETURN NEW; END $$`,
    )
    await app.adapter!.exec(
      'CREATE TRIGGER reject_code_write BEFORE UPDATE ON product_product FOR EACH ROW EXECUTE FUNCTION reject_code_write()',
    )
  } else {
    await app.adapter!.exec(
      `CREATE TRIGGER reject_code_write BEFORE UPDATE ON product_product WHEN NEW."codeKey" = 'FAIL-CODE' BEGIN SELECT RAISE(ABORT, 'injected code failure'); END`,
    )
  }
  await assert.rejects(() =>
    call('product.saveVariantSetup', {
      templateId: 'sizes',
      lines,
      variants: variants.map((row, index) => ({ ...row, defaultCode: index ? 'FAIL-CODE' : 'GOOD-CODE' })),
    }),
  )
  assert.deepEqual(
    await app.adapter!.all(
      'SELECT id, "defaultCode", "codeKey" FROM product_product WHERE "templateId" = \'sizes\' AND "combinationKey" <> \'\' ORDER BY "defaultCode"',
    ),
    swapped,
    'a later write failure restores all codes and released keys',
  )
  await app.adapter!.exec(
    pg ? 'DROP TRIGGER reject_code_write ON product_product' : 'DROP TRIGGER reject_code_write',
  )
  if (pg) await app.adapter!.exec('DROP FUNCTION reject_code_write()')
  await save('product.saveVariantSetup', {
    templateId: 'sizes',
    lines,
    variants: variants.map(({ defaultCode: _code, ...row }) => row),
  })
  assert.deepEqual(
    await app.adapter!.all(
      'SELECT id, "defaultCode", "codeKey" FROM product_product WHERE "templateId" = \'sizes\' AND "combinationKey" <> \'\' ORDER BY "defaultCode"',
    ),
    swapped,
  )
  await Promise.all([
    save('product.saveVariant', { id: variants[0]!.id, templateId: 'sizes', defaultCode: 'SIZE-RACE' }),
    save('product.saveVariantSetup', {
      templateId: 'sizes',
      lines,
      variants: variants.map(({ defaultCode: _code, ...row }) => ({ ...row, weight: '4' })),
    }),
  ])
  const concurrent = (
    await app.adapter!.all('SELECT id, "defaultCode", "codeKey" FROM product_product')
  ).find((row) => row.id === variants[0]!.id)!
  assert.equal(concurrent.defaultCode, 'SIZE-RACE', 'an omitted setup code cannot restore a stale value')
  assert.equal(concurrent.codeKey, 'SIZE-RACE')
})

test('Commerce migration preserves duplicate legacy codes and reserves their normalized spelling', async (t) => {
  const { app, deployment, save, create, get } = await boot(t)
  await create('old-a', 'OLD-A')
  await create('old-b', 'OLD-B')
  const adapter = app.adapter!
  const manifest = compose(deployment.modules, { headless: true, companies: true })
  const oldModules = deployment.modules.map((module) => {
    if (typeof module === 'string' || module.name !== 'product') return module
    const product = module.models!.Product!
    const { codeKey: _field, ...fields } = product.fields
    const { code_key_unique: _index, ...indexes } = product.indexes!
    return {
      ...module,
      version: '0.2.1',
      models: { ...module.models, Product: { ...product, fields, indexes } },
    }
  })
  const old = compose(oldModules, { headless: true, companies: true })
  // Reconstruct the preceding physical schema and marker, with legacy collisions.
  await adapter.exec('DROP INDEX product_product__code_key_unique')
  await adapter.exec('ALTER TABLE product_product DROP COLUMN "codeKey"')
  await adapter.exec('UPDATE product_product SET "defaultCode" = \' legacy-code \'')
  const placeholder = adapter.name === 'postgres' ? '$1' : '?'
  await adapter.run(`UPDATE ket_migration SET schema = ${placeholder} WHERE id = 1`, [
    JSON.stringify(schemaFromManifest(old)),
  ])
  await migrateOne(adapter, manifest)
  const legacy = await adapter.all('SELECT id, "defaultCode", "codeKey" FROM product_product ORDER BY id')
  assert.equal(legacy.length, 2)
  assert.ok(legacy.every((row) => row.defaultCode === ' legacy-code ' && row.codeKey === null))
  refused(await create('new-collision', 'LEGACY-CODE'), 'codeTaken')
  const record = await get('old-a')
  await save('product.saveTemplate', {
    id: 'old-a',
    name: 'Renamed legacy',
    type: 'goods',
    expectedRevisionId: record.revisionId,
  })
  assert.equal((await get('old-a')).defaultCode, ' legacy-code ')
  await save('product.saveVariant', { id: 'old-a:default', templateId: 'old-a', defaultCode: 'CLEAN-01' })
  refused(await create('still-held', 'LEGACY-CODE'), 'codeTaken')
  await save('product.saveVariant', { id: 'old-b:default', templateId: 'old-b', defaultCode: 'CLEAN-02' })
  assert.equal((await create('now-free', 'LEGACY-CODE')).ok, true)
  assert.deepEqual(await migrateOne(adapter, manifest), [], 'migration replay is a no-op')
})
