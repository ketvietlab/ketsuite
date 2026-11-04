import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, schemaFromManifest } from '@ketvietlab/ketjs'
import { commerce } from '../packages/ketsuite/src/deployment.ts'
import { sharedCatalogueModules } from '../packages/ketsuite/src/modules/product/company-catalogue.ts'
import {
  catalogueIdentityResolver,
  companyCatalogueModels,
  planCatalogueCompanyIdentities,
} from '../packages/ketsuite/src/modules/product/company-identities.ts'

const modules = commerce.modules.map((module) => {
  assert.notEqual(typeof module, 'string', 'public Commerce uses resolved module objects')
  if (typeof module === 'string') throw new Error('Unresolved Commerce module')
  return module
})
const schema = schemaFromManifest(
  compose(sharedCatalogueModules(modules), { headless: true, companies: true }),
)
const sourceIds = Object.fromEntries(companyCatalogueModels.map((model) => [model, [`${model}:sample`]]))
const input = { schema, originalCompanyId: 'original', companyIds: ['original', 'second'], sourceIds }

test('company identity plan preserves original IDs and isolates every catalogue copy in Commerce', () => {
  const before = structuredClone(input)
  const plan = planCatalogueCompanyIdentities(input)
  const resolve = catalogueIdentityResolver(plan)
  assert.deepEqual(input, before, 'planning never modifies its source schema or inventories')
  assert.equal(plan.identities.length, companyCatalogueModels.length * 2)
  for (const model of companyCatalogueModels) {
    const id = `${model}:sample`
    assert.equal(resolve(model, id, 'original'), id)
    assert.notEqual(resolve(model, id, 'second'), id)
    assert.match(resolve(model, id, 'second'), /^pc1:[a-f0-9]{64}$/)
  }
  assert.deepEqual(plan.unresolvedSharedConsumers, [])
  for (const [model, field, target] of [
    ['sale.OrderLine', 'productId', 'product.Product'],
    ['product.Cost', 'productId', 'product.Product'],
    ['product.ProductUom', 'uomId', 'uom.Unit'],
    ['stock.Quant', 'productId', 'product.Product'],
    ['loyalty.ProductTag', 'productId', 'product.Product'],
  ])
    assert.ok(
      plan.references.some((ref) => ref.model === model && ref.field === field && ref.target === target),
      `${model}.${field}`,
    )
  assert.equal(plan.references.find((ref) => ref.model === 'loyalty.ProductTag')?.scope, 'catalogue')
  assert.equal(plan.references.find((ref) => ref.model === 'product.Cost')?.scope, 'company')
})

test('mapping and digest are stable across company, schema and source enumeration order', () => {
  const expanded = {
    ...input,
    companyIds: ['third', 'original', 'second'],
    sourceIds: { ...sourceIds, 'product.Product': ['z', 'a', 'é', 'a:b'] },
  }
  const first = planCatalogueCompanyIdentities(expanded)
  const reversed = planCatalogueCompanyIdentities({
    ...expanded,
    companyIds: [...expanded.companyIds].reverse(),
    schema: { ...schema, tables: Object.fromEntries(Object.entries(schema.tables).reverse()) },
    sourceIds: Object.fromEntries(
      Object.entries(expanded.sourceIds)
        .reverse()
        .map(([model, ids]) => [model, [...ids].reverse()]),
    ),
  })
  assert.deepEqual(first, reversed)
  const persisted = catalogueIdentityResolver(JSON.parse(JSON.stringify(first)))
  const reordered = JSON.parse(JSON.stringify(first), (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse())
      : value,
  )
  const jsonb = catalogueIdentityResolver(reordered)
  const before = catalogueIdentityResolver(first)
  for (const identity of first.identities) {
    assert.equal(
      persisted(identity.model, identity.sourceId, identity.companyId),
      before(identity.model, identity.sourceId, identity.companyId),
    )
    assert.equal(jsonb(identity.model, identity.sourceId, identity.companyId), identity.targetId)
  }
})

