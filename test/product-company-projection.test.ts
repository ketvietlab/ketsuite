import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, schemaFromManifest } from '@ketvietlab/ketjs'
import type { Row, Schema } from '@ketvietlab/ketjs'
import { commerce } from '../packages/ketsuite/src/deployment.ts'
import { sharedCatalogueModules } from '../packages/ketsuite/src/modules/product/company-catalogue.ts'
import {
  assertNoQueuedCatalogueJobs,
  catalogueIdentityResolver,
  companyCatalogueModels,
  planCatalogueCompanyIdentities,
  projectCatalogueCompanyRows,
} from '../packages/ketsuite/src/modules/product/company-migration.ts'
import {
  posCatalogueEvidence,
  preserveCatalogueEvidence,
  projectCompanyCatalogueWebsiteCards,
  publicCatalogueOwnerPolicies,
  saleCatalogueEvidence,
  settleCatalogueCompanyProjection,
  stockStaffChannelCatalogueEvidence,
} from '../packages/ketsuite/src/company-migration.ts'
import type {
  CatalogueCompanyProjection,
  CatalogueOwnerPolicy,
} from '../packages/ketsuite/src/company-migration.ts'

const modules = commerce.modules.map((module) => {
  if (typeof module === 'string') throw new Error('Unresolved Commerce module')
  return module
})
const commerceSchema = schemaFromManifest(
  compose(sharedCatalogueModules(modules), { headless: true, companies: true }),
)

function fixture() {
  const schema = structuredClone(commerceSchema)
  const rows: Record<string, Row[]> = Object.fromEntries(
    Object.values(schema.tables).map((table) => [table.model, []]),
  )
  rows['company.Company'] = [{ id: 'original' }, { id: 'second' }]
  rows['uom.Unit'] = [
    {
      id: 'each',
      name: 'Each',
      relativeUomId: null,
      parentPath: 'each/',
      relativeFactor: '1',
      absoluteFactor: '1',
      rounding: '1',
      active: true,
    },
    {
      id: 'box',
      name: 'Box',
      relativeUomId: 'each',
      parentPath: 'each/box/',
      relativeFactor: '6',
      absoluteFactor: '6',
      rounding: '1',
      active: true,
    },
  ]
  rows['product.Template'] = [
    { id: 'template', name: 'Example', type: 'goods', uomId: 'each', listPrice: '125.50', active: false },
  ]
  rows['product.Attribute'] = [
    { id: 'size', name: 'Size', sequence: 0, displayType: 'select', createVariant: 'always', active: true },
  ]
  rows['product.AttributeValue'] = [{ id: 'small', attributeId: 'size', name: 'Small', sequence: 0 }]
  rows['product.TemplateAttributeLine'] = [{ id: 'line', templateId: 'template', attributeId: 'size' }]
  rows['product.TemplateAttributeValue'] = [
    { id: 'value', lineId: 'line', valueId: 'small', priceExtra: '2.50' },
  ]
  rows['product.Product'] = [
    {
      id: 'variant',
      templateId: 'template',
      combinationKey: 'small',
      defaultCode: 'EX-S',
      barcode: '12345678',
      weight: '1',
      volume: '0',
      active: false,
    },
  ]
  rows['product.ProductValue'] = [
    { id: 'variant-value', productId: 'variant', templateAttributeValueId: 'value' },
  ]
  rows['product.TemplateUom'] = [{ id: 'template:box', templateId: 'template', uomId: 'box' }]
  rows['product.Cost'] = [
    { id: 'original:variant', companyId: 'original', productId: 'variant', standardPrice: '60.25' },
    { id: 'second:variant', companyId: 'second', productId: 'variant', standardPrice: '71.30' },
  ]
  rows['product.ProductUom'] = [
    { id: 'pack', companyId: 'second', productId: 'variant', uomId: 'box', barcode: '23456789' },
  ]
  rows['stock.Location'] = [{ id: 'location', companyId: 'second' }]
  rows['stock.Lot'] = [
    { id: 'lot', companyId: 'second', productId: 'variant', name: 'Batch 1', active: true },
  ]
  rows['stock.Quant'] = [
    {
      id: 'second:variant:location:lot',
      companyId: 'second',
      productId: 'variant',
      locationId: 'location',
      lotId: 'lot',
      lotKey: 'lot',
      quantity: '12.50',
      reservedQuantity: '2.25',
      inDate: '2026-01-01T00:00:00Z',
      version: 7,
    },
  ]
  rows['sale.Order'] = [{ id: 'order', companyId: 'second' }]
  rows['sale.OrderLine'] = [
    {
      id: 'order-line',
      companyId: 'second',
      orderId: 'order',
      productId: 'variant',
      productUomId: 'box',
      productUomQty: '2',
      priceUnit: '753',
      discount: '0',
      priceSubtotal: '1506',
      qtyDelivered: '1',
      qtyInvoiced: '1',
    },
  ]
  rows['storage.Attachment'] = [
    {
      id: 'image',
      companyId: 'second',
      resModel: 'product.Template',
      resId: 'template',
      storeKey: 'test/image',
      checksum: 'unchanged',
    },
  ]
  rows['mail.Thread'] = [
    {
      id: 'thread',
      companyId: 'second',
      resModel: 'product.Template',
      resId: 'template',
      displayName: 'Example',
      active: true,
    },
  ]
  return { schema, rows }
}

