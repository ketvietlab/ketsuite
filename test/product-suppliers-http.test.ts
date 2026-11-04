import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

async function seed(t: TestContext) {
  const r = await boot(t)
  for (const id of ['goods', 'other-product'])
    await r.save('product.saveRecord', {
      id,
      name: id,
      type: 'goods',
      uomId: 'each',
      defaultCode: id.toUpperCase(),
      purchaseOk: true,
    })
  await r.save('partner.savePartner', { id: 'vendor', name: 'Đông Á', kind: 'company' })
  await r.save('partner.grantRole', { id: 'vendor-role', partnerId: 'vendor', role: 'supplier' })
  await r.save('partner.savePartner', { id: 'contact', name: 'A contact', kind: 'company' })
  const context = () => r.call('purchase.getProductSuppliers', { templateId: 'goods' })
  const grid = async (changes: Row, expectedRevision?: unknown) =>
    r.call('purchase.applyProductSupplierGrid', {
      templateId: 'goods',
      expectedRevision: expectedRevision ?? (await context()).revision,
      changes: { added: [], updated: [], removed: [], order: null, ...changes },
    })
  const add = (id: string, index = 0, values: Row = {}) => ({
    id,
    index,
    values: {
      partnerId: 'vendor',
      productId: '',
      productCode: 'SUP',
      minQty: '100',
      price: '18000',
      delay: 5,
      ...values,
    },
  })
  return { ...r, context, grid, add }
}

test('P48 supplier grid adds, reorders, updates and removes atomically with no-op revisions', async (t) => {
  const r = await seed(t)
  assert.equal(
    (await r.grid({ added: [r.add('a'), r.add('b', 1, { minQty: '500', price: '17200', delay: 10 })] })).ok,
    true,
  )
  const initial = await r.context(),
    rows = initial.rows as Row[]
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map((row) => row.price),
    ['18000', '17200'],
  )
  assert.equal((await r.grid({})).revision, initial.revision)
  assert.equal(
    (await r.grid({ updated: [{ id: rows[0]!.id, values: { price: '18000' } }] })).revision,
    initial.revision,
  )
  assert.equal((await r.grid({ order: [rows[1]!.id, rows[0]!.id] })).ok, true)
  assert.deepEqual(
    ((await r.context()).rows as Row[]).map((row) => row.price),
    ['17200', '18000'],
  )
  const held = await r.context()
  assert.equal(
    (await r.grid({ updated: [{ id: rows[0]!.id, values: { delay: 366 } }], removed: [rows[1]!.id] })).ok,
    false,
  )
  assert.deepEqual(await r.context(), held)
  for (const values of [
    { minQty: '-1' },
    { price: '-1' },
    { productCode: 'x'.repeat(41) },
    { productId: 'other-product:default' },
    { companyId: 'other' },
  ]) {
    assert.equal((await r.grid({ updated: [{ id: rows[0]!.id, values }] })).ok, false)
    assert.deepEqual(await r.context(), held)
  }
  assert.equal((await r.grid({ removed: [rows[0]!.id] })).ok, true)
  assert.equal(((await r.context()).rows as Row[]).length, 1)
})

test('P48 supplier cap and revision serialize grid and legacy supplier writes', async (t) => {
  const r = await seed(t)
  assert.equal(
    (await r.grid({ added: Array.from({ length: 21 }, (_, i) => r.add(`row-${i}`, i)) })).ok,
    false,
  )
  assert.equal(((await r.context()).rows as Row[]).length, 0)
  assert.equal((await r.grid({ added: Array.from({ length: 19 }, (_, i) => r.add(`row-${i}`, i)) })).ok, true)
  const revision = (await r.context()).revision
  const results = await Promise.all([
    r.grid({ added: [r.add('grid-last', 19)] }, revision),
    r.call('purchase.saveSupplierInfo', {
      id: 'legacy-last',
      partnerId: 'vendor',
      productTemplateId: 'goods',
      productUomId: 'each',
      price: '80',
    }),
  ])
  assert.equal(results.filter((row) => row.ok === true).length, 1)
  assert.equal(((await r.context()).rows as Row[]).length, 20)
  const row = ((await r.context()).rows as Row[])[0]!
  const current = await r.context()
  const race = await Promise.all([
    r.grid({ updated: [{ id: row.id, values: { delay: 2 } }] }, current.revision),
    r.grid({ updated: [{ id: row.id, values: { delay: 3 } }] }, current.revision),
  ])
  assert.equal(race.filter((value) => value.ok === true).length, 1)
})

