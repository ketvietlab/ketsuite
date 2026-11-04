import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, migrateOne, schemaFromManifest } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

type Run = Awaited<ReturnType<typeof boot>>
type Combo = Row & { items: Row[] }
const all = async (run: Run) =>
  (await run.app.client.call<Combo[]>('product.listCombos', { includeArchived: true })).value
const read = async (run: Run, id = 'choice') => (await all(run)).find((row) => row.id === id)!
const item = (id = 'one', extraPrice = '0') => ({ productId: `${id}:default`, extraPrice })
const products = async (run: Run, ids = ['one', 'two']) => {
  for (const id of ids)
    await run.save('product.saveRecord', {
      id,
      name: id,
      type: 'goods',
      uomId: 'each',
      defaultCode: id.toUpperCase(),
    })
}
const create = (run: Run, extra: Row = {}) =>
  run.save('product.saveCombo', {
    id: 'choice',
    name: 'Lựa chọn',
    items: [item()],
    ...extra,
  })

test('P44 combo choice names and item identities are scoped, normalized and ordered', async (t) => {
  const run = await boot(t)
  await products(run)
  await create(run, { name: '  Lựa chọn  ', items: [item('two', '00060000'), item()] })
  let row = await read(run)
  assert.equal(row.name, 'Lựa chọn')
  assert.deepEqual(
    row.items.map(({ productId, extraPrice, sequence }) => ({ productId, extraPrice, sequence })),
    [
      { productId: 'two:default', extraPrice: '60000', sequence: 0 },
      { productId: 'one:default', extraPrice: '0', sequence: 1 },
    ],
  )
  assert.equal(
    (await run.call('product.saveCombo', { id: 'duplicate', name: 'LỰA CHỌN', items: [item()] })).ok,
    false,
  )
  for (const name of ['', ' ', 'a'.repeat(41)])
    assert.equal((await run.call('product.saveCombo', { id: 'bad', name, items: [item()] })).ok, false)
  await create(run, { id: 'limit', name: 'é'.repeat(40) })
  await run.fixture('product.saveTemplate', { id: 'private', name: 'Private', type: 'service' }, 'other')
  await run.fixture(
    'product.saveCombo',
    { id: 'private-choice', name: 'Lựa chọn', items: [item('private')] },
    'other',
  )
  assert.equal((await all(run)).length, 2)
  assert.equal(
    (await run.call('product.saveCombo', { id: 'cross', name: 'Foreign', items: [item('private')] })).ok,
    false,
  )
  const ids = new Map(row.items.map((item) => [item.productId, item.id]))
  await create(run, { items: [item(), item('two', '7')], expectedRevisionId: row.revisionId })
  row = await read(run)
  assert.equal(row.items[0]?.productId, 'one:default')
  assert.equal(row.items[0]?.id, ids.get('one:default'))
  assert.equal(row.items[1]?.id, ids.get('two:default'))
})

test('P44 1–20 items and exact whole extra prices refuse malformed drafts atomically', async (t) => {
  const run = await boot(t)
  const ids = Array.from({ length: 21 }, (_, index) => `item-${index}`)
  await products(run, ids)
  await create(run, { items: [item(ids[0])] })
  let row = await read(run)
  const bad = [
    [],
    ids.map((id) => item(id)),
    [item(ids[0]), item(ids[0])],
    [null],
    [{ productId: '' }],
    ...['-1', '1.2', '1e3', '10000000000', 'NaN'].map((price) => [item(ids[0], price)]),
  ]
  for (const items of bad) {
    assert.equal(
      (
        await run.call('product.saveCombo', {
          id: 'choice',
          name: 'Must not persist',
          items,
          expectedRevisionId: row.revisionId,
        })
      ).ok,
      false,
    )
    const after = await read(run)
    assert.equal(after.name, 'Lựa chọn')
    assert.deepEqual(after.items, row.items)
    assert.equal(after.revisionId, row.revisionId)
  }
  await create(run, {
    items: ids.slice(0, 20).map((id) => item(id, '9999999999')),
    expectedRevisionId: row.revisionId,
  })
  row = await read(run)
  assert.equal(row.items.length, 20)
  assert.equal(row.items[19]?.extraPrice, '9999999999')
  await create(run, { items: [item(ids[0], '   ')], expectedRevisionId: row.revisionId })
  assert.equal((await read(run)).items[0]?.extraPrice, '0')
  assert.equal((await run.call('product.saveCombo', { id: 'empty', name: 'Empty', items: [] })).ok, false)
  assert.ok(!(await all(run)).some((row) => row.id === 'empty'))
})

