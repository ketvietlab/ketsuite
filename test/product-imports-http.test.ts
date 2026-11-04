import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'
const sheet = (rows: string[]) => ['Product code\tProduct name\tUnit\tSales price', ...rows].join('\n')
test('P52 creates one immutable receipt; no-op and replay preserve product revision', async (t) => {
  const r = await boot(t)
  const data = sheet(['TEA\tTea\tEach\t159.000'])
  const imported = await r.save('product.importProducts', { id: 'import-1', data })
  assert.equal(imported.name, 'NHAP/0001')
  assert.equal(imported.createdCount, 1)
  const detail = await r.call('product.getImport', { id: 'import-1' })
  const id = String((detail.items as Row[])[0]!.templateId)
  const before = await r.call('product.getTemplate', { id })
  const replay = await r.save('product.importProducts', { id: 'import-1', data })
  assert.equal(replay.name, imported.name)
  const noop = await r.save('product.importProducts', { id: 'import-2', data })
  assert.equal(noop.createdCount, 0)
  assert.equal(noop.changedCount, 0)
  assert.equal(noop.variantCount, 0)
  const after = await r.call('product.getTemplate', { id })
  assert.deepEqual(after, before)
  const conflict = await r.call('product.importProducts', {
    id: 'import-1',
    data: sheet(['TEA\tChanged\tEach\t10']),
  })
  assert.equal(conflict.ok, false)
  const history = await r.call('product.listImports', { templateId: id })
  assert.equal(history.total, 2)
  assert.ok((history.rows as Row[]).every((row) => !Object.hasOwn(row, 'data')))
})
test('P53 a last-row refusal rolls back products, counts and numbering', async (t) => {
  const r = await boot(t)
  const failed = await r.call('product.importProducts', {
    id: 'bad',
    data: sheet(['TEA\tTea\tEach\t100', 'BAD\tBad\tMissing unit\t100']),
  })
  assert.equal(failed.ok, false)
  assert.equal((failed.errors as Row[])[0]?.row, 3)
  assert.equal((await r.call('product.listImports', {})).total, 0)
  const good = await r.save('product.importProducts', { id: 'good', data: sheet(['TEA\tTea\tEach\t100']) })
  assert.equal(good.name, 'NHAP/0001')
  assert.equal(good.createdCount, 1)
})
test('P53 groups codes without case; first nonblank product fields win', async (t) => {
  const r = await boot(t)
  const saved = await r.save('product.importProducts', {
    id: 'group',
    data: sheet(['tea\t\tEach\t', 'TEA\tTea\tEach\t159,000', 'Tea\tIgnored\tEach\t200']),
  })
  assert.equal(saved.rowCount, 3)
  assert.equal(saved.createdCount, 1)
  const detail = await r.call('product.getImport', { id: 'group' })
  assert.equal((detail.items as Row[])[0]?.name, 'Tea')
})

