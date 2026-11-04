import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'
import { matchesProductUse } from '../packages/ketsuite/src/modules/product/use-filter.ts'
const templates = 'product.templates',
  variants = 'product.variants'
const filters = (r: Awaited<ReturnType<typeof boot>>) => r.call('product_backend.searchTemplates', {})
const rows = (answer: Row) => answer.favorites as Row[]
const draft = {
  listKey: templates,
  name: 'Bán được',
  shared: false,
  state: { presets: ['sale'], page: 99, pageSize: 1, selected: ['secret'], record: 'product.template:x' },
}
async function reader(r: Awaited<ReturnType<typeof boot>>, id: string, company = 'acme') {
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await r.fixture('user.createUser', {
    id,
    login: id,
    password: 'test-password',
    name: id,
    defaultCompanyId: company,
  })
  await r.fixture('user.grantCompany', { id: id + '-company', userId: id, companyId: company })
  await r.fixture('user.assignRole', { id: id + '-role', userId: id, roleId: 'commerce.warehouse-operator' })
  const client = r.app.client.anonymous()
  await client.login({ login: id, password: 'test-password' })
  return client
}
test('P56 product and SKU use filters follow parent flags and explicit lot tracking', async (t) => {
  const r = await boot(t)
  for (const [id, saleOk, purchaseOk] of [
    ['sell', true, false],
    ['buy', false, true],
    ['lot', true, true],
  ] as const)
    await r.save('product.saveRecord', {
      id,
      name: id,
      type: 'goods',
      uomId: 'each',
      defaultCode: id.toUpperCase(),
      saleOk,
      purchaseOk,
      isStorable: true,
    })
  await r.save('stock.configureProduct', { templateId: 'lot', isStorable: true, tracking: 'lot' })
  for (const [use, expected] of [
    ['sale', ['lot', 'sell']],
    ['purchase', ['buy', 'lot']],
    ['notSold', ['buy']],
    ['tracked', ['lot']],
  ] as const) {
    const product = await r.call('stock_backend.searchProductTemplates', {
      href: `/admin/product/templates?preset=${use}`,
    })
    assert.deepEqual((product.rows as Row[]).map((x) => x.id).sort(), [...expected].sort())
    const sku = await r.call('stock_backend.searchProductVariants', { use })
    assert.deepEqual((sku.rows as Row[]).map((x) => x.templateId).sort(), [...expected].sort())
  }
  assert.equal(matchesProductUse({}, 'sale'), true)
  assert.equal(matchesProductUse({ purchaseOk: null }, 'purchase'), true)
  assert.equal(matchesProductUse({ isStorable: true }, 'tracked'), false)
})
test('P56 saved filters whitelist state, separate lists, match current state and round-trip URLs', async (t) => {
  const r = await boot(t)
  assert.equal(
    (
      await r.app.client.call<Row>(
        'product_backend.saveFilter',
        { id: 'sale', ...draft },
        { idempotencyKey: 'filter-sale' },
      )
    ).value.ok,
    true,
  )
  const current = await r.call('product_backend.searchTemplates', {
    href: '/admin/product/templates?preset=sale&page=2&record=product.savedFilter:new',
  })
  const entry = rows(current)[0]!
  assert.equal(entry.active, true)
  assert.equal(entry.owned, true)
  assert.equal(entry.shared, false)
  assert.doesNotMatch(String(entry.href), /page=|record=|selected=/)
  const context = await r.call('product_backend.filterContext', { id: 'sale', listKey: templates })
  const state = (context.data as Row).state as Row
  for (const key of ['page', 'pageSize', 'selected', 'record', 'favoriteId'])
    assert.equal(state[key], undefined, key)
  await r.save('product_backend.saveFilter', {
    id: 'sku',
    ...draft,
    listKey: variants,
    state: {
      use: 'tracked',
      categoryId: 'group',
      tagId: 'tag',
      q: ' abc ',
      sort: 'code',
      dir: 'desc',
      page: 9,
    },
  })
  assert.deepEqual(
    rows(await filters(r)).map((x) => x.id),
    ['sale'],
  )
  const sku = await r.call('product_backend.searchVariants', {
    use: 'tracked',
    categoryId: 'group',
    tagId: 'tag',
    q: 'abc',
    sort: 'code',
    dir: 'desc',
  })
  assert.deepEqual(
    rows(sku).map((x) => x.id),
    ['sku'],
  )
  assert.equal(rows(sku)[0]!.active, true)
  assert.match(String(rows(sku)[0]!.href), /category=group/)
  assert.match(String(rows(sku)[0]!.href), /tag=tag/)
  const fresh = await r.call('product_backend.filterContext', {
    id: 'new',
    listKey: variants,
    href: rows(sku)[0]!.href,
  })
  assert.equal(((fresh.data as Row).state as Row).categoryId, 'group')
})
test('P56 catalogue reader saves own filters; sharing stays company-bound and others cannot mutate', async (t) => {
  const r = await boot(t),
    client = await reader(r, 'reader'),
    outsider = await reader(r, 'outside', 'other')
  await r.save('product_backend.saveFilter', { id: 'private', ...draft })
  await r.save('product_backend.saveFilter', { id: 'shared', ...draft, name: 'Shared', shared: true })
  const read = async () => (await client.call<Row>('product_backend.searchTemplates', {})).value
  assert.deepEqual(
    rows(await read()).map((x) => x.id),
    ['shared'],
  )
  const shared = rows(await read())[0]!
  assert.equal(shared.owned, false)
  assert.equal(
    (await client.call('product_backend.filterContext', { id: 'shared', listKey: templates })).value,
    null,
  )
  for (const [fn, args] of [
    ['product_backend.saveFilter', { ...draft, id: 'shared', expectedRevisionId: shared.revisionId }],
    [
      'product_backend.deleteFilter',
      { id: 'shared', listKey: templates, expectedRevisionId: shared.revisionId },
    ],
  ] as const) {
    const refusal = (await client.call<Row>(fn, args)).value
    assert.equal(refusal.ok, false)
    assert.equal((refusal.errors as Row[])[0]?.code, 'backend.error.savedSearch.owner')
  }
  assert.equal(
    (await client.call<Row>('product_backend.saveFilter', { id: 'reader-filter', ...draft })).value.ok,
    true,
  )
  assert.deepEqual(rows((await outsider.call<Row>('product_backend.searchTemplates', {})).value), [])
  assert.equal(
    rows(await filters(r)).some((x) => x.id === 'reader-filter'),
    false,
  )
  const applied = (
    await client.call<Row>('product_backend.applySearchFilter', {
      listKey: templates,
      favoriteId: 'shared',
      returnTo: '/admin/product/templates',
    })
  ).value
  assert.match(String(applied.href), /preset=sale/)
})
test('P56 names, owner revisions, deletion and name reuse cannot bypass legacy writers', async (t) => {
  const r = await boot(t)
  await r.save('product_backend.saveFilter', { id: 'one', ...draft })
  for (const name of ['  BÁN ĐƯỢC  ', 'x'.repeat(61), '   '])
    assert.equal((await r.call('product_backend.saveFilter', { id: 'duplicate', ...draft, name })).ok, false)
  const entry = rows(await filters(r))[0]!
  assert.equal(
    (await r.call('product_backend.saveFilter', { id: 'one', ...draft, name: 'Changed' })).ok,
    false,
  )
  await r.save('product_backend.saveFilter', {
    id: 'one',
    ...draft,
    name: 'Changed',
    shared: true,
    expectedRevisionId: entry.revisionId,
  })
  assert.equal(
    (
      await r.call('product_backend.deleteFilter', {
        id: 'one',
        listKey: templates,
        expectedRevisionId: entry.revisionId,
      })
    ).ok,
    false,
  )
  const updated = rows(await filters(r))[0]!
  await r.save('product_backend.deleteFilter', {
    id: 'one',
    listKey: templates,
    expectedRevisionId: updated.revisionId,
  })
  await r.save('product_backend.saveFilter', { id: 'two', ...draft, name: 'Changed' })
  const legacy = await r.app.fixture.call<Row>(
    'backend.saveSavedSearch',
    { id: 'legacy', listKey: templates, state: draft.state, name: 'CHANGED' },
    { actor: 'owner', scope: { company: 'acme' } },
  )
  assert.equal(legacy.value.ok, false)
  assert.equal(rows(await filters(r)).length, 1)
})
test('P56 concurrent names and stale edits have one winner; default replacement remains compatible', async (t) => {
  const r = await boot(t)
  const results = await Promise.all(
    ['a', 'b'].map((id) => r.call('product_backend.saveFilter', { id, ...draft })),
  )
  assert.equal(results.filter((x) => x.ok).length, 1)
  const first = rows(await filters(r))[0]!
  const updates = await Promise.all(
    ['First', 'Second'].map((name) =>
      r.call('product_backend.saveFilter', {
        id: first.id,
        ...draft,
        name,
        expectedRevisionId: first.revisionId,
      }),
    ),
  )
  assert.equal(updates.filter((x) => x.ok).length, 1)
  await r.save('product_backend.saveFilter', { id: 'default-a', ...draft, name: 'Default A', default: true })
  await r.save('product_backend.saveFilter', { id: 'default-b', ...draft, name: 'Default B', default: true })
  assert.deepEqual(
    rows(await filters(r))
      .filter((x) => x.isDefault)
      .map((x) => x.id),
    ['default-b'],
  )
})

test('P56 same owner cannot edit or delete another company filter through either entry point', async (t) => {
  const r = await boot(t)
  const foreign = (
    await r.app.fixture.call<Row>(
      'product_backend.saveFilter',
      { id: 'foreign', ...draft, shared: true },
      { actor: 'owner', scope: { company: 'other' } },
    )
  ).value
  assert.equal(foreign.ok, true)
  assert.deepEqual(rows(await filters(r)), [])
  assert.equal(
    (await r.call('product_backend.saveFilter', { id: 'foreign', ...draft, expectedRevisionId: 'initial' }))
      .ok,
    false,
  )
  const legacy = (
    await r.app.fixture.call<Row>(
      'backend.archiveSavedSearch',
      { id: 'foreign', listKey: templates },
      { actor: 'owner', scope: { company: 'acme' } },
    )
  ).value
  assert.equal(legacy.ok, false)
})
