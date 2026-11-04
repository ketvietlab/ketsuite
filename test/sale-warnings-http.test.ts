import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, migrateOne, schemaFromManifest, type Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('D32 warnings are off by default and enabling them preserves existing configuration callers', async (t) => {
  const r = await setup(t)
  assert.equal((await r.call('sale.getConfiguration', {})).saleWarnings, false)
  assert.equal(
    (
      await r.call('sale.savePartnerWarning', {
        partnerId: 'buyer',
        message: 'Call first',
        expectedRevision: 0,
      })
    ).ok,
    false,
  )
  await r.save('sale.saveConfiguration', { requireProduct: false, saleWarnings: true, expectedRevision: 0 })
  await r.save('sale.saveConfiguration', { requireProduct: true, expectedRevision: 1 })
  assert.equal((await r.call('sale.getConfiguration', {})).saleWarnings, true)
  await r.save('sale.savePartnerWarning', { partnerId: 'buyer', message: 'Call first', expectedRevision: 0 })
  await r.add({ productUomId: 'each' })
  assert.equal(
    ((await r.call('sale.getOrder', { id: 'order' })).saleWarnings as Row[])[0]!.message,
    'Call first',
  )
})

test('D32 warning projection is advisory, customer first and deduplicated by product template', async (t) => {
  const r = await setup(t)
  await r.save('sale.saveConfiguration', { requireProduct: false, saleWarnings: true, expectedRevision: 0 })
  await r.save('sale.savePartnerWarning', {
    partnerId: 'buyer',
    message: 'Call reception',
    expectedRevision: 0,
  })
  const context = await r.call('product.templateModalContext', { id: 'goods', locale: 'en' })
  await r.save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    uomId: 'each',
    saleWarning: 'Keep cool',
    expectedRevisionId: ((context.data as Row).record as Row).revisionId,
  })
  await r.add({ productUomId: 'each' })
  await r.add({ id: 'second', productUomId: 'each' })
  const order = await r.call('sale.getOrder', { id: 'order' })
  assert.deepEqual(
    (order.saleWarnings as Row[]).map((row) => [row.kind, row.message]),
    [
      ['partner', 'Call reception'],
      ['product', 'Keep cool'],
    ],
  )
  await r.save('sale.confirmOrder', { id: 'order', expectedRevision: order.revision })
  assert.equal((await r.call('sale.getOrder', { id: 'order' })).state, 'sale')
  await r.save('sale.cancelOrder', { id: 'order' })
  assert.deepEqual((await r.call('sale.getOrder', { id: 'order' })).saleWarnings, [])
})