test('P54 exported SKU codes, exact prices and escaped attributes import back without changes', async (t) => {
  const r = await boot(t)
  await r.save('product.saveAttributeDraft', {
    id: 'size',
    name: 'Size: label',
    displayType: 'select',
    createVariant: 'always',
    values: [
      { id: 'small', name: 'S;small' },
      { id: 'large', name: 'L' },
    ],
  })
  const data =
    'Product code\tProduct name\tUnit\tSales price\tAttribute values\tVariant code\tVariant price\tCost\nTEA\tTea\tEach\t0.1230\tSize\\: label:S\\;small\tTEA-S\t1.2340\t9007199254740993\nTEA\tTea\tEach\t0.1230\tSize\\: label:L\tTEA-L\t\t12'
  const first = await r.save('product.importProducts', { id: 'variants', data })
  assert.equal(first.createdCount, 1)
  assert.equal(first.variantCount, 2)
  const exported = await r.save('product.exportImportSheet', { locale: 'en' })
  assert.equal(exported.rowCount, 2)
  const before = await r.call('product.getImport', { id: 'variants' })
  const id = String((before.items as Row[])[0]!.templateId)
  const revision = (await r.call('product.getTemplate', { id })).revisionId
  const roundtrip = await r.save('product.importProducts', { id: 'roundtrip', data: exported.csv })
  assert.equal(roundtrip.changedCount, 0)
  assert.equal(roundtrip.variantCount, 0)
  assert.equal((await r.call('product.getTemplate', { id })).revisionId, revision)
})
test('P52 only product keepers import; readers see receipts with cost redaction', async (t) => {
  const r = await boot(t)
  await r.save('account.saveTax', {
    id: 'vat',
    name: 'VAT 10%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const clients = new Map()
  for (const [id, roleId] of [
    ['manager', 'commerce.sales-manager'],
    ['warehouse', 'commerce.warehouse-operator'],
  ]) {
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: id + '-company', userId: id, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: id + '-role', userId: id, roleId })
    const client = r.app.client.anonymous()
    await client.login({ login: id!, password: 'test-password' })
    clients.set(id, client)
  }
  const data = 'Product code\tProduct name\tUnit\tVAT\tCost\nTEA\tTea\tEach\tVAT 10%\t987654'
  const result = (await clients.get('manager').call('product.importProducts', { id: 'managed', data })).value
  assert.equal(result.ok, true, JSON.stringify(result))
  await assert.rejects(
    () => clients.get('warehouse').call('product.importProducts', { id: 'forged', data }),
    { status: 403 },
  )
  const detail = (await clients.get('warehouse').call('product.getImport', { id: 'managed', locale: 'en' }))
    .value
  assert.equal(detail.record.costRedacted, true)
  assert.ok(!JSON.stringify(detail).includes('987654'))
  const exported = (await clients.get('warehouse').call('product.exportImportSheet', { locale: 'en' })).value
  assert.equal(exported.costIncluded, false)
  assert.ok(!String(exported.csv).includes('987654'))
  assert.equal(
    (await r.call('product.getImport', { id: 'managed' })).record &&
      ((await r.call('product.getImport', { id: 'managed' })).record as Row).data,
    data,
  )
})
test('P53 stocked cost refusal rolls back a simultaneous name change', async (t) => {
  const r = await boot(t)
  await r.save('product.saveRecord', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    isStorable: true,
    tracking: 'none',
    costPrice: '20',
  })
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await r.save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'count',
    productId: 'goods:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '5',
    productUomId: 'each',
  })
  const before = await r.call('product.getTemplate', { id: 'goods' })
  const refused = await r.call('product.importProducts', {
    id: 'stocked',
    data: 'Product code\tProduct name\tCost\nGOODS\tChanged\t30',
  })
  assert.equal(refused.ok, false)
  assert.equal((refused.errors as Row[])[0]?.column, 'cost')
  assert.deepEqual(await r.call('product.getTemplate', { id: 'goods' }), before)
  assert.equal((await r.call('product.listImports', {})).total, 0)
})

test('P52 concurrent replay yields one receipt and independent imports retain unique numbering', async (t) => {
  const r = await boot(t),
    data = sheet(['TEA\tTea\tEach\t100'])
  const results = await Promise.all([
    r.call('product.importProducts', { id: 'race', data }),
    r.call('product.importProducts', { id: 'race', data }),
  ])
  assert.ok(results.some((result) => result.ok === true))
  assert.equal((await r.call('product.listImports', {})).total, 1)
  assert.equal((await r.save('product.importProducts', { id: 'race', data })).name, 'NHAP/0001')
  const distinct = await Promise.all(
    ['COFFEE', 'JUICE'].map((id) =>
      r.call('product.importProducts', { id, data: sheet([id + '\t' + id + '\tEach\t100']) }),
    ),
  )
  for (const [index, result] of distinct.entries())
    if (!result.ok) {
      const id = ['COFFEE', 'JUICE'][index]!
      await r.save('product.importProducts', { id, data: sheet([id + '\t' + id + '\tEach\t100']) })
    }
  const receipts = (await r.call('product.listImports', {})).rows as Row[]
  assert.deepEqual(receipts.map((row) => row.name).sort(), ['NHAP/0001', 'NHAP/0002', 'NHAP/0003'])
})
test('P52 active-company name resolution and receipt reads isolate a multi-company user', async (t) => {
  const r = await boot(t)
  await r.fixture('uom.saveUnit', { id: 'other-each', name: 'Each', relativeFactor: '1' }, 'other')
  await r.fixture(
    'product.importProducts',
    { id: 'other-import', data: sheet(['TEA\tOther tea\tEach\t200']) },
    'other',
  )
  await r.fixture('user.grantCompany', { id: 'owner-other', userId: 'owner', companyId: 'other' })
  const result = await r.save('product.importProducts', {
    id: 'own-import',
    data: sheet(['TEA\tOwn tea\tEach\t100']),
  })
  assert.equal(result.createdCount, 1)
  assert.equal(result.name, 'NHAP/0001')
  assert.equal((await r.call('product.getImport', { id: 'other-import' })).record, null)
  assert.equal((await r.call('product.listImports', {})).total, 1)
  const exported = await r.save('product.exportImportSheet', { locale: 'en' })
  assert.ok(String(exported.csv).includes('Own tea'))
  assert.ok(!String(exported.csv).includes('Other tea'))
})
test('P53 missing choices and invalid variant codes report the source row and roll back', async (t) => {
  const r = await boot(t)
  const invalid = await r.call('product.importProducts', {
    id: 'bad-code',
    data: 'Product code\tProduct name\tUnit\tVariant code\nTEA\tTea\tEach\tBAD CODE',
  })
  assert.equal(invalid.ok, false)
  assert.equal((invalid.errors as Row[])[0]?.column, 'code')
  assert.equal((await r.call('product.listImports', {})).total, 0)
})

