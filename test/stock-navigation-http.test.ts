import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setup } from './fixtures/sale/commerce.ts'

/** The sidebar entries, in order, each with whether it is lit. */
const entries = (html: string) => {
  const nav = html.slice(html.indexOf('data-ui="app-navigation"'))
  return [...nav.matchAll(/<a data-ui="navigation-item"([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: /href="([^"]*)"/.exec(match[1]!)?.[1]?.replaceAll('&amp;', '&') ?? '',
    active: match[1]!.includes('data-active="true"'),
    label: match[2]!.replace(/<[^>]*>/g, '').trim(),
  }))
}

test('K6 K21 K32 the Stock sidebar keeps daily work, a queue per kind of transfer, and lots', async (t) => {
  const r = await setup(t)
  const stock = (html: string) => entries(html).filter((entry) => entry.href.startsWith('/admin/stock'))
  const overview = stock(await (await r.app.client.get('/admin/stock?lang=vi')).text())
  assert.deepEqual(
    overview.map((entry) => entry.label),
    [
      'Tổng quan kho',
      'Tồn kho',
      'Lô hàng',
      'Phiếu nhập kho',
      'Phiếu xuất kho',
      'Phiếu chuyển kho',
      'Tất cả phiếu kho',
      'Bổ sung hàng',
      'Kiểm kê',
      'Phiếu hủy hàng',
      'Chi phí mua kho',
      // K40: titled as its page.
      'Dự báo tồn kho',
      'Lịch sử dịch chuyển',
      'Giá trị tồn kho',
      'Phân tích dịch chuyển',
      'Tuổi tồn kho',
      // K48: shipping closes the menu, as in the mock.
      'Tổng quan giao hàng',
      'Vận hành giao hàng',
      'Danh sách vận đơn',
      'Đối soát vận chuyển',
    ],
  )
  assert.deepEqual(
    overview
      .filter((entry) => entry.label.startsWith('Phiếu ') && entry.href.includes('?'))
      .map((entry) => entry.href),
    [
      '/admin/stock/transfers?preset=receipts',
      '/admin/stock/transfers?preset=deliveries',
      '/admin/stock/transfers?preset=internal',
    ],
  )
  // Each queue is the entry lit on its list, with any other filter beside it; the full list
  // lights its own entry.
  const lit = async (path: string) =>
    stock(await (await r.app.client.get(path)).text())
      .filter((entry) => entry.active)
      .map((entry) => entry.label)
  assert.deepEqual(await lit('/admin/stock/transfers?lang=vi&preset=receipts'), ['Phiếu nhập kho'])
  assert.deepEqual(await lit('/admin/stock/transfers?lang=vi&preset=deliveries&preset=ready'), [
    'Phiếu xuất kho',
  ])
  assert.deepEqual(await lit('/admin/stock/transfers?lang=vi&preset=internal'), ['Phiếu chuyển kho'])
  assert.deepEqual(await lit('/admin/stock/transfers?lang=vi'), ['Tất cả phiếu kho'])
  assert.deepEqual(await lit('/admin/stock/lots?lang=vi'), ['Lô hàng'])
  // Configuration is behind the gear, under its own Stock heading.
  const configuration = ['warehouses', 'locations', 'picking-types', 'routes', 'accounting']
  for (const path of configuration)
    assert.ok(!overview.some((entry) => entry.href.startsWith(`/admin/stock/${path}`)), path)
  const settings = await (await r.app.client.get('/admin/settings?lang=vi')).text()
  for (const path of configuration) assert.match(settings, new RegExp(`href="/admin/stock/${path}[?"]`), path)
  const warehouses = await r.app.client.get('/admin/stock/warehouses?lang=vi')
  assert.equal(warehouses.status, 200)
  assert.ok(!stock(await warehouses.text()).some((entry) => entry.active))
})

test('K21 each transfer queue lists only its kind', async (t) => {
  const r = await setup(t)
  for (const [id, type] of [
    ['IN-1', 'incoming'],
    ['OUT-1', 'outgoing'],
    ['INT-1', 'internal'],
  ] as const)
    await r.save('stock.createPicking', { id, name: id, pickingTypeId: `wh:${type}` })
  const names = async (preset: string) => {
    const html = await (await r.app.client.get(`/admin/stock/transfers?lang=vi${preset}`)).text()
    return ['IN-1', 'OUT-1', 'INT-1'].filter((name) => html.includes(`>${name}<`))
  }
  assert.deepEqual(await names('&preset=receipts'), ['IN-1'])
  assert.deepEqual(await names('&preset=deliveries'), ['OUT-1'])
  assert.deepEqual(await names('&preset=internal'), ['INT-1'])
  assert.deepEqual(await names(''), ['IN-1', 'OUT-1', 'INT-1'])
  // A count adjustment moves goods inside the company but is not a transfer anyone works: it
  // stays out of the internal queue and is still among all transfers.
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'ADJ-1',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '3',
    productUomId: 'each',
  })
  const all = await (await r.app.client.get('/admin/stock/transfers?lang=vi')).text()
  assert.match(all, /data-row="ADJ-1:picking"/)
  const internal = await (await r.app.client.get('/admin/stock/transfers?lang=vi&preset=internal')).text()
  assert.doesNotMatch(internal, /data-row="ADJ-1:picking"/)
  // A queue and a state narrow together: none of these is ready yet.
  assert.deepEqual(await names('&preset=receipts&preset=ready'), [])
  assert.deepEqual(await names('&preset=receipts&preset=draft'), ['IN-1'])
  // The list is headed by the queue it was opened on, and plainly otherwise.
  const heading = async (query: string) =>
    /<h1[^>]*>([\s\S]*?)<\/h1>/
      .exec(await (await r.app.client.get(`/admin/stock/transfers?lang=vi${query}`)).text())?.[1]
      ?.replace(/<!--[\s\S]*?-->/g, '')
      .trim()
  assert.equal(await heading('&preset=receipts'), 'Phiếu nhập kho')
  assert.equal(await heading('&preset=deliveries&preset=ready'), 'Phiếu xuất kho')
  assert.equal(await heading('&preset=internal'), 'Phiếu chuyển kho')
  assert.equal(await heading(''), 'Phiếu kho')
  assert.equal(await heading('&preset=receipts&preset=internal'), 'Phiếu kho')
})

test('K14 sellers and their manager read stock and transfers, never its value', async (t) => {
  const r = await setup(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const login = async (role: string) => {
    await r.fixture('user.createUser', {
      id: role,
      login: role,
      password: 'test-password',
      name: role,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${role}-company`, userId: role, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${role}-role`, userId: role, roleId: `commerce.${role}` })
    const client = r.app.client.anonymous()
    await client.login({ login: role, password: 'test-password' })
    return client
  }
  for (const role of ['sales-representative', 'sales-manager']) {
    const client = await login(role)
    const page = await client.get('/admin/stock/inventory?lang=vi')
    assert.equal(page.status, 200, role)
    const sidebar = entries(await page.text())
      .filter((entry) => entry.href.startsWith('/admin/stock'))
      .map((entry) => entry.label)
    for (const label of ['Tồn kho', 'Lô hàng', 'Phiếu nhập kho', 'Phiếu xuất kho', 'Phiếu chuyển kho'])
      assert.ok(sidebar.includes(label), `${role} reads ${label}`)
    assert.ok(!sidebar.includes('Giá trị tồn kho'), `${role} does not read stock value`)
    assert.equal((await client.get('/admin/stock/transfers?lang=vi&preset=deliveries')).status, 200, role)
    assert.notEqual((await client.get('/admin/stock/valuation?lang=vi')).status, 200, role)
  }
})
