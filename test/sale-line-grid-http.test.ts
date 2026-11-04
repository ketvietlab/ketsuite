import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
const blank = () => ({ added: [], updated: [], removed: [], order: null })

test('Commerce line grid saves a mixed patch atomically with exact negotiated prices and tax fields', async (t) => {
  const { call, add, save, productId } = await setup(t)
  await save('account.saveTax', {
    id: 'vat10',
    name: 'VAT 10%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await add({ priceUnit: '1100', discount: '10', taxIds: ['vat10'] })
  const before = await call('sale.getOrder', { id: 'order' })
  const result = await call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: before.revision,
    changes: {
      added: [
        {
          id: 'local-new',
          index: 1,
          values: {
            productId,
            productUomId: 'each',
            productUomQty: 3,
            priceUnit: '12345678901234567890',
            discount: 0,
          },
        },
      ],
      updated: [{ id: 'line', values: { productUomQty: 4 } }],
      removed: [],
      order: ['local-new', 'line'],
    },
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  const after = await call('sale.getOrder', { id: 'order' })
  const lines = (after.lines as Row[]).sort((a, b) => Number(a.sequence) - Number(b.sequence))
  assert.equal(lines[0]!.priceUnit, '12345678901234567890')
  assert.notEqual(lines[0]!.id, 'local-new', 'temporary client ids never become tenant primary keys')
  assert.equal(lines[1]!.id, 'line')
  assert.equal(lines[1]!.priceUnit, '1100')
  assert.equal(Number(lines[1]!.discount), 10)
  assert.equal(Number(lines[1]!.productUomQty), 4)
  assert.deepEqual(lines[1]!.taxIds, ['vat10'])
  assert.equal(Number(lines[1]!.priceSubtotal), 3960)
  assert.equal(Number(lines[1]!.priceSubtotalIncl), 4356)
  const replay = await call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: before.revision,
    changes: blank(),
  })
  assert.equal(replay.ok, false)
})

test('Commerce line grid rolls back invalid units, foreign line ids and forged money fields', async (t) => {
  const { call, add, productId } = await setup(t)
  await add({ priceUnit: '1100' })
  const before = await call('sale.getOrder', { id: 'order' })
  for (const changes of [
    {
      ...blank(),
      updated: [{ id: 'line', values: { productUomQty: 9 } }],
      added: [{ id: 'bad', index: 1, values: { productId, productUomId: 'case', productUomQty: 1 } }],
    },
    { ...blank(), updated: [{ id: 'line', values: { productUomQty: -1 } }] },
    { ...blank(), removed: ['foreign-line'] },
    { ...blank(), updated: [{ id: 'line', values: { priceSubtotal: '1' } }] },
    { ...blank(), updated: [{ id: 'line', values: { priceUnit: { value: 1 } } }] },
    { ...blank(), order: ['line', 'line'] },
  ]) {
    const result = await call('sale.applyLineGrid', {
      id: 'order',
      expectedRevision: before.revision,
      changes,
    })
    assert.equal(result.ok, false, JSON.stringify(changes))
    assert.deepEqual(await call('sale.getOrder', { id: 'order' }), before)
  }
})

test('Commerce line grid reprices a changed unit, clears all lines and preserves no-op revisions', async (t) => {
  const { call, add } = await setup(t)
  await add({ priceUnit: '1100' })
  let before = await call('sale.getOrder', { id: 'order' })
  let result = await call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: before.revision,
    changes: blank(),
  })
  assert.equal(result.revision, before.revision)
  result = await call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: before.revision,
    changes: { ...blank(), updated: [{ id: 'line', values: { productUomId: 'each' } }] },
  })
  assert.equal(result.ok, true)
  before = await call('sale.getOrder', { id: 'order' })
  assert.equal((before.lines as Row[])[0]!.priceUnit, '100')
  assert.equal(
    (
      await call('sale.applyLineGrid', {
        id: 'order',
        expectedRevision: before.revision,
        changes: { ...blank(), removed: ['line'] },
      })
    ).ok,
    true,
  )
  const after = await call('sale.getOrder', { id: 'order' })
  assert.deepEqual(after.lines, [])
  assert.equal(Number(after.amountTotal), 0)
})

