import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sqliteStore } from '@ketvietlab/ketjs'
import type { Adapter, Row, Schema } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import {
  catalogueIdentityResolver,
  inspectCatalogueCompanyIdentities,
  projectCatalogueCompanyRows,
} from '../packages/ketsuite/src/modules/product/company-migration.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'
import { sharedCatalogueModules } from '../packages/ketsuite/src/modules/product/company-catalogue.ts'

test('Commerce preflight reads inactive and unreferenced catalogue rows without changing business data or schema', async (t) => {
  const commerce = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(
    // Seed the shared catalogue a tenant has before its split.
    { ...commerce, modules: sharedCatalogueModules(commerce.modules) },
    { worker: false },
  )
  t.after(() => app.close())
  const adapter = app.adapter!
  assert.ok(adapter)
  const seed = async (name: string, input: Row, company = 'original') => {
    const result = await app.fixture.call<Row>(name, input, { scope: { company, branches: null } })
    assert.equal(result.value.ok, true, JSON.stringify(result.value))
    return result.value
  }
  for (const company of ['original', 'second']) {
    await seed('partner.savePartner', { id: `${company}-party`, kind: 'company', name: `Example ${company}` })
    await seed('company.saveCompany', { id: company, partnerId: `${company}-party`, currency: 'VND' })
  }
  await seed('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
  await seed('product.saveTemplate', {
    id: 'sample',
    name: 'Sample',
    type: 'goods',
    uomId: 'each',
    listPrice: '125',
  })
  const products = await adapter.all('SELECT * FROM product_product')
  assert.equal(products.length, 1)
  const productId = String(products[0]!.id)
  await seed('product.setCost', { productId, standardPrice: '60' })
  await seed('product.setCost', { productId, standardPrice: '70' }, 'second')
  await seed('product.saveAttribute', { id: 'unused', name: 'Unused attribute', createVariant: 'always' })
  const parameter = adapter.name === 'postgres' ? '$1' : '?'
  await adapter.run(`UPDATE product_template SET active = FALSE WHERE id = ${parameter}`, ['sample'])
  await adapter.run(`UPDATE product_product SET active = FALSE WHERE id = ${parameter}`, [productId])
  const snapshot = async () => ({
    migration: await adapter.all('SELECT * FROM ket_migration'),
    templates: await adapter.all('SELECT * FROM product_template'),
    products: await adapter.all('SELECT * FROM product_product'),
    costs: await adapter.all('SELECT * FROM product_cost ORDER BY id'),
    units: await adapter.all('SELECT * FROM uom_unit'),
    attributes: await adapter.all('SELECT * FROM product_attribute'),
  })
  const before = await snapshot()
  const first = await inspectCatalogueCompanyIdentities(adapter, 'original')
  const second = await adapter.tx(async (tx) => {
    if (tx.name === 'postgres') await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    return inspectCatalogueCompanyIdentities(tx, 'original')
  })
  if (adapter.name === 'postgres')
    await assert.rejects(
      adapter.tx((tx) => inspectCatalogueCompanyIdentities(tx, 'original')),
      /requires a repeatable-read/,
    )
  assert.deepEqual(
    first,
    second,
    'same snapshot gives the same mapping, including within a caller transaction',
  )
  assert.deepEqual(await snapshot(), before, 'preflight preserves prices, costs, IDs and migration marker')
  const resolve = catalogueIdentityResolver(first)
  assert.equal(resolve('product.Product', productId, 'original'), productId)
  assert.notEqual(resolve('product.Product', productId, 'second'), productId)
  assert.notEqual(resolve('product.Attribute', 'unused', 'second'), 'unused')
  assert.notEqual(resolve('uom.Unit', 'each', 'second'), 'each')
  const appliedSchema = JSON.parse(String(before.migration[0]!.schema)) as Schema
  const fullSnapshot: Record<string, Row[]> = {}
  for (const [table, definition] of Object.entries(appliedSchema.tables))
    fullSnapshot[definition.model] = await adapter.all(`SELECT * FROM ${adapter.quoteIdent(table)}`)
  const projection = projectCatalogueCompanyRows({
    schema: appliedSchema,
    identityPlan: first,
    rows: fullSnapshot,
  })
  assert.equal(
    projection.rows.find((row) => row.model === 'product.Cost' && row.companyId === 'second')?.after.id,
    `second:${resolve('product.Product', productId, 'second')}`,
  )
  assert.equal(
    projection.rows.find((row) => row.model === 'product.Template' && row.companyId === 'second')?.after
      .listPrice,
    before.templates[0]!.listPrice,
  )
  assert.deepEqual(await snapshot(), before, 'projection also leaves the actual datastore untouched')
  await assert.rejects(inspectCatalogueCompanyIdentities(adapter, 'missing'), /does not exist/)
  assert.deepEqual(await snapshot(), before, 'failed preflight also leaves the tenant untouched')
  if (adapter.name === 'postgres') {
    let inserted = false
    const concurrent: Adapter = {
      ...adapter,
      tx: (fn) =>
        adapter.tx((tx) =>
          fn({
            ...tx,
            all: async (sql, params) => {
              const rows = await tx.all(sql, params)
              if (!inserted && sql.includes('company_company')) {
                inserted = true
                await adapter.run(
                  "INSERT INTO product_attribute (id, name, sequence, \"displayType\", \"createVariant\", active) VALUES ('concurrent', 'Concurrent', 0, 'select', 'always', TRUE)",
                )
              }
              return rows
            },
          }),
        ),
    }
    // A real second connection writes after the snapshot starts.
    const during = await inspectCatalogueCompanyIdentities(concurrent, 'original')
    assert.equal(inserted, true)
    assert.ok(!during.identities.some((identity) => identity.sourceId === 'concurrent'))
    const after = await inspectCatalogueCompanyIdentities(adapter, 'original')
    assert.ok(after.identities.some((identity) => identity.sourceId === 'concurrent'))
  }
})