function identityPlan(schema: Schema, rows: Record<string, Row[]>) {
  const installed = new Set(Object.values(schema.tables).map((table) => table.model))
  const sourceIds = Object.fromEntries(
    companyCatalogueModels
      .filter((model) => installed.has(model))
      .map((model) => [model, rows[model]!.map((row) => String(row.id))]),
  )
  return planCatalogueCompanyIdentities({
    schema,
    sourceIds,
    originalCompanyId: 'original',
    companyIds: ['original', 'second'],
  })
}

test('Commerce projection clones the catalogue and rewrites company operations without changing amounts or evidence', () => {
  const { schema, rows } = fixture()
  const before = structuredClone(rows)
  const plan = identityPlan(schema, rows)
  const resolve = catalogueIdentityResolver(plan)
  const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: plan })
  assert.deepEqual(rows, before)
  assert.deepEqual(projection.pendingReviews, [])
  const projected = (model: string, id: string, companyId = 'second') => {
    const change = projection.rows.find(
      (row) => row.model === model && row.sourceId === id && row.companyId === companyId,
    )
    assert.ok(change, `${model}/${id}/${companyId}`)
    return change.after
  }
  const variantId = resolve('product.Product', 'variant', 'second')
  assert.equal(projected('product.Product', 'variant').id, variantId)
  assert.equal(projected('product.Product', 'variant', 'original').id, 'variant')
  assert.equal(
    projected('product.Product', 'variant').combinationKey,
    resolve('product.AttributeValue', 'small', 'second'),
  )
  assert.equal(projected('product.Product', 'variant').active, false)
  assert.equal(projected('product.Template', 'template').listPrice, '125.50')
  assert.equal(
    projected('product.ProductValue', 'variant-value').templateAttributeValueId,
    resolve('product.TemplateAttributeValue', 'value', 'second'),
  )
  assert.equal(
    projected('uom.Unit', 'box').parentPath,
    `${resolve('uom.Unit', 'each', 'second')}/${resolve('uom.Unit', 'box', 'second')}/`,
  )
  const cost = projected('product.Cost', 'second:variant')
  assert.equal(cost.id, `second:${variantId}`)
  assert.equal(cost.standardPrice, '71.30')
  assert.ok(!projection.rows.some((row) => row.model === 'product.Cost' && row.companyId === 'original'))
  const quant = projected('stock.Quant', 'second:variant:location:lot')
  assert.equal(quant.id, `second:${variantId}:location:lot`)
  assert.equal(quant.quantity, '12.50')
  assert.equal(quant.reservedQuantity, '2.25')
  assert.equal(quant.version, 7)
  assert.equal(quant.inDate, '2026-01-01T00:00:00Z')
  assert.equal(projected('product.ProductUom', 'pack').id, 'pack')
  assert.equal(projected('product.ProductUom', 'pack').barcode, '23456789')
  const line = projected('sale.OrderLine', 'order-line')
  assert.equal(line.productId, variantId)
  assert.equal(line.productUomId, resolve('uom.Unit', 'box', 'second'))
  assert.equal(line.priceSubtotal, '1506')
  assert.equal(line.qtyDelivered, '1')
  assert.equal(line.qtyInvoiced, '1')
  assert.equal(
    projected('storage.Attachment', 'image').resId,
    resolve('product.Template', 'template', 'second'),
  )
  assert.equal(projected('storage.Attachment', 'image').storeKey, 'test/image')
  assert.equal(projected('storage.Attachment', 'image').checksum, 'unchanged')
  assert.equal(projected('mail.Thread', 'thread').resId, resolve('product.Template', 'template', 'second'))
  assert.deepEqual(
    projection.operationalIdentities.map((row) => row.model),
    ['product.Cost', 'stock.Quant'],
  )
  assert.deepEqual(projectCatalogueCompanyRows({ schema, rows, identityPlan: plan }), projection)
  assert.deepEqual(
    projectCatalogueCompanyRows({
      schema: { ...schema, tables: Object.fromEntries(Object.entries(schema.tables).reverse()) },
      rows: Object.fromEntries(
        Object.entries(rows)
          .reverse()
          .map(([model, values]) => [model, [...values].reverse()]),
      ),
      identityPlan: plan,
    }),
    projection,
  )
})

