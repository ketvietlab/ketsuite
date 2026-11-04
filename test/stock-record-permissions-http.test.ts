import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { boot } from './fixtures/sale/commerce.ts'

async function setup(t: TestContext) {
  const r = await boot(t)
  await r.save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await r.save('stock.saveLocation', { id: 'customer', name: 'Customer', usage: 'customer' })
  await r.save('stock.savePickingType', {
    id: 'out',
    name: 'Delivery',
    code: 'outgoing',
    defaultLocationSrcId: 'wh:stock',
    defaultLocationDestId: 'customer',
  })
  await r.save('stock.createPicking', { id: 'pick', name: 'Delivery audit', pickingTypeId: 'out' })
  await r.fixture('user.saveRole', { id: 'reader', name: 'Reader' })
  await r.fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Reader',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'reader-company', userId: 'reader', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'reader' })
  const grant = async (fnKey: string) => {
    const result = await r.fixture('user.grantFunction', { id: fnKey, roleId: 'reader', fnKey })
    assert.notEqual(result.ok, false, JSON.stringify(result))
  }
  const reader = r.app.client.anonymous()
  await reader.login({ login: 'reader', password: 'test-password' })
  return { ...r, reader, grant }
}

type TransferContext = {
  record: Record<string, unknown>
  permissions: Record<string, boolean>
  collaboration: Array<{ island: string }>
  /** What the scheduled day plans, which names it on the page. */
  kind?: string | null
}
/** What a transfer's page renders from: the record runtime's context, as `client` sees it. */
const contextOf = async (client: { get: (path: string) => Promise<Response> }, lang = 'en') => {
  const response = await client.get(`/admin/stock/transfer/pick/context?lang=${lang}`)
  assert.equal(response.status, 200)
  return ((await response.json()) as { data: TransferContext }).data
}
const islandsOf = (context: TransferContext) => context.collaboration.map((entry) => entry.island)

test('Commerce stock reader sees the record without optional reads or unauthorized controls', async (t) => {
  const r = await setup(t)
  assert.equal((await r.reader.get('/admin/stock/transfers/pick')).status, 403)
  assert.equal((await r.reader.get('/admin/stock/transfer/pick/context')).status, 403)
  await r.grant('stock.getPicking')
  for (const lang of ['vi', 'en']) {
    // The page is the record runtime's island, loading; its guide sits beside it once.
    const page = await r.reader.get(`/admin/stock/transfers/pick?lang=${lang}`)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /data-ui="record-page"/)
    assert.match(html, /data-island="stock\.transfer-page"/)
    assert.match(html, /<title>Delivery audit<\/title>/)
    assert.equal((html.match(/id="stock-transfer-help"/g) ?? []).length, 1)
    const context = await contextOf(r.reader, lang)
    assert.equal(context.record.name, 'Delivery audit')
    // A delivery's page names its day "Ngày dự kiến xuất".
    assert.equal(context.kind, 'outgoing')
    assert.deepEqual(islandsOf(context), [])
    for (const name of ['confirmPicking', 'assignPicking', 'validatePicking', 'cancelPicking', 'addMove'])
      assert.equal(context.permissions[name], false, name)
  }
  // The page keeps no form of its own to write through.
  assert.equal(
    (await r.reader.post('/admin/stock/transfers/pick', new URLSearchParams({ action: 'cancel' }))).status,
    405,
  )
  assert.equal((await r.call('stock.getPicking', { id: 'pick' })).state, 'draft')
})

test('Commerce stock collaboration requires every provider read, and authorized controls remain', async (t) => {
  const r = await setup(t)
  await r.grant('stock.getPicking')
  await r.grant('stock.listStorableProducts')
  assert.deepEqual(islandsOf(await contextOf(r.reader)), [])
  await r.grant('stock_mail_backend.timeline')
  // Commerce does not compose the optional Stock activity bridge.
  assert.deepEqual(islandsOf(await contextOf(r.reader)), ['mail.chatter'])
  await r.grant('stock.confirmPicking')
  const granted = await contextOf(r.reader)
  assert.equal(granted.permissions.confirmPicking, true)
  assert.equal(granted.permissions.cancelPicking, false)
  const owned = await contextOf(r.app.client)
  assert.deepEqual(islandsOf(owned), ['mail.chatter'])
  assert.equal(owned.permissions.cancelPicking, true)
})

test('Commerce sales manager can follow a delivery link without a forbidden chatter request', async (t) => {
  const r = await setup(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await r.fixture('user.assignRole', {
    id: 'manager-role',
    userId: 'reader',
    roleId: 'commerce.sales-manager',
  })
  const page = await r.reader.get('/admin/stock/transfers/pick?lang=vi')
  assert.equal(page.status, 200)
  assert.match(await page.text(), /data-island="stock\.transfer-page"/)
  const context = await contextOf(r.reader, 'vi')
  assert.deepEqual(islandsOf(context), [])
  assert.equal(context.permissions.cancelPicking, false)
})

test('Commerce direct transfer remains scoped to its company', async (t) => {
  const r = await setup(t)
  await r.grant('stock.getPicking')
  await r.fixture('stock.saveWarehouse', { id: 'other-wh', name: 'Other', code: 'OTHER' }, 'other')
  await r.fixture(
    'stock.createPicking',
    { id: 'foreign', name: 'Foreign transfer', pickingTypeId: 'other-wh:incoming' },
    'other',
  )
  assert.equal((await r.fixture('stock.getPicking', { id: 'foreign' }, 'other')).id, 'foreign')
  assert.equal((await r.reader.get('/admin/stock/transfers/foreign?company=other')).status, 404)
  assert.equal((await r.reader.get('/admin/stock/transfer/foreign/context?company=other')).status, 404)
})
