import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { compose, migrateOne, schemaFromManifest } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import type { PackagingGridData } from '../packages/ketsuite/src/modules/product/packaging-grid.ts'
import { setup } from './fixtures/sale/commerce.ts'

async function boot(t: TestContext, variants = true) {
  const r = await setup(t)
  if (variants) {
    await r.save('product.saveAttributeDraft', {
      id: 'color',
      name: 'Color',
      displayType: 'select',
      createVariant: 'always',
      values: [
        { id: 'red', name: 'Red' },
        { id: 'blue', name: 'Blue' },
      ],
    })
    await r.save('product.configureAttributes', {
      templateId: 'goods',
      lines: [{ attributeId: 'color', values: [{ valueId: 'red' }, { valueId: 'blue' }] }],
    })
  }
  const products = (await r.call('product.getTemplate', { id: 'goods' })).variants as Row[]
  const grid = async () =>
    (await r.app.client.call<PackagingGridData>('product.getPackagingGrid', { templateId: 'goods' })).value
  const saveGrid = async (changes: Row, revision?: string) =>
    r.call('product.savePackagingGrid', {
      templateId: 'goods',
      expectedRevisionId: revision ?? (await grid()).revision,
      changes,
    })
  const units = async (productId: string) =>
    (await r.app.client.call<Row[]>('sale.listLineUnits', { productId })).value.map((row) => row.id)
  return { ...r, grid, saveGrid, products, units }
}
const added = (id: string, uomId: string, productId = '*', barcode = '') => ({
  id,
  values: { uomId, productId, barcode },
})

