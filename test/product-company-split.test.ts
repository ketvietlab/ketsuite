import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, sqliteStore, verifyPhysicalSchema } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import type { CatalogueCompanyProjection } from '../packages/ketsuite/src/company-migration.ts'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import {
  companyCatalogueModules,
  publicCatalogueOwnerPolicies,
  splitCatalogueByCompany,
} from '../packages/ketsuite/src/company-migration.ts'
import { commerce, createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'
import { sharedCatalogueModules } from '../packages/ketsuite/src/modules/product/company-catalogue.ts'

const modules = commerce.modules.map((module) => {
  if (typeof module === 'string') throw new Error('Unresolved Commerce module')
  return module
})
const target = compose(companyCatalogueModules(modules), { headless: true, companies: true })

async function tenant(t: { after: (fn: () => Promise<void>) => void }) {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(
    // Seed the shared catalogue a tenant has before its split.
    { ...deployment, modules: sharedCatalogueModules(deployment.modules) },
    { worker: false },
  )
  t.after(() => app.close())
  const adapter = app.adapter!
  const fixture = (name: string, input: Row, company = 'original') =>
    app.fixture.call(name, input, { scope: { company, branches: null } })
  for (const company of ['original', 'second']) {
    await fixture('partner.savePartner', { id: `${company}-party`, kind: 'company', name: company }, company)
    await fixture(
      'company.saveCompany',
      { id: company, partnerId: `${company}-party`, currency: 'VND' },
      company,
    )
  }
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'catalogue-split-test',
    name: 'Owner',
    defaultCompanyId: 'original',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'owner-original', userId: 'owner', companyId: 'original' })
  await app.client.login({ login: 'owner', password: 'catalogue-split-test' })
  const save = async (name: string, input: Row) => {
    const result = (await app.client.call<Row>(name, input)).value
    assert.equal(result.ok, true, JSON.stringify(result))
    return result
  }
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
  await save('product.saveAttributeLine', {
    id: 'sample-size',
    templateId: 'sample',
    attributeId: 'size',
    valueIds: ['small', 'large'],
  })
  await save('product.generateVariants', { templateId: 'sample' })
  const p = (index: number) => (adapter.name === 'postgres' ? `$${index}` : '?')
  const variants = await adapter.all(
    `SELECT id FROM product_product WHERE "templateId" = ${p(1)} ORDER BY id`,
    ['sample'],
  )
  const variant = String(variants.find((row) => row.id)!.id)
  await adapter.run(`UPDATE product_product SET barcode = ${p(1)} WHERE id = ${p(2)}`, [
    '8930000000017',
    variant,
  ])
  for (const company of ['original', 'second'])
    assert.equal(
      (
        (await fixture(
          'product.setCost',
          { productId: variant, standardPrice: company === 'original' ? '60' : '70' },
          company,
        )) as Row
      ).ok,
      true,
    )
  return { app, adapter, variant, p }
}

const columnsOf = async (adapter: Adapter, table: string) =>
  Object.keys((await adapter.introspect())[table] ?? {})

