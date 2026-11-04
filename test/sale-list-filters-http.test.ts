import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { encodeListState } from '@ketvietlab/ketjs'
import type { FilterNode, ListState, Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

const state = (filters: FilterNode[] = [], presets: string[] = []): ListState => ({
  presets,
  filters,
  groupBy: [],
  sort: [],
  openGroups: [],
  groupPages: {},
  page: 1,
  includeArchived: false,
})
const rule = (field: string, operator: string, value?: unknown) =>
  ({ kind: 'rule', field, operator, ...(value === undefined ? {} : { value }) }) as FilterNode

/**
 * Linh sells in team Khách sỉ, Huy in no team. Linh's order sells Goods to Buyer, Huy's sells Tea to
 * Café; Linh also holds a quotation for Lan Anh.
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
  await r.save('sale.saveTeam', { id: 'b2b', name: 'Khách sỉ', leaderId: 'linh', memberIds: ['linh'] })
  await r.save('sale.saveTeam', { id: 'old', name: 'Đội cũ', leaderId: 'huy', memberIds: [] })
  const old = ((await r.call('sale.listTeams', { ids: ['old'] })) as unknown as Row[])[0]!
  await r.save('sale.setTeamActive', { id: 'old', active: false, expectedRevisionId: old.revisionId })
  await r.save('partner.savePartner', { id: 'cafe', kind: 'company', name: 'Café Sáng' })
  await r.save('partner.grantRole', { id: 'cafe-role', partnerId: 'cafe', role: 'customer' })
  await r.save('partner.savePartner', { id: 'lan', kind: 'person', name: 'Lan Anh' })
  await r.save('partner.grantRole', { id: 'lan-role', partnerId: 'lan', role: 'customer' })
  await r.save('product.saveRecord', {
    id: 'tea',
    name: 'Trà',
    type: 'goods',
    defaultCode: 'TEA',
    uomId: 'each',
    listPrice: '20',
    saleOk: true,
  })
  const tea = String(
    ((await r.call('product.listVariants', { templateId: 'tea' })) as unknown as Row[])[0]!.id,
  )
  await r.save('sale.createOrder', {
    id: 'linh-order',
    partnerId: 'buyer',
    warehouseId: 'wh',
    userId: 'linh',
  })
  await r.add({ id: 'linh-line', orderId: 'linh-order' })
  await r.save('sale.createOrder', {
    id: 'huy-order',
    partnerId: 'cafe',
    warehouseId: 'wh',
    userId: 'huy',
    teamId: null,
  })
  await r.add({ id: 'huy-line', orderId: 'huy-order', productId: tea, productUomId: 'each' })
  for (const id of ['linh-order', 'huy-order']) await r.save('sale.confirmOrder', { id })
  await r.save('sale.createOrder', { id: 'linh-quote', partnerId: 'lan', warehouseId: 'wh', userId: 'linh' })
  return r
}

test('D19 the filter bar offers every salesperson and team, and the customers and products sold', async (t) => {
  const r = await sold(t)
  const orders = (await r.call('sale.getOrderFilterChoices', {})) as Row
  const names = (rows: unknown) => (rows as Row[]).map((row) => row.name)
  assert.ok(names(orders.salespeople).includes('Bùi Khánh Linh'))
  assert.ok(names(orders.salespeople).includes('Hoàng Gia Huy'))
  // Archived teams stay choices, after the teams in use.
  assert.deepEqual(
    (orders.teams as Row[]).map((row) => [row.name, row.active]),
    [
      ['Khách sỉ', true],
      ['Đội cũ', false],
    ],
  )
  assert.deepEqual(names(orders.customers), ['Buyer', 'Café Sáng'])
  assert.deepEqual(names(orders.products), ['Goods', 'Trà'])
  // The quotation list offers the customers of its quotations: the fixture's and Linh's.
  const quotations = (await r.call('sale.getOrderFilterChoices', { quotations: true })) as Row
  assert.deepEqual(names(quotations.customers), ['Buyer', 'Lan Anh'])
})

test('D19 the sales order list narrows by salesperson, team, customer, product and invoice status', async (t) => {
  const r = await sold(t)
  const names = async (listState: ListState) =>
    (
      (await r.call('sale.listOrders', { state: 'sale', listState, listMode: 'rows' })) as unknown as {
        rows: Row[]
      }
    ).rows
      .map((row) => String(row.id))
      .sort()
  assert.deepEqual(await names(state()), ['huy-order', 'linh-order'])
  assert.deepEqual(await names(state([rule('userId', 'equals', 'linh')])), ['linh-order'])
  assert.deepEqual(await names(state([rule('userId', 'anyOf', ['linh', 'huy'])])), [
    'huy-order',
    'linh-order',
  ])
  assert.deepEqual(await names(state([rule('teamId', 'equals', 'b2b')])), ['linh-order'])
  // "Not in a team" is a team that is not set.
  assert.deepEqual(await names(state([rule('teamId', 'isNotSet')])), ['huy-order'])
  assert.deepEqual(await names(state([rule('partnerId', 'equals', 'cafe')])), ['huy-order'])
  assert.deepEqual(await names(state([rule('templateId', 'equals', 'tea')])), ['huy-order'])
  assert.deepEqual(await names(state([rule('templateId', 'anyOf', ['tea', 'goods'])])), [
    'huy-order',
    'linh-order',
  ])
  // Filters accumulate with each other and with the presets.
  assert.deepEqual(
    await names(state([rule('userId', 'equals', 'linh'), rule('templateId', 'equals', 'tea')])),
    [],
  )
  const toInvoice = await names(state([], ['to invoice']))
  const statuses = (
    (await r.call('sale.listOrders', { state: 'sale', listState: state(), listMode: 'rows' })) as unknown as {
      rows: Row[]
    }
  ).rows
  assert.deepEqual(
    toInvoice,
    statuses
      .filter((row) => row.invoiceStatus === 'to invoice')
      .map((row) => String(row.id))
      .sort(),
  )
  assert.ok(toInvoice.length > 0)
})

test('D19 both lists read their filters from the address and name the choices in the bar', async (t) => {
  const r = await sold(t)
  const page = async (path: string, listState: ListState) => {
    const response = await r.app.client.get(encodeListState(listState, `${path}?lang=vi`))
    assert.equal(response.status, 200, path)
    return response.text()
  }
  const orders = await page('/admin/sales/orders', state([rule('teamId', 'isNotSet')]))
  assert.match(orders, /href="\/admin\/sales\/orders\/huy-order/)
  assert.doesNotMatch(orders, /href="\/admin\/sales\/orders\/linh-order/)
  // The bar names the salespeople and teams it offers, archived teams marked.
  assert.match(orders, /Hoàng Gia Huy/)
  assert.match(orders, /Đội cũ \(Đã lưu trữ\)/)
  assert.match(orders, /Tên khách hàng/)
  const quotations = await page('/admin/sales/quotations', state([rule('userId', 'equals', 'linh')]))
  assert.match(quotations, /\/admin\/sales\/quotations\/linh-quote/)
  assert.doesNotMatch(quotations, /\/admin\/sales\/quotations\/order[?"]/)
  const others = await page('/admin/sales/quotations', state([rule('userId', 'equals', 'huy')]))
  assert.doesNotMatch(others, /\/admin\/sales\/quotations\/linh-quote/)
  // The overview's queue opens the orders waiting for an invoice.
  const overview = await (await r.app.client.get('/admin/sales?lang=vi')).text()
  assert.match(overview, /preset=to%20invoice/)
})
