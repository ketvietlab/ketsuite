import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { encodeListState } from '@ketvietlab/ketjs'
import { emptyProductListState } from '../packages/ketsuite/src/modules/product/search.ts'
import { boot, setup } from './fixtures/sale/commerce.ts'

type Run = Awaited<ReturnType<typeof boot>>
async function seed(run: Run) {
  await run.save('product.saveRecord', {
    id: 'item',
    name: 'Item',
    type: 'goods',
    uomId: 'each',
    defaultCode: 'ITEM',
  })
  for (let i = 0; i < 11; i++)
    await run.save('product.saveCombo', {
      id: `choice-${i}`,
      name: `Choice ${i}`,
      items: [{ productId: 'item:default', extraPrice: '0' }],
    })
}
const ids = (count: number) => Array.from({ length: count }, (_, i) => `choice-${i}`)
const combo = (extra: Row = {}) => ({
  id: 'combo',
  name: 'Combo',
  type: 'combo',
  uomId: 'each',
  defaultCode: 'COMBO',
  listPrice: '590000',
  comboIds: ids(1),
  ...extra,
})
const get = (run: Run, id = 'combo') => run.call('product.getTemplate', { id })

test('P45 combo assignment is ordered, bounded, company-scoped and atomic', async (t) => {
  const run = await boot(t)
  await seed(run)
  for (const comboIds of [[], ids(11), ['choice-0', 'choice-0'], ['missing']]) {
    assert.equal((await run.call('product.saveRecord', combo({ comboIds }))).ok, false)
    assert.equal(await get(run), null)
  }
  assert.equal((await run.call('product.saveRecord', combo({ uomId: null }))).ok, false)
  await run.save('product.saveRecord', combo({ comboIds: ids(10).reverse() }))
  let row = await get(run)
  assert.deepEqual(row.comboIds, ids(10).reverse())
  assert.equal(row.categoryId, null)
  assert.equal(row.listPrice, '590000')
  assert.equal((row.variants as Row[]).length, 1)
  const variants = await run.call('product_backend.searchVariants', { type: 'combo' })
  assert.equal(variants.total, 1)
  assert.equal((variants.rows as Row[])[0]?.type, 'combo')
  const href = encodeListState(
    {
      ...emptyProductListState(),
      filters: [{ kind: 'rule', field: 'type', operator: 'equals', value: 'combo' }],
    },
    new URL('http://local/admin/product/templates'),
  )
  const listed = await run.call('product_backend.searchTemplates', { href })
  assert.equal(listed.total, 1)
  assert.equal(
    (
      await run.call(
        'product.saveRecord',
        combo({ expectedRevisionId: row.revisionId, name: 'Bad', comboIds: ids(11) }),
      )
    ).ok,
    false,
  )
  assert.equal((await get(run)).name, 'Combo')
  assert.equal(
    (await run.call('product.saveRecord', combo({ type: 'goods', expectedRevisionId: row.revisionId }))).ok,
    false,
  )
  await run.fixture(
    'product.saveTemplate',
    { id: 'other-item', name: 'Other', type: 'goods', uomId: 'each' },
    'other',
  )
  await run.fixture(
    'product.saveCombo',
    { id: 'foreign', name: 'Foreign', items: [{ productId: 'other-item:default', extraPrice: '0' }] },
    'other',
  )
  assert.equal(
    (
      await run.call(
        'product.saveRecord',
        combo({ expectedRevisionId: row.revisionId, comboIds: ['foreign'] }),
      )
    ).ok,
    false,
  )
  const { comboIds: _choices, ...omitted } = combo({ expectedRevisionId: row.revisionId, name: 'Kept' })
  await run.save('product.saveRecord', omitted)
  row = await get(run)
  assert.deepEqual(row.comboIds, ids(10).reverse())
})

test('P45 combo rejects variants, packaging, stock and ordinary sale workflow', async (t) => {
  const run = await setup(t)
  await seed(run)
  await run.save('product.saveRecord', combo())
  for (const [fn, args] of [
    ['product.configureAttributes', { templateId: 'combo', lines: [] }],
    ['product.saveVariantSetup', { templateId: 'combo', lines: [], variants: [] }],
    ['product.generateVariants', { templateId: 'combo' }],
    ['product.saveVariant', { id: 'manual', templateId: 'combo', defaultCode: 'MANUAL' }],
    ['product.addTemplateUom', { templateId: 'combo', uomId: 'each' }],
    ['product.addProductUom', { productId: 'combo:default', uomId: 'each' }],
    ['stock.configureProduct', { templateId: 'combo', isStorable: true, tracking: 'none' }],
    ['product.setCost', { productId: 'combo:default', standardPrice: '100' }],
  ] as const)
    assert.equal((await run.call(fn, args)).ok, false, fn)
  const row = await get(run)
  assert.equal(
    (await run.call('product.saveRecord', combo({ expectedRevisionId: row.revisionId, isStorable: true })))
      .ok,
    false,
  )
  assert.equal((await get(run)).revisionId, row.revisionId)
  assert.equal((await run.add({ productId: 'combo:default', productUomId: 'each' })).ok, true)
  const policies = (await run.app.client.call<Row[]>('sale.listInvoicePolicies', {})).value
  assert.ok(!policies.some((policy) => policy.id === 'combo'))
  assert.equal(
    (await run.call('sale.setInvoicePolicy', { templateId: 'combo', invoicePolicy: 'order' })).ok,
    false,
  )
  assert.equal(
    (
      await run.call('stock.addMove', {
        id: 'combo-move',
        name: 'Combo move',
        productId: 'combo:default',
        productUomId: 'each',
        productUomQty: '1',
        locationId: 'wh:stock',
        locationDestId: 'wh:output',
      })
    ).ok,
    false,
  )
})

