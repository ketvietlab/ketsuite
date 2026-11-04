import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { overviewFigures } from '../packages/ketsuite/src/modules/stock_backend/overview-data.ts'
import { setup } from './fixtures/sale/commerce.ts'

/**
 * Today is 31 January 2030. Warehouse (WH) holds lots SOON (expiring), OLD (expired) and GONE (none left);
 * Hà Nội (HN) holds lot FAR. WH has a receipt to receive, a delivery ready, a late delivery waiting for goods,
 * a draft and a count under way; HN has a receipt to receive and a count waiting for approval.
 */
async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('stock.saveWarehouse', { id: 'hn', name: 'Hà Nội', code: 'HN' })
  await r.save('product.setCost', { productId: r.productId, standardPrice: '1000' })
  for (const [id, expirationDate, locationId, counted] of [
    ['SOON', '2030-03-01T00:00:00Z', 'wh:stock', '5'],
    ['OLD', '2030-01-01T00:00:00Z', 'wh:stock', '3'],
    ['GONE', '2030-02-15T00:00:00Z', 'wh:stock', '0'],
    ['FAR', '2031-06-01T00:00:00Z', 'hn:stock', '4'],
  ] as const) {
    await r.save('stock.createLot', { id, productId: r.productId, name: id, expirationDate })
    if (counted !== '0')
      await r.save('stock.adjustInventory', {
        id: `count-${id}`,
        productId: r.productId,
        locationId,
        inventoryLocationId: 'count',
        countedQuantity: counted,
        productUomId: 'each',
        lotId: id,
      })
  }
  const transfer = async (id: string, pickingTypeId: string, quantity: string, scheduledDate?: string) => {
    await r.save('stock.createPicking', {
      id,
      name: id,
      pickingTypeId,
      ...(scheduledDate ? { scheduledDate } : {}),
    })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: quantity,
    })
  }
  await transfer('in-wh', 'wh:incoming', '10', '2030-02-02T00:00:00Z')
  await transfer('in-hn', 'hn:incoming', '10', '2030-02-05T00:00:00Z')
  await transfer('out-ready', 'wh:outgoing', '2', '2030-03-01T00:00:00Z')
  await transfer('out-late', 'wh:outgoing', '100', '2030-01-20T00:00:00Z')
  await transfer('out-draft', 'wh:outgoing', '1', '2030-01-10T00:00:00Z')
  for (const id of ['in-wh', 'in-hn', 'out-ready', 'out-late']) await r.save('stock.confirmPicking', { id })
  // The delivery with goods is held; the late one is left waiting for goods.
  await r.save('stock.assignPicking', { id: 'out-ready' })
  await r.save('stock.saveOrderpoint', {
    id: 'rule',
    productId: r.productId,
    warehouseId: 'wh',
    locationId: 'wh:stock',
    trigger: 'manual',
    minQuantity: '50',
    maxQuantity: '60',
    replenishmentUomId: 'each',
    source: 'supplier',
    vendorId: null,
    leadDays: 2,
  })
  await r.save('stock.startCountSession', { id: 'hn-count', warehouseId: 'hn', blind: false })
  const session = (await r.call('stock.getCountSession', { id: 'hn-count' })) as Row
  await r.save('stock.saveCountLines', {
    id: 'hn-count',
    lines: (session.lines as Row[]).map((line) => ({ lineId: line.id, counted: '4' })),
  })
  await r.save('stock.submitCountSession', { id: 'hn-count' })
  // Warehouse is still being counted, so its count waits for nobody's approval yet.
  await r.save('stock.startCountSession', { id: 'wh-count', warehouseId: 'wh', blind: false })
  return r
}

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"')
const plain = (value: string | undefined) => value?.replace(/<[^>]*>/g, '').trim()

/** The overview's tiles by label: value, detail and link, `null` when the tile opens nothing. */
function tiles(html: string): Record<string, { value?: string; detail: string | null; href: string | null }> {
  return Object.fromEntries(
    [...html.matchAll(/<(a|article)\b([^>]*data-ui="metric"[^>]*)>([\s\S]*?)<\/\1>/g)].map(
      ([, , attributes, body]) => [
        plain(/data-ui="metric-label"[^>]*>([\s\S]*?)<\/p>/.exec(body!)?.[1]),
        {
          value: plain(/data-ui="metric-value"[^>]*>([\s\S]*?)<\/p>/.exec(body!)?.[1]),
          detail: plain(/data-ui="metric-detail"[^>]*>([\s\S]*?)<\/p>/.exec(body!)?.[1]) ?? null,
          href: /href="([^"]*)"/.exec(attributes!)?.[1]
            ? decode(/href="([^"]*)"/.exec(attributes!)![1]!)
            : null,
        },
      ],
    ),
  )
}