test('projection rejects stale inventories, missing snapshots, broken references and foreign company rows', () => {
  for (const [edit, expected] of [
    [
      (rows: Record<string, Row[]>) => {
        delete rows['sale.OrderLine']
      },
      /Missing projection snapshot/,
    ],
    [
      (rows: Record<string, Row[]>) => {
        rows['product.Product'] = []
      },
      /snapshot differs/,
    ],
    [
      (rows: Record<string, Row[]>) => {
        rows['sale.OrderLine']![0]!.productId = 'missing'
      },
      /Missing referenced row/,
    ],
    [
      (rows: Record<string, Row[]>) => {
        rows['sale.OrderLine']![0]!.companyId = 'unknown'
      },
      /Unknown projection company/,
    ],
    [
      (rows: Record<string, Row[]>) => {
        rows['sale.Order']![0]!.companyId = 'original'
      },
      /Cross-company typed reference/,
    ],
    [
      (rows: Record<string, Row[]>) => {
        rows['uom.Unit']![0]!.relativeUomId = 'box'
      },
      /Cyclic unit hierarchy/,
    ],
    [
      (rows: Record<string, Row[]>) => {
        rows['uom.Unit']![1]!.parentPath = 'wrong/'
      },
      /hierarchy and stored path disagree/,
    ],
  ] as const) {
    const { schema, rows } = fixture()
    const plan = identityPlan(schema, rows)
    edit(rows)
    assert.throws(() => projectCatalogueCompanyRows({ schema, rows, identityPlan: plan }), expected)
  }
})

test('units stored before paths ended in a slash project into slash-terminated paths', () => {
  const { schema, rows } = fixture()
  rows['uom.Unit']![0]!.parentPath = 'each'
  rows['uom.Unit']![1]!.parentPath = 'each/box'
  const plan = identityPlan(schema, rows)
  const resolve = catalogueIdentityResolver(plan)
  const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: plan })
  const path = (id: string, companyId: string) =>
    projection.rows.find(
      (row) => row.model === 'uom.Unit' && row.sourceId === id && row.companyId === companyId,
    )?.after.parentPath
  assert.equal(path('box', 'original'), 'each/box/')
  assert.equal(
    path('box', 'second'),
    `${resolve('uom.Unit', 'each', 'second')}/${resolve('uom.Unit', 'box', 'second')}/`,
  )
})