test('P48 legacy supplier units and hidden fields survive untouched grid saves', async (t) => {
  const r = await seed(t)
  await r.save('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'each', relativeFactor: '12' })
  await r.save('purchase.saveSupplierInfo', {
    id: 'legacy',
    partnerId: 'vendor',
    productTemplateId: 'goods',
    productUomId: 'box',
    minQty: '2',
    price: '100',
    discount: '5',
    productName: 'Negotiated name',
    dateEnd: '2027-01-01T00:00:00.000Z',
    sequence: 10,
  })
  const initial = await r.context(),
    row = (initial.rows as Row[])[0]!
  assert.equal(row.minQty, '24')
  const raw = () => r.app.adapter!.all('SELECT * FROM purchase_supplier_info')
  const before = await raw()
  assert.equal(
    (await r.grid({ updated: [{ id: row.id, values: { price: row.price, minQty: row.minQty } }] })).revision,
    initial.revision,
  )
  assert.deepEqual(await raw(), before)
  assert.equal((await r.grid({ updated: [{ id: row.id, values: { price: '10', minQty: '36' } }] })).ok, true)
  const changed = (await raw())[0]!
  assert.equal(changed.price, '120')
  assert.equal(changed.minQty, '3')
  assert.equal(changed.productUomId, 'box')
  assert.equal(changed.discount, '5')
  assert.equal(changed.productName, 'Negotiated name')
})

test('P48 supplier ownership, inactive product and non-purchasable product refuse changes', async (t) => {
  const r = await seed(t)
  await r.save('purchase.saveSupplierInfo', {
    id: 'other-row',
    partnerId: 'vendor',
    productTemplateId: 'other-product',
    productUomId: 'each',
    price: '80',
  })
  assert.equal((await r.grid({ updated: [{ id: 'other-row', values: { price: '1' } }] })).ok, false)
  const product = await r.call('product.getTemplate', { id: 'goods' })
  await r.save('product.archiveTemplate', {
    id: 'goods',
    active: false,
    expectedRevisionId: product.revisionId ?? 'initial',
    confirmed: true,
    reason: 'Test archive',
  })
  assert.equal((await r.grid({ added: [r.add('blocked')] })).ok, false)
  const foreign = await r.fixture(
    'purchase.applyProductSupplierGrid',
    {
      templateId: 'goods',
      expectedRevision: 'foreign',
      changes: { added: [], updated: [], removed: [], order: null },
    },
    'other',
  )
  assert.equal(foreign.ok, false)
  assert.equal(((await r.context()).rows as Row[]).length, 0)
})

test('P48 real Commerce roles gate supplier edits and redact costs independently', async (t) => {
  const r = await seed(t)
  await r.grid({ added: [r.add('a')] })
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  for (const [id, role] of [
    ['manager', 'sales-manager'],
    ['warehouse', 'warehouse-manager'],
    ['reader', 'warehouse-operator'],
  ]) {
    await r.fixture('user.createUser', {
      id,
      login: id,
      name: id,
      password: 'test-password',
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId: `commerce.${role}` })
    await r.app.client.login({ login: id, password: 'test-password' })
    const context = await r.context(),
      row = (context.rows as Row[])[0]!
    if (id === 'reader') {
      assert.equal(context.editable, false)
      assert.equal(context.money, false)
      assert.equal(row.price, null)
      await assert.rejects(
        () => r.grid({ updated: [{ id: row.id, values: { delay: 3 } }] }),
        (error: { status?: number }) => error.status === 403,
      )
    } else {
      assert.equal(context.editable, true)
      assert.equal(row.price, '18000')
      assert.equal((await r.grid({ updated: [{ id: row.id, values: { delay: 3 } }] })).ok, true)
    }
  }
  // A custom catalogue writer without money access can edit metadata but cannot forge a price.
  await r.fixture('user.saveRole', { id: 'metadata', name: 'Metadata editor' })
  for (const fnKey of ['purchase.getProductSuppliers', 'purchase.applyProductSupplierGrid'])
    await r.fixture('user.grantFunction', { id: `metadata:${fnKey}`, roleId: 'metadata', fnKey })
  await r.fixture('user.assignRole', { id: 'metadata-reader', userId: 'reader', roleId: 'metadata' })
  await r.app.client.login({ login: 'reader', password: 'test-password' })
  const row = ((await r.context()).rows as Row[])[0]!
  await assert.rejects(
    () => r.grid({ updated: [{ id: row.id, values: { price: '1' } }] }),
    (error: { status?: number }) => error.status === 403,
  )
  assert.equal((await r.grid({ updated: [{ id: row.id, values: { delay: 8 } }] })).ok, true)
  await r.app.client.login({ login: 'owner', password: 'test-password' })
  assert.equal(((await r.context()).rows as Row[])[0]!.price, '18000')
  const partners = (await r.call('purchase.listSupplierPartners', {})) as unknown as Row[]
  assert.equal(partners[0]!.id, 'vendor')
  assert.equal(
    ((await r.call('purchase.listSupplierPartners', { search: 'dong a' })) as unknown as Row[])[0]!.id,
    'vendor',
  )
})

test('P48 duplicate omits suppliers and non-purchasable/combo records reject grid writes', async (t) => {
  const r = await seed(t)
  await r.grid({ added: [r.add('a', 0, { price: '9007199254740993' })] })
  assert.equal(((await r.context()).rows as Row[])[0]!.price, '9007199254740993')
  await r.save('product.duplicateTemplate', { id: 'copy', sourceId: 'goods' })
  const copy = await r.call('purchase.getProductSuppliers', { templateId: 'copy' })
  assert.deepEqual(copy.rows, [])
  await r.save('product.saveRecord', {
    id: 'not-buyable',
    name: 'Not buyable',
    type: 'goods',
    defaultCode: 'NOTBUY',
    uomId: 'each',
    purchaseOk: false,
  })
  await r.save('product.saveCombo', {
    id: 'choice',
    name: 'Choice',
    items: [{ productId: 'goods:default', extraPrice: '0' }],
  })
  await r.save('product.saveRecord', {
    id: 'combo',
    name: 'Combo',
    type: 'combo',
    defaultCode: 'COMBO',
    uomId: 'each',
    comboIds: ['choice'],
  })
  for (const templateId of ['not-buyable', 'combo']) {
    const view = await r.call('purchase.getProductSuppliers', { templateId })
    assert.equal(view.editable, false)
    const result = await r.call('purchase.applyProductSupplierGrid', {
      templateId,
      expectedRevision: view.revision,
      changes: { added: [r.add('blocked')], updated: [], removed: [], order: null },
    })
    assert.equal(result.ok, false)
    assert.deepEqual((await r.call('purchase.getProductSuppliers', { templateId })).rows, [])
  }
})