test('empty installed models are allowed, absent inventories and invalid identities are refused', () => {
  const empty = Object.fromEntries(companyCatalogueModels.map((model) => [model, []]))
  assert.equal(planCatalogueCompanyIdentities({ ...input, sourceIds: empty }).identities.length, 0)
  assert.throws(
    () => planCatalogueCompanyIdentities({ ...input, sourceIds: {} }),
    /Missing catalogue inventory/,
  )
  assert.throws(
    () => planCatalogueCompanyIdentities({ ...input, sourceIds: { ...sourceIds, unknown: [] } }),
    /Unexpected catalogue inventory/,
  )
  assert.throws(
    () => planCatalogueCompanyIdentities({ ...input, companyIds: ['original', 'original'] }),
    /Duplicate catalogue company/,
  )
  assert.throws(
    () => planCatalogueCompanyIdentities({ ...input, originalCompanyId: 'missing' }),
    /does not exist/,
  )
  assert.throws(() => planCatalogueCompanyIdentities({ ...input, companyIds: [] }), /does not exist/)
  assert.throws(
    () =>
      planCatalogueCompanyIdentities({
        ...input,
        sourceIds: { ...sourceIds, 'product.Product': ['duplicate', 'duplicate'] },
      }),
    /Duplicate source identity/,
  )
  for (const id of ['', '\0', null])
    assert.throws(
      () =>
        planCatalogueCompanyIdentities({
          ...input,
          sourceIds: { ...sourceIds, 'product.Product': [id as string] },
        }),
      /Invalid catalogue identity/,
    )
})

test('existing IDs that collide with a planned clone are rejected instead of overwritten', () => {
  const existing = planCatalogueCompanyIdentities(input)
  const cloneId = catalogueIdentityResolver(existing)('product.Product', 'product.Product:sample', 'second')
  assert.throws(
    () =>
      planCatalogueCompanyIdentities({
        ...input,
        sourceIds: { ...sourceIds, 'product.Product': ['product.Product:sample', cloneId] },
      }),
    /Catalogue target identity collision/,
  )
})

test('ambiguous shared consumers remain visible and company-scoped replay cannot be replanned as legacy', () => {
  const extended = structuredClone(schema)
  extended.tables.extension_link = {
    model: 'extension.Link',
    owner: 'extension',
    indexes: {},
    columns: {
      id: { sql: 'TEXT PRIMARY KEY', base: 'id', optional: false, by: 'extension', target: null },
      variantId: { sql: 'TEXT', base: 'ref', optional: false, by: 'extension', target: 'product.Product' },
    },
  }
  const plan = planCatalogueCompanyIdentities({ ...input, schema: extended })
  assert.deepEqual(plan.unresolvedSharedConsumers, ['extension.Link'])
  assert.notEqual(plan.digest, planCatalogueCompanyIdentities(input).digest)
  const current = structuredClone(schema)
  current.tables.product_product!.columns.companyId = {
    sql: 'TEXT',
    base: 'text',
    optional: false,
    by: '(scope)',
    target: null,
  }
  assert.throws(() => planCatalogueCompanyIdentities({ ...input, schema: current }), /already company scoped/)
})

test('missing or modified mappings cannot silently retain a foreign company source ID', () => {
  const plan = planCatalogueCompanyIdentities(input)
  const resolve = catalogueIdentityResolver(plan)
  for (const args of [
    ['product.Product', 'missing', 'second'],
    ['product.Product', 'product.Product:sample', 'missing'],
    ['missing', 'product.Product:sample', 'second'],
  ] as const)
    assert.throws(() => resolve(args[0], args[1], args[2]), /Unresolved catalogue reference/)
  const tampered = structuredClone(plan)
  tampered.identities[0]!.targetId = 'tampered'
  assert.throws(() => catalogueIdentityResolver(tampered), /digest mismatch/)
})

test('model-qualified mapping keys cannot alias delimiter-shaped identifiers', () => {
  const plan = planCatalogueCompanyIdentities({
    ...input,
    companyIds: ['original', 'c', 'b:c'],
    sourceIds: { ...sourceIds, 'product.Product': ['a:b', 'a'], 'product.Template': ['a:b', 'a'] },
  })
  const resolve = catalogueIdentityResolver(plan)
  assert.notEqual(resolve('product.Product', 'a:b', 'c'), resolve('product.Product', 'a', 'b:c'))
  assert.notEqual(resolve('product.Template', 'a:b', 'c'), resolve('product.Product', 'a:b', 'c'))
})
