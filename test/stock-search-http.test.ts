import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/**
 * Lot A is counted into Warehouse; the order delivers 4 of it and a return of it waits. Warehouse is being
 * counted again. Hà Nội has a replenishment rule, and a receipt waits there, never received.
 */
async function seed(t: TestContext) {
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('stock.saveWarehouse', { id: 'hn', name: 'Hà Nội', code: 'HN' })
  await r.save('stock.createLot', { id: 'A', productId: r.productId, name: 'LO-ĐẦU', ref: 'NCC-77' })
  await r.save('stock.adjustInventory', {
    id: 'count-A',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'count',
    countedQuantity: '10',
    productUomId: 'each',
    lotId: 'A',
  })
  await r.add({ productUomId: 'each', productUomQty: '4' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  await r.save('stock.assignPicking', { id: 'order:delivery' })
  await r.save('stock.completePicking', { id: 'order:delivery', createBackorder: false })
  await r.save('stock.createReturn', { id: 'order:delivery', returnId: 'back' })
  await r.save('stock.createPicking', { id: 'in', name: 'in', pickingTypeId: 'hn:incoming' })
  await r.save('stock.addMove', {
    id: 'in-move',
    pickingId: 'in',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '5',
  })
  await r.save('stock.startCountSession', { id: 'recount', warehouseId: 'wh' })
  await r.save('stock.saveOrderpoint', {
    id: 'hn-rule',
    productId: r.productId,
    warehouseId: 'hn',
    locationId: 'hn:stock',
    trigger: 'manual',
    minQuantity: '1',
    maxQuantity: '20',
    replenishmentUomId: 'each',
    source: 'supplier',
    vendorId: null,
    leadDays: 2,
  })
  const name = async (fn: string, id: string) => String(((await r.call(fn, { id })) as Row).name)
  return {
    r,
    names: {
      order: await name('sale.getOrder', 'order'),
      delivery: await name('stock.getPicking', 'order:delivery'),
      back: await name('stock.getPicking', 'back'),
      count: await name('stock.getPicking', 'count-A:picking'),
      receipt: await name('stock.getPicking', 'in'),
      session: await name('stock.getCountSession', 'recount'),
    },
  }
}

type Client = { request: (path: string, init?: RequestInit) => Promise<Response> }
/** Where the topbar search of the page at `path` goes. */
const topbarSearch = async (client: Client, path: string) => {
  const markup = await (await client.request(path)).text()
  const href = /data-ui="global-search-trigger" href="([^"]*)"/.exec(markup)?.[1] ?? ''
  return new URL(href.replaceAll('&amp;', '&'), 'http://ket.local').pathname
}
/** What the search answers for `q`, each row as [kind, number, for, source document, status]. */
async function searched(client: Client, q: string, page = 1) {
  const response = await client.request('/_ket/fn/stock_backend.searchStock?lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ href: `/admin/stock/search?lang=en&q=${encodeURIComponent(q)}`, page }),
  })
  if (response.status !== 200) return response.status
  return ((await response.json()) as { value: Row }).value
}
const shown = (answer: Row | number) =>
  ((answer as Row).rows as Row[]).map((row) => [row.kind, row.name, row.subject, row.origin, row.state])