/** The rows of the table under a section heading, by row id, as their cells' text. */
function section(html: string, heading: string) {
  const at = html.indexOf(`>${heading}<`)
  assert.notEqual(at, -1, heading)
  const table = /<table[\s\S]*?<\/table>/.exec(html.slice(at))?.[0] ?? ''
  return [...table.matchAll(/<tr[^>]*data-row="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)].map(([, id, row]) => [
    id,
    [...row!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => plain(cell)),
  ])
}

const rowIds = (html: string) => [...html.matchAll(/<tr[^>]*data-row="([^"]+)"/g)].map((row) => row[1])

/** The ids a list shows at `href`: from the page, or from its data endpoint when it renders on the client. */
async function listed(
  client: { request: (path: string, init?: RequestInit) => Promise<Response> },
  href: string,
) {
  const response = await client.request(href)
  assert.equal(response.status, 200, href)
  const ids = rowIds(await response.text())
  if (!ids.every((id) => id?.startsWith('loading-'))) return ids
  const data = await client.request(`${href.split('?')[0]}/data?lang=en`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ href }),
  })
  assert.equal(data.status, 200, href)
  return ((await data.json()).value.rows as Row[]).map((row) => String(row.id))
}

test('K51 the overview counts what waits, per warehouse, and each figure opens the list it counts', async (t) => {
  const r = await seed(t)
  const page = async (query = '') => {
    const response = await r.app.client.get(`/admin/stock?lang=en${query}`)
    assert.equal(response.status, 200)
    return response.text()
  }
  const all = await page()
  const figures = tiles(all)
  assert.deepEqual(
    Object.fromEntries(Object.entries(figures).map(([label, tile]) => [label, [tile.value, tile.detail]])),
    {
      'Receipts to receive': ['2', null],
      'Deliveries ready': ['1', null],
      'Deliveries waiting': ['1', '1 late'],
      'Products to replenish': ['1', null],
      'Lots expiring soon': ['1', '1 expired lots still on hand'],
      'Counts to approve': ['1', null],
      'Stock value': ['₫12,000', null],
    },
  )
  // Each tile opens its list with the same rows it counted.
  const opened = async (label: string) => {
    const href = figures[label]!.href
    assert.ok(href, label)
    return listed(r.app.client, href)
  }
  assert.deepEqual(await opened('Lots expiring soon'), ['SOON'])
  assert.deepEqual(await opened('Counts to approve'), ['hn-count'])
  assert.equal((await opened('Products to replenish')).length, 1)
  // A transfer tile opens Transfers on its kind and states (#1414's presets), narrowed to the warehouse by name.
  const query = (href: string) => {
    const url = new URL(href, 'http://local')
    return [
      url.pathname,
      url.searchParams.getAll('preset'),
      url.searchParams
        .getAll('filter')
        .map((token) => JSON.parse(Buffer.from(token, 'base64url').toString())),
    ]
  }
  assert.deepEqual(query(figures['Receipts to receive']!.href!), [
    '/admin/stock/transfers',
    ['receipts', 'waiting', 'ready'],
    [],
  ])
  assert.deepEqual(query(figures['Deliveries ready']!.href!).slice(1), [['deliveries', 'ready'], []])
  assert.deepEqual(query(figures['Deliveries waiting']!.href!).slice(1), [['deliveries', 'waiting'], []])
  assert.match(figures['Stock value']!.href!, /^\/admin\/stock\/valuation/)

  // By warehouse: each row opens that warehouse's on hand.
  assert.equal(figures['Stock value']!.value, '₫12,000')
  assert.deepEqual(section(all, 'By warehouse'), [
    ['hn', ['Hà Nội', '1', '1', '0', '0', '0', '₫4,000']],
    ['wh', ['Warehouse', '1', '1', '3', '1', '1', '₫8,000']],
  ])
  assert.match(all, /data-row="hn" data-row-href="\/admin\/stock\/inventory\?warehouse=hn&amp;lang=en"/)
  // To do: confirmed transfers late or due within a week, the most overdue first; drafts and later ones wait.
  assert.deepEqual(
    section(all, 'To do').map(([id]) => id),
    ['out-late', 'in-wh', 'in-hn'],
  )
  // The list holds receipts and deliveries alike, so each day says what it plans.
  assert.deepEqual(
    section(all, 'To do').map(([id, cells]) => [
      id,
      (cells as string[]).find((cell) => / · \d/.test(cell))?.split(' · ')[0],
    ]),
    [
      ['out-late', 'Delivery'],
      ['in-wh', 'Receipt'],
      ['in-hn', 'Receipt'],
    ],
  )

  // #1813: the places a row moves goods between read in the reader's language, not their English seed names.
  const vi = section(await (await r.app.client.get('/admin/stock?lang=vi')).text(), 'Việc cần làm')
  const delivery = vi.find(([id]) => id === 'out-late')?.[1] as string[]
  assert.ok(delivery.includes('Tồn kho → Khách hàng'), delivery.join(' | '))

  // One warehouse: the figures narrow to it, a zero opens nothing.
  const hn = tiles(await page('&warehouse=hn'))
  assert.deepEqual(
    Object.fromEntries(Object.entries(hn).map(([label, tile]) => [label, [tile.value, tile.href !== null]])),
    {
      'Receipts to receive': ['1', true],
      'Deliveries ready': ['0', false],
      'Deliveries waiting': ['0', false],
      'Products to replenish': ['0', false],
      'Lots expiring soon': ['0', false],
      'Counts to approve': ['1', true],
      'Stock value': ['₫4,000', true],
    },
  )
  assert.deepEqual(await listed(r.app.client, hn['Counts to approve']!.href!), ['hn-count'])
  assert.match(hn['Stock value']!.href!, /warehouse=hn/)
  assert.deepEqual(query(hn['Receipts to receive']!.href!)[2], [
    { kind: 'rule', field: 'warehouse', operator: 'equals', value: 'Hà Nội' },
  ])
  assert.deepEqual(await listed(r.app.client, hn['Receipts to receive']!.href!), ['in-hn'])
  assert.deepEqual(
    section(await page('&warehouse=hn'), 'By warehouse').map(([id]) => id),
    ['hn'],
  )
  // In Warehouse, the expiring lot it holds opens on its own.
  const wh = tiles(await page('&warehouse=wh'))
  assert.equal(wh['Lots expiring soon']!.value, '1')
  assert.deepEqual(await listed(r.app.client, wh['Lots expiring soon']!.href!), ['SOON'])
  assert.deepEqual(await listed(r.app.client, wh['Products to replenish']!.href!), ['rule'])
  // An unknown warehouse reads as all of them.
  assert.deepEqual(tiles(await page('&warehouse=gone')), figures)

  // The on-hand page narrows to the warehouse a row opens.
  const onHand = await r.app.client.get('/admin/stock/inventory?lang=en&warehouse=hn')
  const lots = [...(await onHand.text()).matchAll(/<td[^>]*data-col="lot"[^>]*>([\s\S]*?)<\/td>/g)].map(
    (cell) => plain(cell[1]),
  )
  assert.deepEqual(lots, ['FAR'])
})