test('P35 one product save atomically narrows packaging eligibility and keeps historical sale lines', async (t) => {
  const r = await boot(t)
  const before = await r.grid(),
    red = String(r.products[0]!.id),
    blue = String(r.products[1]!.id)
  assert.equal(before.rows.length, 1)
  assert.equal((await r.add()).ok, true)
  const result = await r.call('product.saveRecord', {
    id: 'goods',
    type: 'goods',
    name: 'Renamed goods',
    expectedRevisionId: before.revision,
    packagings: {
      updated: [{ id: before.rows[0]!.id, values: { productId: red, barcode: '4006381333931' } }],
    },
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal((await r.call('product.getTemplate', { id: 'goods' })).name, 'Renamed goods')
  assert.ok((await r.units(red)).includes('box'))
  assert.ok(!(await r.units(blue)).includes('box'))
  assert.equal((await r.grid()).rows[0]!.barcode, '4006381333931')
  const order = await r.call('sale.getOrder', { id: 'order' })
  assert.equal((order.lines as Row[])[0]!.productUomId, 'box')
  const stale = await r.saveGrid({ removed: [(await r.grid()).rows[0]!.id] }, before.revision)
  assert.equal(stale.ok, false)
  assert.match(JSON.stringify(stale), /conflict/)
})

test('P35 rejects new overlapping scopes, shared barcodes and invalid units with whole-record rollback', async (t) => {
  const r = await boot(t)
  const before = await r.grid(),
    productId = String(r.products[0]!.id)
  for (const changes of [
    { added: [added('new', 'box', productId)] },
    { updated: [{ id: before.rows[0]!.id, values: { barcode: '4006381333931' } }] },
    { added: [added('new', 'each', productId)] },
    { added: [added('new', 'case', 'foreign-product')] },
  ]) {
    const result = await r.call('product.saveRecord', {
      id: 'goods',
      type: 'goods',
      name: 'Must roll back',
      expectedRevisionId: before.revision,
      packagings: changes,
    })
    assert.equal(result.ok, false, JSON.stringify(result))
    assert.equal((await r.call('product.getTemplate', { id: 'goods' })).name, 'Goods')
    assert.deepEqual(await r.grid(), before)
  }
  assert.equal((await r.saveGrid({ removed: ['foreign-row'] })).ok, false)
})

test('P35 preserves legacy shared-unit barcode rows and supports atomic GS1 swaps', async (t) => {
  const r = await boot(t)
  const [red, blue] = r.products.map((row) => String(row.id))
  await r.save('product.addProductUom', { productId: red, uomId: 'box', barcode: '4006381333931' })
  await r.save('product.addProductUom', { productId: blue, uomId: 'box', barcode: '5901234123457' })
  const before = await r.grid()
  assert.equal(before.legacyOverlap, true)
  const a = before.rows.find((row) => row.productId === red)!,
    b = before.rows.find((row) => row.productId === blue)!
  assert.equal(
    (
      await r.saveGrid({
        updated: [
          { id: a.id, values: { barcode: b.barcode } },
          { id: b.id, values: { barcode: a.barcode } },
        ],
      })
    ).ok,
    true,
  )
  const swapped = await r.grid()
  assert.deepEqual(
    swapped.rows.map((row) => row.id),
    before.rows.map((row) => row.id),
  )
  assert.equal(swapped.rows.find((row) => row.id === a.id)!.barcode, b.barcode)
  assert.equal(swapped.rows.find((row) => row.id === b.id)!.barcode, a.barcode)
  const failed = await r.saveGrid({ updated: [{ id: a.id, values: { barcode: '123' } }] })
  assert.equal(failed.ok, false)
  assert.deepEqual(await r.grid(), swapped)
  await r.save('product.setBarcode', { productId: red, barcode: '96385074' })
  const current = await r.grid()
  assert.equal(
    (await r.saveGrid({ updated: [{ id: a.id, values: { barcode: '00000096385074' } }] })).ok,
    false,
  )
  assert.deepEqual(await r.grid(), current)
})

test('P35 single-SKU packaging merges its legacy barcode and legacy additions invalidate a stale grid', async (t) => {
  const r = await boot(t, false)
  await r.save('product.addProductUom', { productId: r.productId, uomId: 'box', barcode: '4006381333931' })
  const before = await r.grid()
  assert.equal(before.rows.length, 1)
  assert.equal(before.rows[0]!.barcode, '4006381333931')
  assert.equal(before.singleProductId, r.productId)
  await r.save('product.addTemplateUom', { templateId: 'goods', uomId: 'case' })
  assert.equal((await r.saveGrid({ removed: [before.rows[0]!.id] }, before.revision)).ok, false)
  const current = await r.grid()
  assert.equal(
    (
      await r.saveGrid({
        updated: [{ id: current.rows.find((row) => row.uomId === 'box')!.id, values: { barcode: '' } }],
      })
    ).ok,
    true,
  )
  assert.ok((await r.units(r.productId)).includes('box'))
  assert.equal((await r.grid()).rows.find((row) => row.uomId === 'box')!.barcode, '')
})

test('P35 scope and permissions protect both the direct writer and one-save product command', async (t) => {
  const r = await boot(t)
  await r.fixture('uom.saveUnit', { id: 'other-each', name: 'Other each', relativeFactor: '1' }, 'other')
  const foreign = await r.fixture(
    'product.saveRecord',
    { id: 'foreign', name: 'Foreign', type: 'goods', uomId: 'other-each', defaultCode: 'FOREIGN' },
    'other',
  )
  assert.equal(foreign.ok, true)
  assert.ok(await r.fixture('product.getPackagingGrid', { templateId: 'foreign' }, 'other'))
  assert.equal(await r.call('product.getPackagingGrid', { templateId: 'foreign' }), null)
  assert.equal((await r.saveGrid({ added: [added('new', 'other-each')] })).ok, false)
  assert.equal((await r.saveGrid({ added: [added('new', 'case', 'foreign:default')] })).ok, false)
  await r.fixture('user.saveRole', { id: 'limited', name: 'Limited' })
  await r.fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    name: 'Reader',
    password: 'test-password',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'limited' })
  const grant = (fnKey: string) => r.fixture('user.grantFunction', { id: fnKey, roleId: 'limited', fnKey })
  for (const fn of [
    'product.getPackagingGrid',
    'product.getTemplate',
    'product.templateModalContext',
    'product.saveRecord',
  ])
    await grant(fn)
  const client = r.app.client.anonymous()
  await client.login({ login: 'reader', password: 'test-password' })
  const before = await r.grid()
  assert.equal(
    (await client.call<PackagingGridData>('product.getPackagingGrid', { templateId: 'goods' })).value
      .editable,
    false,
  )
  const input = {
    id: 'goods',
    type: 'goods',
    name: 'Goods',
    expectedRevisionId: before.revision,
    packagings: { added: [added('new', 'case', String(r.products[0]!.id))] },
  }
  await assert.rejects(
    client.call('product.savePackagingGrid', {
      templateId: 'goods',
      expectedRevisionId: before.revision,
      changes: input.packagings,
    }),
    { status: 403 },
  )
  await assert.rejects(client.call('product.saveRecord', input), { status: 403 })
  assert.deepEqual(await r.grid(), before)
  await grant('product.savePackagingGrid')
  assert.equal(
    (await client.call<PackagingGridData>('product.getPackagingGrid', { templateId: 'goods' })).value
      .editable,
    true,
  )
  assert.equal((await client.call<Row>('product.saveRecord', input)).value.ok, true)
  const current = await r.grid()
  await assert.rejects(
    client.call('product.saveRecord', {
      ...input,
      name: 'Forbidden general edit',
      expectedRevisionId: current.revision,
      packagings: { removed: [current.rows[0]!.id] },
    }),
    { status: 403 },
  )
  assert.deepEqual(await r.grid(), current)
})

