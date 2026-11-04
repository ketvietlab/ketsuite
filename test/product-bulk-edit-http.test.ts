import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'
type Run = Awaited<ReturnType<typeof boot>>
async function seed(r: Run, ids = ['a', 'b']) {
  for (const id of ids)
    await r.save('product.saveRecord', {
      id,
      name: id,
      type: 'goods',
      uomId: 'each',
      defaultCode: 'P-' + id.toUpperCase(),
      listPrice: '100',
      saleDelay: 3,
      saleOk: true,
      isStorable: true,
    })
}
async function selected(r: Run, ids = ['a', 'b']) {
  return Promise.all(
    ids.map(async (id) => ({
      id,
      revision: String((await r.call('product.getTemplate', { id })).revisionId ?? 'initial'),
    })),
  )
}
test('P55 atomic receipts preserve no-op rows and replay, and history only names changed products', async (t) => {
  const r = await boot(t)
  await seed(r)
  const before = await r.call('product.getTemplate', { id: 'a' })
  const noop = await r.save('product.bulkEditProducts', {
    id: 'noop',
    products: await selected(r),
    field: 'saleDelay',
    value: '03',
  })
  assert.equal(noop.name, 'SUA/0001')
  assert.equal(noop.changedCount, 0)
  assert.deepEqual(await r.call('product.getTemplate', { id: 'a' }), before)
  assert.deepEqual((await r.call('product.listBulkEdits', { templateId: 'a' })).rows, [])
  const args = { id: 'price', products: await selected(r), field: 'listPrice', value: '125.00' }
  const changed = (
    await r.app.client.call<Row>('product.bulkEditProducts', args, { idempotencyKey: 'bulk-price' })
  ).value
  assert.equal(changed.changedCount, 2)
  assert.equal(changed.name, 'SUA/0002')
  assert.equal((await r.save('product.bulkEditProducts', args)).name, 'SUA/0002')
  assert.equal((await r.call('product.bulkEditProducts', { ...args, value: '130' })).ok, false)
  assert.notEqual((await r.call('product.getTemplate', { id: 'a' })).revisionId, before.revisionId)
  const history = (await r.call('product.listBulkEdits', { templateId: 'a' })).rows as Row[]
  assert.equal(history.length, 1)
  assert.equal(history[0]!.name, 'SUA/0002')
  assert.equal(history[0]!.actor, 'owner')
  assert.equal(history[0]!.productCount, 2)
  const samePrice = await r.save('product.bulkEditProducts', {
    id: 'same-price',
    products: await selected(r),
    field: 'listPrice',
    value: '0125.000',
  })
  assert.equal(samePrice.changedCount, 0)
})
test('P55 late refusal rolls back prior saves and numbering; stale revisions refuse the whole batch', async (t) => {
  const r = await boot(t)
  await seed(r)
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await r.save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'count',
    productId: 'b:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '1',
    productUomId: 'each',
  })
  const before = await r.call('product.getTemplate', { id: 'a' })
  const failed = await r.call('product.bulkEditProducts', {
    id: 'bad',
    products: await selected(r),
    field: 'isStorable',
    value: 'false',
  })
  assert.equal(failed.ok, false)
  assert.equal((failed.errors as Row[])[0]!.code, 'product.error.bulk.locked')
  assert.deepEqual(await r.call('product.getTemplate', { id: 'a' }), before)
  const stale = await selected(r)
  const good = await r.save('product.bulkEditProducts', {
    id: 'good',
    products: stale,
    field: 'saleOk',
    value: 'false',
  })
  assert.equal(good.name, 'SUA/0001')
  assert.equal(
    (
      await r.call('product.bulkEditProducts', {
        id: 'stale',
        products: stale,
        field: 'saleOk',
        value: 'true',
      })
    ).ok,
    false,
  )
})
test('P55 shared native writers validate tags, categories, tax and exact prices', async (t) => {
  const r = await boot(t)
  await seed(r)
  await r.save('product.saveTag', { id: 'tag', name: 'Featured' })
  await r.save('product.saveCategory', { id: 'group', name: 'Goods' })
  await r.save('account.saveTax', {
    id: 'vat',
    name: 'VAT10',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  for (const [field, value] of [
    ['addTag', 'tag'],
    ['categoryId', 'group'],
    ['taxId', 'vat'],
    ['listPrice', '9007199254740993'],
  ]) {
    assert.equal(
      (await r.save('product.bulkEditProducts', { id: field, products: await selected(r), field, value }))
        .changedCount,
      2,
    )
    assert.equal(
      (
        await r.save('product.bulkEditProducts', {
          id: field + '-noop',
          products: await selected(r),
          field,
          value,
        })
      ).changedCount,
      0,
    )
  }
  assert.equal(
    (
      await r.save('product.bulkEditProducts', {
        id: 'remove',
        products: await selected(r),
        field: 'removeTag',
        value: 'tag',
      })
    ).changedCount,
    2,
  )
  const bad = await r.call('product.bulkEditProducts', {
    id: 'invalid',
    products: await selected(r),
    field: 'categoryId',
    value: 'missing',
  })
  assert.equal(bad.ok, false)
})
test('P55 bound selection, boolean values and company boundaries are enforced', async (t) => {
  const r = await boot(t)
  await seed(r)
  const products = await selected(r)
  for (const patch of [
    { products: [] },
    { products: [...products, products[0]] },
    { products: Array.from({ length: 201 }, (_, i) => ({ id: String(i), revision: 'initial' })) },
    { field: 'saleOk', value: 'no' },
    { field: 'saleDelay', value: '366' },
    { field: 'listPrice', value: '-1' },
    { field: 'unknown' },
  ]) {
    const result = await r.call('product.bulkEditProducts', {
      id: 'bad',
      products,
      field: 'saleOk',
      value: 'false',
      ...patch,
    })
    assert.equal(result.ok, false)
    if ('products' in patch) assert.equal((result.errors as Row[])[0]!.code, 'product.error.bulk.selection')
  }
  await r.fixture(
    'product.saveRecord',
    { id: 'foreign', name: 'Foreign', type: 'goods', uomId: 'each', defaultCode: 'FOREIGN' },
    'other',
  )
  const result = await r.call('product.bulkEditProducts', {
    id: 'foreign',
    products: [...products, { id: 'foreign', revision: 'initial' }],
    field: 'saleOk',
    value: 'false',
  })
  assert.equal(result.ok, false)
  assert.equal((await r.call('product.getTemplate', { id: 'a' })).saleOk, true)
})
test('P55 field grants are enforced for real Commerce roles and do not block authorized no-ops', async (t) => {
  const r = await boot(t)
  await seed(r)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await r.fixture('user.createUser', {
    id: 'manager',
    login: 'manager',
    password: 'test-password',
    name: 'Manager',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'manager-company', userId: 'manager', companyId: 'acme' })
  await r.fixture('user.assignRole', {
    id: 'manager-role',
    userId: 'manager',
    roleId: 'commerce.sales-manager',
  })
  const client = r.app.client.anonymous()
  await client.login({ login: 'manager', password: 'test-password' })
  const result = (
    await client.call<Row>('product.bulkEditProducts', {
      id: 'permitted',
      products: await selected(r),
      field: 'saleOk',
      value: 'false',
    })
  ).value
  assert.equal(result.ok, true)
  const failed = (
    await client.call<Row>('product.bulkEditProducts', {
      id: 'stock',
      products: await selected(r),
      field: 'isStorable',
      value: 'false',
    })
  ).value
  assert.equal(failed.ok, false)
  assert.equal((failed.errors as Row[])[0]!.code, 'product.error.bulk.permission')
  const noop = (
    await client.call<Row>('product.bulkEditProducts', {
      id: 'stock-noop',
      products: await selected(r),
      field: 'isStorable',
      value: 'true',
    })
  ).value
  assert.equal(noop.ok, true)
  assert.equal(noop.changedCount, 0)
})

test('P55 accepts 200 selections and concurrent replay creates one receipt', async (t) => {
  const r = await boot(t)
  const ids = Array.from({ length: 200 }, (_, i) => `bulk-${i}`)
  await seed(r, ids)
  const products = await selected(r, ids)
  const args = { id: 'maximum', products, field: 'saleDelay', value: '4' }
  const attempts = await Promise.allSettled([
    r.call('product.bulkEditProducts', args),
    r.call('product.bulkEditProducts', args),
  ])
  assert.ok(attempts.some((result) => result.status === 'fulfilled' && result.value.ok === true))
  const replay = await r.save('product.bulkEditProducts', args)
  assert.equal(replay.name, 'SUA/0001')
  assert.equal(replay.productCount, 200)
  assert.equal(replay.changedCount, 200)
  const history = (await r.call('product.listBulkEdits', { templateId: ids[0] })).rows as Row[]
  assert.equal(history.length, 1)
})
