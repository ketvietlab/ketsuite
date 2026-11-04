import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { commerce, createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'

test('Commerce composes its catalogue per company', () => {
  const manifest = compose(
    commerce.modules.map((module) => {
      if (typeof module === 'string') throw new Error('Unresolved Commerce module')
      return module
    }),
    { headless: true, companies: true },
  )
  for (const model of ['uom.Unit', 'product.Template', 'product.Product', 'loyalty.ProductTag'])
    assert.equal(manifest.models[model]!.scope, 'company', model)
  assert.deepEqual(manifest.models['product.Product']!.indexes.barcode_unique!.fields, [
    'companyId',
    'barcode',
  ])
})

test('a Commerce company sees and checks only its own catalogue', async (t) => {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const call = async (name: string, input: Row, company: string) =>
    (await app.fixture.call(name, input, { scope: { company, branches: null } })).value as Row
  for (const company of ['a', 'b']) {
    await call('partner.savePartner', { id: `${company}-party`, kind: 'company', name: company }, company)
    await call(
      'company.saveCompany',
      { id: company, partnerId: `${company}-party`, currency: 'VND' },
      company,
    )
    assert.equal(
      (await call('uom.saveUnit', { id: `unit-${company}`, name: 'Each', relativeFactor: '1' }, company)).ok,
      true,
    )
  }
  const template = (company: string, id: string) => ({
    id,
    name: `Sample ${id}`,
    type: 'goods',
    uomId: `unit-${company}`,
    listPrice: '100',
    barcode: '8930000000019',
  })
  assert.equal((await call('product.saveTemplate', template('a', 'tpl-a'), 'a')).ok, true)
  assert.equal(
    (await call('product.saveTemplate', template('b', 'tpl-b'), 'b')).ok,
    true,
    'another company may sell the same barcode',
  )
  const duplicate = await call('product.saveTemplate', template('a', 'tpl-a2'), 'a')
  assert.equal(duplicate.ok, false)
  assert.deepEqual(
    (duplicate.errors as Row[]).map((error) => error.field),
    ['barcode'],
  )

  const listed = async (company: string) =>
    ((await call('product.listTemplates', {}, company)) as unknown as Row[]).map((row) => row.id)
  assert.deepEqual(await listed('a'), ['tpl-a'])
  assert.deepEqual(await listed('b'), ['tpl-b'])

  // The unit lookup is scoped, so another company's unit reads as missing.
  const crossed = await call(
    'product.saveTemplate',
    { ...template('b', 'tpl-b2'), uomId: 'unit-a', barcode: null },
    'b',
  )
  assert.equal(crossed.ok, false)
  assert.deepEqual(
    (crossed.errors as Row[]).map((error) => error.field),
    ['uomId'],
  )

  const p = (index: number) => (app.adapter!.name === 'postgres' ? `$${index}` : '?')
  const rows = await app.adapter!.all(
    `SELECT "templateId", "companyId" FROM product_product WHERE barcode = ${p(1)} ORDER BY "companyId"`,
    ['8930000000019'],
  )
  assert.deepEqual(
    rows.map((row) => [row.templateId, row.companyId]),
    [
      ['tpl-a', 'a'],
      ['tpl-b', 'b'],
    ],
  )
})