test('P35 enforces 20 rows, keeps order and refuses fabricated immutable fields', async (t) => {
  const r = await boot(t, false)
  for (let i = 0; i < 20; i++)
    await r.save('uom.saveUnit', {
      id: `pack-${i}`,
      name: `Pack ${i}`,
      relativeUomId: 'each',
      relativeFactor: String(i + 2),
    })
  const before = await r.grid()
  const addedRows = Array.from({ length: 19 }, (_, i) => added(`new-${i}`, `pack-${i}`))
  assert.equal(
    (
      await r.saveGrid({
        added: addedRows,
        order: [...addedRows.map((row) => row.id).reverse(), before.rows[0]!.id],
      })
    ).ok,
    true,
  )
  const twenty = await r.grid()
  assert.equal(twenty.rows.length, 20)
  assert.equal(twenty.rows[0]!.uomId, 'pack-18')
  assert.equal(twenty.rows[19]!.uomId, 'box')
  const tooMany = await r.saveGrid({ added: [added('extra', 'pack-19')] })
  assert.equal(tooMany.ok, false)
  assert.match(JSON.stringify(tooMany), /limit/)
  assert.deepEqual(await r.grid(), twenty)
  for (const changes of [
    { updated: [{ id: twenty.rows[0]!.id, values: { companyId: 'other' } }] },
    { added: [added('new', 'pack-19')], removed: [twenty.rows[0]!.id], order: ['foreign-row'] },
    { updated: [{ id: 'unknown-row', values: { barcode: '' } }] },
  ])
    assert.equal((await r.saveGrid(changes)).ok, false)
  assert.deepEqual(await r.grid(), twenty)
})

async function outcome(action: Promise<Row>): Promise<Row> {
  try {
    return await action
  } catch (error) {
    const body = (error as { body?: Row }).body
    if (body?.code === 'conflict') return { ok: false, errors: [body] }
    throw error
  }
}

