// The search-filter bar over the purchasing lists.
//
// Requests for quotation, confirmed orders and the vendor price list each read a
// bounded collection and narrow it in memory, so what is worth proving over real
// HTTP is that the URL the bar writes is the URL the page reads: the query, a
// state preset, a grouped table, and a favourite that survives a round trip.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const RFQS = '/admin/purchase/rfqs'
const PRICELISTS = '/admin/purchase/vendor-pricelists'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'abc', kind: 'company', name: 'Nhà cung cấp ABC' })
  await fixture('partner.savePartner', { id: 'xyz', kind: 'company', name: 'Nhà cung cấp XYZ' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  const call = (name: string, input: Record<string, unknown> = {}) => app.client.call(name, input)
  await call('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'goods',
    name: 'Bàn làm việc',
    type: 'goods',
    uomId: 'unit',
    listPrice: '2000000',
    purchaseOk: true,
  })
  await call('product.saveVariant', {
    id: 'desk',
    templateId: 'goods',
    defaultCode: 'BAN',
    combinationKey: '',
  })
  await call('stock.saveLocation', { id: 'supplier', name: 'Nhà cung cấp', usage: 'supplier' })
  await call('stock.saveLocation', { id: 'stock', name: 'Kho chính', usage: 'internal' })
  await call('stock.savePickingType', {
    id: 'incoming',
    name: 'Nhập hàng',
    code: 'incoming',
    defaultLocationSrcId: 'supplier',
    defaultLocationDestId: 'stock',
  })
  await call('purchase.createOrder', { id: 'rfq-abc', partnerId: 'abc', pickingTypeId: 'incoming' })
  await call('purchase.createOrder', { id: 'rfq-xyz', partnerId: 'xyz', pickingTypeId: 'incoming' })
  await call('purchase.sendRfq', { id: 'rfq-xyz' })
  await call('purchase.saveSupplierInfo', {
    id: 'abc:desk',
    partnerId: 'abc',
    productTemplateId: 'goods',
    productId: 'desk',
    productUomId: 'unit',
    minQty: '10',
    price: '1500000',
    discount: '5',
    delay: 2,
  })
  await call('purchase.saveSupplierInfo', {
    id: 'xyz:desk',
    partnerId: 'xyz',
    productTemplateId: 'goods',
    productId: 'desk',
    productUomId: 'unit',
    minQty: '0',
    price: '1600000',
    discount: '0',
    delay: 5,
  })
  return app
}

test('purchase RFQs HTTP: the bar replaces the GET search and drives the same URL state', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${RFQS}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.doesNotMatch(allHtml, /name="q"[^>]*data-ui="chrome-search-input"/)
  assert.match(allHtml, /data-row="rfq-abc"/)
  assert.match(allHtml, /data-row="rfq-xyz"/)

  const searched = await (await app.client.get(`${RFQS}?lang=vi&q=XYZ`)).text()
  assert.match(searched, /data-row="rfq-xyz"/)
  assert.doesNotMatch(searched, /data-row="rfq-abc"/)

  const draft = await (await app.client.get(`${RFQS}?lang=vi&preset=draft`)).text()
  assert.match(draft, /data-row="rfq-abc"/)
  assert.doesNotMatch(draft, /data-row="rfq-xyz"/)

  // Alternatives within one group, so asking for both keeps both requests.
  const both = await (await app.client.get(`${RFQS}?lang=vi&preset=draft&preset=sent`)).text()
  assert.match(both, /data-row="rfq-abc"/)
  assert.match(both, /data-row="rfq-xyz"/)

  const grouped = await (await app.client.get(`${RFQS}?lang=vi&group=state`)).text()
  assert.match(grouped, /data-ui="kt-group-toggle"/)
  assert.doesNotMatch(grouped, /data-ui="kt-row"/)
  const open = grouped.match(/data-ui="kt-group-toggle" href="([^"]+)" aria-expanded="false"/)
  assert.ok(open, 'a group must be expandable')
  assert.match(await (await app.client.get(open[1]!.replaceAll('&amp;', '&'))).text(), /data-ui="kt-row"/)
})

test('purchase vendor price list HTTP: the tiered preset narrows to lines above a quantity', async (t) => {
  const app = await boot(t)
  const tiered = await (await app.client.get(`${PRICELISTS}?lang=vi&preset=tiered`)).text()
  assert.match(tiered, /data-row="abc:desk"/)
  assert.doesNotMatch(tiered, /data-row="xyz:desk"/)
})

test('purchase vendor price list HTTP: validity presets narrow to prices in force, ahead or expired today', async (t) => {
  const app = await boot(t)
  const price = (id: string, dates: Record<string, string>) =>
    app.client.call('purchase.saveSupplierInfo', {
      id,
      partnerId: 'abc',
      productTemplateId: 'goods',
      productUomId: 'unit',
      price: '1000000',
      ...dates,
    })
  await price('abc:past', { dateStart: '2020-01-01', dateEnd: '2020-12-31' })
  await price('abc:later', { dateStart: '2099-01-01' })
  const rows = async (preset: string) =>
    [
      ...(await (await app.client.get(`${PRICELISTS}?lang=vi&preset=${preset}`)).text()).matchAll(
        /data-row="([^"]+)"/g,
      ),
    ]
      .map((match) => match[1])
      .sort()
  assert.deepEqual(await rows('current'), ['abc:desk', 'xyz:desk'])
  assert.deepEqual(await rows('upcoming'), ['abc:later'])
  assert.deepEqual(await rows('expired'), ['abc:past'])
  // Without the renderer's hydration markers, so a cell reads as its text.
  const all = (await (await app.client.get(`${PRICELISTS}?lang=vi`)).text()).replace(/<!--k\[?-->/g, '')
  assert.match(
    all,
    /data-row="abc:past"[\s\S]*?data-col="validity"[\s\S]*?data-value="expired"[^>]*>(?:<span[^>]*>)?Hết hạn<[\s\S]*?1\/1\/20 – 31\/12\/20/,
  )
  assert.match(
    all,
    /data-row="abc:later"[\s\S]*?data-value="upcoming"[^>]*>(?:<span[^>]*>)?Sắp hiệu lực<[\s\S]*?Từ 1\/1\/99/,
  )
  assert.match(all, /id="purchase-vendor-pricelist-help"/)
})

