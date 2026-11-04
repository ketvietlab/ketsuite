import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

const empty = () => ({ added: [], updated: [], removed: [], order: null })

/** A line's cost snapshot, without the margin worked out from its current quantity and price. */
const snapshot = (rows: unknown) =>
  (rows as Array<Record<string, unknown>>).map(({ margin: _, ...row }) => row)

test('Commerce captures exact package cost separately from customer order and report data', async (t) => {
  const { call, save, add, productId, app } = await setup(t)
  await save('product.setCost', { productId, standardPrice: '60.123456789123' })
  assert.equal((await add()).ok, true)
  const costs = (await call('sale.getLineCosts', { id: 'order' })) as unknown as Row[]
  assert.equal(costs.length, 1)
  assert.equal(costs[0]!.unitCost, '721.481481469476')
  assert.equal(costs[0]!.currency, 'VND')
  assert.equal(Number(costs[0]!.factor), 12)
  const contextResponse = (await (
    await app.client.get('/admin/sales/record/order/context?lang=en')
  ).json()) as { data: { lineCosts: Row[] } }
  assert.equal(contextResponse.data.lineCosts[0]!.unitName, 'Box of 12')
  assert.equal(contextResponse.data.lineCosts[0]!.currency, 'VND')
  const order = await call('sale.getOrder', { id: 'order' })
  assert.ok(!JSON.stringify(order).includes('unitCost'))
  const report = await call('sale.getQuotationReport', { id: 'order' })
  assert.ok(!JSON.stringify(report).includes('unitCost'))
  await save('product.setCost', { productId, standardPrice: '90' })
  assert.deepEqual(await call('sale.getLineCosts', { id: 'order' }), costs, 'reads never reprice snapshots')
  assert.equal((await add()).ok, true, 'composed writer remains idempotent by line id')
  assert.deepEqual(await call('sale.getLineCosts', { id: 'order' }), costs)
})

