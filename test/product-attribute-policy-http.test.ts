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
  await save('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
  const create = (id: string, defaultCode: string) =>
    call('product.saveRecord', { id, name: id, type: 'goods', defaultCode, uomId: 'each' })
  return { app, deployment, fixture, call, save, create }
}

const values = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
]
const draft = (extra: Row = {}) => ({
  id: 'color',
  name: 'Color',
  displayType: 'select',
  createVariant: 'always',
  values,
  ...extra,
})

const definition = (extra: Row = {}) => {
  const { values: _values, ...input } = draft(extra)
  return input
}

test('Commerce applies attribute mode and name rules to both draft and low-level writers', async (t) => {
  const { call, save, fixture } = await boot(t)
  for (const fn of ['product.saveAttribute', 'product.saveAttributeDraft']) {
    const multi = await call(
      fn,
      fn === 'product.saveAttribute' ? definition({ displayType: 'multi' }) : draft({ displayType: 'multi' }),
    )
    assert.equal(multi.ok, false)
    assert.equal((multi.errors as Row[])[0]?.code, 'product.error.attribute.multiPolicy')
  }
  await save('product.saveAttributeDraft', draft({ displayType: 'multi', createVariant: 'no_variant' }))
  await save('product.saveAttribute', { id: 'color', name: 'Options' })
  const held = (await call('product.listAttributes', {})) as unknown as Row[]
  assert.equal(held[0]?.createVariant, 'no_variant')
  assert.equal(held[0]?.displayType, 'multi')
  const duplicate = await call('product.saveAttribute', { id: 'duplicate', name: '  OPTIONS  ' })
  assert.equal(duplicate.ok, false)
  assert.equal((duplicate.errors as Row[])[0]?.code, 'product.error.attribute.duplicateName')
  await assert.doesNotReject(async () => {
    assert.equal(
      (await fixture('product.saveAttribute', { id: 'other-options', name: 'Options' }, 'other')).ok,
      true,
    )
  })
})

test('Commerce blocks used attribute policy changes and value reassignment without losing definitions', async (t) => {
  const { app, call, save, create } = await boot(t)
  await create('goods', 'GOODS')
  await save('product.saveAttributeDraft', draft())
  await save('product.saveAttributeLine', {
    id: 'line',
    templateId: 'goods',
    attributeId: 'color',
    valueIds: ['red'],
  })
  for (const fn of ['product.saveAttribute', 'product.saveAttributeDraft']) {
    const result = await call(
      fn,
      fn === 'product.saveAttribute'
        ? definition({ createVariant: 'no_variant' })
        : draft({ createVariant: 'no_variant' }),
    )
    assert.equal(result.ok, false)
    assert.equal((result.errors as Row[])[0]?.code, 'product.error.attribute.policyInUse')
  }
  const archived = await call('product.saveAttribute', definition({ active: false }))
  assert.equal(archived.ok, false)
  assert.equal((archived.errors as Row[])[0]?.code, 'product.error.attribute.archiveInUse')
  const removed = await call('product.saveAttributeDraft', draft({ values: values.slice(1) }))
  assert.equal(removed.ok, false)
  await save('product.saveAttribute', { id: 'size', name: 'Size' })
  const moved = await call('product.saveAttributeValue', { id: 'red', attributeId: 'size', name: 'Large' })
  assert.equal(moved.ok, false)
  assert.equal((moved.errors as Row[])[0]?.code, 'product.error.attribute.valueAttributeInUse')
  await save('product.saveAttributeValue', { id: 'red', attributeId: 'color', name: 'Crimson' })
  const lines = (await app.client.call<Row[]>('product.listAttributeLines', { templateId: 'goods' })).value
  assert.ok(lines[0], 'The product must retain its attribute line')
  assert.equal((lines[0].values as Row[])[0]?.name, 'Crimson')
  const attributes = (await app.client.call<Row[]>('product.listAttributes', {})).value
  assert.equal(attributes.find((row) => row.id === 'color')?.active, true)
})