test('manual and archived variant identity markers follow the copied row while quantities keep their no-lot key', () => {
  const { schema, rows } = fixture()
  rows['product.Product']![0]!.combinationKey = 'manual:variant'
  rows['stock.Quant']![0]!.lotId = null
  rows['stock.Quant']![0]!.lotKey = ''
  rows['stock.Quant']![0]!.id = 'second:variant:location:_'
  const plan = identityPlan(schema, rows)
  const copied = catalogueIdentityResolver(plan)('product.Product', 'variant', 'second')
  for (const prefix of ['manual:', 'archived:']) {
    rows['product.Product']![0]!.combinationKey = `${prefix}variant`
    const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: plan })
    assert.equal(
      projection.rows.find((row) => row.model === 'product.Product' && row.companyId === 'second')?.after
        .combinationKey,
      `${prefix}${copied}`,
    )
    assert.equal(
      projection.rows.find((row) => row.model === 'stock.Quant')?.after.id,
      `second:${copied}:location:_`,
    )
  }
})

test('opaque JSON even without a typed product FK remains unchanged and requires an owner policy', () => {
  const { schema, rows } = fixture()
  schema.tables.extension_receipt = {
    model: 'extension.Receipt',
    owner: 'extension',
    indexes: {},
    columns: {
      id: { sql: 'TEXT PRIMARY KEY', base: 'id', optional: false, by: 'extension', target: null },
      payload: { sql: 'TEXT', base: 'json', optional: false, by: 'extension', target: null },
    },
  }
  const payload = { productId: 'variant', hash: 'keep-evidence' }
  rows['extension.Receipt'] = [{ id: 'receipt', payload }]
  rows['sale.OrderLine']![0]!.taxEvidence = { productId: 'variant', taxAmount: '150.6', hash: 'keep-tax' }
  const plan = identityPlan(schema, rows)
  const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: plan })
  assert.ok(
    projection.pendingReviews.some(
      (review) => review.model === 'extension.Receipt' && review.field === 'payload',
    ),
  )
  assert.ok(!projection.rows.some((row) => row.model === 'extension.Receipt'))
  const line = projection.rows.find((row) => row.model === 'sale.OrderLine')!
  assert.deepEqual(line.after.taxEvidence, rows['sale.OrderLine']![0]!.taxEvidence)
  assert.deepEqual(rows['extension.Receipt']![0]!.payload, payload)
})

test('evidence of the original company keeps its IDs, so only copied-company evidence naming a catalogue ID needs review', () => {
  const { schema, rows } = fixture()
  const column = (base: 'id' | 'text' | 'json' | 'ref', target: string | null = null) => ({
    sql: 'TEXT',
    base,
    optional: false,
    by: 'extension',
    target,
  })
  schema.tables.extension_receipt = {
    model: 'extension.Receipt',
    owner: 'extension',
    indexes: {},
    columns: {
      id: column('id'),
      companyId: column('text'),
      productId: column('ref', 'product.Product'),
      payload: column('json'),
      requestHash: column('text'),
    },
  }
  rows['extension.Receipt'] = [
    {
      id: 'kept',
      companyId: 'original',
      productId: 'variant',
      payload: { lines: [{ productId: 'variant' }] },
      requestHash: 'h1',
    },
    { id: 'plain', companyId: 'second', productId: 'variant', payload: { amount: '10' }, requestHash: 'h2' },
    {
      id: 'named',
      companyId: 'second',
      productId: 'variant',
      payload: { image: '/admin/product/images/variant?size=small', keys: 'each,box' },
      requestHash: 'h3',
    },
  ]
  const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: identityPlan(schema, rows) })
  assert.deepEqual(
    projection.pendingReviews.filter((review) => review.model === 'extension.Receipt'),
    [
      { model: 'extension.Receipt', sourceId: 'named', field: 'payload', reason: 'opaque-json' },
      { model: 'extension.Receipt', sourceId: 'named', field: 'requestHash', reason: 'opaque-hash' },
      { model: 'extension.Receipt', sourceId: 'plain', field: 'requestHash', reason: 'opaque-hash' },
    ],
  )
  assert.ok(!projection.rows.some((row) => row.model === 'extension.Receipt' && row.sourceId === 'kept'))
})

