import { saleRecordBack } from '../packages/ketsuite/src/modules/sale_backend/record/routes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row, ServeContext, Route } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
import { orderWorkflowFunction } from '../packages/ketsuite/src/modules/sale_backend/record/workflow.ts'

test('Commerce direct quotation and order pages mount the native record with scoped data and print targets', async (t) => {
  const { app, add } = await setup(t)
  await add()
  for (const path of ['/admin/sales/quotations/order', '/admin/sales/orders/order']) {
    const response = await app.client.get(`${path}?lang=en&company=acme&branch=`)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /sale.order-page/)
    assert.doesNotMatch(html, /\[object Object\]/, 'extension markup must remain renderable')
    assert.doesNotMatch(
      html,
      /name="productUomQty"/,
      'the page reads record and grid data through native context',
    )
    assert.match(html, /company=acme/)
  }
  assert.equal((await app.client.get('/admin/sales/orders/missing')).status, 404)
  const response = await app.client.get('/admin/sales/record/order/context?lang=en')
  assert.equal(response.status, 200)
  const { data } = (await response.json()) as { data: Row }
  assert.equal((data.permissions as Row).applyLineGrid, true)
  assert.equal((data.record as Row).warehouseName, 'Warehouse')
  assert.equal(((data.record as Row).lines as Row[])[0]!.productUomName, 'Box of 12')
  assert.deepEqual(data.reports, [], 'Commerce fixture has no report-renderer route; do not offer dead links')
})

test('Commerce native workflow refuses stale confirmations and cross-origin commands, then refreshes state and reports', async (t) => {
  const { app, add, call } = await setup(t)
  const before = await call('sale.getOrder', { id: 'order' })
  await add()
  const post = (body: Row, origin?: string) =>
    app.client.post('/admin/sales/order-command?lang=en', JSON.stringify(body), {
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    })
  const stale = await post({ command: 'confirmOrder', id: 'order', expectedRevision: before.revision })
  const refused = ((await stale.json()) as { value: Row }).value
  assert.equal(refused.ok, false)
  assert.equal((refused.errors as Row[])[0]!.code, 'sale.error.orderChanged')
  assert.equal((await post({ command: 'confirmOrder', id: 'order' }, 'https://foreign.example')).status, 403)
  assert.equal((await post({ command: 'deleteEverything', id: 'order' })).status, 400)
  const current = await call('sale.getOrder', { id: 'order' })
  const confirmed = await post({ command: 'confirmOrder', id: 'order', expectedRevision: current.revision })
  assert.equal(((await confirmed.json()) as { value: Row }).value.ok, true)
  const { data } = (await (await app.client.get('/admin/sales/record/order/context?lang=en')).json()) as {
    data: Row
  }
  assert.equal((data.record as Row).state, 'sale')
  assert.deepEqual(data.reports, [])
  assert.equal((await app.client.get('/admin/sales/order-command')).status, 405)
})

test('Commerce read-only users see direct records without cost or workflow authority', async (t) => {
  const { app, save, add, fixture } = await setup(t)
  await add()
  await save('sale.confirmOrder', { id: 'order' })
  await save('user.saveRole', { id: 'reader', name: 'Sales reader' })
  for (const fnKey of ['sale.getOrder', 'sale.listOrders'])
    await save('user.grantFunction', { id: `reader-${fnKey}`, roleId: 'reader', fnKey })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    name: 'Reader',
    password: 'test-password',
    defaultCompanyId: 'acme',
  })
  await save('user.grantCompany', { id: 'reader-acme', userId: 'reader', companyId: 'acme' })
  await save('user.assignRole', { id: 'reader-role', userId: 'reader', roleId: 'reader' })
  await app.client.login({ login: 'reader', password: 'test-password' })
  assert.equal((await app.client.get('/admin/sales/quotations/order')).status, 200)
  const { data } = (await (await app.client.get('/admin/sales/record/order/context?lang=en')).json()) as {
    data: Row
  }
  assert.equal((data.permissions as Row).applyLineGrid, false)
  assert.equal((data.permissions as Row).getLineCosts, false)
  assert.equal(data.lineCosts, undefined)
  assert.ok(((data.record as Row).moves as Row[]).length > 0)
  assert.ok(((data.record as Row).moves as Row[]).every((move) => move.pickingHref === null))
  const forged = await app.client.post(
    '/admin/sales/order-command',
    JSON.stringify({ command: 'confirmOrder', id: 'order' }),
    { headers: { 'content-type': 'application/json' } },
  )
  assert.equal(forged.status, 403)
})

test('Workflow selection preserves installed loyalty functions and base fallbacks', async () => {
  const req = {} as Parameters<Route>[1]
  const ctx = {
    live: async () => ({ functions: { 'loyalty_sale.confirmOrder': {} } }),
  } as unknown as ServeContext
  assert.equal(await orderWorkflowFunction(ctx, req, 'confirmOrder'), 'loyalty_sale.confirmOrder')
  assert.equal(await orderWorkflowFunction(ctx, req, 'cancelOrder'), 'sale.cancelOrder')
})

test('Sales record back targets retain list scope and refuse external or unrelated destinations', () => {
  const url = new URL('https://example.test/admin/sales/orders/order?lang=en&company=acme')
  url.searchParams.set('returnTo', '/admin/sales/orders?productId=sku&lang=vi')
  assert.equal(saleRecordBack(url, '/admin/sales/orders'), '/admin/sales/orders?productId=sku&lang=vi')
  for (const target of [
    'https://foreign.example/admin/sales/orders',
    '/admin/users',
    'javascript:alert(1)',
  ]) {
    url.searchParams.set('returnTo', target)
    assert.equal(saleRecordBack(url, '/admin/sales/orders'), '/admin/sales/orders?lang=en&company=acme')
  }
})