async function enable(r: Awaited<ReturnType<typeof setup>>) {
  await r.save('sale.saveConfiguration', { requireProduct: false, saleWarnings: true, expectedRevision: 0 })
}
async function productWarning(r: Awaited<ReturnType<typeof setup>>, message: string) {
  const context = await r.call('product.templateModalContext', { id: 'goods', locale: 'en' })
  return r.call('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    uomId: 'each',
    saleWarning: message,
    expectedRevisionId: ((context.data as Row).record as Row).revisionId,
  })
}
test('D32 customer warning length, clearing, no-op and stale revisions protect stored content', async (t) => {
  const r = await setup(t)
  await enable(r)
  assert.equal(
    (
      await r.call('sale.savePartnerWarning', {
        partnerId: 'buyer',
        message: 'x'.repeat(301),
        expectedRevision: 0,
      })
    ).ok,
    false,
  )
  assert.equal(
    (await r.call('sale.savePartnerWarning', { partnerId: 'missing', message: 'Hello', expectedRevision: 0 }))
      .ok,
    false,
  )
  const input = { partnerId: 'buyer', message: 'x'.repeat(300), expectedRevision: 0 }
  assert.equal((await r.save('sale.savePartnerWarning', input)).revision, 1)
  assert.equal((await r.save('sale.savePartnerWarning', { ...input, expectedRevision: 1 })).revision, 1)
  assert.equal((await r.call('sale.savePartnerWarning', { ...input, message: 'Lost update' })).ok, false)
  assert.equal((await r.call('sale.getPartnerWarning', { partnerId: 'buyer' })).message, input.message)
  await r.save('sale.savePartnerWarning', { partnerId: 'buyer', message: '  ', expectedRevision: 1 })
  assert.equal((await r.call('sale.getPartnerWarning', { partnerId: 'buyer' })).revision, 2)
  assert.deepEqual(
    (await r.call('sale.previewWarnings', { partnerId: 'buyer', productIds: [] })).warnings,
    [],
  )
})
test('D32 concurrent customer editors accept exactly one revision', async (t) => {
  const r = await setup(t)
  await enable(r)
  const results = await Promise.all(
    ['One', 'Two'].map((message) =>
      r.call('sale.savePartnerWarning', { partnerId: 'buyer', message, expectedRevision: 0 }),
    ),
  )
  assert.equal(results.filter((row) => row.ok !== false).length, 1)
  assert.equal(results.filter((row) => row.ok === false).length, 1)
  const saved = await r.call('sale.getPartnerWarning', { partnerId: 'buyer' })
  assert.equal(saved.revision, 1)
  assert.ok(['One', 'Two'].includes(String(saved.message)))
})
test('D32 warnings and settings isolate companies while the contact is shared', async (t) => {
  const r = await setup(t)
  await enable(r)
  await r.save('sale.savePartnerWarning', { partnerId: 'buyer', message: 'Acme only', expectedRevision: 0 })
  await productWarning(r, 'Acme product')
  assert.equal((await r.fixture('sale.getWarningSettings', {}, 'other')).enabled, false)
  await r.fixture(
    'sale.saveConfiguration',
    { requireProduct: false, saleWarnings: true, expectedRevision: 0 },
    'other',
  )
  assert.equal((await r.fixture('sale.getPartnerWarning', { partnerId: 'buyer' }, 'other')).message, '')
  await r.fixture(
    'sale.savePartnerWarning',
    { partnerId: 'buyer', message: 'Other only', expectedRevision: 0 },
    'other',
  )
  assert.equal((await r.call('sale.getPartnerWarning', { partnerId: 'buyer' })).message, 'Acme only')
  const preview = await r.fixture(
    'sale.previewWarnings',
    { partnerId: 'buyer', productIds: [r.productId] },
    'other',
  )
  assert.deepEqual(
    (preview.warnings as Row[]).map((w) => w.message),
    ['Other only'],
  )
})
test('D32 switching warnings off hides them without deleting saved notes', async (t) => {
  const r = await setup(t)
  await enable(r)
  await r.save('sale.savePartnerWarning', { partnerId: 'buyer', message: 'Keep this', expectedRevision: 0 })
  await productWarning(r, 'Keep product warning')
  await r.add({ productUomId: 'each' })
  await r.save('sale.saveConfiguration', { requireProduct: false, saleWarnings: false, expectedRevision: 1 })
  assert.deepEqual((await r.call('sale.getOrder', { id: 'order' })).saleWarnings, [])
  assert.equal((await r.call('sale.getPartnerWarning', { partnerId: 'buyer' })).message, '')
  assert.equal(
    (
      await r.call('sale.savePartnerWarning', {
        partnerId: 'buyer',
        message: 'Replace while off',
        expectedRevision: 1,
      })
    ).ok,
    false,
  )
  await r.save('sale.saveConfiguration', { requireProduct: false, saleWarnings: true, expectedRevision: 2 })
  assert.deepEqual(
    ((await r.call('sale.getOrder', { id: 'order' })).saleWarnings as Row[]).map((w) => w.message),
    ['Keep this', 'Keep product warning'],
  )
})
test('D32 product warning length and omitted-field saves preserve catalogue content', async (t) => {
  const r = await setup(t)
  await enable(r)
  assert.equal((await productWarning(r, 'x'.repeat(301))).ok, false)
  assert.notEqual((await productWarning(r, 'x'.repeat(300))).ok, false)
  const context = await r.call('product.templateModalContext', { id: 'goods', locale: 'en' })
  await r.save('product.saveRecord', {
    id: 'goods',
    name: 'Goods renamed',
    type: 'goods',
    uomId: 'each',
    expectedRevisionId: ((context.data as Row).record as Row).revisionId,
  })
  const preview = await r.call('sale.previewWarnings', { productIds: [r.productId, r.productId] })
  assert.deepEqual(
    (preview.warnings as Row[]).map((w) => [w.name, String(w.message).length]),
    [['Goods renamed', 300]],
  )
  assert.notEqual((await productWarning(r, '')).ok, false)
  assert.deepEqual((await r.call('sale.previewWarnings', { productIds: [r.productId] })).warnings, [])
})
test('D32 gift product warnings participate in the same template deduplication', async (t) => {
  const r = await setup(t)
  await enable(r)
  await productWarning(r, 'Gift advisory')
  await r.save('loyalty_sale.saveProgram', {
    values: { name: 'Gift', programType: 'buy_x_get_y', minimumQuantity: '1', rewardProductId: r.productId },
  })
  await r.add({ productUomId: 'each', productUomQty: '2' })
  const order = await r.call('sale.getOrder', { id: 'order' })
  assert.ok((order.lines as Row[]).some((line) => line.lineKind === 'reward'))
  assert.deepEqual(
    (order.saleWarnings as Row[]).map((w) => w.message),
    ['Gift advisory'],
  )
})
test('D32 read-only warning access cannot save customer notes and denied previews return 403', async (t) => {
  const r = await setup(t)
  await enable(r)
  await r.fixture('user.createUser', {
    id: 'viewer',
    login: 'viewer',
    password: 'test-password',
    name: 'Viewer',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'viewer-company', userId: 'viewer', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'viewer-role', name: 'Viewer' })
  await r.fixture('user.assignRole', { id: 'viewer-link', userId: 'viewer', roleId: 'viewer-role' })
  await r.fixture('user.grantFunction', {
    id: 'warning-read',
    roleId: 'viewer-role',
    fnKey: 'sale.getPartnerWarning',
  })
  const viewer = r.app.client.anonymous()
  await viewer.login({ login: 'viewer', password: 'test-password' })
  const context = await viewer.get('/admin/sales/customers/buyer/warning?company=acme&lang=en')
  assert.equal(context.status, 200)
  assert.equal(((await context.json()) as { data: Row }).data.save, false)
  await assert.rejects(
    viewer.call('sale.savePartnerWarning', { partnerId: 'buyer', message: 'Forbidden', expectedRevision: 0 }),
    (e: unknown) => (e as { status: number }).status === 403,
  )
  assert.equal(
    (await viewer.get('/admin/sales/warnings/preview?selection=%7B%22productIds%22%3A%5B%5D%7D')).status,
    403,
  )
})
test('D32 existing Commerce schemas add nullable warning fields and the company note table', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each' })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const manifest = compose(r.deployment.modules, { headless: true, companies: true }),
    legacy = schemaFromManifest(manifest),
    adapter = r.app.adapter!
  delete legacy.tables.sale_partner_warning
  await adapter.exec('DROP TABLE sale_partner_warning')
  for (const [table, field] of [
    ['product_template', 'saleWarning'],
    ['sale_configuration', 'saleWarnings'],
  ]) {
    delete legacy.tables[table!]!.columns[field!]
    await adapter.exec(`ALTER TABLE ${table} DROP COLUMN "${field}"`)
  }
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(legacy)],
  )
  const changes = await migrateOne(adapter, manifest)
  assert.equal(
    changes.filter((change) => change.op === 'CREATE_TABLE' && change.table === 'sale_partner_warning')
      .length,
    1,
  )
  assert.equal(changes.filter((change) => change.op === 'ADD_COLUMN').length, 2)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  assert.deepEqual(await migrateOne(adapter, manifest), [])
  await enable(r)
  await productWarning(r, 'Migrated product')
  await r.save('sale.savePartnerWarning', {
    partnerId: 'buyer',
    message: 'Migrated customer',
    expectedRevision: 0,
  })
})

