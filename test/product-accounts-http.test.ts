import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, schemaFromManifest, sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'
import { seedAccountingTestFixture } from './accounting-test-fixture.ts'
import { legacyModules } from './fixtures/legacy-modules.ts'

async function boot(t: TestContext) {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const fixture = async (fn: string, input: Row, company = 'acme') =>
    (await app.fixture.call<Row>(fn, input, { scope: { company, branches: null } })).value
  for (const id of ['acme', 'other']) {
    await fixture('partner.savePartner', { id: `${id}-party`, kind: 'company', name: id })
    await fixture('company.saveCompany', { id, partnerId: `${id}-party`, currency: 'VND' })
  }
  await seedAccountingTestFixture((fn, input) => fixture(fn, input))
  await fixture('account.saveAccount', {
    id: 'inventory',
    code: 'INV',
    name: 'Goods purchases',
    accountType: 'asset_current',
  })
  await fixture('account.saveDefaults', {
    incomeAccountId: 'core-revenue',
    expenseAccountId: 'core-expense',
    goodsPurchaseAccountId: 'inventory',
    servicePurchaseAccountId: 'core-expense',
    receivableAccountId: 'core-receivable',
    payableAccountId: 'core-payable',
  })
  await fixture('partner.savePartner', { id: 'customer', name: 'Customer', kind: 'company' })
  for (const id of ['owner', 'editor']) {
    await fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
      superuser: id === 'owner',
    })
    await fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
  }
  await app.client.login({ login: 'owner', password: 'test-password' })
  const call = async <T = Row>(fn: string, input: Row = {}) => (await app.client.call<T>(fn, input)).value
  const save = async (fn: string, input: Row) => {
    const row = await call(fn, input)
    assert.equal(row.ok, true, JSON.stringify(row))
    return row
  }
  const create = (id: string, type = 'goods', extra: Row = {}) =>
    save('product.saveRecord', { id, type, name: id, defaultCode: id.toUpperCase(), ...extra })
  const preview = (id: string, moveType = 'in_invoice') =>
    call('account.previewAccounts', { productId: `${id}:default`, moveType })
  const post = async (
    id: string,
    productId: string,
    moveType: string,
    accountId: string,
    explicit?: string,
  ) => {
    await save('account.createInvoice', {
      id,
      journalId: moveType === 'in_invoice' ? 'core-purchases' : 'core-sales',
      moveType,
      partnerId: 'customer',
      invoiceDate: '2026-10-20T00:00:00.000Z',
      description: 'Product line',
      productId: `${productId}:default`,
      quantity: '2',
      priceUnit: '100',
      ...(explicit ? { lineAccountId: explicit } : {}),
    })
    await save('account.postMove', { id })
    const detail = await call('account.getMove', { id })
    const lines = detail.lines as Row[]
    assert.equal(lines.find((row) => row.productId === `${productId}:default`)?.accountId, accountId)
    assert.equal(
      lines.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0),
      0,
    )
    return id
  }
  return { app, deployment, fixture, call, save, create, preview, post }
}

test('Commerce posts goods and services to typed company defaults without storing product overrides', async (t) => {
  const { app, call, save, create, preview, post } = await boot(t)
  await create('goods')
  await create('service', 'service')
  assert.equal((await preview('goods')).lineAccountId, 'inventory')
  assert.equal((await preview('service')).lineAccountId, 'core-expense')
  assert.equal((await preview('goods', 'out_invoice')).lineAccountId, 'core-revenue')
  assert.equal((await app.adapter!.all('SELECT * FROM account_product_account')).length, 0)
  await post('goods-bill', 'goods', 'in_invoice', 'inventory')
  await post('service-bill', 'service', 'in_invoice', 'core-expense')
  await post('goods-sale', 'goods', 'out_invoice', 'core-revenue')
  // Older defaults forms omit the new fields; they must keep their saved values.
  await save('account.saveDefaults', {
    incomeAccountId: 'core-other-revenue',
    expenseAccountId: 'core-expense',
    receivableAccountId: 'core-receivable',
    payableAccountId: 'core-payable',
  })
  assert.equal((await call('account.getDefaults')).goodsPurchaseAccountId, 'inventory')
  assert.equal((await preview('goods')).lineAccountId, 'inventory')
})

