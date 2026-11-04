import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, migrateOne, schemaFromManifest } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'
const tags = async (call: Awaited<ReturnType<typeof boot>>['call']) =>
  (await call('product.listTags', { includeArchived: true })) as unknown as Row[]

test('Commerce tag names are company scoped, normalized and reserved while archived', async (t) => {
  const { call, save, fixture } = await boot(t)
  await save('product.saveTag', { id: 'tag', name: '  Bán chạy  ' })
  let row = (await tags(call))[0]!
  assert.equal(row.name, 'Bán chạy')
  assert.equal((await call('product.saveTag', { id: 'duplicate', name: 'BÁN CHẠY' })).ok, false)
  assert.equal((await call('product.saveTag', { id: 'long', name: 'x'.repeat(31) })).ok, false)
  assert.equal((await call('product.saveTag', { id: 'blank', name: '  ' })).ok, false)
  await save('product.saveTag', { id: 'boundary', name: 'é'.repeat(30) })
  assert.equal((await fixture('product.saveTag', { id: 'other-tag', name: 'Bán chạy' }, 'other')).ok, true)
  assert.equal((await tags(call)).length, 2)
  await save('product.setTagActive', { id: 'tag', active: false, expectedRevisionId: row.revisionId })
  assert.ok(!((await call('product.listTags', {})) as unknown as Row[]).some((row) => row.id === 'tag'))
  assert.equal((await call('product.saveTag', { id: 'duplicate', name: 'Bán chạy' })).ok, false)
  assert.equal(
    (await call('product.saveTag', { id: 'tag', name: 'Changed', expectedRevisionId: row.revisionId })).ok,
    false,
  )
  assert.equal(
    (await call('product.setTagActive', { id: 'tag', active: true, expectedRevisionId: row.revisionId })).ok,
    false,
  )
  row = (await tags(call)).find((row) => row.id === 'tag')!
  await save('product.setTagActive', { id: 'tag', active: true, expectedRevisionId: row.revisionId })
  assert.equal((await tags(call)).find((row) => row.id === 'tag')!.active, true)
})

test('Commerce product tags save atomically, cap at ten, reject foreign tags and retain archived assignments', async (t) => {
  const { call, save, fixture } = await boot(t)
  for (let i = 0; i < 11; i++) await save('product.saveTag', { id: `tag-${i}`, name: `Tag ${i}` })
  await fixture('product.saveTag', { id: 'foreign', name: 'Private' }, 'other')
  const create = { id: 'goods', name: 'Goods', defaultCode: 'GOODS', type: 'goods', uomId: 'each' }
  assert.equal((await call('product.saveRecord', { ...create, tagIds: ['foreign'] })).ok, false)
  assert.equal(await call('product.getTemplate', { id: 'goods' }), null)
  await save('product.saveRecord', { ...create, tagIds: ['tag-1', 'tag-0', 'tag-1'] })
  const read = () => call('product.getTemplate', { id: 'goods' })
  let held = await read()
  assert.deepEqual(held.tagIds, ['tag-1', 'tag-0'])
  const update = (input: Row) =>
    call('product.saveRecord', { ...create, expectedRevisionId: held.revisionId, ...input })
  assert.equal(
    (await update({ name: 'Wrong', tagIds: Array.from({ length: 11 }, (_, i) => `tag-${i}`) })).ok,
    false,
  )
  assert.equal((await read()).name, 'Goods')
  assert.equal((await update({ tagIds: Array.from({ length: 10 }, (_, i) => `tag-${i}`) })).ok, true)
  held = await read()
  assert.equal((held.tagIds as string[]).length, 10)
  const tag = (await tags(call)).find((row) => row.id === 'tag-1')!
  await save('product.setTagActive', { id: tag.id, active: false, expectedRevisionId: tag.revisionId })
  assert.equal((await update({ name: 'Retained', tagIds: ['tag-1', 'tag-0'] })).ok, true)
  held = await read()
  assert.deepEqual(held.tagIds, ['tag-1', 'tag-0'])
  assert.equal(
    (await call('product.saveRecord', { ...create, id: 'new', defaultCode: 'NEW', tagIds: ['tag-1'] })).ok,
    false,
  )
  assert.equal((await update({ tagIds: ['tag-0'] })).ok, true)
  held = await read()
  assert.deepEqual(held.tagIds, ['tag-0'])
  assert.equal((await update({ tagIds: ['tag-1'] })).ok, false)
  assert.equal((await update({ name: 'Still kept' })).ok, true)
  assert.deepEqual((await read()).tagIds, ['tag-0'])
  await call('product.deleteTemplates', { ids: ['goods'] })
  assert.equal(await call('product.getTemplate', { id: 'goods' }), null)
})

test('Commerce accounting and reader roles cannot forge product tag changes', async (t) => {
  const { app, call, save, fixture } = await boot(t)
  await save('product.saveTag', { id: 'tag', name: 'Tag' })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    defaultCode: 'GOODS',
    type: 'goods',
    uomId: 'each',
  })
  assert.equal(
    (await app.fixture.call<Row>('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })).value.ok,
    true,
  )
  for (const [id, roleId] of [
    ['accountant', 'commerce.accountant'],
    ['reader', 'commerce.sales-representative'],
  ]) {
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
    await client.login({ login: id!, password: 'test-password' })
    await assert.rejects(() => client.call('product.saveTag', { id: 'forged', name: 'Forged' }), {
      status: 403,
    })
    const row = await call('product.getTemplate', { id: 'goods' })
    await assert.rejects(
      () =>
        client.call('product.saveRecord', {
          id: 'goods',
          name: 'Goods',
          type: 'goods',
          tagIds: ['tag'],
          expectedRevisionId: row.revisionId,
        }),
      { status: 403 },
    )
    assert.deepEqual((await call('product.getTemplate', { id: 'goods' })).tagIds, [])
  }
})

