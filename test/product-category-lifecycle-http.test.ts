import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, migrateOne, schemaFromManifest } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

const refused = (value: Row, reason: string) => {
  assert.equal(value.ok, false, JSON.stringify(value))
  assert.equal((value.errors as Row[])[0]?.code, `product.error.category.${reason}`)
}
const onlyDomainConflicts = (results: PromiseSettledResult<Row>[]) => {
  for (const result of results)
    if (result.status === 'rejected') {
      assert.equal(result.reason.body.code, 'conflict', JSON.stringify(result.reason.body))
      // Locked KetJS maps custom conflict codes to 400; a released mapping must prove 409.
      assert.equal(result.reason.status, Number(process.env.KET_EXPECT_CONFLICT_STATUS ?? 400))
    }
}
const product = (id: string, categoryId: string): Row => ({
  id,
  name: id,
  defaultCode: id.toUpperCase(),
  type: 'goods',
  uomId: 'each',
  categoryId,
})

test('P39 category names, sibling identity, cycles and company isolation', async (t) => {
  const { call, save, fixture, app } = await boot(t)
  for (const [name, reason] of [
    [' ', 'required'],
    ['a'.repeat(41), 'nameLong'],
    ['A / B', 'nameSlash'],
  ])
    refused(await call('product.saveCategory', { id: 'bad', name }), reason!)
  await save('product.saveCategory', { id: 'root', name: ' Root ' })
  refused(await call('product.saveCategory', { id: 'same', name: 'ROOT' }), 'duplicateName')
  await save('product.saveCategory', { id: 'child', name: 'Root', parentId: 'root' })
  await save('product.saveCategory', { id: 'leaf', name: 'Leaf', parentId: 'child' })
  refused(await call('product.saveCategory', { id: 'root', name: 'Root', parentId: 'leaf' }), 'parentInvalid')
  refused(await call('product.saveCategory', { id: 'root', name: 'Root', parentId: 'root' }), 'parentInvalid')
  assert.equal((await fixture('product.saveCategory', { id: 'foreign', name: 'Root' }, 'other')).ok, true)
  refused(await call('product.saveCategory', { id: 'x', name: 'X', parentId: 'foreign' }), 'parentInvalid')
  refused(await call('product.setCategoryActive', { id: 'foreign', active: false }), 'missing')
  const categories = (await app.client.call<Row[]>('product.listCategories', {})).value
  assert.equal(categories.find((row) => row.id === 'root')!.name, 'Root')
  assert.equal(categories.find((row) => row.id === 'leaf')!.path, 'Root / Root / Leaf')
  assert.ok(!categories.some((row) => row.id === 'foreign'))
})

test('P39 archive and restore preserve descendants, products and historical category labels', async (t) => {
  const { call, save, app } = await boot(t)
  await save('product.saveCategory', { id: 'root', name: 'Root' })
  await save('product.saveCategory', { id: 'child', name: 'Child', parentId: 'root' })
  refused(await call('product.setCategoryActive', { id: 'root', active: false }), 'inUse')
  await save('product.saveRecord', product('goods', 'child'))
  refused(await call('product.setCategoryActive', { id: 'child', active: false }), 'inUse')
  await save('product.archiveTemplate', {
    id: 'goods',
    active: false,
    reason: 'Retired',
    confirmed: true,
    expectedRevisionId: (await call('product.getTemplate', { id: 'goods' })).revisionId,
  })
  await save('product.setCategoryActive', { id: 'child', active: false })
  await save('product.setCategoryActive', { id: 'root', active: false })
  assert.deepEqual((await app.client.call<Row[]>('product.listCategories', {})).value, [])
  const held = (await app.client.call<Row[]>('product.listCategories', { ids: ['child'] })).value
  assert.equal(held[0]!.path, 'Root / Child')
  assert.equal(held[0]!.active, false)
  assert.equal(
    (await app.client.call<Row[]>('product.listCategories', { includeArchived: true })).value.length,
    2,
  )
  refused(await call('product.setCategoryActive', { id: 'child', active: true }), 'parentInactive')
  refused(await call('product.saveRecord', product('new-product', 'child')), 'inactive')
  refused(await call('product.duplicateTemplate', { id: 'copy', sourceId: 'goods' }), 'inactive')
  refused(
    await call('product.archiveTemplate', {
      id: 'goods',
      active: true,
      confirmed: true,
      expectedRevisionId: (await call('product.getTemplate', { id: 'goods' })).revisionId,
    }),
    'inactive',
  )
  assert.equal((await call('product.getTemplate', { id: 'goods' })).active, false)
  await save('product.setCategoryActive', { id: 'root', active: true })
  await save('product.setCategoryActive', { id: 'child', active: true })
  await save('product.archiveTemplate', {
    id: 'goods',
    active: true,
    confirmed: true,
    expectedRevisionId: (await call('product.getTemplate', { id: 'goods' })).revisionId,
  })
  refused(await call('product.setCategoryActive', { id: 'child', active: false }), 'inUse')
})