test('Commerce resolves per field through product and category ancestors, then uses explicit invoice choices', async (t) => {
  const { app, fixture, call, save, create, preview, post } = await boot(t)
  await save('product.saveCategory', { id: 'root', name: 'Root' })
  await save('product.saveCategory', { id: 'child', name: 'Child', parentId: 'root' })
  await save('account.saveCategoryAccount', {
    categoryId: 'root',
    incomeAccountId: 'core-other-revenue',
    expenseAccountId: 'inventory',
  })
  await save('account.saveCategoryAccount', { categoryId: 'child', expenseAccountId: 'core-expense' })
  await create('sample', 'goods', { categoryId: 'child' })
  assert.equal((await preview('sample', 'out_invoice')).lineAccountId, 'core-other-revenue')
  assert.equal((await preview('sample')).lineAccountId, 'core-expense')
  await save('account.setProductAccounts', { templateId: 'sample', expenseAccountId: 'inventory' })
  assert.equal((await preview('sample')).lineAccountFrom, 'product')
  assert.equal((await preview('sample', 'out_invoice')).lineAccountFrom, 'category')
  // A copy starts with the accounts its source names (P22); the source's category stays the fallback.
  const copy = (await (
    await app.client.get('/admin/product/templates/new/context?duplicate=sample&lang=en')
  ).json()) as { data: Row }
  assert.equal((copy.data.accounts as Row).expenseAccountId, 'inventory')
  assert.equal((copy.data.accounts as Row).incomeAccountId, null)
  await post('override-bill', 'sample', 'in_invoice', 'inventory')
  await post('explicit-sale', 'sample', 'out_invoice', 'core-revenue', 'core-revenue')
  await save('account.setProductAccounts', { templateId: 'sample', expenseAccountId: null })
  assert.equal((await preview('sample')).lineAccountId, 'core-expense')
  const foreign = await fixture('account.getProductAccounts', { templateId: 'sample' }, 'other')
  assert.equal(foreign, null)
  const context = (await (
    await app.client.get('/admin/product/templates/sample/context?lang=en')
  ).json()) as { data: Row }
  assert.equal((context.data.accounts as Row).expenseAccountId, null)
  assert.equal(((context.data.accounts as Row).purchase as Row).id, 'core-expense')
  // A malformed ancestor chain cannot hang resolution or silently choose an account.
  await save('account.saveCategoryAccount', { categoryId: 'root' })
  await save('account.saveCategoryAccount', { categoryId: 'child' })
  await app.adapter!.exec("UPDATE product_category SET \"parentId\" = 'child' WHERE id = 'root'")
  await assert.rejects(() =>
    call('account.previewAccounts', { productId: 'sample:default', moveType: 'out_invoice' }),
  )
})

test('Commerce product accounts share the record transaction and invalidate older drafts', async (t) => {
  const { app, call, save, create } = await boot(t)
  await create('sample')
  const before = await call('product.getTemplate', { id: 'sample' })
  const bad = await call('product.saveRecord', {
    id: 'sample',
    type: 'goods',
    name: 'Must roll back',
    expectedRevisionId: before.revisionId,
    incomeAccountId: 'core-cash',
  })
  assert.equal(bad.ok, false)
  const unchanged = await call('product.getTemplate', { id: 'sample' })
  assert.equal(unchanged.name, before.name)
  assert.equal(unchanged.revisionId, before.revisionId)
  assert.equal((await app.adapter!.all('SELECT * FROM account_product_account')).length, 0)
  await save('product.saveRecord', {
    id: 'sample',
    type: 'goods',
    name: 'Saved with mapping',
    expectedRevisionId: before.revisionId,
    incomeAccountId: 'core-other-revenue',
    expenseAccountId: 'inventory',
  })
  const current = await call('product.getTemplate', { id: 'sample' })
  assert.equal(
    (await call('account.getProductAccounts', { templateId: 'sample' })).incomeAccountId,
    'core-other-revenue',
  )
  await save('account.setProductAccounts', {
    templateId: 'sample',
    expectedRevisionId: current.revisionId,
    incomeAccountId: null,
  })
  assert.equal(
    (
      await call('product.saveRecord', {
        id: 'sample',
        type: 'goods',
        name: 'Stale',
        expectedRevisionId: current.revisionId,
      })
    ).ok,
    false,
  )
  const after = await call('product.getTemplate', { id: 'sample' })
  await save('account.setProductAccounts', { templateId: 'sample', expenseAccountId: 'inventory' })
  assert.equal(
    (await call('product.getTemplate', { id: 'sample' })).revisionId,
    after.revisionId,
    'unchanged mapping is a no-op',
  )
})