test('operational inbound references follow rekeyed stock rows and unknown company configuration requires review', () => {
  const { schema, rows } = fixture()
  const field = (base: 'id' | 'text' | 'ref', target: string | null = null) => ({
    sql: 'TEXT',
    base,
    optional: false,
    by: 'extension',
    target,
  })
  schema.tables.extension_reservation = {
    model: 'extension.Reservation',
    owner: 'extension',
    indexes: {},
    columns: {
      id: field('id'),
      companyId: field('text'),
      quantId: field('ref', 'stock.Quant'),
    },
  }
  schema.tables.extension_recipe = {
    model: 'extension.Recipe',
    owner: 'extension',
    indexes: {},
    columns: {
      id: field('id'),
      companyId: field('text'),
      productId: field('ref', 'product.Product'),
    },
  }
  schema.tables.product_product!.columns.recipeId = { ...field('ref', 'extension.Recipe'), optional: true }
  rows['extension.Reservation'] = [
    { id: 'reservation', companyId: 'second', quantId: 'second:variant:location:lot' },
  ]
  rows['extension.Recipe'] = [{ id: 'recipe', companyId: 'second', productId: 'variant' }]
  rows['product.Product']![0]!.recipeId = 'recipe'
  const plan = identityPlan(schema, rows)
  const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: plan })
  const quant = projection.rows.find((row) => row.model === 'stock.Quant')!.after
  assert.equal(projection.rows.find((row) => row.model === 'extension.Reservation')!.after.quantId, quant.id)
  assert.deepEqual(projection.pendingReviews, [
    {
      model: 'product.Product',
      sourceId: 'variant',
      field: 'recipeId',
      reason: 'company-reference-on-catalogue',
    },
  ])
  rows['extension.Reservation']![0]!.companyId = 'original'
  assert.throws(
    () => projectCatalogueCompanyRows({ schema, rows, identityPlan: plan }),
    /Cross-company typed reference/,
  )
})

test('projection refuses operational primary-key collisions and absent required references', () => {
  const { schema, rows } = fixture()
  const plan = identityPlan(schema, rows)
  const copied = catalogueIdentityResolver(plan)('product.Product', 'variant', 'second')
  rows['product.Cost']!.push({ ...rows['product.Cost']![1], id: `second:${copied}` })
  assert.throws(
    () => projectCatalogueCompanyRows({ schema, rows, identityPlan: plan }),
    /Operational identity collision/,
  )
  rows['product.Cost']!.pop()
  rows['sale.OrderLine']![0]!.orderId = null
  assert.throws(
    () => projectCatalogueCompanyRows({ schema, rows, identityPlan: plan }),
    /Missing required reference/,
  )
})