test('P39 active pricelist rules guard category archival and archived categories guard list activation', async (t) => {
  const { call, save } = await boot(t)
  await save('product.saveCategory', { id: 'root', name: 'Root' })
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  const rule = {
    id: 'rule',
    pricelistId: 'retail',
    categoryId: 'root',
    appliedOn: '2_product_category',
    computePrice: 'fixed',
    fixedPrice: '90',
  }
  await save('pricing.savePricelistItem', rule)
  refused(await call('product.setCategoryActive', { id: 'root', active: false }), 'inUse')
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail', active: false })
  await save('product.setCategoryActive', { id: 'root', active: false })
  refused(await call('pricing.savePricelist', { id: 'retail', name: 'Retail', active: true }), 'inactive')
  refused(await call('pricing.savePricelistItem', { ...rule, id: 'next' }), 'inactive')
  await save('product.setCategoryActive', { id: 'root', active: true })
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail', active: true })
})

test('P39 concurrent sibling names and opposing reparents cannot create duplicates or cycles', async (t) => {
  const { call, save, app } = await boot(t)
  const names = await Promise.all([
    call('product.saveCategory', { id: 'a', name: 'Same' }),
    call('product.saveCategory', { id: 'b', name: ' SAME ' }),
  ])
  assert.equal(names.filter((row) => row.ok === true).length, 1)
  refused(names.find((row) => row.ok === false)!, 'duplicateName')
  await save('product.saveCategory', { id: 'left', name: 'Left' })
  await save('product.saveCategory', { id: 'right', name: 'Right' })
  const moves = await Promise.allSettled([
    call('product.saveCategory', { id: 'left', name: 'Left', parentId: 'right' }),
    call('product.saveCategory', { id: 'right', name: 'Right', parentId: 'left' }),
  ])
  onlyDomainConflicts(moves)
  assert.equal(moves.filter((result) => result.status === 'fulfilled' && result.value.ok === true).length, 1)
  const rows = (await app.client.call<Row[]>('product.listCategories', {})).value
  assert.ok(
    !(
      rows.find((row) => row.id === 'left')!.parentId === 'right' &&
      rows.find((row) => row.id === 'right')!.parentId === 'left'
    ),
  )
})

test('P39 category archive races with product and rule attachment preserve the usage invariant', async (t) => {
  const { call, save, app } = await boot(t)
  await save('pricing.savePricelist', { id: 'retail', name: 'Retail' })
  for (const kind of ['product', 'rule']) {
    await save('product.saveCategory', { id: kind, name: kind })
    const assign =
      kind === 'product'
        ? () => call('product.saveRecord', product('raced', kind))
        : () =>
            call('pricing.savePricelistItem', {
              id: 'raced-rule',
              pricelistId: 'retail',
              categoryId: kind,
              appliedOn: '2_product_category',
              computePrice: 'fixed',
            })
    const outcomes = await Promise.allSettled([
      call('product.setCategoryActive', { id: kind, active: false }),
      assign(),
    ])
    onlyDomainConflicts(outcomes)
    const successes = outcomes.filter((result) => result.status === 'fulfilled' && result.value.ok === true)
    assert.equal(successes.length, 1, JSON.stringify(outcomes))
    const row = (await app.client.call<Row[]>('product.listCategories', { ids: [kind] })).value[0]!
    if (row.active) refused(await call('product.setCategoryActive', { id: kind, active: false }), 'inUse')
  }
})