test('Commerce competing tag names have one owner and a meaningful refusal', async (t) => {
  const { call } = await boot(t)
  const results = await Promise.allSettled([
    call('product.saveTag', { id: 'one', name: 'Shared' }),
    call('product.saveTag', { id: 'two', name: 'SHARED' }),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled' && r.value.ok === true).length, 1)
  for (const result of results) {
    if (result.status === 'rejected') {
      assert.equal(result.reason.status, Number(process.env.KET_EXPECT_CONFLICT_STATUS ?? 400))
      assert.equal(result.reason.body.code, 'conflict')
    } else if (result.value.ok === false)
      assert.equal((result.value.errors as Row[])[0]!.code, 'product.error.tag.duplicateName')
  }
  assert.equal((await tags(call)).length, 1)
})

test('Commerce duplication preserves tag order and archived history without aliasing assignments', async (t) => {
  const { call, save } = await boot(t)
  await save('product.saveTag', { id: 'one', name: 'One' })
  await save('product.saveTag', { id: 'two', name: 'Two' })
  await save('product.saveRecord', {
    id: 'source',
    name: 'Source',
    defaultCode: 'SOURCE',
    type: 'goods',
    uomId: 'each',
    tagIds: ['two', 'one'],
  })
  const row = (await tags(call)).find((row) => row.id === 'two')!
  await save('product.setTagActive', { id: 'two', active: false, expectedRevisionId: row.revisionId })
  await save('product.duplicateTemplate', { id: 'copy', sourceId: 'source', name: 'Copy' })
  const copy = await call('product.getTemplate', { id: 'copy' })
  assert.deepEqual(copy.tagIds, ['two', 'one'])
  await save('product.saveRecord', {
    id: 'copy',
    name: 'Copy',
    type: 'goods',
    expectedRevisionId: copy.revisionId,
    tagIds: ['one'],
  })
  assert.deepEqual((await call('product.getTemplate', { id: 'source' })).tagIds, ['two', 'one'])
  assert.deepEqual((await call('product.getTemplate', { id: 'copy' })).tagIds, ['one'])
})

test('Commerce concurrent assignment and archival retain history only for a winning assignment', async (t) => {
  const { call, save } = await boot(t)
  await save('product.saveTag', { id: 'tag', name: 'Tag' })
  await save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    defaultCode: 'GOODS',
    type: 'goods',
    uomId: 'each',
  })
  const row = (await tags(call))[0]!,
    product = await call('product.getTemplate', { id: 'goods' })
  const results = await Promise.allSettled([
    call('product.saveRecord', {
      id: 'goods',
      name: 'Goods',
      type: 'goods',
      tagIds: ['tag'],
      expectedRevisionId: product.revisionId,
    }),
    call('product.setTagActive', { id: 'tag', active: false, expectedRevisionId: row.revisionId }),
  ])
  for (const result of results)
    if (result.status === 'rejected') {
      assert.equal(result.reason.status, Number(process.env.KET_EXPECT_CONFLICT_STATUS ?? 400))
      assert.equal(result.reason.body.code, 'conflict')
    }
  const assignment = results[0]!
  const assigned = assignment.status === 'fulfilled' && assignment.value.ok === true
  assert.deepEqual((await call('product.getTemplate', { id: 'goods' })).tagIds, assigned ? ['tag'] : [])
  const current = (await tags(call))[0]!
  if (current.active !== false)
    await save('product.setTagActive', { id: 'tag', active: false, expectedRevisionId: current.revisionId })
  assert.equal(
    (
      await call('product.saveRecord', {
        id: 'late',
        name: 'Late',
        defaultCode: 'LATE',
        type: 'goods',
        uomId: 'each',
        tagIds: ['tag'],
      })
    ).ok,
    false,
  )
  assert.equal(await call('product.getTemplate', { id: 'late' }), null)
})

test('Commerce tag schema upgrade is additive and replays without altering existing products', async (t) => {
  const { app, deployment, save } = await boot(t)
  await save('product.saveRecord', {
    id: 'legacy',
    name: 'Legacy',
    defaultCode: 'LEGACY',
    type: 'goods',
    uomId: 'each',
  })
  const adapter = app.adapter!,
    manifest = compose(deployment.modules, { headless: true, companies: true })
  const schema = schemaFromManifest(manifest)
  const legacy = {
    ...schema,
    tables: Object.fromEntries(
      Object.entries(schema.tables).filter(
        ([, table]) => !['product.Tag', 'product.TemplateTag'].includes(table.model),
      ),
    ),
  }
  await adapter.exec('DROP TABLE product_template_tag')
  await adapter.exec('DROP TABLE product_tag')
  const before = await adapter.all('SELECT * FROM product_template')
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(legacy)],
  )
  await migrateOne(adapter, manifest)
  assert.deepEqual(await adapter.all('SELECT * FROM product_template'), before)
  assert.equal((await adapter.all('SELECT * FROM product_template_tag')).length, 0)
  assert.deepEqual(await migrateOne(adapter, manifest), [])
  await save('product.saveTag', { id: 'new', name: 'New after upgrade' })
})