test('product cards of a copied company point at its template copy; other catalogue IDs keep the field pending', () => {
  const { schema, rows } = fixture()
  const card = (id: string, productId: string, slots?: Row) => ({
    id,
    type: 'website_catalog.product_card',
    settings: { productId, ctaLabel: 'Buy' },
    ...(slots ? { slots } : {}),
  })
  rows['website.Site'] = [{ id: 'site', companyId: 'second' }]
  rows['website_catalog.Template'] = [
    {
      id: 'layout',
      companyId: 'second',
      layout: [card('t1', 'template', { main: [card('t2', 'template')] })],
      bindings: {},
    },
  ]
  rows['website_catalog.Binding'] = [
    {
      id: 'binding',
      companyId: 'second',
      siteId: 'site',
      productId: 'template',
      templateId: 'layout',
      contentLayout: [card('b1', 'template', { main: [card('b2', 'deleted-template')] })],
    },
  ]
  rows['website.EntryRevision'] = [
    {
      id: 'revision',
      companyId: 'second',
      entryId: 'entry',
      layout: [card('r1', 'template'), { id: 'r2', type: 'text', settings: { body: 'see variant' } }],
    },
  ]
  rows['website.Page'] = [{ id: 'page', companyId: 'original', layout: [card('p1', 'template')] }]
  const plan = identityPlan(schema, rows)
  const copy = catalogueIdentityResolver(plan)('product.Template', 'template', 'second')
  const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: plan })
  const website = (reviews: typeof projection.pendingReviews) =>
    reviews
      .filter((review) => review.model.startsWith('website'))
      .map((review) => `${review.model}.${review.field}`)
  assert.deepEqual(website(projection.pendingReviews), [
    'website.EntryRevision.layout',
    'website_catalog.Binding.contentLayout',
    'website_catalog.Template.layout',
  ])
  const before = structuredClone({ rows, projection })
  const result = projectCompanyCatalogueWebsiteCards(projection, rows)
  assert.deepEqual({ rows, projection }, before)
  const after = (model: string) => result.rows.find((row) => row.model === model)?.after
  assert.deepEqual(after('website_catalog.Binding')!.contentLayout, [
    card('b1', copy, { main: [card('b2', 'deleted-template')] }),
  ])
  assert.equal(after('website_catalog.Binding')!.productId, copy)
  assert.deepEqual(after('website_catalog.Template')!.layout, [
    card('t1', copy, { main: [card('t2', copy)] }),
  ])
  assert.deepEqual((after('website.EntryRevision')!.layout as Row[])[0], card('r1', copy))
  assert.equal(after('website.Page'), undefined, 'the original company keeps its cards')
  assert.deepEqual(website(result.pendingReviews), ['website.EntryRevision.layout'])
})

test('owners settle the evidence they keep, and a company reference stays with its own policy', () => {
  const { schema, rows } = fixture()
  rows['sale.OrderLine']![0]!.taxEvidence = { taxes: [{ taxId: 'variant', amount: '1' }] }
  rows['sale.OrderLine']![0]!.taxIds = ['variant']
  schema.tables.product_product!.columns.recipeId = {
    sql: 'TEXT',
    base: 'ref',
    optional: true,
    by: 'extension',
    target: 'sale.Order',
  }
  rows['product.Product']![0]!.recipeId = 'order'
  const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: identityPlan(schema, rows) })
  const named = (reviews: typeof projection.pendingReviews) =>
    reviews.map((review) => `${review.model}.${review.field}`)
  assert.deepEqual(named(projection.pendingReviews), [
    'product.Product.recipeId',
    'sale.OrderLine.taxEvidence',
    'sale.OrderLine.taxIds',
  ])
  const before = structuredClone(projection)
  const evidence = {
    ...saleCatalogueEvidence,
    ...posCatalogueEvidence,
    ...stockStaffChannelCatalogueEvidence,
  }
  assert.deepEqual(named(preserveCatalogueEvidence(projection, evidence).pendingReviews), [
    'product.Product.recipeId',
  ])
  assert.deepEqual(
    named(preserveCatalogueEvidence(projection, { 'product.Product': ['recipeId'] }).pendingReviews),
    named(projection.pendingReviews),
    'listing a company reference as evidence does not settle it',
  )
  assert.deepEqual(projection, before)
})