test('Commerce refuses account changes from a catalogue editor and omits sensitive accounting context', async (t) => {
  const { app, fixture, call, save, create } = await boot(t)
  await create('sample')
  await save('account.setProductAccounts', { templateId: 'sample', incomeAccountId: 'core-other-revenue' })
  await fixture('user.saveRole', { id: 'editor-role', name: 'Editor' })
  for (const fnKey of [
    'product.getTemplate',
    'product.saveTemplate',
    'product.saveRecord',
    'product.templateModalContext',
  ])
    await fixture('user.grantFunction', { id: `editor:${fnKey}`, roleId: 'editor-role', fnKey })
  await fixture('user.assignRole', { id: 'editor-role', userId: 'editor', roleId: 'editor-role' })
  await app.client.login({ login: 'editor', password: 'test-password' })
  const before = await call('product.getTemplate', { id: 'sample' })
  const context = (await (
    await app.client.get('/admin/product/templates/sample/context?lang=en')
  ).json()) as { data: Row }
  assert.equal(context.data.accounts, null)
  await assert.rejects(() =>
    call('account.setProductAccounts', { templateId: 'sample', incomeAccountId: 'core-revenue' }),
  )
  await assert.rejects(() =>
    call('product.saveRecord', { id: 'sample', type: 'goods', name: 'Denied', incomeAccountId: null }),
  )
  assert.equal((await call('product.getTemplate', { id: 'sample' })).revisionId, before.revisionId)
  await save('product.saveRecord', {
    id: 'sample',
    type: 'goods',
    name: 'Unrelated edit',
    expectedRevisionId: before.revisionId,
  })
  await app.client.login({ login: 'owner', password: 'test-password' })
  assert.equal(
    (await call('account.getProductAccounts', { templateId: 'sample' })).incomeAccountId,
    'core-other-revenue',
  )
})

test('Commerce account migration keeps legacy mappings and adds empty product overrides', async (t) => {
  const declaration = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const oldModules = legacyModules(
    declaration.modules.map((module) => {
      if (typeof module === 'string' || module.name !== 'account') return module
      const { ProductAccount: _product, ...models } = module.models!
      const defaults = models.Defaults!
      const {
        goodsPurchaseAccountId: _goods,
        servicePurchaseAccountId: _services,
        ...fields
      } = defaults.fields
      return { ...module, version: '0.12.0', models: { ...models, Defaults: { ...defaults, fields } } }
    }),
  )
  const app = await createCommerceTestDeployment({ ...declaration, modules: oldModules }, { worker: false })
  t.after(() => app.close())
  const fixture = (fn: string, input: Row) =>
    app.fixture.call(fn, input, { scope: { company: 'acme', branches: null } })
  await fixture('partner.savePartner', { id: 'party', name: 'Company', kind: 'company' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'party', currency: 'VND' })
  await fixture('account.saveAccount', {
    id: 'expense',
    code: 'EXP',
    name: 'Existing expense',
    accountType: 'expense',
  })
  await fixture('product.saveCategory', { id: 'existing', name: 'Existing category' })
  await fixture('account.saveCategoryAccount', { categoryId: 'existing', expenseAccountId: 'expense' })
  await app.adapter!.exec(
    "INSERT INTO account_defaults (id, \"companyId\", \"expenseAccountId\") VALUES ('defaults', 'acme', 'expense')",
  )
  const before = await app.adapter!.all('SELECT * FROM account_category_account')
  const manifest = compose(declaration.modules, { headless: true, companies: true })
  await migrateOne(app.adapter!, manifest)
  const defaults = (await app.adapter!.all('SELECT * FROM account_defaults'))[0]!
  assert.equal(defaults.expenseAccountId, 'expense')
  assert.equal(defaults.goodsPurchaseAccountId, null)
  assert.equal(defaults.servicePurchaseAccountId, null)
  assert.deepEqual(await app.adapter!.all('SELECT * FROM account_category_account'), before)
  assert.equal((await app.adapter!.all('SELECT * FROM account_product_account')).length, 0)
  assert.deepEqual(await migrateOne(app.adapter!, manifest), [])
  assert.ok(
    Object.values(schemaFromManifest(manifest).tables).some(
      (table) => table.model === 'account.ProductAccount',
    ),
  )
})