test('K51 a tile shows only to whoever may open its list; stock value only to whoever may see it', async (t) => {
  const r = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const labels = async (roleId: string) => {
    const id = roleId.replace('commerce.', '')
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId })
    const client = r.app.client.anonymous()
    await client.login({ login: id, password: 'test-password' })
    const response = await client.request('/admin/stock?lang=en')
    assert.equal(response.status, 200, roleId)
    const html = await response.text()
    return { tiles: Object.keys(tiles(html)), value: html.includes('>Value<') }
  }
  assert.deepEqual(await labels('commerce.warehouse-manager'), {
    tiles: [
      'Receipts to receive',
      'Deliveries ready',
      'Deliveries waiting',
      'Products to replenish',
      'Lots expiring soon',
      'Counts to approve',
      'Stock value',
    ],
    value: true,
  })
  for (const roleId of ['commerce.warehouse-operator', 'commerce.sales-representative']) {
    const seen = await labels(roleId)
    assert.equal(seen.tiles.length, 6, roleId)
    assert.deepEqual([seen.tiles.includes('Stock value'), seen.value], [false, false], roleId)
  }
})

test('K51 a list the reader may not read leaves its tile out', () => {
  const source = {
    pickings: [],
    pickingTypes: [],
    warehouses: [{ id: 'wh', name: 'Warehouse' }],
    locations: [],
    quants: null,
    lots: null,
    counts: null,
    orderpoints: null,
    values: null,
  }
  const figures = overviewFigures(source, '', Date.now())
  assert.deepEqual(
    figures.tiles.map((tile) => [tile.id, tile.value, tile.href]),
    [
      ['receiptsOpen', 0, null],
      ['deliveriesReady', 0, null],
      ['deliveriesWaiting', 0, null],
    ],
  )
  assert.deepEqual(
    figures.warehouses.map((row) => [row.toOrder, row.value]),
    [[null, null]],
  )
  // With every list readable, each tile is there.
  const full = overviewFigures(
    { ...source, quants: [], lots: [], counts: [], orderpoints: [], values: { '': '0' } },
    '',
    0,
  )
  assert.deepEqual(
    full.tiles.map((tile) => tile.id),
    [
      'receiptsOpen',
      'deliveriesReady',
      'deliveriesWaiting',
      'toOrder',
      'lotsExpiring',
      'countsReview',
      'value',
    ],
  )
})
