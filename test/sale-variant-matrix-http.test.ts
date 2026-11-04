import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, migrateOne, type Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
async function matrix(t: Parameters<typeof setup>[0], dimensions = 2) {
  const r = await setup(t)
  const lines = []
  for (let axis = 0; axis < dimensions; axis++) {
    await r.save('product.saveAttributeDraft', {
      id: 'axis' + axis,
      name: 'Axis ' + axis,
      displayType: 'select',
      createVariant: 'always',
      values: [
        { id: 'a' + axis, name: 'A' + axis },
        { id: 'b' + axis, name: 'B' + axis },
      ],
    })
    lines.push({ attributeId: 'axis' + axis, values: [{ valueId: 'a' + axis }, { valueId: 'b' + axis }] })
  }
  await r.save('product.saveRecord', {
    id: 'matrix',
    name: 'Matrix product',
    defaultCode: 'MATRIX',
    type: 'goods',
    uomId: 'each',
    saleOk: true,
    listPrice: '100',
    saleVariantMode: 'matrix',
  })
  await r.save('product.configureAttributes', { templateId: 'matrix', lines })
  const read = () => r.call('sale.getVariantMatrix', { id: 'order', templateId: 'matrix' })
  const write = async (quantities: Row[], overrides: Row = {}) => {
    const current = await read()
    return r.call('sale.setVariantMatrix', {
      id: 'order',
      templateId: 'matrix',
      expectedRevision: (current.order as Row).revision,
      matrixRevision: current.matrixRevision,
      quantities,
      ...overrides,
    })
  }
  return { ...r, read, write }
}
test('D28 mode is explicit, legacy defaults to inline and matrices preserve configured axes', async (t) => {
  const r = await matrix(t)
  const menu = await r.call('sale.listVariantMatrices', { id: 'order' })
  assert.deepEqual(menu, [{ id: 'matrix', name: 'Matrix product' }])
  const read = await r.read()
  assert.equal((read.axes as Row[]).length, 2)
  assert.equal((read.rows as Row[]).length, 4)
  assert.ok((read.rows as Row[]).every((row) => row.price === '100' && row.quantity === '0'))
  assert.equal((await r.call('product.getTemplate', { id: 'goods' })).saleVariantMode, null)
  assert.equal(await r.call('sale.getVariantMatrix', { id: 'order', templateId: 'goods' }), null)
  assert.equal(
    (
      await r.call('product.saveRecord', {
        id: 'invalid',
        name: 'Invalid',
        type: 'goods',
        uomId: 'each',
        saleVariantMode: 'unknown',
      })
    ).ok,
    false,
  )
})
test('D28 batches update first SKU lines, blank removes and omitted cells remain untouched', async (t) => {
  const r = await matrix(t)
  const rows = (await r.read()).rows as Row[]
  assert.equal(
    (
      await r.write([
        { productId: rows[0]!.id, quantity: '2' },
        { productId: rows[1]!.id, quantity: '3' },
      ])
    ).ok,
    true,
  )
  await r.save('sale.addLine', {
    id: 'duplicate',
    orderId: 'order',
    productId: rows[0]!.id,
    productUomId: 'each',
    productUomQty: '9',
    priceUnit: '75',
    sequence: 9999,
  })
  assert.equal((await r.write([{ productId: rows[0]!.id, quantity: '4' }])).ok, true)
  let order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal((order.lines as Row[]).find((line) => line.id === 'duplicate')!.productUomQty, '9')
  assert.equal((order.lines as Row[]).find((line) => line.productId === rows[1]!.id)!.productUomQty, '3')
  assert.equal((await r.write([{ productId: rows[1]!.id, quantity: '' }])).ok, true)
  order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(
    (order.lines as Row[]).some((line) => line.productId === rows[1]!.id),
    false,
  )
  assert.equal((order.lines as Row[]).length, 2)
})
test('D28 malformed, stale, unavailable and simultaneous batches are refused atomically', async (t) => {
  const r = await matrix(t)
  const current = await r.read(),
    rows = current.rows as Row[]
  const before = await r.call('sale.getOrder', { id: 'order' })
  for (const quantities of [
    [
      { productId: rows[0]!.id, quantity: '2' },
      { productId: 'missing', quantity: '3' },
    ],
    [{ productId: rows[0]!.id, quantity: '-1' }],
    [
      { productId: rows[0]!.id, quantity: '2' },
      { productId: rows[0]!.id, quantity: '3' },
    ],
  ]) {
    assert.equal((await r.write(quantities)).ok, false)
    assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  }
  assert.equal(
    (await r.write([{ productId: rows[0]!.id, quantity: '2' }], { matrixRevision: 'stale' })).ok,
    false,
  )
  const refusal = await r.write([{ productId: rows[0]!.id, quantity: '-1' }])
  assert.equal((refusal.errors as Row[])[0]!.messageKey, 'sale.error.quantityPositive')
  assert.equal((refusal.errors as Row[])[0]!.message, undefined)
  const writes = await Promise.allSettled(
    ['2', '3'].map((quantity) =>
      r.write([{ productId: rows[0]!.id, quantity }], { expectedRevision: before.revision }),
    ),
  )
  assert.equal(writes.filter((result) => result.status === 'fulfilled' && result.value.ok === true).length, 1)
})
test('D28 a later historical cell rolls back the preceding successful quantity edit', async (t) => {
  const r = await matrix(t)
  const rows = (await r.read()).rows as Row[]
  await r.write([
    { productId: rows[0]!.id, quantity: '2' },
    { productId: rows[1]!.id, quantity: '3' },
  ])
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.app.adapter!.run(
    `UPDATE sale_order_line SET "qtyInvoiced" = '2' WHERE "productId" = ${r.app.adapter!.name === 'postgres' ? '$1' : '?'}`,
    [rows[1]!.id],
  )
  const before = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(
    (
      await r.write([
        { productId: rows[0]!.id, quantity: '4' },
        { productId: rows[1]!.id, quantity: '1' },
      ])
    ).ok,
    false,
  )
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
})

