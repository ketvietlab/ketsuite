import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'
type Run = Awaited<ReturnType<typeof boot>>
const search = (r: Run, q: string, extra: Row = {}) =>
  r.call('product_backend.searchCatalogue', { q, ...extra })
const rows = (answer: Row) => answer.rows as Row[]
const kinds = (answer: Row) => [...new Set(rows(answer).map((row) => row.kind))]
async function seed(r: Run) {
  await r.save('product.saveCategory', { id: 'category', name: 'Needle category' })
  await r.save('product.saveTag', { id: 'tag', name: 'Needle tag' })
  await r.save('uom.saveUnit', { id: 'needle-unit', name: 'Needle unit', relativeFactor: '1' })
  await r.save('product.saveAttributeDraft', {
    id: 'attribute',
    name: 'Needle attribute',
    displayType: 'select',
    createVariant: 'always',
    values: [{ id: 'red', name: 'Crimson' }],
  })
  await r.save('product.saveRecord', {
    id: 'needle',
    name: 'Needle product',
    type: 'goods',
    uomId: 'each',
    defaultCode: 'NEEDLE',
    categoryId: 'category',
    tagIds: ['tag'],
  })
  await r.save('product.saveCombo', {
    id: 'combo',
    name: 'Needle combo',
    items: [{ productId: 'needle:default', extraPrice: '0' }],
  })
  await r.save('product.importProducts', {
    id: 'import',
    data: 'Product code\tProduct name\tUnit\nNEEDLE\tNeedle product\tEach',
  })
}
test('P57 searches all eight types using native identities; strips list narrowing and keeps scope', async (t) => {
  const r = await boot(t)
  await seed(r)
  const answer = await search(r, 'needle', {
    href: '/admin/product/search?lang=en&company=forged&branch=north&status=archived&categoryId=missing&tagId=missing&use=service&preset=archived&record=product.template:x',
    pageSize: 1,
  })
  assert.deepEqual(kinds(answer), [
    'template',
    'variant',
    'attribute',
    'unit',
    'category',
    'tag',
    'combo',
    'import',
  ])
  assert.equal(answer.total, 8)
  assert.equal(rows(answer).length, 8)
  const query = answer.query as Row
  assert.equal(query.pageSize, 25)
  assert.doesNotMatch(String(query.href), /status=|categoryId=|tagId=|use=|preset=|record=|forged/)
  for (const row of rows(answer)) {
    assert.deepEqual(Object.keys(row).sort(), ['id', 'recordId', 'name', 'code', 'kind', 'href'].sort())
    const url = new URL(String(row.href), 'http://test')
    assert.equal(url.searchParams.get('company'), 'acme')
    assert.equal(url.searchParams.get('lang'), 'en')
    assert.equal(url.searchParams.get('branch'), 'north')
    assert.match(url.searchParams.get('returnTo')!, /^\/admin\/product\/search\?/)
    if (['template', 'variant'].includes(String(row.kind)))
      assert.equal(url.pathname, '/admin/product/templates/needle')
    else assert.match(url.searchParams.get('record')!, /^product\./)
  }
  assert.equal((await search(r, '   ')).total, 0)
  assert.equal((await search(r, 'not-found')).total, 0)
  assert.ok(kinds(await search(r, 'NHAP/0001')).includes('import'))
})
test('P57 folds accents; searches SKU and packaging barcodes, attribute values and tags', async (t) => {
  const r = await boot(t)
  await seed(r)
  await r.save('product.saveAttributeLine', {
    id: 'line',
    templateId: 'needle',
    attributeId: 'attribute',
    valueIds: ['red'],
  })
  await r.save('product.generateVariants', { templateId: 'needle' })
  const variants = (await r.app.client.call<Row[]>('product.listVariants', { templateId: 'needle' })).value
  const id = String(variants[0]!.id)
  await r.save('product.setBarcode', { productId: id, barcode: '4006381333931' })
  await r.save('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'each', relativeFactor: '12' })
  await r.save('product.addProductUom', { productId: id, uomId: 'box', barcode: '5901234123457' })
  assert.deepEqual(kinds(await search(r, '4006381333931')), ['template', 'variant'])
  assert.deepEqual(kinds(await search(r, '5901234123457')), ['template', 'variant'])
  assert.equal((await r.call('product_backend.searchVariants', { q: '5901234123457' })).total, 1)
  assert.equal((await r.call('product_backend.searchImports', { q: 'needle' })).total, 1)
  assert.deepEqual(kinds(await search(r, 'Crimson')), ['variant', 'attribute'])
  assert.ok(kinds(await search(r, 'Needle tag')).includes('template'))
  await r.save('product.saveTag', { id: 'accent', name: 'Đồ uống' })
  assert.deepEqual(kinds(await search(r, 'do uong')), ['tag'])
})
test('P57 paginates across providers at 25 and clamps an out-of-range page without duplicates', async (t) => {
  const r = await boot(t)
  for (let i = 0; i < 27; i++)
    await r.save('product.saveRecord', {
      id: `item-${i}`,
      name: `Page ${String(i).padStart(2, '0')}`,
      defaultCode: `PAGE-${i}`,
      type: 'goods',
      uomId: 'each',
    })
  const first = await search(r, 'Page'),
    second = await search(r, 'Page', { page: 2 }),
    third = await search(r, 'Page', { page: 999 })
  assert.equal(first.total, 54)
  assert.equal(first.pages, 3)
  assert.equal(rows(first).length, 25)
  assert.equal(rows(second).length, 25)
  assert.deepEqual(kinds(second), ['template', 'variant'])
  assert.equal(third.page, 3)
  assert.equal(rows(third).length, 4)
  assert.equal(third.next, undefined)
  assert.equal(new Set([...rows(first), ...rows(second), ...rows(third)].map((row) => row.id)).size, 54)
  assert.match(String(second.previous), /q=Page/)
  assert.match(String(first.next), /page=2/)
})
test('P57 excludes archived products and their SKUs, archived configuration and foreign companies', async (t) => {
  const r = await boot(t)
  await seed(r)
  const held = await r.call('product.getTemplate', { id: 'needle' })
  await r.save('product.archiveTemplate', {
    id: 'needle',
    active: false,
    confirmed: true,
    reason: 'Catalogue retired',
    expectedRevisionId: held.revisionId,
  })
  const tags = (await r.app.client.call<Row[]>('product.listTags', {})).value
  await r.save('product.setTagActive', { id: 'tag', active: false, expectedRevisionId: tags[0]!.revisionId })
  await r.fixture('product.saveTemplate', { id: 'foreign', name: 'Needle secret', type: 'service' }, 'other')
  await r.fixture('product.saveTag', { id: 'foreign-tag', name: 'Needle foreign' }, 'other')
  const answer = await search(r, 'Needle')
  assert.ok(!kinds(answer).includes('template'))
  assert.ok(!kinds(answer).includes('variant'))
  assert.ok(!kinds(answer).includes('tag'))
  assert.doesNotMatch(JSON.stringify(answer), /Needle secret|Needle foreign/)
})
test('P57 requires both list and target permission for each result and the page itself is guarded', async (t) => {
  const r = await boot(t)
  await seed(r)
  await r.fixture('user.saveRole', { id: 'limited', name: 'Limited' })
  await r.fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'limited' })
  const client = r.app.client.anonymous()
  await client.login({ login: 'reader', password: 'test-password' })
  assert.equal((await client.get('/admin/product/search?q=Needle')).status, 403)
  const grant = async (fnKey: string) =>
    r.fixture('user.grantFunction', { id: fnKey, roleId: 'limited', fnKey })
  await grant('product_backend.searchCatalogue')
  await grant('product_backend.searchTags')
  assert.equal((await client.call<Row>('product_backend.searchCatalogue', { q: 'Needle' })).value.total, 0)
  await grant('product_backend.tagContext')
  const answer = (await client.call<Row>('product_backend.searchCatalogue', { q: 'Needle' })).value
  assert.deepEqual(kinds(answer), ['tag'])
  assert.equal(answer.total, 1)
  assert.equal((await client.get('/admin/product/search?q=Needle')).status, 200)
  const target = await client.get(String(rows(answer)[0]!.href))
  assert.equal(target.status, 200)
})