test('Commerce costs a line added without a unit in the product unit', async (t) => {
  const { call, save, add, productId } = await setup(t)
  await save('product.setCost', { productId, standardPrice: '60' })
  // The add row may leave the unit empty (C6): the line, and its cost, are then the product's own.
  const added = await add({ productUomId: undefined })
  assert.equal(added.ok, true, JSON.stringify(added))
  const line = ((await call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!
  assert.equal(line.productUomId, 'each')
  const costs = (await call('sale.getLineCosts', { id: 'order' })) as unknown as Row[]
  assert.equal(costs.length, 1)
  assert.equal(costs[0]!.productUomId, 'each')
  assert.equal(Number(costs[0]!.factor), 1)
  assert.equal(Number(costs[0]!.unitCost), 60)
})

test('Commerce distinguishes missing cost from zero and recalculates package cost on line edits', async (t) => {
  const { call, save, add, productId } = await setup(t)
  await add()
  let cost = ((await call('sale.getLineCosts', { id: 'order' })) as unknown as Row[])[0]!
  assert.equal(cost.unitCost, null)
  await save('product.setCost', { productId, standardPrice: '0' })
  let order = await call('sale.getOrder', { id: 'order' })
  await save('sale.updateLine', { id: 'line', expectedRevision: order.revision, productUomQty: '3' })
  cost = ((await call('sale.getLineCosts', { id: 'order' })) as unknown as Row[])[0]!
  assert.equal(Number(cost.unitCost), 0)
  await save('product.setCost', { productId, standardPrice: '25' })
  order = await call('sale.getOrder', { id: 'order' })
  await save('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: order.revision,
    changes: { ...empty(), updated: [{ id: 'line', values: { productUomId: 'each' } }] },
  })
  cost = ((await call('sale.getLineCosts', { id: 'order' })) as unknown as Row[])[0]!
  assert.equal(Number(cost.unitCost), 25)
  assert.equal(cost.productUomId, 'each')
})

test('Commerce failed replacement rolls back snapshots, line values and revision together', async (t) => {
  const { call, save, add, productId } = await setup(t)
  await save('product.setCost', { productId, standardPrice: '60' })
  await add()
  const before = await call('sale.getOrder', { id: 'order' })
  const costs = await call('sale.getLineCosts', { id: 'order' })
  await save('product.setCost', { productId, standardPrice: '70' })
  const failed = await call('sale.saveDraft', {
    id: 'order',
    expectedRevision: before.revision,
    partnerId: 'buyer',
    warehouseId: 'wh',
    lines: [
      { id: 'line', productId, productUomId: 'each', productUomQty: '3' },
      { id: 'bad', productId, productUomId: 'case', productUomQty: '1' },
    ],
  })
  assert.equal(failed.ok, false)
  assert.deepEqual(await call('sale.getLineCosts', { id: 'order' }), costs)
  assert.deepEqual(await call('sale.getOrder', { id: 'order' }), before)
  assert.equal(
    (
      await call('sale.applyLineGrid', {
        id: 'order',
        expectedRevision: before.revision,
        changes: { ...empty(), updated: [{ id: 'line', values: { unitCost: '1' } }] },
      })
    ).ok,
    false,
  )
})

test('Commerce deletes snapshots with removed lines and isolates companies', async (t) => {
  const { call, save, add, fixture, app } = await setup(t)
  await add()
  assert.deepEqual(await fixture('sale.getLineCosts', { id: 'order' }, 'other'), [])
  const broad = await app.fixture.call(
    'sale.getLineCosts',
    { id: 'order' },
    {
      scope: { company: 'other', companies: ['acme', 'other'], branches: null },
    },
  )
  assert.deepEqual(broad.value, [], 'active company stays authoritative even with access to both companies')
  await save('sale.removeLine', { id: 'line' })
  assert.deepEqual(await call('sale.getLineCosts', { id: 'order' }), [])
  assert.equal((await app.adapter!.all('SELECT id FROM sale_order_line_cost')).length, 0)
  await add()
  const order = await call('sale.getOrder', { id: 'order' })
  await save('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: order.revision,
    changes: { ...empty(), removed: ['line'] },
  })
  assert.equal((await app.adapter!.all('SELECT id FROM sale_order_line_cost')).length, 0)
})

test('Commerce preserves a fractional-factor snapshot when source cost becomes unavailable', async (t) => {
  const { app, save, add, call } = await setup(t)
  await save('product.saveRecord', {
    id: 'bundle',
    name: 'Bundle',
    type: 'goods',
    defaultCode: 'BUNDLE',
    uomId: 'box',
    listPrice: '100',
    saleOk: true,
  })
  const variants = (await call('product.listVariants', { templateId: 'bundle' })) as unknown as Row[]
  const productId = variants[0]!.id
  await save('product.addTemplateUom', { templateId: 'bundle', uomId: 'each' })
  await save('product.setCost', { productId, standardPrice: '120' })
  assert.equal((await add({ productId, productUomId: 'each' })).ok, true)
  const costs = await call('sale.getLineCosts', { id: 'order' })
  await app.adapter!.run('DELETE FROM product_cost')
  const order = await call('sale.getOrder', { id: 'order' })
  await save('sale.updateLine', { id: 'line', expectedRevision: order.revision, productUomQty: '3' })
  // The snapshot stays; the margin it gives follows the new quantity (D26).
  assert.deepEqual(snapshot(await call('sale.getLineCosts', { id: 'order' })), snapshot(costs))
})