test('P54 a plain SKU override keeps the grouping code and exact cost updates', async (t) => {
  const r = await boot(t)
  const data =
    'Product code\tProduct name\tUnit\tVariant code\tVariant price\tCost\nTEA\tTea\tEach\tTEA-OWN\t1.2340\t9007199254740992'
  await r.save('product.importProducts', { id: 'plain', data })
  const exported = await r.save('product.exportImportSheet', { locale: 'en' })
  assert.ok(String(exported.csv).includes('"TEA"'))
  const noop = await r.save('product.importProducts', { id: 'plain-noop', data: exported.csv })
  assert.equal(noop.createdCount, 0)
  assert.equal(noop.changedCount, 0)
  const changed = await r.save('product.importProducts', {
    id: 'exact-cost',
    data: data.replace('9007199254740992', '9007199254740993'),
  })
  assert.equal(changed.changedCount, 1)
  assert.equal(changed.variantCount, 1)
  assert.ok(
    String((await r.save('product.exportImportSheet', { locale: 'en' })).csv).includes('9007199254740993'),
  )
})

test('P53 500 distinct product rows commit together; 501 rows leave no receipt', async (t) => {
  const r = await boot(t)
  const rows = Array.from({ length: 500 }, (_, i) => `BATCH-${i}\tItem ${i}\tEach\t100`)
  const accepted = await r.save('product.importProducts', { id: 'max', data: sheet(rows) })
  assert.equal(accepted.rowCount, 500)
  assert.equal(accepted.createdCount, 500)
  assert.equal(accepted.variantCount, 500)
  const refused = await r.call('product.importProducts', {
    id: 'too-many',
    data: sheet([...rows, 'EXTRA\tExtra\tEach\t100']),
  })
  assert.equal(refused.ok, false)
  assert.equal((await r.call('product.listImports', {})).total, 1)
})

test('P54 an export that cannot round-trip names every product without a stable code', async (t) => {
  const r = await boot(t)
  await r.save('product.importProducts', { id: 'coded', data: sheet(['TEA\tTea\tEach\t100']) })
  for (const [id, name] of [
    ['legacy-a', 'Legacy balm'],
    ['legacy-b', 'Legacy soap'],
  ])
    await r.save('product.saveRecord', {
      id,
      name,
      type: 'goods',
      defaultCode: id.toUpperCase(),
      uomId: 'each',
      listPrice: '100',
      saleOk: true,
    })
  // Records migrated from before codes were required carry none.
  await r.app.fixture.withTenant('', async ({ adapter }) => {
    await adapter.run(`UPDATE product_template SET "variantCodeBase" = NULL WHERE id LIKE 'legacy-%'`)
    await adapter.run(
      `UPDATE product_product SET "defaultCode" = NULL, "codeKey" = NULL WHERE "templateId" LIKE 'legacy-%'`,
    )
  })
  const refused = await r.call('product.exportImportSheet', { locale: 'en' })
  assert.equal(refused.ok, false)
  assert.deepEqual(
    (refused.errors as Row[]).map((issue) => [issue.product, issue.code]),
    [
      ['Legacy balm', 'product.error.import.legacyCode'],
      ['Legacy soap', 'product.error.import.legacyCode'],
    ],
  )
})