test('Commerce enforces the 50 variant ceiling for configuration, raw setups, generation and manual creation', async (t) => {
  const { app, call, save, create } = await boot(t)
  await create('goods', 'GOODS')
  const before = (await app.client.call<Row[]>('product.listVariants', { templateId: 'goods' })).value
  const configured = await call('product.configureAttributes', {
    templateId: 'goods',
    lines: [8, 7].map((size, index) => ({
      name: `Attribute ${index}`,
      values: Array.from({ length: size }, (_, i) => ({ name: `Value ${i}`, priceExtra: '0' })),
    })),
  })
  assert.equal(configured.ok, false)
  assert.equal((configured.errors as Row[])[0]?.code, 'product.error.configure.tooMany')
  assert.equal((await app.client.call<Row[]>('product.listAttributes', {})).value.length, 0)
  const raw = await call('product.saveVariantSetup', {
    templateId: 'goods',
    lines: [],
    variants: Array.from({ length: 51 }, () => ({ active: true, valueIds: {} })),
  })
  assert.equal(raw.ok, false)
  assert.equal((raw.errors as Row[])[0]?.code, 'product.error.configure.tooMany')
  assert.deepEqual(
    (await app.client.call<Row[]>('product.listVariants', { templateId: 'goods' })).value,
    before,
  )
  const fifty = Array.from({ length: 50 }, (_, index) => ({ id: `v${index}`, name: `Value ${index}` }))
  await save('product.saveAttributeDraft', draft({ values: fifty }))
  await save('product.saveAttributeLine', {
    id: 'fifty',
    templateId: 'goods',
    attributeId: 'color',
    valueIds: fifty.map((v) => v.id),
  })
  await save('product.generateVariants', { templateId: 'goods' })
  assert.equal(
    (await app.client.call<Row[]>('product.listVariants', { templateId: 'goods' })).value.length,
    50,
  )
  const extra = await call('product.saveVariant', { id: 'extra', templateId: 'goods', defaultCode: 'EXTRA' })
  assert.equal(extra.ok, false)
  await save('product.saveAttributeValue', { id: 'v50', attributeId: 'color', name: 'Value 50' })
  await save('product.saveAttributeLine', {
    id: 'fifty',
    templateId: 'goods',
    attributeId: 'color',
    valueIds: [...fifty.map((v) => v.id), 'v50'],
  })
  const generated = await call('product.generateVariants', { templateId: 'goods' })
  assert.equal(generated.ok, false)
  assert.equal((generated.errors as Row[])[0]?.code, 'product.error.configure.tooMany')
  assert.equal(
    (await app.client.call<Row[]>('product.listVariants', { templateId: 'goods' })).value.length,
    50,
  )
})

test('Commerce serializes competing attribute names within a company', async (t) => {
  const { call, app } = await boot(t)
  const outcomes = await Promise.all([
    call('product.saveAttributeDraft', draft({ id: 'first', name: 'Concurrent', values: [] })),
    call('product.saveAttribute', { id: 'second', name: '  CONCURRENT  ' }),
  ])
  assert.equal(outcomes.filter((row) => row.ok === true).length, 1)
  assert.equal(outcomes.filter((row) => row.ok === false).length, 1)
  assert.equal(
    (outcomes.find((row) => row.ok === false)!.errors as Row[])[0]?.code,
    'product.error.attribute.duplicateName',
  )
  assert.equal((await app.client.call<Row[]>('product.listAttributes', {})).value.length, 1)
})

test('Commerce applies default attribute extras only to newly selected values', async (t) => {
  const { app, call, save, create } = await boot(t)
  await create('goods', 'GOODS')
  await create('next', 'NEXT')
  await save(
    'product.saveAttributeDraft',
    draft({ values: [{ id: 'red', name: 'Red', defaultPriceExtra: '2.5' }] }),
  )
  const configure = (templateId: string) =>
    save('product.configureAttributes', {
      templateId,
      lines: [{ attributeId: 'color', name: 'Color', values: [{ valueId: 'red' }] }],
    })
  const extra = async (templateId: string) => {
    const lines = (await app.client.call<Row[]>('product.listAttributeLines', { templateId })).value
    assert.ok(lines[0])
    return Number((lines[0].values as Row[])[0]?.priceExtra)
  }
  await configure('goods')
  assert.equal(await extra('goods'), 2.5)
  await save('product.saveAttributeValue', {
    id: 'red',
    attributeId: 'color',
    name: 'Red',
    defaultPriceExtra: '7',
  })
  await configure('goods')
  await configure('next')
  assert.equal(await extra('goods'), 2.5)
  assert.equal(await extra('next'), 7)
  await create('raw', 'RAW')
  await save('product.saveVariantSetup', {
    templateId: 'raw',
    lines: [{ attributeId: 'color', values: [{ valueId: 'red' }] }],
    variants: [{ valueIds: { color: 'red' } }],
  })
  assert.equal(await extra('raw'), 7)
  await create('low', 'LOW')
  await save('product.saveAttributeLine', {
    id: 'low:color',
    templateId: 'low',
    attributeId: 'color',
    valueIds: ['red'],
  })
  assert.equal(await extra('low'), 7)
  const invalid = await call(
    'product.saveAttributeDraft',
    draft({ name: 'Must roll back', values: [{ id: 'red', name: 'Red', defaultPriceExtra: 'NaN' }] }),
  )
  assert.equal(invalid.ok, false)
  const held = (await app.client.call<Row[]>('product.listAttributes', {})).value
  assert.equal(held[0]?.name, 'Color')
})