test('P35 concurrent grids and legacy additions cannot silently overwrite each other', async (t) => {
  const r = await boot(t)
  const before = await r.grid(),
    red = String(r.products[0]!.id),
    blue = String(r.products[1]!.id)
  const results = await Promise.all([
    outcome(r.saveGrid({ added: [added('red', 'case', red)] }, before.revision)),
    outcome(r.saveGrid({ added: [added('blue', 'case', blue)] }, before.revision)),
  ])
  assert.equal(results.filter((row) => row.ok === true).length, 1)
  assert.equal(results.filter((row) => row.ok === false).length, 1)
  assert.match(JSON.stringify(results.find((row) => row.ok === false)), /conflict/)
  await r.save('uom.saveUnit', { id: 'extra', name: 'Extra', relativeUomId: 'each', relativeFactor: '7' })
  const current = await r.grid(),
    shared = current.rows.find((row) => row.uomId === 'box')!
  const [legacy, grid] = await Promise.all([
    outcome(r.call('product.addTemplateUom', { templateId: 'goods', uomId: 'extra' })),
    outcome(r.saveGrid({ removed: [shared.id] }, current.revision)),
  ])
  assert.ok(legacy.ok || grid.ok)
  const after = await r.grid()
  assert.equal(
    after.rows.some((row) => row.uomId === 'extra'),
    legacy.ok === true,
  )
  assert.equal(
    after.rows.some((row) => row.uomId === 'box'),
    grid.ok !== true,
  )
})

test('P35 cross-product concurrent barcode claims have one winner and roll back the loser', async (t) => {
  const r = await boot(t, false)
  await r.save('product.saveRecord', {
    id: 'second',
    name: 'Second',
    type: 'goods',
    uomId: 'each',
    defaultCode: 'SECOND',
  })
  const second = (
    await r.app.client.call<PackagingGridData>('product.getPackagingGrid', { templateId: 'second' })
  ).value
  const results = await Promise.all([
    r.saveGrid({ added: [added('first', 'case', '*', '96385074')] }),
    r.call('product.savePackagingGrid', {
      templateId: 'second',
      expectedRevisionId: second.revision,
      changes: { added: [added('second', 'case', '*', '00000096385074')] },
    }),
  ])
  assert.equal(results.filter((row) => row.ok === true).length, 1)
  assert.equal(results.filter((row) => row.ok === false).length, 1)
  assert.match(JSON.stringify(results.find((row) => row.ok === false)), /barcodeTaken/)
  const firstAfter = await r.grid(),
    secondAfter = (
      await r.app.client.call<PackagingGridData>('product.getPackagingGrid', { templateId: 'second' })
    ).value
  assert.equal(
    firstAfter.rows.some((row) => row.uomId === 'case'),
    results[0]!.ok === true,
  )
  assert.equal(
    secondAfter.rows.some((row) => row.uomId === 'case'),
    results[1]!.ok === true,
  )
  if (results[1]!.ok === false) assert.deepEqual(secondAfter, second)
})

test('P35 nullable ordering migration preserves legacy packaging IDs and barcode claims', async (t) => {
  const r = await boot(t, false)
  await r.save('product.addProductUom', { productId: r.productId, uomId: 'box', barcode: '4006381333931' })
  const before = await r.grid(),
    adapter = r.app.adapter!
  const manifest = compose(r.deployment.modules, { headless: true, companies: true })
  const oldModules = r.deployment.modules.map((module) => {
    if (typeof module === 'string' || module.name !== 'product') return module
    const models = { ...module.models! }
    for (const name of ['TemplateUom', 'ProductUom']) {
      const model = models[name]!
      const { sequence: _sequence, ...fields } = model.fields
      models[name] = { ...model, fields }
    }
    return { ...module, models }
  })
  await adapter.exec('ALTER TABLE product_template_uom DROP COLUMN sequence')
  await adapter.exec('ALTER TABLE product_product_uom DROP COLUMN sequence')
  await adapter.run(
    `UPDATE ket_migration SET schema = ${adapter.name === 'postgres' ? '$1' : '?'} WHERE id = 1`,
    [JSON.stringify(schemaFromManifest(compose(oldModules, { headless: true, companies: true })))],
  )
  await migrateOne(adapter, manifest)
  assert.deepEqual(await r.grid(), before)
  const claims = await adapter.all("SELECT code FROM product_barcode_claim WHERE code = '04006381333931'")
  assert.equal(claims.length, 1)
  assert.deepEqual(await migrateOne(adapter, manifest), [])
})
