import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'
import type {
  CategoryAnswer,
  CategoryModalData,
} from '../packages/ketsuite/src/modules/product_backend/categories/shared.ts'

test('P39 category read returns full paths, inherited accounts and descendant counts with bounded pages', async (t) => {
  const { save, call, app, fixture } = await boot(t)
  await save('account.saveAccount', { id: 'income', code: '511', name: 'Sales', accountType: 'income' })
  await save('product.saveCategory', { id: 'root', name: 'Hàng hóa' })
  await save('product.saveCategory', { id: 'child', name: 'Thiết bị', parentId: 'root' })
  await save('account.saveCategoryAccount', { categoryId: 'root', incomeAccountId: 'income' })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    categoryId: 'child',
  })
  await fixture('product.saveCategory', { id: 'foreign', name: 'Secret' }, 'other')
  const result = (
    await app.client.call<CategoryAnswer>('product_backend.searchCategories', {
      href: '/admin/product/categories?q=hang&page=99',
      pageSize: 1,
    })
  ).value
  assert.equal(result.total, 2)
  assert.equal(result.page, 2)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0]!.path, 'Hàng hóa / Thiết bị')
  assert.equal(result.rows[0]!.productCount, 1)
  assert.equal(result.rows[0]!.income, '511 · Sales')
  assert.ok(!result.rows.some((row) => row.id === 'foreign'))
  const context = (await call('product_backend.categoryContext', { id: 'child', locale: 'en' }))
    .data as CategoryModalData
  assert.equal(context.inherited.income, '511 · Sales')
  assert.equal(context.canArchive, false)
  assert.ok(!context.parents.some((row) => row.value === 'child'))
})

test('P39 record save rolls back general changes when accounting refuses and rejects stale snapshots', async (t) => {
  const { save, call } = await boot(t)
  await save('account.saveAccount', { id: 'income', code: '511', name: 'Sales', accountType: 'income' })
  await save('product.saveCategory', { id: 'root', name: 'Root' })
  const context = async () =>
    (await call('product_backend.categoryContext', { id: 'root' })).data as CategoryModalData
  const first = await context()
  const refused = await call('product.saveCategoryRecord', {
    id: 'root',
    name: 'Changed',
    incomeAccountId: 'missing',
    expectedRevision: first.record.revision,
  })
  assert.equal(refused.ok, false)
  assert.equal((await context()).record.name, 'Root')
  await save('product.saveCategoryRecord', {
    id: 'root',
    name: 'Changed',
    incomeAccountId: 'income',
    expectedRevision: first.record.revision,
  })
  const stale = await call('product.saveCategoryRecord', {
    id: 'root',
    name: 'Stale',
    expectedRevision: first.record.revision,
  })
  assert.equal(stale.ok, false)
  assert.equal((stale.errors as Row[])[0]!.code, 'product.error.category.conflict')
  assert.equal((await context()).record.incomeAccountId, 'income')
  const create = await call('product.saveCategoryRecord', {
    id: 'rollback',
    name: 'New',
    incomeAccountId: 'missing',
  })
  assert.equal(create.ok, false)
  assert.equal(await call('product_backend.categoryContext', { id: 'rollback' }), null)
})

test('P39 accountant can change accounts but forged general fields return 403 without partial saves', async (t) => {
  const { save, call, fixture, app } = await boot(t)
  await save('account.saveAccount', { id: 'income', code: '511', name: 'Sales', accountType: 'income' })
  await save('product.saveCategory', { id: 'root', name: 'Root' })
  assert.equal(
    (await app.fixture.call<Row>('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })).value.ok,
    true,
  )
  await fixture('user.createUser', {
    id: 'accountant',
    login: 'accountant',
    password: 'test-password',
    name: 'Accountant',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'accountant-company', userId: 'accountant', companyId: 'acme' })
  await fixture('user.assignRole', {
    id: 'accountant-grant',
    userId: 'accountant',
    roleId: 'commerce.accountant',
  })
  const client = app.client.anonymous()
  await client.login({ login: 'accountant', password: 'test-password' })
  const context = (
    await client.call<{ data: CategoryModalData }>('product_backend.categoryContext', { id: 'root' })
  ).value.data
  assert.deepEqual(context.permissions, { general: false, accounts: true, lifecycle: false })
  await assert.rejects(
    () =>
      client.call('product.saveCategoryRecord', {
        id: 'root',
        name: 'Forged',
        incomeAccountId: 'income',
        expectedRevision: context.record.revision,
      }),
    { status: 403 },
  )
  assert.equal(
    ((await call('product_backend.categoryContext', { id: 'root' })).data as CategoryModalData).record
      .incomeAccountId,
    '',
  )
  assert.equal(
    (
      await client.call<Row>('product.saveCategoryRecord', {
        id: 'root',
        incomeAccountId: 'income',
        expectedRevision: context.record.revision,
      })
    ).value.ok,
    true,
  )
  await assert.rejects(() => client.call('product.setCategoryActive', { id: 'root', active: false }), {
    status: 403,
  })
  assert.equal((await client.call('product_backend.categoryContext', {})).value, null)
})

test('P39 shipped manager and sales roles respect category field groups and inactive account choices', async (t) => {
  const { save, call, app, fixture } = await boot(t)
  await save('product.saveCategory', { id: 'root', name: 'Root' })
  await save('account.saveAccount', {
    id: 'inactive',
    code: '512',
    name: 'Closed',
    accountType: 'income',
    active: false,
  })
  await save('account.saveAccount', { id: 'income', code: '511', name: 'Sales', accountType: 'income' })
  assert.equal(
    (await app.fixture.call<Row>('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })).value.ok,
    true,
  )
  for (const [id, roleId, permissions] of [
    ['manager', 'commerce.sales-manager', { general: true, accounts: true, lifecycle: true }],
    ['reader', 'commerce.sales-representative', { general: false, accounts: false, lifecycle: false }],
  ] as const) {
    await fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId })
    const client = app.client.anonymous()
    await client.login({ login: id, password: 'test-password' })
    const context = (
      await client.call<{ data: CategoryModalData }>('product_backend.categoryContext', { id: 'root' })
    ).value.data
    assert.deepEqual(context.permissions, permissions)
    assert.ok(!context.incomeAccounts.some((row) => row.value === 'inactive'))
    if (id === 'manager') {
      const refused = (
        await client.call<Row>('product.saveCategoryRecord', {
          id: 'root',
          name: 'Should roll back',
          incomeAccountId: 'inactive',
          expectedRevision: context.record.revision,
        })
      ).value
      assert.equal(refused.ok, false)
      assert.equal(
        ((await call('product_backend.categoryContext', { id: 'root' })).data as CategoryModalData).record
          .name,
        'Root',
      )
      await client.call('product.saveCategoryRecord', {
        id: 'root',
        name: 'Manager edited',
        incomeAccountId: 'income',
        expectedRevision: context.record.revision,
      })
      await assert.rejects(
        () =>
          client.call('account.saveAccount', {
            id: 'forged',
            code: '999',
            name: 'Forged',
            accountType: 'income',
          }),
        { status: 403 },
      )
    } else {
      await assert.rejects(
        () =>
          client.call('product.saveCategoryRecord', {
            id: 'root',
            name: 'Forged',
            expectedRevision: context.record.revision,
          }),
        { status: 403 },
      )
      assert.equal((await client.call('product_backend.categoryContext', {})).value, null)
    }
  }
})