test('K55 Search in Stock finds transfers, lots, counts and rules by number, code, name and source', async (t) => {
  const { r, names } = await seed(t)
  const client = r.app.client
  // The order's number finds its delivery; the return names the delivery it brings back, and as a
  // receipt it is ready once confirmed (K18).
  assert.deepEqual(shown(await searched(client, names.order)), [
    ['delivery', names.delivery, 'Buyer', names.order, 'state.done'],
  ])
  assert.deepEqual(shown(await searched(client, names.delivery)), [
    ['return', names.back, 'Buyer', names.delivery, 'state.assigned'],
    ['delivery', names.delivery, 'Buyer', names.order, 'state.done'],
  ])
  // Without accents or case: the lot by its name and its reference, then what moved it.
  const lot = (await searched(client, 'lo-dau')) as Row
  assert.deepEqual(shown(lot)[0]!.slice(0, 2), ['lot', 'LO-ĐẦU'])
  assert.deepEqual(
    shown(await searched(client, 'ncc-77')).map((row) => row[0]),
    ['lot'],
  )
  // A count by its number; a warehouse finds its rule.
  const count = (await searched(client, names.session)) as Row
  assert.deepEqual(
    shown(count).map((row) => [row[0], row[1], row[4]]),
    [['count', names.session, 'count.state.counting']],
  )
  // Its warehouse finds it too.
  const counted = shown(count)[0]![2] as string
  assert.ok(
    shown(await searched(client, counted)).some((row) => row[0] === 'count'),
    counted,
  )
  const hn = (await searched(client, 'ha noi')) as Row
  assert.deepEqual(
    shown(hn).map((row) => [row[0], row[2], row[4]]),
    [['rule', 'Hà Nội (HN)', 'search.state.active']],
  )
  // A product finds every transfer of it, in every status, and the lot and the rule.
  const goods = shown(await searched(client, 'goods'))
  assert.deepEqual(
    goods.map((row) => [row[0], row[1]]),
    [
      ['receipt', names.receipt],
      ['return', names.back],
      ['delivery', names.delivery],
      ['adjustment', names.count],
      ['lot', 'LO-ĐẦU'],
      ['rule', goods.find((row) => row[0] === 'rule')![1]],
    ],
  )
  assert.equal(goods.find((row) => row[0] === 'receipt')![4], 'state.draft')
  // A count's adjustment names no source document; the lot, still held in Warehouse, has no expiry.
  const product = goods.find((row) => row[0] === 'lot')![2]
  assert.deepEqual(
    goods.find((row) => row[0] === 'adjustment'),
    ['adjustment', names.count, product, '', 'state.done'],
  )
  assert.deepEqual(goods.find((row) => row[0] === 'lot')!.slice(3), ['NCC-77', 'lot.condition.noExpiry'])
  // Each opens its own record, in the reader's language.
  const hrefs = Object.fromEntries(
    [hn, lot, count].flatMap((answer) => answer.rows as Row[]).map((row) => [row.kind, row.href]),
  )
  assert.equal(hrefs.lot, '/admin/stock/lots/A?company=acme&lang=en')
  assert.equal(hrefs.rule, '/admin/stock/replenishment/hn-rule?company=acme&lang=en')
  assert.match(
    String(hrefs.count),
    /^\/admin\/stock\/counts\?company=acme&lang=en&record=stock\.countSession(%3A|:)recount$/,
  )
  assert.equal(
    ((await searched(client, names.delivery)) as { rows: Row[] }).rows[1]!.href,
    '/admin/stock/transfers/order%3Adelivery?company=acme&lang=en',
  )
  // Nothing typed, nothing searched.
  assert.deepEqual(shown(await searched(client, '')), [])
})

test('K55 results page by 25', async (t) => {
  const { r } = await seed(t)
  for (let index = 1; index <= 26; index++)
    await r.save('stock.createLot', {
      id: `P${index}`,
      productId: r.productId,
      name: `PAGE-${String(index).padStart(2, '0')}`,
    })
  const first = (await searched(r.app.client, 'page-')) as Row
  assert.deepEqual([first.total, first.pages, (first.rows as Row[]).length], [26, 2, 25])
  assert.equal(first.next, '/admin/stock/search?lang=en&company=acme&q=page-&page=2')
  const second = (await searched(r.app.client, 'page-', 2)) as Row
  assert.deepEqual(
    shown(second).map((row) => row[1]),
    ['PAGE-26'],
  )
  assert.equal(second.previous, '/admin/stock/search?lang=en&company=acme&q=page-')
})