test('P45 combo archive history, restore constraints, copy and deletion preserve choice usage', async (t) => {
  const run = await boot(t)
  await seed(run)
  await run.save('product.saveRecord', combo())
  const choices = async () =>
    (await run.app.client.call<Row[]>('product.listCombos', { includeArchived: true })).value
  let choice = (await choices()).find((row) => row.id === 'choice-0')!
  assert.equal(
    (
      await run.call('product.setComboActive', {
        id: choice.id,
        active: false,
        expectedRevisionId: choice.revisionId,
      })
    ).ok,
    false,
  )
  await run.save('product.duplicateTemplate', { id: 'copy', sourceId: 'combo' })
  assert.deepEqual((await get(run, 'copy')).comboIds, ids(1))
  assert.equal((await choices()).find((row) => row.id === 'choice-0')!.productCount, 2)
  await run.call('product.deleteTemplates', { ids: ['copy'] })
  const { comboIds: _choices, ...sourceCopy } = combo({
    id: 'source-copy',
    defaultCode: 'SOURCECOPY',
    duplicateSourceId: 'combo',
  })
  await run.save('product.saveRecord', sourceCopy)
  assert.deepEqual((await get(run, 'source-copy')).comboIds, ids(1))
  await run.call('product.deleteTemplates', { ids: ['source-copy'] })
  await run.save('product.archiveTemplate', {
    id: 'combo',
    active: false,
    reason: 'No longer offered',
    confirmed: true,
    expectedRevisionId: (await get(run)).revisionId,
  })
  choice = (await choices()).find((row) => row.id === 'choice-0')!
  await run.save('product.setComboActive', {
    id: choice.id,
    active: false,
    expectedRevisionId: choice.revisionId,
  })
  assert.deepEqual((await get(run)).comboIds, ids(1))
  assert.equal(
    (
      await run.call('product.archiveTemplate', {
        id: 'combo',
        active: true,
        confirmed: true,
        expectedRevisionId: (await get(run)).revisionId,
      })
    ).ok,
    false,
  )
  assert.equal((await get(run)).active, false)
  assert.equal((await run.call('product.duplicateTemplate', { id: 'bad-copy', sourceId: 'combo' })).ok, false)
  assert.equal(await get(run, 'bad-copy'), null)
})

test('P45 concurrent choice archive and product assignment have one winner', async (t) => {
  const run = await boot(t)
  await seed(run)
  const choice = (await run.app.client.call<Row[]>('product.listCombos', {})).value.find(
    (row) => row.id === 'choice-0',
  )!
  const results = await Promise.allSettled([
    run.call('product.saveRecord', combo()),
    run.call('product.setComboActive', {
      id: choice.id,
      active: false,
      expectedRevisionId: choice.revisionId,
    }),
  ])
  assert.equal(
    results.filter((result) => result.status === 'fulfilled' && result.value.ok === true).length,
    1,
  )
  for (const result of results)
    if (result.status === 'rejected') assert.equal(result.reason.body.code, 'conflict')
  const product = await get(run)
  const final = (
    await run.app.client.call<Row[]>('product.listCombos', { includeArchived: true })
  ).value.find((row) => row.id === choice.id)!
  assert.ok(!product || final.active === true)
})

test('P45 accountant reads combo choices but cannot forge general assignments', async (t) => {
  const run = await boot(t)
  await seed(run)
  await run.save('product.saveRecord', combo())
  await run.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await run.fixture('user.createUser', {
    id: 'accountant',
    name: 'Accountant',
    login: 'accountant',
    password: 'test-password',
    defaultCompanyId: 'acme',
  })
  await run.fixture('user.grantCompany', {
    id: 'accountant-company',
    userId: 'accountant',
    companyId: 'acme',
  })
  await run.fixture('user.assignRole', {
    id: 'accountant-role',
    userId: 'accountant',
    roleId: 'commerce.accountant',
  })
  const client = run.app.client.anonymous()
  await client.login({ login: 'accountant', password: 'test-password' })
  const row = await get(run)
  const context = (
    await client.call<{ data: { record: Row; combos: Row[] } }>('product.templateModalContext', {
      id: 'combo',
      locale: 'en',
    })
  ).value
  assert.deepEqual(context.data.record.comboIds, ids(1))
  assert.ok(context.data.combos.some((choice) => choice.value === 'choice-0'))
  await assert.rejects(
    () =>
      client.call(
        'product.saveRecord',
        combo({ expectedRevisionId: row.revisionId, comboIds: ['choice-1'] }),
      ),
    { status: 403 },
  )
  assert.deepEqual((await get(run)).comboIds, ids(1))
})