test('a Commerce tenant splits its catalogue by company in one transaction; a dry run, a refusal and a replay write nothing', async (t) => {
  const { adapter, variant, p } = await tenant(t)
  const marker = async () => (await adapter.all('SELECT schema FROM ket_migration WHERE id = 1'))[0]!.schema
  const unsplit = await marker()
  // An owner policy may rewrite a row of the original company; its copy still starts
  // from the source row as it was read.
  function renamesOriginal(projection: CatalogueCompanyProjection) {
    const result = structuredClone(projection)
    for (const row of result.rows)
      if (row.model === 'product.Template' && row.mode === 'update') row.after.name = 'Renamed'
    return result
  }
  const split = (dryRun = false, manifest = target) =>
    splitCatalogueByCompany(adapter, {
      manifest,
      originalCompanyId: 'original',
      policies: [...publicCatalogueOwnerPolicies, renamesOriginal],
      dryRun,
      now: () => '2026-10-19T00:00:00.000Z',
    })

  const plan = await split(true)
  assert.equal(plan.state, 'planned')
  assert.ok(plan.clones > 0 && plan.updates > 0 && plan.mappings > 0)
  assert.ok(plan.statements.some((statement) => /ADD COLUMN "companyId"/.test(statement)))
  assert.ok(plan.statements.some((statement) => /barcode_unique/.test(statement)))
  assert.equal(await marker(), unsplit)
  assert.ok(!(await columnsOf(adapter, 'product_template')).includes('companyId'))

  await adapter.run(
    `INSERT INTO ket_job (id, job, queue, args, state, max_attempts, scheduled_at, company_id, inserted_at, updated_at) VALUES (${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(p).join(', ')})`,
    [
      'queued',
      'stock.recompute',
      'default',
      JSON.stringify({ productId: variant }),
      'available',
      3,
      '2026-10-19T00:00:00.000Z',
      'second',
      '2026-10-19T00:00:00.000Z',
      '2026-10-19T00:00:00.000Z',
    ],
  )
  await assert.rejects(split(), /drain them first: stock\.recompute queued/)
  assert.equal(await marker(), unsplit)
  assert.ok(!(await columnsOf(adapter, 'product_template')).includes('companyId'), 'the refusal rolled back')
  await adapter.run(`DELETE FROM ket_job WHERE id = ${p(1)}`, ['queued'])

  const partner = target.models['partner.Partner']!
  const widened = {
    ...target,
    models: {
      ...target.models,
      'partner.Partner': {
        ...partner,
        indexes: { ...partner.indexes, split_probe: { fields: ['name'], unique: false, by: 'partner' } },
      },
    },
  }
  await assert.rejects(
    split(false, widened),
    /ordinary migration before the catalogue split: CREATE_INDEX partner_partner$/,
  )
  assert.equal(await marker(), unsplit)

  const result = await split()
  assert.deepEqual({ ...result, statements: plan.statements }, { ...plan, state: 'applied' })
  const verified = await verifyPhysicalSchema(adapter, target)
  assert.equal(verified.ok, true, JSON.stringify(verified.manifestIssues))

  const templates = await adapter.all(
    'SELECT id, "companyId", name FROM product_template ORDER BY "companyId"',
  )
  assert.deepEqual(
    templates.map((row) => [row.companyId, row.name]),
    [
      ['original', 'Renamed'],
      ['second', 'Sample'],
    ],
  )
  assert.equal(templates[0]!.id, 'sample', 'the original company keeps its ID')
  const copy = String(templates[1]!.id)
  assert.match(copy, /^pc1:/)

  const products = await adapter.all(
    `SELECT id, "companyId", "templateId" FROM product_product WHERE barcode = ${p(1)} ORDER BY "companyId"`,
    ['8930000000017'],
  )
  assert.deepEqual(
    products.map((row) => [row.companyId, row.templateId]),
    [
      ['original', 'sample'],
      ['second', copy],
    ],
    'a barcode now repeats once per company',
  )
  assert.equal(products[0]!.id, variant)
  const variantCopy = String(products[1]!.id)
  const costs = await adapter.all(
    `SELECT id, "companyId", "productId", "standardPrice" FROM product_cost ORDER BY "companyId"`,
  )
  assert.deepEqual(
    costs.map((row) => [row.id, row.productId, Number(row.standardPrice)]),
    [
      [`original:${variant}`, variant, 60],
      [`second:${variantCopy}`, variantCopy, 70],
    ],
  )
  const ledger = await adapter.all(
    `SELECT "companyId", "sourceId", "targetId" FROM product_catalogue_identity_mapping WHERE model = ${p(1)}`,
    ['product.Template'],
  )
  assert.deepEqual(
    ledger.map((row) => ({ ...row })),
    [{ companyId: 'second', sourceId: 'sample', targetId: copy }],
  )
  const mappings = await adapter.all('SELECT COUNT(*) AS n FROM product_catalogue_identity_mapping')
  assert.equal(Number(mappings[0]!.n), plan.mappings)
  assert.equal(
    (
      await adapter.all(`SELECT id FROM product_catalogue_identity_mapping WHERE "companyId" = ${p(1)}`, [
        'original',
      ])
    ).length,
    0,
  )

  const rows = await adapter.all('SELECT COUNT(*) AS n FROM product_product')
  assert.deepEqual(await split(), {
    state: 'already-split',
    statements: [],
    clones: 0,
    updates: 0,
    mappings: 0,
  })
  assert.deepEqual(await adapter.all('SELECT COUNT(*) AS n FROM product_product'), rows)
})