test('Commerce concurrent grid patches allow one revision winner, a confirmed order too', async (t) => {
  const { call, add, save } = await setup(t)
  await add()
  const before = await call('sale.getOrder', { id: 'order' })
  const results = await Promise.all(
    [3, 4].map((qty) =>
      call('sale.applyLineGrid', {
        id: 'order',
        expectedRevision: before.revision,
        changes: { ...blank(), updated: [{ id: 'line', values: { productUomQty: qty } }] },
      }),
    ),
  )
  assert.equal(results.filter((result) => result.ok === true).length, 1)
  await save('sale.confirmOrder', { id: 'order' })
  const confirmed = await call('sale.getOrder', { id: 'order' })
  // A confirmed order removes a line not yet delivered (D33b), once: the second save is stale.
  const removals = await Promise.all(
    [0, 1].map(() =>
      call('sale.applyLineGrid', {
        id: 'order',
        expectedRevision: confirmed.revision,
        changes: { ...blank(), removed: ['line'] },
      }),
    ),
  )
  assert.equal(removals.filter((result) => result.ok === true).length, 1)
  assert.deepEqual((await call('sale.getOrder', { id: 'order' })).lines, [])
})

test('Commerce line grid requires quote permission and cannot edit a sibling company order', async (t) => {
  const { app, fixture, add, call } = await setup(t)
  await add()
  const before = await call('sale.getOrder', { id: 'order' })
  await fixture('user.createUser', {
    id: 'viewer',
    login: 'viewer',
    password: 'viewer-test-password',
    name: 'Viewer',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'viewer-company', userId: 'viewer', companyId: 'acme' })
  const viewer = app.client.anonymous()
  await viewer.login({ login: 'viewer', password: 'viewer-test-password' })
  const args = { id: 'order', expectedRevision: before.revision, changes: { ...blank(), removed: ['line'] } }
  await assert.rejects(
    () => viewer.call('sale.applyLineGrid', args),
    (error: unknown) => {
      assert.equal((error as { status: number }).status, 403)
      return true
    },
  )
  const foreign = await app.fixture.call('sale.applyLineGrid', args, {
    scope: { company: 'other', branches: null },
  })
  assert.equal((foreign.value as Row).ok, false)
  assert.deepEqual(await call('sale.getOrder', { id: 'order' }), before)
})

test('Commerce line grid preserves historical delivery references after a quotation is reopened', async (t) => {
  const { call, add, save, app } = await setup(t)
  await add()
  await save('sale.confirmOrder', { id: 'order' })
  // Model a reopened quotation without severing its pre-existing stock references.
  await app.adapter!.run("UPDATE sale_order SET state = 'draft' WHERE id = 'order'")
  const before = await call('sale.getOrder', { id: 'order' })
  const result = await call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: before.revision,
    changes: { ...blank(), removed: ['line'] },
  })
  assert.equal(result.ok, false)
  assert.equal((result.errors as Row[])[0]!.code, 'sale.error.historyGridStructure')
  assert.deepEqual(await call('sale.getOrder', { id: 'order' }), before)
  assert.equal((await app.adapter!.all(`SELECT id FROM stock_move WHERE "saleLineId" = 'line'`)).length, 1)
})

test('Commerce saveDraft retains its product-unit-quantity contract when sharing the grid writer', async (t) => {
  const { call, productId } = await setup(t)
  const before = await call('sale.getOrder', { id: 'order' })
  const result = await call('sale.saveDraft', {
    id: 'order',
    expectedRevision: before.revision,
    partnerId: 'buyer',
    warehouseId: 'wh',
    lines: [
      {
        id: 'line',
        productId,
        productUomId: 'box',
        productUomQty: '1',
        priceUnit: { forged: true },
        discount: 99,
        taxIds: ['not-a-tax'],
        name: 'forged label',
      },
    ],
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  const line = ((await call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!
  assert.equal(line.priceUnit, '1200')
  assert.equal(Number(line.discount), 0)
  assert.deepEqual(line.taxIds, [])
  assert.equal(line.name, 'Goods')
})

test('Commerce line grid sells a product line left without a unit in the product unit, as the add row does', async (t) => {
  const { call, productId } = await setup(t)
  const before = await call('sale.getOrder', { id: 'order' })
  const result = await call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: before.revision,
    changes: {
      ...blank(),
      added: [
        {
          id: 'local',
          index: 0,
          values: { productId, productUomId: null, productUomQty: 2, priceAutomatic: true },
        },
      ],
    },
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  const line = ((await call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!
  assert.equal(line.productUomId, 'each')
  assert.equal(Number(line.productUomQty), 2)
})
