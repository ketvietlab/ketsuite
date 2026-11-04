import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { commerce, createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'

test('commerce product capabilities keep catalogue, variants, costs and packaging coherent over HTTP', async (t) => {
  const app = await createCommerceTestDeployment(commerce, { worker: false })
  t.after(() => app.close())
  const fixture = (name: string, input: Row) =>
    app.fixture.call(name, input, { scope: { company: 'catalogue-test', branches: null } })
  await fixture('partner.savePartner', { id: 'company-party', kind: 'company', name: 'Example Company' })
  await fixture('company.saveCompany', { id: 'catalogue-test', partnerId: 'company-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'product-refactor-test',
    name: 'Owner',
    defaultCompanyId: 'catalogue-test',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'owner-company', userId: 'owner', companyId: 'catalogue-test' })
  await app.client.login({ login: 'owner', password: 'product-refactor-test' })
  const call = async <T = Row>(name: string, input: Row = {}) => (await app.client.call<T>(name, input)).value
  const save = async (name: string, input: Row) => {
    const result = await call(name, input)
    assert.equal(result.ok, true, JSON.stringify(result))
    return result
  }

  await save('uom.saveUnit', { id: 'unit', name: 'Each', relativeFactor: '1' })
  await save('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'unit', relativeFactor: '6' })
  await save('product.saveCategory', { id: 'care', name: 'Care' })
  await save('product.saveBrand', { id: 'example', name: 'Example' })
  await save('product.saveTemplate', {
    id: 'sample',
    name: 'Sample product',
    type: 'goods',
    uomId: 'unit',
    categoryId: 'care',
    brandId: 'example',
    listPrice: '100',
  })
  await save('product.saveAttribute', { id: 'size', name: 'Size', createVariant: 'always' })
  await save('product.saveAttributeValue', { id: 'small', attributeId: 'size', name: 'Small' })
  await save('product.saveAttributeValue', { id: 'large', attributeId: 'size', name: 'Large' })
  await save('product.saveAttributeLine', {
    id: 'sample-size',
    templateId: 'sample',
    attributeId: 'size',
    valueIds: ['small', 'large'],
  })
  const generated = await save('product.generateVariants', { templateId: 'sample' })
  assert.equal(generated.created, 1, 'the original SKU receives the first combination')
  assert.equal((await save('product.generateVariants', { templateId: 'sample' })).created, 0)
  const variants = await call<Row[]>('product.listVariants', { templateId: 'sample' })
  assert.equal(variants.length, 2)
  const selected = variants.find((row) => row.combinationKey === 'small')!
  assert.ok(selected)
  await save('product.saveVariant', {
    id: selected.id,
    templateId: 'sample',
    defaultCode: 'SAMPLE-S',
    barcode: '96385074',
  })
  await save('product.setCost', { productId: selected.id, standardPrice: '60' })
  await save('product.addTemplateUom', { templateId: 'sample', uomId: 'box' })
  await save('product.setProductUom', { productId: selected.id, uomId: 'box', barcode: '4006381333931' })
  const variant = await call<Row>('product.getVariant', { id: selected.id })
  assert.equal(variant.combinationKey, 'small', 'editing identifiers keeps the variant identity')
  assert.equal(variant.defaultCode, 'SAMPLE-S')
  assert.equal(Number((variant.cost as Row).standardPrice), 60)
  assert.equal((await call<Row[]>('product.listCategories'))[0]?.name, 'Care')
  assert.equal((await call<Row[]>('product.listBrands'))[0]?.name, 'Example')
  const template = await call<Row>('product.getTemplate', { id: 'sample' })
  assert.equal(template.categoryId, 'care')
  assert.equal((await call<Row>('product.countTemplates', {})).count, 1)
  const archived = await call('product.archiveTemplate', {
    id: 'sample',
    active: false,
    reason: 'Discontinued',
    confirmed: true,
    expectedRevisionId: template.revisionId,
  })
  assert.equal(archived.active, false)
  assert.equal((await call<Row[]>('product.listTemplates')).length, 0)
  assert.equal((await call<Row[]>('product.listVariants', { templateId: 'sample' })).length, 0)
})

test('saving an attribute line keeps value rows whose ids no longer follow the line:value pattern', async (t) => {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const adapter = app.adapter!
  const fixture = (name: string, input: Row) =>
    app.fixture.call(name, input, { scope: { company: 'catalogue-test', branches: null } })
  await fixture('partner.savePartner', { id: 'company-party', kind: 'company', name: 'Example Company' })
  await fixture('company.saveCompany', { id: 'catalogue-test', partnerId: 'company-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'product-refactor-test',
    name: 'Owner',
    defaultCompanyId: 'catalogue-test',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'owner-company', userId: 'owner', companyId: 'catalogue-test' })
  await app.client.login({ login: 'owner', password: 'product-refactor-test' })
  const save = async (name: string, input: Row) => {
    const result = (await app.client.call<Row>(name, input)).value
    assert.equal(result.ok, true, JSON.stringify(result))
    return result
  }
  const p = (index: number) => (adapter.name === 'postgres' ? `$${index}` : '?')

  await save('uom.saveUnit', { id: 'unit', name: 'Each', relativeFactor: '1' })
  await save('product.saveTemplate', {
    id: 'sample',
    name: 'Sample',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100',
  })
  await save('product.saveAttribute', { id: 'size', name: 'Size', createVariant: 'always' })
  await save('product.saveAttributeValue', { id: 'small', attributeId: 'size', name: 'Small' })
  await save('product.saveAttributeValue', { id: 'large', attributeId: 'size', name: 'Large' })
  const line = { id: 'sample-size', templateId: 'sample', attributeId: 'size' }
  await save('product.saveAttributeLine', { ...line, valueIds: ['small', 'large'] })
  assert.equal((await save('product.generateVariants', { templateId: 'sample' })).created, 1)

  // A company copy of the catalogue gives every row an opaque id (company-identities.ts),
  // so the runtime may no longer derive a value row's id from its line and value.
  const remapped = new Map<string, string>()
  await adapter.tx(async (tx) => {
    const values = await tx.all(`SELECT * FROM product_template_attribute_value WHERE "lineId" = ${p(1)}`, [
      line.id,
    ])
    for (const value of values) {
      const id = `pc1:${String(value.valueId)}-copy`
      const links = await tx.all(
        `SELECT * FROM product_product_value WHERE "templateAttributeValueId" = ${p(1)}`,
        [value.id],
      )
      await tx.run(`DELETE FROM product_product_value WHERE "templateAttributeValueId" = ${p(1)}`, [value.id])
      await tx.run(`DELETE FROM product_template_attribute_value WHERE id = ${p(1)}`, [value.id])
      for (const [table, row] of [
        ['product_template_attribute_value', { ...value, id }],
        ...links.map((link) => ['product_product_value', { ...link, templateAttributeValueId: id }] as const),
      ] as const) {
        const columns = Object.keys(row)
        await tx.run(
          `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map((_, index) => p(index + 1)).join(', ')})`,
          columns.map((column) => (row as Row)[column]),
        )
      }
      remapped.set(String(value.valueId), id)
    }
  })
  const state = async () => ({
    values: await adapter.all(
      `SELECT id, "valueId" FROM product_template_attribute_value WHERE "lineId" = ${p(1)} ORDER BY id`,
      [line.id],
    ),
    links: await adapter.all(
      'SELECT "productId", "templateAttributeValueId" FROM product_product_value ORDER BY "productId"',
    ),
  })
  const before = await state()
  assert.deepEqual(
    before.values.map((row) => row.id),
    [remapped.get('large'), remapped.get('small')],
  )
  assert.equal(before.links.length, 2)

  await save('product.saveAttributeLine', { ...line, valueIds: ['small', 'large'] })
  assert.deepEqual(
    await state(),
    before,
    'replaying the same selection keeps every remapped row and variant link',
  )

  await save('product.saveAttributeLine', { ...line, valueIds: ['small'] })
  const after = await state()
  assert.deepEqual(
    after.values.map((row) => [row.id, row.valueId]),
    [[remapped.get('small'), 'small']],
    'deselecting one value removes only that value and keeps the remapped id of the other',
  )
  assert.ok(
    after.links.some((row) => row.templateAttributeValueId === remapped.get('small')),
    'the kept value still defines its variant',
  )

  // The copied variants carry opaque ids too; their combination, not an id prefix,
  // says they were generated, so regeneration still archives the one left behind.
  for (const key of ['small', 'large']) {
    const old = (
      await adapter.all(
        `SELECT id FROM product_product WHERE "templateId" = ${p(1)} AND "combinationKey" = ${p(2)}`,
        ['sample', key],
      )
    )[0]!
    await adapter.run(
      `UPDATE product_product SET id = ${p(1)} WHERE "templateId" = ${p(2)} AND "combinationKey" = ${p(3)}`,
      [`pc1:variant-${key}`, 'sample', key],
    )
    await adapter.run(`UPDATE product_product_value SET "productId" = ${p(1)} WHERE "productId" = ${p(2)}`, [
      `pc1:variant-${key}`,
      old.id,
    ])
  }
  const regenerated = await save('product.generateVariants', { templateId: 'sample' })
  assert.equal(regenerated.created, 0, 'the remapped variant of the kept value is reused')
  assert.deepEqual(regenerated.ids, ['pc1:variant-small'])
  const variants = await adapter.all(
    `SELECT id, active FROM product_product WHERE "templateId" = ${p(1)} ORDER BY id`,
    ['sample'],
  )
  assert.deepEqual(
    variants.map((row) => [row.id, Boolean(row.active)]),
    [['pc1:variant-small', true]],
    'the unused deselected variant is deleted and the kept opaque identity is unchanged',
  )

  const setup = await save('product.saveVariantSetup', {
    templateId: 'sample',
    lines: [{ attributeId: 'size', values: [{ valueId: 'small', priceExtra: '5' }] }],
    variants: [
      { id: 'pc1:variant-small', valueIds: { size: 'small' }, weight: '0', volume: '0', active: true },
    ],
  })
  assert.equal(setup.created, 0)
  assert.deepEqual(
    (
      await adapter.all(
        `SELECT id, "priceExtra" FROM product_template_attribute_value WHERE "lineId" = ${p(1)}`,
        [line.id],
      )
    ).map((row) => [row.id, Number(row.priceExtra)]),
    [[remapped.get('small'), 5]],
    'the variant editor updates the remapped value row in place',
  )
  assert.deepEqual(
    (
      await adapter.all(
        `SELECT "templateAttributeValueId" FROM product_product_value WHERE "productId" = ${p(1)}`,
        ['pc1:variant-small'],
      )
    ).map((row) => row.templateAttributeValueId),
    [remapped.get('small')],
  )

  await save('product.addTemplateUom', { templateId: 'sample', uomId: 'unit' })
  await adapter.run(`UPDATE product_template_uom SET id = 'pc1:packaging' WHERE "templateId" = 'sample'`)
  const packaging = await save('product.addTemplateUom', { templateId: 'sample', uomId: 'unit' })
  assert.equal(packaging.id, 'pc1:packaging', 'adding a held unit again answers with the row that holds it')

  // A caller still naming the line by its pre-copy id reaches the copied line, not a new one.
  await adapter.run(
    `UPDATE product_template_attribute_value SET "lineId" = 'pc1:line' WHERE "lineId" = ${p(1)}`,
    [line.id],
  )
  await adapter.run(`UPDATE product_template_attribute_line SET id = 'pc1:line' WHERE id = ${p(1)}`, [
    line.id,
  ])
  const replayed = await save('product.saveAttributeLine', { ...line, valueIds: ['small', 'large'] })
  assert.equal(replayed.id, 'pc1:line')
  assert.deepEqual(
    (
      await adapter.all(
        'SELECT id, "lineId", "valueId" FROM product_template_attribute_value ORDER BY "valueId"',
      )
    ).map((row) => [row.id, row.lineId, row.valueId]),
    [
      ['pc1:line:large', 'pc1:line', 'large'],
      [remapped.get('small'), 'pc1:line', 'small'],
    ],
  )
  assert.equal(
    (await adapter.all(`SELECT id FROM product_template_attribute_line WHERE "templateId" = 'sample'`))
      .length,
    1,
  )
  await save('product.saveTemplate', {
    id: 'other',
    name: 'Other',
    type: 'goods',
    uomId: 'unit',
    listPrice: '1',
  })
  const taken = (
    await app.client.call<Row>('product.saveAttributeLine', {
      id: 'pc1:line',
      templateId: 'other',
      attributeId: 'size',
      valueIds: ['small'],
    })
  ).value
  assert.equal(taken.ok, false, 'an id held by another template line is refused, not shared')
  assert.equal(
    (await adapter.all(`SELECT id FROM product_template_attribute_value WHERE "lineId" = 'pc1:line'`)).length,
    2,
  )
})
