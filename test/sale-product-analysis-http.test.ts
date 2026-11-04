import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { sqliteStore } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { createCommerceDeployment } from '../packages/ketsuite/src/deployment.ts'
import { createCommerceTestDeployment } from './commerce-test-deployment.ts'

// P32: the product page's Sold card opens a sales analysis with a row per variant, and
// each row opens the orders that sold that variant.

async function sold(t: TestContext) {
  const deployment = createCommerceDeployment(async (config) => {
    if (!config.databaseUrl) return sqliteStore(config)
    const adapter = postgresAdapter(config.databaseUrl)
    await adapter.open()
    return adapter
  })
  const app = await createCommerceTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const fixture = async (fn: string, input: Row) =>
    (await app.fixture.call<Row>(fn, input, { scope: { company: 'acme', branches: null } })).value
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
  const call = async (fn: string, input: Row) => (await app.client.call<Row>(fn, input)).value
  const save = async (fn: string, input: Row) => {
    const result = await call(fn, input)
    assert.notEqual(result.ok, false, JSON.stringify(result))
    return result
  }
  await save('uom.saveUnit', { id: 'each', name: 'Each', relativeFactor: '1' })
  await save('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH' })
  await save('partner.savePartner', { id: 'buyer', kind: 'company', name: 'Buyer' })
  await save('product.saveRecord', {
    id: 'tee',
    name: 'Áo thun',
    type: 'goods',
    defaultCode: 'TEE',
    uomId: 'each',
    listPrice: '100',
    saleOk: true,
  })
  await save('product.saveAttributeDraft', {
    id: 'size',
    name: 'Cỡ',
    displayType: 'select',
    createVariant: 'always',
    values: [
      { id: 'small', name: 'Nhỏ' },
      { id: 'large', name: 'Lớn' },
    ],
  })
  await save('product.configureAttributes', {
    templateId: 'tee',
    lines: [
      { attributeId: 'size', values: ['small', 'large'].map((valueId) => ({ valueId, priceExtra: '0' })) },
    ],
  })
  const variants = (await call('product.listVariants', { templateId: 'tee' })) as unknown as Row[]
  const id = (name: string) => String(variants.find((row) => row.displayName === name)?.id)
  const order = async (orderId: string, lines: Array<[string, string]>, confirm = true) => {
    await save('sale.createOrder', { id: orderId, partnerId: 'buyer', warehouseId: 'wh' })
    for (const [index, [productId, qty]] of lines.entries())
      await save('sale.addLine', {
        id: `${orderId}-${index}`,
        orderId,
        productId,
        productUomQty: qty,
        productUomId: 'each',
      })
    if (confirm) await save('sale.confirmOrder', { id: orderId })
  }
  const small = id('Áo thun Nhỏ')
  const large = id('Áo thun Lớn')
  await order('so-1', [[small, '1']])
  await order('so-2', [
    [small, '2'],
    [large, '1'],
  ])
  // A quotation sold nothing yet.
  await order('q-1', [[large, '5']], false)
  return { app, call, small, large }
}

test('Commerce counts a product’s sales per variant, confirmed orders only (P32)', async (t) => {
  const { call, small, large } = await sold(t)
  const sales = (await call('sale.productSales', { templateId: 'tee', days: 30 })) as Row
  assert.equal(sales.quantity, 4)
  assert.equal(sales.orders, 2)
  assert.deepEqual(
    (sales.variants as Row[]).map((row) => [row.productId, row.quantity, row.orders, row.revenue]),
    [
      [small, 3, 2, 300],
      [large, 1, 1, 100],
    ],
  )
})

test('Commerce opens the analysis from the Sold card and each variant’s orders from it (P32)', async (t) => {
  const { app, small } = await sold(t)
  // The card on the product page points at the analysis.
  const context = (await (await app.client.get('/admin/product/templates/tee/context?lang=vi')).json()) as {
    data: { links: { orders: string }; sales: Row }
  }
  assert.equal(context.data.links.orders, '/admin/sales/analysis?templateId=tee&lang=vi')
  assert.equal(context.data.sales.variants, undefined, 'the card carries totals, not the per-variant rows')

  for (const [lang, title, head, revenue] of [
    ['vi', 'Phân tích bán hàng', 'Áo thun · 30 ngày gần đây', 'Doanh thu chưa thuế'],
    ['en', 'Sales analysis', 'Áo thun · last 30 days', 'Untaxed revenue'],
  ] as const) {
    const page = await app.client.get(`/admin/sales/analysis?templateId=tee&lang=${lang}`)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.ok(html.includes(title) && html.includes(head), `${lang}: the product and period head the page`)
    assert.ok(html.includes(revenue), `${lang}: a money reader sees revenue`)
    assert.ok(html.includes('Áo thun Nhỏ') && html.includes('Áo thun Lớn'), `${lang}: a row per variant`)
    assert.ok(
      html.includes(`href="/admin/sales/orders?productId=${encodeURIComponent(small)}&amp;lang=${lang}"`),
      `${lang}: a variant opens its orders`,
    )
    assert.ok(html.includes(`href="/admin/product/templates/tee?lang=${lang}"`), `${lang}: the way back`)
    assert.equal((html.match(/id="sale-analysis-help"/gu) ?? []).length, 1, `${lang}: one guide`)
  }

  // Without a product it is the analysis of the company's sales (D19).
  const company = await (await app.client.get('/admin/sales/analysis?lang=vi')).text()
  assert.ok(
    company.includes('Nhóm theo') && !company.includes('Chọn một sản phẩm'),
    'without a product, all sales',
  )
})

test('Commerce narrows the sales order list to the orders that sold one variant (P32)', async (t) => {
  const { app, call, large } = await sold(t)
  const direct = (await call('sale.listOrders', { state: 'sale', productId: large })) as unknown as Row[]
  assert.deepEqual(
    direct.map((row) => row.id),
    ['so-2'],
  )
  const html = await (
    await app.client.get(`/admin/sales/orders?productId=${encodeURIComponent(large)}&lang=vi`)
  ).text()
  assert.ok(html.includes('Đơn có Áo thun Lớn'), 'the notice names the variant')
  assert.ok(html.includes('href="/admin/sales/orders?lang=vi"'), 'the notice offers every order again')
  assert.ok(html.includes('S00002') || html.includes('so-2'), 'the order that sold it is listed')
  assert.ok(!html.includes('S00001'), 'an order without the variant is not')
  assert.equal((html.match(/id="sale-orders-help"/gu) ?? []).length, 1, 'the list has one guide')
  const page = await (
    await app.client.get(
      `/admin/sales/orders?productId=${encodeURIComponent(large)}&group=invoiceStatus&lang=vi`,
    )
  ).text()
  // Both orders are waiting for an invoice; grouped, the page still counts only the one.
  assert.deepEqual(
    [...page.matchAll(/data-ui="kt-group-count"><!--k\[-->(\d+)/gu)].map((match) => match[1]),
    ['1'],
    'grouping keeps the narrowing',
  )
  // Grouping keeps the narrowing.
  const grouped = (await call('sale.listOrders', {
    state: 'sale',
    productId: large,
    listState: {
      presets: [],
      filters: [],
      groupBy: [{ key: 'invoiceStatus' }],
      sort: [],
      openGroups: [],
      groupPages: {},
      page: 1,
      includeArchived: false,
    },
    listMode: 'groups',
  })) as unknown as Array<{ count: number }>
  assert.equal(
    grouped.reduce((sum, group) => sum + Number(group.count), 0),
    1,
  )
})