test('P44 held retired or non-selling items retain history but cannot be newly offered', async (t) => {
  const run = await boot(t)
  await products(run)
  await create(run)
  let template = await run.call('product.getTemplate', { id: 'one' })
  await run.save('product.saveRecord', {
    id: 'one',
    name: 'one',
    type: 'goods',
    saleOk: false,
    expectedRevisionId: template.revisionId,
  })
  let row = await read(run)
  await create(run, { expectedRevisionId: row.revisionId })
  assert.equal((await run.call('product.saveCombo', { id: 'late', name: 'Late', items: [item()] })).ok, false)
  template = await run.call('product.getTemplate', { id: 'one' })
  await run.save('product.archiveTemplate', {
    id: 'one',
    active: false,
    reason: 'Discontinued',
    confirmed: true,
    expectedRevisionId: template.revisionId,
  })
  row = await read(run)
  await create(run, { expectedRevisionId: row.revisionId })
  assert.equal((await read(run)).items[0]?.productId, 'one:default')
  row = await read(run)
  await create(run, { items: [item('two')], expectedRevisionId: row.revisionId })
  row = await read(run)
  assert.equal(
    (
      await run.call('product.saveCombo', {
        id: 'choice',
        name: row.name,
        items: [item()],
        expectedRevisionId: row.revisionId,
      })
    ).ok,
    false,
  )
})

test('P44 archive guards active product usage, reserves names and checks revision', async (t) => {
  const run = await boot(t)
  await products(run)
  await create(run)
  let row = await read(run)
  const adapter = run.app.adapter!
  const placeholders = adapter.name === 'postgres' ? '$1,$2,$3,$4,$5' : '?,?,?,?,?'
  await adapter.run(
    `INSERT INTO product_template_combo (id, "companyId", "templateId", "comboId", sequence) VALUES (${placeholders})`,
    ['link', 'acme', 'two', 'choice', 0],
  )
  assert.equal((await read(run)).productCount, 1)
  assert.equal(
    (
      await run.call('product.setComboActive', {
        id: 'choice',
        active: false,
        expectedRevisionId: row.revisionId,
      })
    ).ok,
    false,
  )
  const template = await run.call('product.getTemplate', { id: 'two' })
  await run.save('product.archiveTemplate', {
    id: 'two',
    active: false,
    reason: 'Discontinued',
    confirmed: true,
    expectedRevisionId: template.revisionId,
  })
  await run.save('product.setComboActive', {
    id: 'choice',
    active: false,
    expectedRevisionId: row.revisionId,
  })
  assert.equal((await run.app.client.call<Combo[]>('product.listCombos', {})).value.length, 0)
  assert.equal(
    (await run.call('product.saveCombo', { id: 'duplicate', name: row.name, items: [item()] })).ok,
    false,
  )
  assert.equal(
    (
      await run.call('product.setComboActive', {
        id: 'choice',
        active: true,
        expectedRevisionId: row.revisionId,
      })
    ).ok,
    false,
  )
  row = await read(run)
  assert.equal(row.productCount, 0)
  assert.equal(
    (
      await run.call('product.saveCombo', {
        id: 'choice',
        name: 'Changed',
        items: [item()],
        expectedRevisionId: row.revisionId,
      })
    ).ok,
    false,
  )
  await run.save('product.setComboActive', { id: 'choice', active: true, expectedRevisionId: row.revisionId })
  assert.equal((await read(run)).active, true)
})

