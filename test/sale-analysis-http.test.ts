import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { FilterNode, ListState, Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/**
 * In the company's calendar (Asia/Ho_Chi_Minh): Linh sold Goods in September and on the first hour of
 * October (still September in UTC), in team Khách sỉ; Huy sold Tea in October, in no team. A cancelled
 * October order and the fixture's quotation do not count. Goods cost 60 a unit, Tea has no cost.
 */
async function sold(t: TestContext) {
  const r = await setup(t)
  for (const [id, name] of [
    ['linh', 'Bùi Khánh Linh'],
    ['huy', 'Hoàng Gia Huy'],
  ]) {
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-acme`, userId: id, companyId: 'acme' })
  }
  await r.save('sale.saveTeam', {
    id: 'b2b',
    name: 'Khách sỉ',
    leaderId: 'linh',
    memberIds: ['linh'],
    monthlyTarget: '1000',
  })
  await r.save('partner.savePartner', { id: 'cafe', kind: 'company', name: 'Café Sáng' })
  await r.save('partner.grantRole', { id: 'cafe-role', partnerId: 'cafe', role: 'customer' })
  await r.save('product.saveRecord', {
    id: 'tea',
    name: 'Trà',
    type: 'service',
    defaultCode: 'TEA',
    uomId: 'each',
    listPrice: '20',
    saleOk: true,
  })
  const tea = String(
    ((await r.call('product.listVariants', { templateId: 'tea' })) as unknown as Row[])[0]!.id,
  )
  await r.save('product.setCost', { productId: r.productId, standardPrice: '60' })
  const order = async (id: string, dateOrder: string, input: Row, line: Row) => {
    await r.save('sale.createOrder', { id, partnerId: 'buyer', warehouseId: 'wh', dateOrder, ...input })
    await r.add({
      id: `${id}-line`,
      orderId: id,
      productUomId: 'each',
      productUomQty: '2',
      priceUnit: '100',
      ...line,
    })
    await r.save('sale.confirmOrder', { id })
  }
  await order('linh-sep', '2026-09-15T03:00:00.000Z', { userId: 'linh' }, {})
  await order('linh-oct', '2026-09-30T18:00:00.000Z', { userId: 'linh' }, { productUomQty: '3' })
  await order(
    'huy-oct',
    '2026-10-10T03:00:00.000Z',
    { userId: 'huy', teamId: null, partnerId: 'cafe' },
    {
      productId: tea,
      priceUnit: '50',
    },
  )
  await order('gone', '2026-10-11T03:00:00.000Z', { userId: 'huy' }, {})
  await r.save('sale.cancelOrder', { id: 'gone' })
  return { ...r, tea }
}

/** The list state a link opens, read back from its address. */
const stateOf = (href: string): ListState => {
  const url = new URL(href.replaceAll('&amp;', '&'), 'http://ket.local')
  return {
    presets: url.searchParams.getAll('preset'),
    filters: url.searchParams
      .getAll('filter')
      .map((value) => JSON.parse(Buffer.from(value, 'base64url').toString()) as FilterNode),
    groupBy: [],
    sort: [],
    openGroups: [],
    groupPages: {},
    page: 1,
    includeArchived: false,
  }
}
const ordersLinks = (html: string) =>
  [
    ...new Set(
      [...html.matchAll(/href="(\/admin\/sales\/orders\?[^"]*filter=[^"]*)"/g)].map((match) => match[1]!),
    ),
  ].map(stateOf)

const analyze = async (r: Awaited<ReturnType<typeof sold>>, fn: string, args: Row) =>
  (await r.call(fn, args)) as Row & { groups: Row[] }

test('D19 sales are grouped by month, salesperson, team, customer and product in the company calendar', async (t) => {
  const r = await sold(t)
  const year = await analyze(r, 'sale.analyzeSales', { period: '2026', groupBy: 'month' })
  assert.equal(year.ok, true)
  assert.deepEqual(year.totals, { revenue: '600', orders: 3 })
  assert.deepEqual(year.previousTotals, { revenue: '0', orders: 0 })
  // The order of 1 a.m. on 1 October, local time, is October's though it is 30 September in UTC.
  assert.deepEqual(
    year.groups.map((group) => [group.key, group.revenue, group.orders]),
    [
      ['2026-09', '200', 1],
      ['2026-10', '400', 2],
    ],
  )
  const october = async (groupBy: string) =>
    (await analyze(r, 'sale.analyzeSales', { period: '2026-10', groupBy })).groups.map((group) => [
      group.label,
      group.revenue,
      group.orders,
    ])
  const users = await analyze(r, 'sale.analyzeSales', { period: '2026-10', groupBy: 'user' })
  assert.equal(users.previous, '2026-09')
  assert.deepEqual(users.previousTotals, { revenue: '200', orders: 1 })
  assert.deepEqual(await october('user'), [
    ['Bùi Khánh Linh', '300', 1],
    ['Hoàng Gia Huy', '100', 1],
  ])
  // An order outside every team is a group of its own, keyed ''.
  assert.deepEqual(
    (await analyze(r, 'sale.analyzeSales', { period: '2026-10', groupBy: 'team' })).groups.map((group) => [
      group.key,
      group.label,
      group.revenue,
    ]),
    [
      ['b2b', 'Khách sỉ', '300'],
      ['', '', '100'],
    ],
  )
  assert.deepEqual(await october('partner'), [
    ['Buyer', '300', 1],
    ['Café Sáng', '100', 1],
  ])
  assert.deepEqual(await october('product'), [
    ['Goods', '300', 1],
    ['Trà', '100', 1],
  ])
  const quarter = await analyze(r, 'sale.analyzeSales', { period: '2026-Q4', groupBy: 'month' })
  assert.equal(quarter.previous, '2026-Q3')
  assert.deepEqual(quarter.previousTotals, { revenue: '200', orders: 1 })
  for (const period of ['2026-13', '26', '2026-Q5', 'soon'])
    assert.deepEqual((await r.call('sale.analyzeSales', { period })).errors, [
      { field: 'period', message: 'sale.error.analysis.period' },
    ])
})

test('D18 gross profit takes each line’s cost and counts the lines whose cost is unknown', async (t) => {
  const r = await sold(t)
  const margin = await analyze(r, 'sale.analyzeSalesMargin', { period: '2026-10', groupBy: 'product' })
  assert.equal(margin.ok, true)
  // Goods: 300 sold less 3 × 60; Tea has no cost, so it adds nothing and is counted.
  assert.deepEqual(margin.totals, { margin: '120', unknownLines: 1 })
  assert.deepEqual(margin.previousTotals, { margin: '80', unknownLines: 0 })
  assert.deepEqual(margin.groups.map((group) => [group.key, group.margin, group.unknownLines]).sort(), [
    ['goods', '120', 0],
    ['tea', '0', 1],
  ])
})

test('D18 the overview reads the month: sales, invoices, team targets, salespeople and expiring quotations', async (t) => {
  const r = await sold(t)
  for (const [id, accountType] of [
    ['revenue', 'income'],
    ['receivable', 'asset_receivable'],
  ])
    await r.save('account.saveAccount', { id, code: id, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  const invoice = async (id: string, orderId: string, invoiceDate: string, post = true) => {
    await r.save('sale.createInvoice', {
      id,
      orderId,
      journalId: 'journal',
      revenueAccountId: 'revenue',
      receivableAccountId: 'receivable',
      invoiceDate,
    })
    if (post) assert.equal((await r.call('account.postMove', { id })).ok, true)
  }
  await invoice('inv-linh', 'linh-oct', '2026-10-20T03:00:00.000Z')
  await invoice('inv-huy', 'huy-oct', '2026-10-21T03:00:00.000Z', false)
  await invoice('inv-sep', 'linh-sep', '2026-09-20T03:00:00.000Z')
  // A quotation sent and expiring in two days.
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString()
  await r.save('sale.createOrder', { id: 'quote', partnerId: 'cafe', warehouseId: 'wh', validityDate: soon })
  await r.add({ id: 'quote-line', orderId: 'quote' })
  assert.equal((await r.call('sale.sendQuotation', { id: 'quote' })).ok, true)
  // A draft expiring as soon is not waiting on the customer; an archived team has no target to reach.
  await r.save('sale.createOrder', { id: 'draft', partnerId: 'cafe', warehouseId: 'wh', validityDate: soon })
  await r.save('sale.saveTeam', {
    id: 'old',
    name: 'Đội cũ',
    leaderId: 'huy',
    memberIds: [],
    monthlyTarget: '5',
  })
  const old = ((await r.call('sale.listTeams', { ids: ['old'] })) as unknown as Row[])[0]!
  await r.save('sale.setTeamActive', { id: 'old', active: false, expectedRevisionId: old.revisionId })
  const overview = (await r.call('sale.getSalesOverview', { period: '2026-10' })) as Row
  assert.equal(overview.ok, true)
  assert.equal(overview.revenue, '400')
  assert.equal(overview.previousRevenue, '200')
  assert.equal(overview.orders, 2)
  // Only posted invoices count: Huy's draft does not.
  assert.equal(overview.invoiced, '300')
  assert.equal(overview.previousInvoiced, '200')
  assert.deepEqual(overview.teams, [{ id: 'b2b', name: 'Khách sỉ', target: '1000', invoiced: '300' }])
  assert.deepEqual(
    (overview.salespeople as Row[]).map((row) => [row.name, row.revenue]),
    [
      ['Bùi Khánh Linh', '300'],
      ['Hoàng Gia Huy', '100'],
    ],
  )
  assert.deepEqual(
    (overview.expiring as Row[]).map((row) => [row.id, row.partnerName, row.expired]),
    [['quote', 'Café Sáng', false]],
  )
  assert.equal((overview.openQuotations as Row).count, 3)
  // Waiting for an invoice is the orders the list's own preset counts, not every confirmed order.
  const confirmed = (
    (await r.call('sale.listOrders', {
      state: 'sale',
      listMode: 'rows',
      listState: stateOf('/'),
    })) as unknown as {
      rows: Row[]
    }
  ).rows
  const waiting = confirmed.filter((row) => row.invoiceStatus === 'to invoice')
  assert.ok(waiting.length < confirmed.length)
  assert.equal((overview.toInvoice as Row).count, waiting.length)
  // Huy's invoice, once posted, counts for the month but not for a team; a reversed invoice and its
  // reversal count for nothing.
  assert.equal((await r.call('account.postMove', { id: 'inv-huy' })).ok, true)
  await r.save('account.saveJournal', { id: 'misc', name: 'Misc', code: 'MISC', type: 'general' })
  const posted = (await r.call('sale.getSalesOverview', { period: '2026-10' })) as Row
  assert.equal(posted.invoiced, '400')
  assert.deepEqual(posted.teams, [{ id: 'b2b', name: 'Khách sỉ', target: '1000', invoiced: '300' }])
  const reversed = await r.call('account.reverseMove', {
    id: 'inv-linh',
    reversalId: 'undo',
    journalId: 'misc',
  })
  assert.equal(reversed.ok, true, JSON.stringify(reversed))
  const after = (await r.call('sale.getSalesOverview', { period: '2026-10' })) as Row
  assert.equal(after.invoiced, '100')
  assert.deepEqual(after.teams, [{ id: 'b2b', name: 'Khách sỉ', target: '1000', invoiced: '0' }])
  assert.deepEqual((await r.call('sale.getSalesOverview', { period: '2026-10-01' })).errors, [
    { field: 'period', message: 'sale.error.analysis.period' },
  ])

  const html = await (await r.app.client.get('/admin/sales?lang=vi&period=2026-10')).text()
  assert.match(html, /Tháng 10 năm 2026/)
  assert.match(html, /Khách sỉ/)
  assert.match(html, /Bùi Khánh Linh/)
  assert.match(html, /Café Sáng/)
  assert.match(html, /Lợi nhuận gộp/)
  assert.match(html, /data-ui="help-drawer"/)
  // A salesperson's bar opens their orders of the month, filtered in the list's own bar.
  const linked = ordersLinks(html)
  assert.ok(
    linked.some((state) =>
      state.filters.some((rule) => 'field' in rule && rule.field === 'userId' && rule.value === 'linh'),
    ),
  )
  assert.ok(
    linked.some((state) =>
      state.filters.some(
        (rule) =>
          'field' in rule &&
          rule.field === 'dateOrder' &&
          JSON.stringify(rule.value) === JSON.stringify(['2026-10-01T00:00', '2026-11-01T00:00']),
      ),
    ),
  )
})

test('D19 the analysis screen drills into the orders behind a group, and the list agrees with it', async (t) => {
  const r = await sold(t)
  const html = await (
    await r.app.client.get('/admin/sales/analysis?lang=vi&period=2026-10&groupBy=team')
  ).text()
  assert.match(html, /Phân tích bán hàng/)
  assert.match(html, /Khách sỉ/)
  assert.match(html, /Không thuộc đội/)
  assert.match(html, /Lợi nhuận gộp/)
  const rows = async (listState: ListState) =>
    (
      (await r.call('sale.listOrders', {
        state: 'sale',
        listMode: 'rows',
        listState,
      })) as unknown as { rows: Row[] }
    ).rows
      .map((row) => String(row.id))
      .sort()
  const opened = await Promise.all(ordersLinks(html).map(rows))
  // Each group opens exactly the orders it counted.
  assert.ok(opened.some((ids) => JSON.stringify(ids) === JSON.stringify(['linh-oct'])))
  assert.ok(opened.some((ids) => JSON.stringify(ids) === JSON.stringify(['huy-oct'])))
  // A year by month shows every month; the choices are one GET form that keeps the language.
  const year = await (await r.app.client.get('/admin/sales/analysis?lang=en&period=2026')).text()
  assert.match(year, /data-ui="column-chart"/)
  assert.equal(year.match(/data-ui="column-chart-column"/g)?.length, 12)
  assert.match(year, /data-ui="column-chart-label"[^>]*>(?:<!--[^>]*-->)*Dec/)
  const bar = year.match(/<form[^>]*data-ui="filter-bar"[\s\S]*?<\/form>/)?.[0] ?? ''
  assert.match(bar, /action="\/admin\/sales\/analysis"[^>]*method="get"[^>]*data-apply="input"/)
  assert.match(bar, /<input type="hidden" name="lang" value="en"/)
  assert.deepEqual(
    [...bar.matchAll(/<select[^>]*name="(\w+)"/g)].map((match) => match[1]),
    ['period', 'measure', 'groupBy'],
  )
  assert.match(bar, /<option value="2026" selected/)
  assert.match(bar, /<option value="2026-Q4"[^>]*>(?:<!--[^>]*-->)*Q4 2026/)
  assert.match(bar, /<option value="month" selected[^>]*>(?:<!--[^>]*-->)*By month/)
  // With a product it is still the product's own analysis (P32).
  const product = await (await r.app.client.get('/admin/sales/analysis?lang=vi&templateId=goods')).text()
  assert.match(product, /Goods/)
  assert.doesNotMatch(product, /data-ui="column-chart"/)
})

test('D18 only readers of costs see the profit; only readers of sales open the analysis', async (t) => {
  const r = await sold(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const login = async (id: string, roleId: string | null) => {
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    if (roleId) await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId })
    const client = r.app.client.anonymous()
    await client.login({ login: id, password: 'test-password' })
    return client
  }
  const rep = await login('rep', 'commerce.sales-representative')
  // A salesperson reads line costs on orders (sale.cost), so the profit too.
  assert.match(
    await (await rep.get('/admin/sales?lang=vi&period=2026-10')).text(),
    /metric-label"><!--k\[-->Lợi nhuận gộp/,
  )
  const accountant = await login('accountant', 'commerce.accountant')
  const overview = await (await accountant.get('/admin/sales?lang=vi&period=2026-10')).text()
  assert.match(overview, /Tháng 10 năm 2026/)
  assert.doesNotMatch(overview, /metric-label"><!--k\[-->Lợi nhuận gộp/)
  const analysis = await accountant.get('/admin/sales/analysis?lang=vi&period=2026-10&measure=margin')
  assert.equal(analysis.status, 200)
  const text = await analysis.text()
  assert.doesNotMatch(text, /metric-label"><!--k\[-->Lợi nhuận gộp|data-key="margin"/)
  const margin = await accountant.request('/_ket/fn/sale.analyzeSalesMargin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ period: '2026-10' }),
  })
  assert.equal(margin.status, 403)
  const stranger = await login('stranger', null)
  assert.equal((await stranger.get('/admin/sales/analysis?lang=vi')).status, 403)
})