test('D28 one and three axes preserve every SKU and inactive combinations stay unavailable', async (t) => {
  for (const dimensions of [1, 3])
    await t.test(String(dimensions), async (t) => {
      const r = await matrix(t, dimensions)
      const initial = await r.read()
      assert.equal((initial.axes as Row[]).length, dimensions)
      assert.equal((initial.rows as Row[]).length, 2 ** dimensions)
      const removed = (initial.rows as Row[])[0]!
      await r.app.adapter!.run(
        `UPDATE product_product SET active = FALSE WHERE id = ${r.app.adapter!.name === 'postgres' ? '$1' : '?'}`,
        [removed.id],
      )
      const updated = await r.read()
      if (dimensions === 1) {
        assert.equal(updated, null)
        assert.deepEqual(await r.call('sale.listVariantMatrices', { id: 'order' }), [])
      } else {
        assert.equal((updated.rows as Row[]).length, 7)
        assert.notEqual(updated.matrixRevision, initial.matrixRevision)
        assert.equal(
          (
            await r.write([{ productId: (updated.rows as Row[])[0]!.id, quantity: '2' }], {
              matrixRevision: initial.matrixRevision,
            })
          ).ok,
          false,
        )
      }
      assert.equal(Array.isArray((await r.call('sale.getOrder', { id: 'order' })).lines), true)
      assert.equal(((await r.call('sale.getOrder', { id: 'order' })).lines as Row[]).length, 0)
    })
})

test('D28 preparation saves parent drafts only for an eligible selected template', async (t) => {
  const r = await matrix(t)
  await r.add({ priceUnit: '100' })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const input = {
    id: 'order',
    expectedRevision: before.revision,
    shippingPolicy: 'one',
    changes: {
      added: [],
      updated: [{ id: 'line', values: { productUomQty: '5' } }],
      removed: [],
      order: null,
    },
  }
  assert.equal((await r.call('sale.saveCatalogueDraft', { ...input, templateId: 'goods' })).ok, false)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
  const saved = await r.call('sale.saveCatalogueDraft', { ...input, templateId: 'matrix' })
  assert.equal(saved.ok, true)
  assert.equal(saved.templateId, 'matrix')
  const after = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(after.shippingPolicy, 'one')
  assert.equal((after.lines as Row[])[0]!.productUomQty, '5')
})

test('D28 reader context is read-only, writes are forbidden and company scope is enforced', async (t) => {
  const r = await matrix(t)
  await r.fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'read-role', name: 'Reader' })
  for (const fnKey of ['sale.getVariantMatrix', 'sale.listVariantMatrices'])
    await r.fixture('user.grantFunction', { id: fnKey, roleId: 'read-role', fnKey })
  await r.fixture('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'read-role' })
  const reader = r.app.client.anonymous()
  await reader.login({ login: 'reader', password: 'test-password' })
  const page = await reader.get('/admin/sales/variant-matrix/matrix/context?matrixOrderId=order&lang=en')
  assert.equal(page.status, 200)
  const context = (await page.json()) as { data: { save: boolean; orderHref: string } }
  assert.equal(context.data.save, false)
  assert.equal(context.data.orderHref, '/admin/sales/quotations/order?lang=en')
  await assert.rejects(
    () =>
      reader.call('sale.setVariantMatrix', {
        id: 'order',
        templateId: 'matrix',
        expectedRevision: 0,
        matrixRevision: 'x',
        quantities: [],
      }),
    (error: unknown) => (error as { status: number }).status === 403,
  )
  assert.equal((await reader.get('/admin/sales/variant-matrix/matrix/context')).status, 404)
  const foreign = await r.app.fixture.call(
    'sale.getVariantMatrix',
    { id: 'order', templateId: 'matrix' },
    { scope: { company: 'other', companies: ['acme', 'other'], branches: null } },
  )
  assert.equal(foreign.value, null)
})