test('P44 real Commerce roles separate combo reading from configuration', async (t) => {
  const run = await boot(t)
  await products(run)
  await create(run)
  await run.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  for (const [id, role] of [
    ['accountant', 'commerce.accountant'],
    ['reader', 'commerce.sales-representative'],
    ['manager', 'commerce.sales-manager'],
  ]) {
    await run.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await run.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await run.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId: role })
    const client = run.app.client.anonymous()
    await client.login({ login: id!, password: 'test-password' })
    assert.ok((await client.call<Combo[]>('product.listCombos', {})).value.some((row) => row.id === 'choice'))
    const input = { id: `${id}-choice`, name: id, items: [item()] }
    if (id === 'manager') assert.equal((await client.call<Row>('product.saveCombo', input)).value.ok, true)
    else {
      await assert.rejects(() => client.call('product.saveCombo', input), { status: 403 })
      await assert.rejects(
        () =>
          client.call('product.setComboActive', {
            id: 'choice',
            active: false,
            expectedRevisionId: 'forged',
          }),
        { status: 403 },
      )
    }
  }
})

test('P44 competing choice names and stale edits have one successful writer', async (t) => {
  const run = await boot(t)
  await products(run)
  const check = (results: PromiseSettledResult<Row>[]) => {
    assert.equal(results.filter((r) => r.status === 'fulfilled' && r.value.ok === true).length, 1)
    for (const result of results)
      if (result.status === 'rejected') {
        assert.equal(result.reason.status, Number(process.env.KET_EXPECT_CONFLICT_STATUS ?? 400))
        assert.equal(result.reason.body.code, 'conflict')
      }
  }
  check(
    await Promise.allSettled(
      ['one', 'two'].map((id) => run.call('product.saveCombo', { id, name: 'Shared', items: [item()] })),
    ),
  )
  const row = (await all(run))[0]!
  check(
    await Promise.allSettled(
      ['First', 'Second'].map((name) =>
        run.call('product.saveCombo', {
          id: row.id,
          name,
          items: [item()],
          expectedRevisionId: row.revisionId,
        }),
      ),
    ),
  )
  assert.equal((await all(run)).length, 1)
})

test('P44 referenced SKU deletion is refused without deleting the item or its source', async (t) => {
  const run = await boot(t)
  await products(run)
  await create(run)
  await assert.rejects(
    () => run.call('product.deleteTemplates', { ids: ['one'] }),
    (error: unknown) => {
      assert.equal((error as { body: Row }).body.code, 'conflict')
      return true
    },
  )
  assert.equal((await run.call('product.getTemplate', { id: 'one' })).name, 'one')
  assert.equal((await read(run)).items[0]?.productId, 'one:default')
  const row = await read(run)
  await create(run, { items: [item('two')], expectedRevisionId: row.revisionId })
  assert.equal((await run.call('product.deleteTemplates', { ids: ['one'] })).deleted, 1)
})

test('P44 concurrent SKU deletion and new choice assignment cannot leave a dangling item', async (t) => {
  const run = await boot(t)
  await products(run)
  const results = await Promise.allSettled([
    run.call('product.deleteTemplates', { ids: ['one'] }),
    run.call('product.saveCombo', { id: 'race', name: 'Race', items: [item()] }),
  ])
  for (const result of results)
    if (result.status === 'rejected') assert.equal(result.reason.body.code, 'conflict')
  const choice = (await all(run)).find((row) => row.id === 'race')
  const product = await run.call('product.getTemplate', { id: 'one' })
  if (choice) {
    assert.ok(product, 'a saved choice must keep its source product')
    assert.equal(choice.items[0]?.productId, 'one:default')
  } else {
    assert.equal(product, null)
    assert.equal(results[0]?.status, 'fulfilled')
  }
})

test('P44 additive schema upgrade preserves products and is replayable', async (t) => {
  const run = await boot(t)
  await products(run)
  const adapter = run.app.adapter!,
    manifest = compose(run.deployment.modules, { headless: true, companies: true })
  const schema = schemaFromManifest(manifest)
  const legacy = {
    ...schema,
    tables: Object.fromEntries(
      Object.entries(schema.tables).filter(
        ([, table]) => !['product.Combo', 'product.ComboItem', 'product.TemplateCombo'].includes(table.model),
      ),
    ),
  }
  for (const name of ['product_template_combo', 'product_combo_item', 'product_combo'])
    await adapter.exec(`DROP TABLE ${name}`)
  const before = await adapter.all('SELECT * FROM product_template')
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(legacy)],
  )
  await migrateOne(adapter, manifest)
  assert.deepEqual(await adapter.all('SELECT * FROM product_template'), before)
  assert.deepEqual(await migrateOne(adapter, manifest), [])
  await create(run)
  assert.equal((await read(run)).items.length, 1)
})