test('P39 migration preserves legacy categories and duplicate names without destructive backfill', async (t) => {
  const { app, deployment, call, save } = await boot(t)
  await save('product.saveCategory', { id: 'old-a', name: 'A' })
  await save('product.saveCategory', { id: 'old-b', name: 'B' })
  const adapter = app.adapter!
  const manifest = compose(deployment.modules, { headless: true, companies: true })
  const oldModules = deployment.modules.map((module) => {
    if (typeof module === 'string' || module.name !== 'product') return module
    const category = module.models!.Category!
    const { active: _active, nameKey: _key, ...fields } = category.fields
    const { category_name_key_unique: _unique, ...indexes } = category.indexes!
    return {
      ...module,
      version: '0.2.6',
      models: { ...module.models, Category: { ...category, fields, indexes } },
    }
  })
  await adapter.exec('DROP INDEX product_category__category_name_key_unique')
  await adapter.exec('ALTER TABLE product_category DROP COLUMN "nameKey"')
  await adapter.exec('ALTER TABLE product_category DROP COLUMN "active"')
  await adapter.exec("UPDATE product_category SET name = 'Legacy'")
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(schemaFromManifest(compose(oldModules, { headless: true, companies: true })))],
  )
  await migrateOne(adapter, manifest)
  const rows = (await app.client.call<Row[]>('product.listCategories', {})).value
  assert.equal(rows.length, 2)
  assert.ok(rows.every((row) => row.active === true && row.name === 'Legacy'))
  refused(await call('product.saveCategory', { id: 'collision', name: ' LEGACY ' }), 'duplicateName')
  await save('product.saveCategory', { id: 'old-a', name: 'Renamed' })
  assert.deepEqual(await migrateOne(adapter, manifest), [])
})

test('P39 read-only sessions cannot rename or archive categories through RPC', async (t) => {
  const { app, fixture, save, call } = await boot(t)
  await save('product.saveCategory', { id: 'root', name: 'Root' })
  await fixture('user.saveRole', { id: 'reader-role', name: 'Reader' })
  await fixture('user.grantFunction', {
    id: 'reader-list',
    roleId: 'reader-role',
    fnKey: 'product.listCategories',
  })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await fixture('user.assignRole', { id: 'reader-grant', userId: 'reader', roleId: 'reader-role' })
  const reader = app.client.anonymous()
  await reader.login({ login: 'reader', password: 'test-password' })
  assert.equal((await reader.call<Row[]>('product.listCategories', {})).value.length, 1)
  await assert.rejects(() => reader.call('product.saveCategory', { id: 'root', name: 'Forged' }), {
    status: 403,
  })
  await assert.rejects(() => reader.call('product.setCategoryActive', { id: 'root', active: false }), {
    status: 403,
  })
  assert.equal(((await call('product.listCategories', {})) as unknown as Row[])[0]!.name, 'Root')
})

test('P39 archive races with child creation, product restoration and pricelist activation', async (t) => {
  const { call, save, app } = await boot(t)
  for (const kind of ['child', 'restore', 'list']) {
    await save('product.saveCategory', { id: kind, name: kind })
    if (kind === 'restore') {
      await save('product.saveRecord', product('retired', kind))
      await save('product.archiveTemplate', {
        id: 'retired',
        active: false,
        reason: 'Retired',
        confirmed: true,
        expectedRevisionId: (await call('product.getTemplate', { id: 'retired' })).revisionId,
      })
    }
    if (kind === 'list') {
      await save('pricing.savePricelist', { id: 'inactive', name: 'Inactive', active: false })
      await save('pricing.savePricelistItem', {
        id: 'inactive-rule',
        pricelistId: 'inactive',
        categoryId: kind,
        appliedOn: '2_product_category',
        computePrice: 'fixed',
      })
    }
    const revision =
      kind === 'restore' ? (await call('product.getTemplate', { id: 'retired' })).revisionId : null
    const assign =
      kind === 'child'
        ? () => call('product.saveCategory', { id: 'new-child', name: 'New child', parentId: kind })
        : kind === 'restore'
          ? () =>
              call('product.archiveTemplate', {
                id: 'retired',
                active: true,
                confirmed: true,
                expectedRevisionId: revision,
              })
          : () => call('pricing.savePricelist', { id: 'inactive', name: 'Inactive', active: true })
    const results = await Promise.allSettled([
      call('product.setCategoryActive', { id: kind, active: false }),
      assign(),
    ])
    onlyDomainConflicts(results)
    assert.equal(
      results.filter((result) => result.status === 'fulfilled' && result.value.ok === true).length,
      1,
      JSON.stringify(results),
    )
    const category = (await app.client.call<Row[]>('product.listCategories', { ids: [kind] })).value[0]!
    if (category.active)
      refused(await call('product.setCategoryActive', { id: kind, active: false }), 'inUse')
  }
})
