import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { sqliteStore } from '@ketvietlab/ketjs'
import type { Row, ServeContext } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { productPageLink } from '../packages/ketsuite/src/modules/backend/product-page.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'

// P24: a stock row and a lot open the product they hold, for a reader who may read it.

async function boot(t: TestContext) {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const fixture = async (fn: string, input: Row, company = 'acme') =>
    (await app.fixture.call<Row>(fn, input, { scope: { company, branches: null } })).value
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'acme' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'owner',
    login: 'owner',
    password: 'test-password',
    name: 'Owner',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'owner-acme', userId: 'owner', companyId: 'acme' })
  await app.client.login({ login: 'owner', password: 'test-password' })
  const save = async (fn: string, input: Row) => {
    const result = (await app.client.call<Row>(fn, input)).value
    assert.notEqual(result.ok, false, JSON.stringify(result))
    return result
  }
  await save('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('stock.saveLocation', { id: 'adjustment', name: 'Adjustment', usage: 'inventory' })
  await save('product.saveRecord', {
    id: 'yarn',
    name: 'Sợi len',
    type: 'goods',
    defaultCode: 'YARN',
    uomId: 'each',
    isStorable: true,
    tracking: 'lot',
  })
  await save('stock.createLot', { id: 'lot-1', productId: 'yarn:default', name: 'L001' })
  await save('stock.adjustInventory', {
    id: 'count-1',
    productId: 'yarn:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'adjustment',
    countedQuantity: '5',
    productUomId: 'each',
    lotId: 'lot-1',
  })
  return app
}

test('Commerce inventory rows link their product to its page and keep the row opening its count (P24)', async (t) => {
  const app = await boot(t)
  for (const lang of ['vi', 'en'] as const) {
    const page = await app.client.get(`/admin/stock/inventory?lang=${lang}`)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.ok(
      html.includes(`href="/admin/product/templates/yarn?lang=${lang}"`),
      `${lang}: the product's name opens its page`,
    )
    // The row is the count's target, so it is no anchor around the product link.
    assert.doesNotMatch(html, /data-ui="(kt-)?row-link"/u, 'no link wraps the product link')
    assert.match(html, /data-row-href="[^"]*stock\.count/u, 'the row still opens its count')
    assert.equal((html.match(/id="stock-inventory-help"/gu) ?? []).length, 1, 'the list has one guide')
    assert.match(html, /mermaid/u, 'the guide keeps its diagram')
  }
})

test('Commerce lot page offers its product page (P24)', async (t) => {
  const app = await boot(t)
  const context = await app.client.get('/admin/stock/record/lot/lot-1/context?lang=vi')
  assert.equal(context.status, 200)
  const body = (await context.json()) as { data: { productHref: string | null }; messages: Row }
  assert.equal(body.data.productHref, '/admin/product/templates/yarn?lang=vi')
  assert.equal(body.messages['stock_backend.lot.action.openProduct'], 'Mở sản phẩm')
})

test('a product link needs both the product page and the right to read products (P24)', async () => {
  const url = new URL('http://ket.local/admin/stock/inventory?lang=en')
  const fake = (routes: Record<string, unknown>, allowed: boolean) =>
    ({ live: async () => ({ routes }), allows: async () => allowed }) as unknown as ServeContext
  const page = { '/admin/product/templates/{id}': {} }
  const link = async (ctx: ServeContext) => (await productPageLink(ctx, url, {} as never))('tee')
  assert.equal(await link(fake(page, true)), '/admin/product/templates/tee?lang=en')
  assert.equal(await link(fake(page, false)), null, 'a reader who may not read products gets no link')
  assert.equal(await link(fake({}, true)), null, 'a deployment without the product page gets no link')
  assert.equal(await (await productPageLink(fake(page, true), url, {} as never))(undefined), null)
})