test('D28 locked, cancelled and external orders reject batches without changing lines', async (t) => {
  const r = await matrix(t)
  const row = ((await r.read()).rows as Row[])[0]!
  for (const state of [
    'locked = TRUE',
    "locked = FALSE, state = 'cancel'",
    "state = 'draft', \"orderAuthority\" = 'external'",
  ]) {
    await r.app.adapter!.run(`UPDATE sale_order SET ${state} WHERE id = 'order'`)
    const before = await r.call('sale.getOrder', { id: 'order' })
    assert.equal((await r.write([{ productId: row.id, quantity: '3' }])).ok, false)
    assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
    const response = await r.app.client.get('/admin/sales/variant-matrix/matrix/context?matrixOrderId=order')
    assert.equal(((await response.json()) as { data: { save: boolean } }).data.save, false)
  }
})

test('D28 nullable mode migration preserves legacy products and replays without enabling matrices', async (t) => {
  const r = await setup(t)
  const legacy = r.deployment.modules.map((module) => {
    if (typeof module === 'string' || module.name !== 'product') return module
    const template = module.models!.Template!
    const { saleVariantMode: _mode, ...fields } = template.fields
    return { ...module, models: { ...module.models, Template: { ...template, fields } } }
  })
  await migrateOne(r.app.adapter!, compose(legacy, { headless: true, companies: true }), {
    allowDestructive: true,
  })
  const before = await r.app.adapter!.all('SELECT * FROM product_template')
  const target = compose(r.deployment.modules, { headless: true, companies: true })
  await migrateOne(r.app.adapter!, target)
  const after = await r.app.adapter!.all('SELECT * FROM product_template')
  assert.ok(after.every((row) => row.saleVariantMode === null))
  assert.deepEqual(
    after.map(({ saleVariantMode: _mode, ...row }) => row),
    before.map((row) => ({ ...row })),
  )
  assert.deepEqual(await migrateOne(r.app.adapter!, target), [])
  assert.deepEqual(await r.call('sale.listVariantMatrices', { id: 'order' }), [])
})

test('D28 mode changes require catalogue permission, duplicates preserve mode and combos refuse matrices', async (t) => {
  const r = await matrix(t)
  await r.save('product.duplicateTemplate', { id: 'copy', sourceId: 'matrix' })
  assert.equal((await r.call('product.getTemplate', { id: 'copy' })).saleVariantMode, 'matrix')
  assert.equal(
    (
      await r.call('product.saveRecord', {
        id: 'combo',
        name: 'Combo',
        type: 'combo',
        uomId: 'each',
        saleVariantMode: 'matrix',
      })
    ).ok,
    false,
  )
  await r.fixture('user.createUser', {
    id: 'limited',
    login: 'limited',
    password: 'test-password',
    name: 'Limited',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'limited-company', userId: 'limited', companyId: 'acme' })
  await r.fixture('user.saveRole', { id: 'limited-role', name: 'Limited' })
  await r.fixture('user.assignRole', { id: 'limited-assignment', userId: 'limited', roleId: 'limited-role' })
  await r.fixture('user.grantFunction', {
    id: 'save-record',
    roleId: 'limited-role',
    fnKey: 'product.saveRecord',
  })
  const client = r.app.client.anonymous()
  await client.login({ login: 'limited', password: 'test-password' })
  const before = await r.call('product.getTemplate', { id: 'matrix' })
  const input = {
    id: 'matrix',
    type: 'goods',
    name: 'Matrix product',
    uomId: 'each',
    saleVariantMode: 'inline',
    expectedRevisionId: before.revisionId,
  }
  await assert.rejects(() => client.call('product.saveRecord', input), { status: 403 })
  assert.deepEqual(await r.call('product.getTemplate', { id: 'matrix' }), before)
  await r.fixture('user.grantFunction', {
    id: 'save-template',
    roleId: 'limited-role',
    fnKey: 'product.saveTemplate',
  })
  assert.equal((await client.call<Row>('product.saveRecord', input)).value.ok, true)
  assert.equal((await r.call('product.getTemplate', { id: 'matrix' })).saleVariantMode, 'inline')
  assert.equal(
    ((await r.call('sale.listVariantMatrices', { id: 'order' })) as unknown as Row[]).some(
      (row) => row.id === 'matrix',
    ),
    false,
  )
})