test('Commerce archives and restores unused attributes without allowing new archived attachments', async (t) => {
  const { app, call, save, create } = await boot(t)
  await create('goods', 'GOODS')
  await save('product.saveAttributeDraft', draft())
  await save('product.saveAttribute', { id: 'color', name: 'Color', active: false })
  assert.equal(
    (await app.client.call<Row[]>('product.listAttributes', { variantsOnly: true })).value.length,
    0,
  )
  for (const [fn, input] of [
    [
      'product.saveAttributeLine',
      { id: 'goods:color', templateId: 'goods', attributeId: 'color', valueIds: ['red'] },
    ],
    [
      'product.configureAttributes',
      { templateId: 'goods', lines: [{ attributeId: 'color', values: [{ valueId: 'red' }] }] },
    ],
    [
      'product.saveVariantSetup',
      {
        templateId: 'goods',
        lines: [{ attributeId: 'color', values: [{ valueId: 'red' }] }],
        variants: [{ valueIds: { color: 'red' } }],
      },
    ],
  ] as const)
    assert.equal((await call(fn, input)).ok, false, fn)
  assert.equal(
    (await app.client.call<Row[]>('product.listAttributeLines', { templateId: 'goods' })).value.length,
    0,
  )
  await save('product.saveAttribute', { id: 'color', name: 'Color', active: true })
  assert.equal(
    (await app.client.call<Row[]>('product.listAttributes', { variantsOnly: true })).value.length,
    1,
  )
  await save('product.saveAttributeLine', {
    id: 'goods:color',
    templateId: 'goods',
    attributeId: 'color',
    valueIds: ['red'],
  })
})

test('Commerce attribute migration preserves legacy definitions and initializes optional defaults', async (t) => {
  const { app, deployment, call, save } = await boot(t)
  await save('product.saveAttributeDraft', draft())
  const adapter = app.adapter!
  const manifest = compose(deployment.modules, { headless: true, companies: true })
  const oldModules = deployment.modules.map((module) => {
    if (typeof module === 'string' || module.name !== 'product') return module
    const attribute = module.models!.Attribute!
    const value = module.models!.AttributeValue!
    const { nameKey: _key, ...fields } = attribute.fields
    const { name_key: _index, ...indexes } = attribute.indexes!
    const { defaultPriceExtra: _price, ...valueFields } = value.fields
    return {
      ...module,
      version: '0.2.3',
      models: {
        ...module.models,
        Attribute: { ...attribute, fields, indexes },
        AttributeValue: { ...value, fields: valueFields },
      },
    }
  })
  await adapter.exec('DROP INDEX product_attribute__name_key')
  await adapter.exec('ALTER TABLE product_attribute DROP COLUMN "nameKey"')
  await adapter.exec('ALTER TABLE product_attribute_value DROP COLUMN "defaultPriceExtra"')
  const placeholder = adapter.name === 'postgres' ? '$1' : '?'
  await adapter.run(`UPDATE ket_migration SET schema = ${placeholder} WHERE id = 1`, [
    JSON.stringify(schemaFromManifest(compose(oldModules, { headless: true, companies: true }))),
  ])
  await migrateOne(adapter, manifest)
  const context = await call('product.attributeModalContext', { id: 'color', locale: 'en' })
  const record = (context.data as Row).record as Row
  assert.equal(record.name, 'Color')
  assert.equal(record.active, true)
  assert.deepEqual(
    (record.values as Row[]).map((value) => value.defaultPriceExtra),
    ['0', '0'],
  )
  assert.equal((await call('product.saveAttribute', { id: 'duplicate', name: ' COLOR ' })).ok, false)
  await save('product.saveAttribute', { id: 'color', name: 'Colour' })
  assert.deepEqual(await migrateOne(adapter, manifest), [])
})