test('queued jobs outside the original company that name a catalogue ID refuse until drained', () => {
  const { schema, rows } = fixture()
  const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: identityPlan(schema, rows) })
  const job = (fields: Partial<CatalogueQueuedJobInput>): CatalogueQueuedJobInput => ({
    id: 'job',
    job: 'stock.recompute',
    state: 'available',
    args: '{}',
    uniqueKey: null,
    companyId: 'second',
    companies: '["second"]',
    ...fields,
  })
  const refuses = (fields: Partial<CatalogueQueuedJobInput>) =>
    assert.throws(
      () => assertNoQueuedCatalogueJobs(projection, [job(fields)]),
      /drain them first: stock\.recompute job/,
    )
  const passes = (fields: Partial<CatalogueQueuedJobInput>) =>
    assert.doesNotThrow(() => assertNoQueuedCatalogueJobs(projection, [job(fields)]))

  for (const state of ['available', 'scheduled', 'executing', 'retryable'])
    refuses({ state, args: '{"productId":"variant"}' })
  refuses({ args: { productIds: ['variant'] } })
  refuses({ args: '{"productId":"\\u0076ariant"}' })
  refuses({ args: '{"quantId":"second:variant:location:lot"}' })
  refuses({ uniqueKey: 'template:refresh' })
  refuses({ companyId: null, companies: null, args: '{"templateId":"template"}' })
  refuses({ companyId: 'original', companies: '["original","second"]', args: '{"uomId":"box"}' })

  for (const state of ['completed', 'discarded', 'cancelled'])
    passes({ state, args: '{"productId":"variant"}' })
  passes({ companyId: 'original', companies: '["original"]', args: '{"productId":"variant"}' })
  passes({ companyId: 'original', companies: null, uniqueKey: 'variant:refresh' })
  passes({ args: '{"channelId":"shop","note":"variants"}', uniqueKey: 'shop:submit' })
  passes({ args: 'not json' })

  const many = Array.from({ length: 25 }, (_, index) =>
    job({ id: `job-${String(index).padStart(2, '0')}`, args: '{"productId":"variant"}' }),
  )
  assert.throws(() => assertNoQueuedCatalogueJobs(projection, many), /job-19 and 5 more$/)
})

type CatalogueQueuedJobInput = Parameters<typeof assertNoQueuedCatalogueJobs>[1][number]

test('a deployment settles its projection only when every review is settled, identities hold and queues are drained', () => {
  const { schema, rows } = fixture()
  rows['sale.OrderLine']![0]!.taxEvidence = { taxes: [{ taxId: 'variant', amount: '1' }] }
  rows['sale.OrderLine']![0]!.taxIds = ['variant']
  const projection = projectCatalogueCompanyRows({ schema, rows, identityPlan: identityPlan(schema, rows) })
  assert.ok(projection.operationalIdentities.length, 'the fixture rekeys a cost row')
  const before = structuredClone(projection)
  const settle = (policies: CatalogueOwnerPolicy[], jobs: CatalogueQueuedJobInput[] = []) =>
    settleCatalogueCompanyProjection({ projection, snapshot: rows, policies, jobs })

  const settled = settle([...publicCatalogueOwnerPolicies])
  assert.deepEqual(settled.pendingReviews, [])
  assert.deepEqual(settled.rows, projection.rows)
  assert.deepEqual(projection, before, 'the input projection is not mutated')

  assert.throws(
    () => settle([]),
    /^Error: Unsettled catalogue reviews: sale\.OrderLine\.taxEvidence \(opaque-json\), sale\.OrderLine\.taxIds \(opaque-json\)$/,
  )
  function forgetsCosts(current: CatalogueCompanyProjection) {
    return { ...structuredClone(current), operationalIdentities: [] }
  }
  assert.throws(
    () => settle([forgetsCosts, ...publicCatalogueOwnerPolicies]),
    /changed catalogue identities: forgetsCosts/,
  )
  function raisesReview(current: CatalogueCompanyProjection) {
    const result = structuredClone(current)
    result.pendingReviews.push({
      model: 'sale.Order',
      sourceId: 'order',
      field: 'note',
      reason: 'opaque-json',
    })
    return result
  }
  assert.throws(
    () => settle([...publicCatalogueOwnerPolicies, raisesReview]),
    /raised a review: raisesReview/,
  )
  assert.throws(
    () =>
      settle(
        [...publicCatalogueOwnerPolicies],
        [
          {
            id: 'job',
            job: 'stock.recompute',
            state: 'available',
            args: '{"productId":"variant"}',
            companyId: 'second',
          },
        ],
      ),
    /drain them first: stock\.recompute job$/,
  )

  const crowded = structuredClone(projection)
  crowded.pendingReviews = Array.from({ length: 25 }, (_, index) => ({
    model: 'sale.Order',
    sourceId: 'order',
    field: `field${String(index).padStart(2, '0')}`,
    reason: 'opaque-json' as const,
  }))
  assert.throws(
    () => settleCatalogueCompanyProjection({ projection: crowded, snapshot: rows, policies: [], jobs: [] }),
    /field19 \(opaque-json\) and 5 more$/,
  )
})