test('D32 distinct variants share one warning and keep first-selection order', async (t) => {
  const r = await setup(t)
  await enable(r)
  await r.save('product.saveAttributeDraft', {
    id: 'size',
    name: 'Size',
    displayType: 'select',
    createVariant: 'always',
    values: [
      { id: 'small', name: 'Small' },
      { id: 'large', name: 'Large' },
    ],
  })
  await r.save('product.saveRecord', {
    id: 'variants',
    name: 'Variants',
    defaultCode: 'VARIANTS',
    type: 'goods',
    uomId: 'each',
    listPrice: '20',
    saleWarning: 'Shared variant note',
  })
  await r.save('product.configureAttributes', {
    templateId: 'variants',
    lines: [{ attributeId: 'size', values: [{ valueId: 'small' }, { valueId: 'large' }] }],
  })
  await productWarning(r, 'Other product note')
  const variants = (await r.call('product.listVariants', { templateId: 'variants' })) as unknown as Row[]
  assert.equal(variants.length, 2)
  const result = await r.call('sale.previewWarnings', {
    productIds: [variants[1]!.id, r.productId, variants[0]!.id],
  })
  assert.deepEqual(
    (result.warnings as Row[]).map((w) => w.message),
    ['Shared variant note', 'Other product note'],
  )
})
test('D32 Commerce job templates grant customer editing only to the intended roles', async (t) => {
  const r = await setup(t)
  await enable(r)
  await r.app.fixture.call(
    'user.syncRoleTemplates',
    {},
    { actor: 'system:role-templates', scope: { company: 'acme', branches: null } },
  )
  let revision = 0
  for (const [role, editable] of [
    ['company-administrator', true],
    ['sales-representative', true],
    ['sales-manager', true],
    ['tenant-auditor', false],
  ] as const) {
    await r.fixture('user.createUser', {
      id: role,
      login: role,
      name: role,
      password: 'test-password',
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: role + '-company', userId: role, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: role + '-role', userId: role, roleId: 'commerce.' + role })
    const client = r.app.client.anonymous()
    await client.login({ login: role, password: 'test-password' })
    assert.equal((await client.call<{ enabled: boolean }>('sale.getWarningSettings', {})).value.enabled, true)
    const response = await client.get('/admin/sales/customers/buyer/warning?lang=en&company=acme')
    assert.equal(response.status, 200)
    assert.equal(((await response.json()) as { data: Row }).data.save, editable)
    if (editable) {
      const result = await client.call<Row>('sale.savePartnerWarning', {
        partnerId: 'buyer',
        message: role,
        expectedRevision: revision,
      })
      assert.notEqual(result.value.ok, false)
      revision++
    } else
      await assert.rejects(
        client.call('sale.savePartnerWarning', {
          partnerId: 'buyer',
          message: role,
          expectedRevision: revision,
        }),
        (e: unknown) => (e as { status: number }).status === 403,
      )
    if (role === 'company-administrator') {
      await assert.rejects(
        client.call('sale.getOrder', { id: 'order' }),
        (e: unknown) => (e as { status: number }).status === 403,
      )
      const context = await client.get('/admin/product/templates/goods/context?lang=en&company=acme')
      assert.equal(context.status, 200)
      assert.equal(((await context.json()) as { data: Row }).data.saleWarningsOn, true)
    }
  }
})