test('Commerce ordinary order readers cannot fetch costs through the API or modal context', async (t) => {
  const { save, add, app, fixture } = await setup(t)
  await add()
  await save('user.saveRole', { id: 'reader', name: 'Order reader' })
  await save('user.grantFunction', { id: 'reader-order', roleId: 'reader', fnKey: 'sale.getOrder' })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    name: 'Reader',
    password: 'test-password',
    defaultCompanyId: 'acme',
  })
  await save('user.grantCompany', { id: 'reader-acme', userId: 'reader', companyId: 'acme' })
  await save('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'reader' })
  await app.client.login({ login: 'reader', password: 'test-password' })
  await assert.rejects(() => app.client.call('sale.getLineCosts', { id: 'order' }), { status: 403 })
  const response = await app.client.get('/admin/sales/record/order/context?lang=en')
  assert.equal(response.status, 200)
  const context = (await response.json()) as { data: { permissions: Row; lineCosts?: Row[] } }
  assert.equal(context.data.permissions.getLineCosts, false)
  assert.equal(context.data.lineCosts, undefined)
})

test('Commerce concurrent grid saves publish one matching line and cost snapshot', async (t) => {
  const { call, save, add, productId } = await setup(t)
  await save('product.setCost', { productId, standardPrice: '15' })
  await add()
  const order = await call('sale.getOrder', { id: 'order' })
  const results = await Promise.all(
    ['each', 'box'].map((productUomId) =>
      call('sale.applyLineGrid', {
        id: 'order',
        expectedRevision: order.revision,
        changes: { ...empty(), updated: [{ id: 'line', values: { productUomId, productUomQty: 5 } }] },
      }),
    ),
  )
  assert.equal(results.filter((result) => result.ok === true).length, 1)
  const line = ((await call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!
  const costs = (await call('sale.getLineCosts', { id: 'order' })) as unknown as Row[]
  assert.equal(costs.length, 1)
  assert.equal(costs[0]!.productUomId, line.productUomId)
  assert.equal(Number(costs[0]!.unitCost), line.productUomId === 'each' ? 15 : 180)
})

test('Commerce addLine rolls back the line when persisting its cost snapshot fails', async (t) => {
  const { app, add, call } = await setup(t)
  if (process.env.KET_COMMERCE_PG) {
    await app.adapter!.run(
      "CREATE FUNCTION refuse_cost() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cost failed'; END $$",
    )
    await app.adapter!.run(
      'CREATE TRIGGER refuse_cost BEFORE INSERT ON sale_order_line_cost FOR EACH ROW EXECUTE FUNCTION refuse_cost()',
    )
  } else {
    await app.adapter!.run(
      "CREATE TRIGGER refuse_cost BEFORE INSERT ON sale_order_line_cost BEGIN SELECT RAISE(ABORT, 'cost failed'); END",
    )
  }
  await assert.rejects(() => add())
  const order = await call('sale.getOrder', { id: 'order' })
  assert.deepEqual(order.lines, [])
  assert.equal(Number(order.amountTotal), 0)
  assert.deepEqual(await call('sale.getLineCosts', { id: 'order' }), [])
})

test('Commerce retains missing source cost only for the same product, unit, factor and currency', async (t) => {
  const { app, add, save, call, productId } = await setup(t)
  await save('product.setCost', { productId, standardPrice: '60' })
  await add()
  const costs = await call('sale.getLineCosts', { id: 'order' })
  await save('uom.saveUnit', {
    id: 'other-box',
    name: 'Other box',
    relativeUomId: 'each',
    relativeFactor: '12',
  })
  await save('product.addTemplateUom', { templateId: 'goods', uomId: 'other-box' })
  await app.adapter!.run('DELETE FROM product_cost')
  for (const [unit, expected] of [
    ['box', 720],
    ['other-box', null],
    ['each', null],
  ] as const) {
    const order = await call('sale.getOrder', { id: 'order' })
    await save('sale.applyLineGrid', {
      id: 'order',
      expectedRevision: order.revision,
      changes: { ...empty(), updated: [{ id: 'line', values: { productUomId: unit, productUomQty: 4 } }] },
    })
    const after = (await call('sale.getLineCosts', { id: 'order' })) as unknown as Row[]
    if (expected === null) assert.equal(after[0]!.unitCost, null)
    else assert.deepEqual(snapshot(after), snapshot(costs))
  }
})
