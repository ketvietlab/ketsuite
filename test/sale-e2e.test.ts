import { createCommerceTestDeployment as createTestDeployment } from './commerce-test-deployment.ts'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootSale(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null },
    fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'admin-party', kind: 'person', name: 'Administrator' })
  await fixture('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng Minh Anh' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    partnerId: 'admin-party',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) =>
    e2e.client.call<T>(name, input)
  await call('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'goods',
    name: 'Ghế công thái học',
    type: 'goods',
    uomId: 'unit',
    listPrice: '3000000',
    saleOk: true,
  })
  await call('product.saveVariant', {
    id: 'chair',
    templateId: 'goods',
    defaultCode: 'GHE-01',
    combinationKey: '',
  })
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await call('stock.adjustInventory', {
    id: 'adjust',
    productId: 'chair',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'unit',
  })
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Doanh thu', 'income'],
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
    ['tax', '3331', 'Thuế GTGT', 'liability_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveJournal', { id: 'sales-journal', name: 'Bán hàng', code: 'SAL', type: 'sale' })
  await call('account.saveTax', {
    id: 'vat10',
    name: 'GTGT 10%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await call('pricing.savePricelist', { id: 'retail', name: 'Bán lẻ' })
  await call('pricing.savePricelistItem', {
    id: 'chair-price',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId: 'chair',
    computePrice: 'fixed',
    fixedPrice: '2800000',
  })
  return { e2e, call }
}

/** A `sale_backend.*` key where the reader would see it, rather than in props. */
const VISIBLE_KEY = /(?:>|placeholder="|aria-label="|title=")[^<"]*sale_backend\.[A-Za-z]/u
type SaleContext = {
  record: Row & { lines: Row[] }
  permissions: Record<string, boolean>
  collaboration: Row[]
  reports: Row[]
}
/** What the order's page reads and renders: its record context. */
const contextOf = async (
  e2e: Awaited<ReturnType<typeof bootSale>>['e2e'],
  id: string,
  lang = 'vi',
): Promise<SaleContext> => {
  const response = await e2e.client.get(`/admin/sales/record/${id}/context?lang=${lang}`, {
    headers: { accept: 'application/json' },
  })
  assert.equal(response.status, 200, id)
  return ((await response.json()) as { data: SaleContext }).data
}

test('sale-e2e: quotation to delivery and invoice crosses real HTTP', async (t) => {
  const { e2e, call } = await bootSale(t)
  await call('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: 'delivery' })
  await call('sale.createOrder', {
    id: 'so-1',
    partnerId: 'customer',
    warehouseId: 'wh',
    pricelistId: 'retail',
    clientOrderRef: 'KH/2026/01',
  })
  await call('sale.addLine', {
    id: 'so-1:line',
    orderId: 'so-1',
    productId: 'chair',
    productUomQty: '2',
    productUomId: 'unit',
    taxId: 'vat10',
  })
  await call('sale_mail_backend.follow', { targetId: 'so-1' })
  await call('sale_mail_backend.post', {
    id: 'sale-message-1',
    targetId: 'so-1',
    kind: 'note',
    body: 'Ghi chú nội bộ trên đơn bán.',
  })
  assert.equal(
    (await call<{ messages: Row[] }>('sale_mail_backend.timeline', { targetId: 'so-1' })).value.messages[0]
      ?.body,
    'Ghi chú nội bộ trên đơn bán.',
  )
  await call('activity.saveType', {
    id: 'sale-follow-up',
    name: 'Theo dõi khách hàng',
    category: 'todo',
    icon: 'check',
    defaultDelayDays: 0,
    chainingPolicy: 'none',
    sequence: 10,
    active: true,
  })
  await call('sale_activity_backend.schedule', {
    id: 'sale-activity-1',
    targetId: 'so-1',
    typeId: 'sale-follow-up',
    assigneeUserId: 'admin',
    summary: 'Xác nhận lịch giao hàng',
    dueDate: '2026-08-20',
  })
  const emptyOrdersPage = await e2e.client.get('/admin/sales/orders?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.match(await emptyOrdersPage.text(), /Chưa có đơn bán hàng/)
  await call('sale.sendQuotation', { id: 'so-1' })
  assert.equal((await call<Row>('sale.confirmOrder', { id: 'so-1' })).value.pickingId, 'so-1:delivery')
  await call('stock.confirmPicking', { id: 'so-1:delivery' })
  await call('stock.reserveMove', { id: 'so-1:line:delivery' })
  await call('stock.completePicking', { id: 'so-1:delivery' })
  await call('sale.syncDeliveries', { id: 'so-1' })
  assert.equal(
    (
      await call<Row>('sale.createInvoice', {
        id: 'invoice-1',
        orderId: 'so-1',
        journalId: 'sales-journal',
        revenueAccountId: 'revenue',
        receivableAccountId: 'receivable',
        taxAccountId: 'tax',
      })
    ).value.amountTotal,
    '6160000',
  )
  const pages: Array<[string, RegExp]> = [
    ['/admin/sales', /Tổng quan bán hàng/],
    ['/admin/sales/quotations', /Báo giá/],
    ['/admin/sales/orders', /S00001/],
    ['/admin/sales/orders/so-1', /S00001/],
    ['/admin/sales/invoicing-policies', /Chính sách xuất hoá đơn/],
  ]
  for (const [path, expected] of pages) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, expected, path)
    // No message key reaches the reader as text. The search-filter bar names
    // the functions it calls in its island props, which is data, not a key.
    assert.doesNotMatch(html, VISIBLE_KEY, path)
    if (path === '/admin/sales/orders') {
      assert.match(html, /data-ui="list-page"/)
      assert.match(html, /data-ui="kt-grid"/)
      assert.doesNotMatch(html, /list-page-description/)
      assert.match(html, /Khách hàng Minh Anh/)
      assert.match(html, /href="\/admin\/sales\/orders\/so-1"/)
      assert.doesNotMatch(html, /data-ui="record-workspace"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/sales/invoicing-policies') {
      // The list is an island that reads its rows after load (D21); there is nothing to create.
      assert.match(html, /data-ui="list-page"/)
      assert.match(html, /data-island="sale\.policy-results"/)
      assert.doesNotMatch(html, /record=sale\.invoicePolicy%3Anew|data-ui="record-workspace"/)
      assert.doesNotMatch(html, /data-island="mail\.chatter"/)
    }
    if (path === '/admin/sales/orders/so-1') {
      // The order is a page: the server renders it loading, the record runtime renders the
      // order from its context, and the guide sits beside it.
      assert.match(html, /data-island="sale\.order-page"/)
      assert.match(html, /data-ui="record-page"/)
      assert.match(html, /id="sale-order-help"/)
      assert.doesNotMatch(html, /data-island="sale\.order-modal"/)
    }
  }
  // Its conversation and activities are the page's aside, placed from the context.
  const order = await contextOf(e2e, 'so-1')
  assert.equal(order.record.partnerName, 'Khách hàng Minh Anh')
  assert.deepEqual(
    order.collaboration.map((entry) => entry.island),
    ['mail.chatter', 'activity.record'],
  )
  const quotationsPage = await e2e.client.get('/admin/sales/quotations?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const quotationsHtml = await quotationsPage.text()
  assert.match(quotationsHtml, /data-ui="list-page"/)
  assert.doesNotMatch(quotationsHtml, /id="quotation-create-form"/)
  assert.match(quotationsHtml, /Chưa có báo giá/)
  assert.doesNotMatch(quotationsHtml, /data-island="mail\.chatter"/)
  const quotationCreatePage = await e2e.client.get('/admin/sales/quotations/new?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const quotationCreateHtml = await quotationCreatePage.text()
  assert.match(quotationCreateHtml, /data-island="sale\.order-page"/)
  assert.match(quotationCreateHtml, /Tạo báo giá/)
  assert.doesNotMatch(quotationCreateHtml, /data-island="mail\.chatter"/)
  assert.deepEqual((await contextOf(e2e, 'new')).collaboration, [])

  const salesDashboard = await e2e.client.get('/admin/sales?lang=vi', {
    headers: { accept: 'text/html' },
  })
  const salesDashboardHtml = await salesDashboard.text()
  assert.match(salesDashboardHtml, /Tạo báo giá/)
  assert.match(
    salesDashboardHtml,
    /href="\/admin\/sales\/quotations\/new\?lang=vi&amp;returnTo=%2Fadmin%2Fsales%3Flang%3Dvi"/,
  )
  assert.doesNotMatch(salesDashboardHtml, /record=sale\.order/)
  assert.match(salesDashboardHtml, /href="\/admin\/sales\/quotations\?lang=vi&amp;preset=draft"/)
  assert.match(salesDashboardHtml, /href="\/admin\/sales\/orders\?lang=vi"/)

  const legacyInvalidRedirect = await e2e.client.post(
    '/admin/sales/quotations?lang=vi',
    new URLSearchParams({ partnerId: '', warehouseId: '' }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(legacyInvalidRedirect.status, 303)
  assert.equal(legacyInvalidRedirect.headers.get('location'), '/admin/sales/quotations/new?lang=vi&invalid=1')
  const invalidQuotation = await e2e.client.post(
    '/admin/sales/quotations/new?lang=vi',
    new URLSearchParams({ partnerId: '', warehouseId: '' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalidQuotation.headers.get('location'), '/admin/sales/quotations/new?lang=vi&invalid=1')
  const createdQuotation = await e2e.client.form<string>('/admin/sales/quotations/new?lang=vi', {
    partnerId: 'customer',
    warehouseId: 'wh',
    clientOrderRef: 'KH/2026/HTTP',
    pricelistId: 'retail',
  })
  assert.match(createdQuotation, /data-ui="kt-grid"/)
  assert.match(createdQuotation, /Khách hàng Minh Anh/)
  assert.match(createdQuotation, /Bản nháp/)
  assert.doesNotMatch(createdQuotation, /data-island="mail\.chatter"/)
  const englishQuotations = await e2e.client.get('/admin/sales/quotations?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.match(
    await englishQuotations.text(),
    /href="\/admin\/sales\/quotations\/[^"?]+\?lang=en&amp;returnTo=%2Fadmin%2Fsales%2Fquotations%3Flang%3Den"/,
  )
  const englishDashboard = await e2e.client.get('/admin/sales?lang=en', {
    headers: { accept: 'text/html' },
  })
  const englishDashboardHtml = await englishDashboard.text()
  assert.match(englishDashboardHtml, /Create Quotation/)
  assert.match(englishDashboardHtml, /href="\/admin\/sales\/quotations\/new\?lang=en&amp;returnTo=/)
  const english = await e2e.client.get('/admin/sales/orders/so-1?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(english.status, 200)
  const englishDetailHtml = await english.text()
  assert.match(englishDetailHtml, /data-island="sale\.order-page"/)
  assert.match(englishDetailHtml, /Quotations and sales orders/)
  // Close returns to the list in the reader's language.
  assert.match(englishDetailHtml, /&quot;back&quot;:&quot;\/admin\/sales\/orders\?lang=en&quot;/)
  const englishOrders = await e2e.client.get('/admin/sales/orders?lang=en', {
    headers: { accept: 'text/html' },
  })
  const englishOrdersHtml = await englishOrders.text()
  assert.match(englishOrdersHtml, /data-ui="list-page"/)
  assert.doesNotMatch(englishOrdersHtml, /list-page-description/)
  assert.match(englishOrdersHtml, /href="\/admin\/sales\/orders\/so-1\?lang=en"/)
  assert.doesNotMatch(englishOrdersHtml, /data-island="mail\.chatter"/)
  const englishPolicies = await e2e.client.get('/admin/sales/invoicing-policies?lang=en', {
    headers: { accept: 'text/html' },
  })
  const englishPoliciesHtml = await englishPolicies.text()
  assert.match(englishPoliciesHtml, /data-ui="list-page"/)
  assert.match(englishPoliciesHtml, /Invoicing policies/)
  assert.doesNotMatch(englishPoliciesHtml, /data-island="mail\.chatter"/)
  const ownPolicies = await e2e.client.post(
    '/admin/sales/invoicing-policies/read?lang=en',
    new URLSearchParams({ href: '/admin/sales/invoicing-policies?lang=en&setting=own' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const own = ((await ownPolicies.json()) as { value: { rows: Row[] } }).value.rows
  assert.deepEqual(
    own.map((row) => [row.id, row.policy, row.setting]),
    [['goods', 'delivery', 'own']],
  )
  // The old form routes are gone: a product is set from its row.
  assert.equal((await e2e.client.get('/admin/sales/invoicing-policies/new?lang=en')).status, 404)
  await call('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: 'order' })
  const templates = (await call<Row[]>('sale.listInvoicePolicies', {})).value
  assert.equal(templates.find((row) => row.id === 'goods')?.invoicePolicy, 'order')

  await call('sale.createOrder', {
    id: 'so-ui',
    partnerId: 'customer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  // Without the page's script, the order's form actions still answer, with redirects.
  const form = (body: Record<string, string>) =>
    e2e.client.post('/admin/sales/quotations/so-ui?lang=vi', new URLSearchParams(body), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    })
  const invalidLine = await form({
    action: 'add-line',
    productId: '',
    productUomQty: '1',
    productUomId: 'unit',
  })
  assert.equal(invalidLine.headers.get('location'), '/admin/sales/quotations/so-ui?lang=vi&invalid=1')
  const added = await form({
    action: 'add-line',
    productId: 'chair',
    productUomQty: '1',
    productUomId: 'unit',
    taxId: 'vat10',
  })
  assert.equal(added.headers.get('location'), '/admin/sales/quotations/so-ui?lang=vi')
  assert.equal(((await call<Row>('sale.getOrder', { id: 'so-ui' })).value.lines as Row[]).length, 1)
  const confirmed = await form({ action: 'confirm' })
  assert.equal(confirmed.headers.get('location'), '/admin/sales/orders/so-ui?lang=vi')
})

test('sale-e2e: a quotation can lose a line and come back from cancelled', async (t) => {
  const { e2e, call } = await bootSale(t)
  const post = (path: string, body: Record<string, string>) =>
    e2e.client.post(path, new URLSearchParams(body), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  await call('sale.createOrder', { id: 'so-ux', partnerId: 'customer', warehouseId: 'wh' })
  for (const id of ['so-ux:a', 'so-ux:b'])
    await call('sale.addLine', {
      id,
      orderId: 'so-ux',
      productId: 'chair',
      productUomQty: '1',
      productUomId: 'unit',
    })

  // The line table offers a way back out, not just a way in: Edit line removes it.
  const detail = await contextOf(e2e, 'so-ux')
  assert.deepEqual(
    detail.record.lines.map((line) => line.id),
    ['so-ux:a', 'so-ux:b'],
  )
  assert.equal(detail.permissions.removeLine, true)

  const removed = await post('/admin/sales/quotations/so-ux?lang=vi', {
    action: 'remove-line',
    lineId: 'so-ux:a',
  })
  assert.equal(removed.status, 200)
  const afterRemoval = (await call<Row>('sale.getOrder', { id: 'so-ux' })).value
  assert.deepEqual(
    ((afterRemoval.lines as Row[]) ?? []).map((line) => line.id),
    ['so-ux:b'],
  )

  // Cancelling used to be the end of the road: no action on the screen, and the
  // order on neither list.
  const cancelled = await post('/admin/sales/quotations/so-ux?lang=vi', { action: 'cancel' })
  assert.equal(cancelled.status, 200)
  const listed = await e2e.client.get('/admin/sales/quotations?lang=vi', { headers: { accept: 'text/html' } })
  const listedHtml = await listed.text()
  assert.match(listedHtml, /so-ux/)
  assert.match(listedHtml, /Đã huỷ/)
  assert.doesNotMatch(listedHtml, VISIBLE_KEY)

  const cancelledDetail = await contextOf(e2e, 'so-ux')
  assert.equal(cancelledDetail.record.state, 'cancel')
  assert.equal(cancelledDetail.permissions.resetOrder, true)

  const reset = await post('/admin/sales/quotations/so-ux?lang=vi', { action: 'reset' })
  assert.equal(reset.status, 200)
  assert.equal((await contextOf(e2e, 'so-ux', 'en')).record.state, 'draft')
})

test('sale-e2e: the print group is translated and reaches the lists', async (t) => {
  const { e2e, call } = await bootSale(t)
  await call('sale.createOrder', { id: 'so-print', partnerId: 'customer', warehouseId: 'wh' })
  await call('sale.addLine', {
    id: 'so-print:line',
    orderId: 'so-print',
    productId: 'chair',
    productUomQty: '1',
    productUomId: 'unit',
  })

  // The print group's label was the English literal 'Print', written in by hand
  // in four backends while the document names beside it were translated.
  const detail = await contextOf(e2e, 'so-print')
  // Named the way the document heads itself, translated, never a message key.
  assert.deepEqual(detail.reports, [{ label: 'BÁO GIÁ', href: '/reports/sale.quotation/so-print?lang=vi' }])

  // Printing meant opening each record first.
  const quotations = await e2e.client.get('/admin/sales/quotations?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.match(await quotations.text(), /href="\/reports\/sale\.quotation\/so-print/)

  // A confirmed order offers the pro-forma beside its own document, and the
  // orders list prints too.
  await call('sale.confirmOrder', { id: 'so-print' })
  const order = await contextOf(e2e, 'so-print', 'en')
  assert.deepEqual(
    order.reports.map((report) => report.href),
    ['/reports/sale.salesOrder/so-print?lang=en', '/reports/sale.proforma/so-print?lang=en'],
  )
  assert.ok(order.reports.every((report) => !String(report.label).includes('.')))
  const orders = await e2e.client.get('/admin/sales/orders?lang=en', { headers: { accept: 'text/html' } })
  assert.match(await orders.text(), /href="\/reports\/sale\.salesOrder\/so-print/)

  // And the document itself renders, carrying the unit beside the quantity.
  const pdf = await e2e.client.get('/reports/sale.salesOrder/so-print?lang=vi')
  assert.equal(pdf.status, 200)
})

test('sale line editing is atomic, revision-checked and preserves the other quoted prices', async (t) => {
  const { call } = await bootSale(t)
  await call('sale.createOrder', { id: 'edit-order', partnerId: 'customer', warehouseId: 'wh' })
  for (const id of ['first', 'second'])
    await call('sale.addLine', {
      id,
      orderId: 'edit-order',
      productId: 'chair',
      productUomId: 'unit',
      productUomQty: '2',
      priceUnit: '100',
      discount: '5',
      taxId: 'vat10',
    })
  const before = (await call<Row>('sale.getOrder', { id: 'edit-order' })).value
  const edited = (
    await call<Row>('sale.updateLine', {
      id: 'first',
      expectedRevision: before.revision,
      productUomQty: '3',
      priceUnit: '200',
      discount: '10',
      taxIds: [],
    })
  ).value
  assert.equal(edited.ok, true, JSON.stringify(edited))
  const after = (await call<Row>('sale.getOrder', { id: 'edit-order' })).value
  const lines = after.lines as Row[]
  assert.equal(lines.find((row) => row.id === 'first')?.priceSubtotal, '540')
  assert.deepEqual(
    lines.find((row) => row.id === 'second'),
    (before.lines as Row[]).find((row) => row.id === 'second'),
  )
  assert.equal(after.amountTotal, '749')
  const stale = (
    await call<Row>('sale.updateLine', {
      id: 'second',
      expectedRevision: before.revision,
      productUomQty: '99',
    })
  ).value
  assert.equal(stale.ok, false)
  assert.deepEqual((await call<Row>('sale.getOrder', { id: 'edit-order' })).value, after)
  await call('sale.confirmOrder', { id: 'edit-order', expectedRevision: after.revision })
  const confirmed = (await call<Row>('sale.getOrder', { id: 'edit-order' })).value
  assert.equal(
    (
      await call<Row>('sale.updateLine', {
        id: 'first',
        expectedRevision: confirmed.revision,
        productUomQty: '9',
      })
    ).value.ok,
    false,
  )
})