test('purchase lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${RFQS}?lang=vi`

  const applied = await app.client.call<{ href: string }>('purchase_backend.applySearchFilter', {
    listKey: 'purchase.rfqs',
    returnTo,
    query: 'ABC',
    facets: [{ id: 'preset:draft', type: 'filter', label: 'Draft' }],
    groupBy: ['state'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, RFQS)
  assert.equal(href.searchParams.get('q'), 'ABC')
  assert.deepEqual(href.searchParams.getAll('preset'), ['draft'])
  assert.deepEqual(href.searchParams.getAll('group'), ['state'])

  const favorite = await app.client.call<{ id: string }>('purchase_backend.saveSearchFavorite', {
    name: 'Yêu cầu còn nháp',
    isDefault: true,
    state: {
      listKey: 'purchase.rfqs',
      returnTo,
      facets: [{ id: 'preset:draft', type: 'filter', label: 'Draft' }],
      groupBy: [],
      customFilters: [],
    },
  })
  const reopened = await app.client.call<{ href: string }>('purchase_backend.applySearchFilter', {
    listKey: 'purchase.rfqs',
    returnTo,
    favoriteId: favorite.value.id,
    facets: [],
    groupBy: [],
    customFilters: [],
  })
  assert.deepEqual(new URL(reopened.value.href, 'http://ket.local').searchParams.getAll('preset'), ['draft'])
  assert.match(await (await app.client.get(returnTo)).text(), /Yêu cầu còn nháp/)

  await app.client.call('purchase_backend.deleteSearchFavorite', {
    listKey: 'purchase.rfqs',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Yêu cầu còn nháp/)
})

test('purchase lists HTTP: every purchasing list carries the bar', async (t) => {
  const app = await boot(t)
  for (const path of [RFQS, '/admin/purchase/orders', PRICELISTS]) {
    const response = await app.client.get(`${path}?lang=vi`)
    const html = await response.text()
    assert.equal(response.status, 200, path)
    assert.match(html, /data-island="backend\.search-filter"/, path)
    assert.doesNotMatch(html, /name="q"[^>]*data-ui="chrome-search-input"/, path)
  }
})

test('purchase overview HTTP: each counter opens the list narrowed to what it counts', async (t) => {
  const app = await boot(t)
  const call = (name: string, input: Record<string, unknown> = {}) => app.client.call(name, input)
  // A service is billed on what was ordered, so its confirmed order waits for a bill; goods
  // wait for their receipt first.
  await call('product.saveTemplate', {
    id: 'fitting',
    name: 'Lắp đặt',
    type: 'service',
    uomId: 'unit',
    purchaseOk: true,
  })
  await call('product.saveVariant', {
    id: 'fit',
    templateId: 'fitting',
    defaultCode: 'LAP',
    combinationKey: '',
  })
  for (const [id, productId] of [
    ['po-fit', 'fit'],
    ['po-desk', 'desk'],
  ] as const) {
    await call('purchase.createOrder', { id, partnerId: 'abc', pickingTypeId: 'incoming' })
    await call('purchase.addLine', {
      id: `${id}:line`,
      orderId: id,
      productId,
      productQty: '2',
      productUomId: 'unit',
    })
    await call('purchase.confirmOrder', { id })
  }

  const overview = await (await app.client.get('/admin/purchase?lang=vi')).text()
  const counters = [...overview.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(([, href, inner]) => ({
      href: href!.replaceAll('&amp;', '&'),
      text: inner!
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter(
      ({ text }) =>
        /\d+$/.test(text) && /^(Cần gửi|Đang chờ|Chờ duyệt|Đơn mua hàng|Chờ lập hoá đơn) /.test(text),
    )
  const rows = async (href: string) =>
    [
      ...(await (await app.client.get(href)).text()).matchAll(
        /data-ui="kt-row"[^>]*data-row="([^"]+)"|data-row="([^"]+)"[^>]*data-ui="kt-row"/g,
      ),
    ]
      .map((match) => match[1] ?? match[2])
      .sort()
  const seen = Object.fromEntries(
    await Promise.all(counters.map(async ({ href, text }) => [text, await rows(href)] as const)),
  )
  assert.deepEqual(seen, {
    'Cần gửi 1': ['rfq-abc'],
    'Đang chờ 1': ['rfq-xyz'],
    'Chờ duyệt 0': [],
    'Đơn mua hàng 2': ['po-desk', 'po-fit'],
    'Chờ lập hoá đơn 1': ['po-fit'],
  })
})