test('K55 each type follows what the reader may read, and the topbar follows the app', async (t) => {
  const { r, names } = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  // A role of its own that reads lots, lists transfers without opening them and opens counts without listing.
  await r.fixture('user.saveRole', { id: 'lot-reader', name: 'Lot reader' })
  // And one that opens the lots list without the search.
  await r.fixture('user.saveRole', { id: 'lot-lister', name: 'Lot lister' })
  for (const fnKey of [
    'stock.listLots',
    'stock.listStorableProducts',
    'stock.listLocations',
    'stock.listQuants',
  ])
    await r.fixture('user.grantFunction', { id: `lot-lister:${fnKey}`, roleId: 'lot-lister', fnKey })
  for (const fnKey of [
    'stock_backend.searchStock',
    'stock.listLots',
    'stock.listPickings',
    'stock.getCountSession',
  ])
    await r.fixture('user.grantFunction', { id: `lot-reader:${fnKey}`, roleId: 'lot-reader', fnKey })
  const signIn = async (roleId: string | null, id: string) => {
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
  // The reads each type's list makes and its record opens with, asked as those screens ask them.
  const grants: Record<string, [string, Row][]> = {
    transfer: [
      ['stock.listPickings', {}],
      ['stock.getPicking', { id: 'order:delivery' }],
    ],
    lot: [['stock.listLots', {}]],
    count: [
      ['stock.listCountSessions', {}],
      ['stock.getCountSession', { id: 'recount' }],
    ],
    rule: [
      ['stock.getOrderpointCollection', {}],
      ['stock.listOrderpoints', {}],
    ],
  }
  const reads = async (client: Client, fn: string, input: Row) =>
    (
      await client.request(`/_ket/fn/${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
    ).status === 200
  const seen: Record<string, string[]> = {}
  for (const [roleId, id] of [
    ['commerce.warehouse-operator', 'operator'],
    ['commerce.warehouse-manager', 'manager'],
    ['lot-reader', 'lots'],
  ] as const) {
    const client = await signIn(roleId, id)
    const expected: string[] = []
    for (const [kind, needs] of Object.entries(grants))
      if ((await Promise.all(needs.map(([fn, input]) => reads(client, fn, input)))).every(Boolean))
        expected.push(kind)
    const kinds = new Set<string>()
    for (const q of ['goods', names.session])
      for (const row of ((await searched(client, q)) as { rows: Row[] }).rows)
        kinds.add(['lot', 'count', 'rule'].includes(String(row.kind)) ? String(row.kind) : 'transfer')
    assert.deepEqual([...kinds].sort(), expected.sort(), roleId)
    seen[id] = [...kinds].sort()
    if (id === 'lots') continue
    // The topbar of a stock screen opens Search in Stock, which has its own guide.
    const markup = await (await client.request('/admin/stock/search?lang=vi&q=goods')).text()
    assert.match(markup, /data-ui="global-search-trigger"[^>]*aria-label="Tìm trong Kho"/)
    assert.match(markup, /id="stock-search-help"/)
    assert.equal(await topbarSearch(client, '/admin/stock/lots?lang=vi'), '/admin/stock/search')
  }
  assert.deepEqual(seen, {
    operator: ['count', 'lot', 'rule', 'transfer'],
    manager: ['count', 'lot', 'rule', 'transfer'],
    lots: ['lot'],
  })
  // Without a stock role there is no page, no function, and the topbar searches everything.
  const nobody = await signIn(null, 'nobody')
  assert.equal((await nobody.request('/admin/stock/search?lang=en&q=goods')).status, 403)
  assert.equal(await searched(nobody, 'goods'), 403)
  assert.equal(await topbarSearch(nobody, '/admin/context?lang=en'), '/admin/search')
  const lister = await signIn('lot-lister', 'lister')
  assert.equal((await lister.request('/admin/stock/lots?lang=en')).status, 200)
  assert.equal(await topbarSearch(lister, '/admin/stock/lots?lang=en'), '/admin/search')
  // Elsewhere the owner's topbar searches everything, and Products keeps its own.
  assert.equal(await topbarSearch(r.app.client, '/admin/stock/transfers?lang=en'), '/admin/stock/search')
  assert.equal(await topbarSearch(r.app.client, '/admin/sales/orders?lang=en'), '/admin/search')
  assert.equal(await topbarSearch(r.app.client, '/admin/product/templates?lang=en'), '/admin/product/search')
})
