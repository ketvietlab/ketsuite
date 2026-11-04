import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/**
 * K40: today is 31 January 2030 (noon in Hà Nội). Warehouse (WH) holds 10 of lot FRESH and 3 of lot OLD,
 * expired; Hà Nội (HN) holds 4 of lot FAR. WH has a delivery of 4 overdue since 20 January, a delivery of
 * 9 on 5 February, a receipt of 5 on 10 February, and a draft receipt of 7. HN has a draft delivery of 2.
 */
async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('stock.saveWarehouse', { id: 'hn', name: 'Hà Nội', code: 'HN' })
  for (const [id, expirationDate, locationId, counted] of [
    ['FRESH', '2031-06-01T00:00:00Z', 'wh:stock', '10'],
    ['OLD', '2030-01-01T00:00:00Z', 'wh:stock', '3'],
    ['FAR', '2031-06-01T00:00:00Z', 'hn:stock', '4'],
  ] as const) {
    await r.save('stock.createLot', { id, productId: r.productId, name: id, expirationDate })
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
  const transfer = async (id: string, pickingTypeId: string, quantity: string, scheduledDate: string) => {
    await r.save('stock.createPicking', { id, name: id, pickingTypeId, scheduledDate })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: quantity,
    })
  }
  await transfer('OUT-LATE', 'wh:outgoing', '4', '2030-01-20T03:00:00Z')
  await transfer('OUT-BIG', 'wh:outgoing', '9', '2030-02-05T03:00:00Z')
  await transfer('IN-SOON', 'wh:incoming', '5', '2030-02-10T03:00:00Z')
  await transfer('IN-DRAFT', 'wh:incoming', '7', '2030-02-12T03:00:00Z')
  await transfer('HN-DRAFT', 'hn:outgoing', '2', '2030-02-01T03:00:00Z')
  for (const id of ['OUT-LATE', 'OUT-BIG', 'IN-SOON']) await r.save('stock.confirmPicking', { id })
  const rule = (minQuantity: string) =>
    r.save('stock.saveOrderpoint', {
      id: 'rule',
      productId: r.productId,
      warehouseId: 'wh',
      locationId: 'wh:stock',
      trigger: 'manual',
      minQuantity,
      maxQuantity: '60',
      replenishmentUomId: 'each',
    })
  const collection = async () =>
    ((await r.call('stock.getForecastCollection', {})) as { today: string; rows: Row[] }).rows
  const detail = async (warehouseId = 'wh') =>
    (
      (await r.call('stock.getForecastDetail', { warehouseId, productId: r.productId })) as {
        line: Row | null
      }
    ).line
  return { ...r, rule, collection, detail }
}

const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.map((key) => [key, row[key]]))

test('K40 a product in a warehouse runs short on the first day its stock after an operation falls below zero', async (t) => {
  const r = await seed(t)
  await r.rule('5')
  const rows = await r.collection()
  // Short comes first; HN holds what it sends nothing of yet, so it has enough.
  assert.deepEqual(
    rows.map((row) => [row.warehouseId, row.status, row.shortDate]),
    [
      ['wh', 'short', '2030-02-05'],
      ['hn', 'ok', ''],
    ],
  )
  // The expired lot is not usable; the overdue delivery counts from today; the draft receipt is on
  // order but not in the forecast; a draft delivery promises nothing yet.
  assert.deepEqual(
    pick(rows[0]!, ['usable', 'blocked', 'incoming', 'outgoing', 'forecast', 'onOrder', 'shortPicking']),
    {
      usable: 10,
      blocked: 3,
      incoming: 5,
      outgoing: 13,
      forecast: 2,
      onOrder: 7,
      shortPicking: { id: 'OUT-BIG', name: 'OUT-BIG' },
    },
  )
  assert.deepEqual(pick(rows[1]!, ['usable', 'blocked', 'incoming', 'outgoing', 'forecast', 'onOrder']), {
    usable: 4,
    blocked: 0,
    incoming: 0,
    outgoing: 0,
    forecast: 4,
    onOrder: 0,
  })
  // The list carries no operations; the product's page does, in the order they are due.
  assert.equal('events' in rows[0]!, false)
  const line = (await r.detail())!
  assert.deepEqual(
    (line.events as Row[]).map((event) =>
      pick(event, ['pickingName', 'kind', 'date', 'day', 'late', 'quantity', 'balance']),
    ),
    [
      {
        pickingName: 'OUT-LATE',
        kind: 'out',
        date: '2030-01-20',
        day: '2030-01-31',
        late: true,
        quantity: -4,
        balance: 6,
      },
      {
        pickingName: 'OUT-BIG',
        kind: 'out',
        date: '2030-02-05',
        day: '2030-02-05',
        late: false,
        quantity: -9,
        balance: -3,
      },
      {
        pickingName: 'IN-SOON',
        kind: 'in',
        date: '2030-02-10',
        day: '2030-02-10',
        late: false,
        quantity: 5,
        balance: 2,
      },
    ],
  )
  assert.deepEqual(
    (line.drafts as Row[]).map((event) => pick(event, ['pickingName', 'kind', 'quantity'])),
    [{ pickingName: 'IN-DRAFT', kind: 'in', quantity: 7 }],
  )
  assert.deepEqual(pick(line.rule as Row, ['minQuantity', 'maxQuantity']), {
    minQuantity: 5,
    maxQuantity: 60,
  })
  assert.equal(await r.detail('nowhere'), null)
  // Running short again later does not move the day it first ran short.
  await r.save('stock.createPicking', {
    id: 'OUT-AGAIN',
    name: 'OUT-AGAIN',
    pickingTypeId: 'wh:outgoing',
    scheduledDate: '2030-02-20T03:00:00Z',
  })
  await r.save('stock.addMove', {
    id: 'OUT-AGAIN-move',
    pickingId: 'OUT-AGAIN',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '5',
  })
  await r.save('stock.confirmPicking', { id: 'OUT-AGAIN' })
  const again = (await r.collection()).find((row) => row.warehouseId === 'wh')!
  assert.deepEqual(pick(again, ['shortDate', 'shortPicking', 'forecast']), {
    shortDate: '2030-02-05',
    shortPicking: { id: 'OUT-BIG', name: 'OUT-BIG' },
    forecast: -3,
  })
})

test('K40 without a shortage, a warehouse rule ranks its product below its minimum or enough', async (t) => {
  const r = await seed(t)
  await r.save('stock.cancelPicking', { id: 'OUT-BIG', reason: 'Customer withdrew' })
  // 10 usable, 4 out today, 5 in on 10 February: 11, which a minimum of 5 finds enough.
  await r.rule('5')
  assert.deepEqual(
    (await r.collection()).map((row) => [row.warehouseId, row.status, row.forecast]),
    [
      ['hn', 'ok', 4],
      ['wh', 'ok', 11],
    ],
  )
  await r.rule('20')
  assert.deepEqual(
    (await r.collection()).map((row) => [row.warehouseId, row.status, row.forecast]),
    [
      ['wh', 'belowMin', 11],
      ['hn', 'ok', 4],
    ],
  )
  // Receiving brings the stock in: the receipt leaves the forecast and the stock carries it.
  await r.save('stock.prepareReceiptLot', {
    id: 'IN-SOON-line',
    moveId: 'IN-SOON-move',
    quantity: '5',
    name: 'NEW',
    expirationDate: '2031-06-01',
  })
  await r.save('stock.completePicking', { id: 'IN-SOON', createBackorder: false })
  const wh = (await r.collection()).find((row) => row.warehouseId === 'wh')!
  assert.deepEqual(pick(wh, ['usable', 'incoming', 'outgoing', 'forecast']), {
    usable: 15,
    incoming: 0,
    outgoing: 4,
    forecast: 11,
  })
})

test('K40 K43 the screens: the list reads on the client, each row opens its page, and only rule readers see the rule', async (t) => {
  const r = await seed(t)
  await r.rule('20')
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await r.fixture('user.saveRole', { id: 'forecast-only', name: 'Forecast only' })
  for (const fnKey of ['stock.getForecastCollection', 'stock.getForecastDetail'])
    await r.fixture('user.grantFunction', { id: `forecast-only:${fnKey}`, roleId: 'forecast-only', fnKey })
  await r.fixture('user.saveRole', { id: 'nothing', name: 'Nothing' })
  const login = async (id: string, roleId: string) => {
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
    return client
  }
  type Client = { request: (path: string, init?: RequestInit) => Promise<Response> }
  const data = async (client: Client, href = '/admin/stock/forecast?lang=en') => {
    const response = await client.request('/admin/stock/forecast/data?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ href }),
    })
    return response.status === 200 ? ((await response.json()).value as Row) : response.status
  }
  const owner = r.app.client as unknown as Client
  const reader = await login('reader', 'forecast-only')
  const stranger = await login('stranger', 'nothing')

  // No business row enters the server-rendered list.
  const list = await owner.request('/admin/stock/forecast?lang=en')
  assert.equal(list.status, 200)
  const html = await list.text()
  assert.match(html, /<title>Stock forecast/)
  assert.doesNotMatch(html, /OUT-BIG|FRESH/)
  assert.match(html, /stock-forecast-help/)

  const full = (await data(owner)) as Row
  assert.deepEqual(
    (full.rows as Row[]).map((row) =>
      pick(row, ['id', 'statusLabel', 'shortDate', 'minQuantity', 'outgoing', 'forecastText', 'onOrder']),
    ),
    // HN sends nothing out: the cell reads 0, not -0.
    [
      {
        id: `wh:${r.productId}`,
        statusLabel: 'Short',
        shortDate: '02/05/2030',
        minQuantity: '20',
        outgoing: '13',
        forecastText: '2',
        onOrder: '7',
      },
      {
        id: `hn:${r.productId}`,
        statusLabel: 'Enough',
        shortDate: '',
        minQuantity: '',
        outgoing: '0',
        forecastText: '4',
        onOrder: '',
      },
    ],
  )
  assert.equal(
    (full.rows as Row[])[0]!.editHref,
    `/admin/stock/forecast/wh/${encodeURIComponent(r.productId)}?lang=en`,
  )
  // The status preset narrows the list.
  const short = (await data(owner, '/admin/stock/forecast?lang=en&preset=ok')) as Row
  assert.deepEqual(
    (short.rows as Row[]).map((row) => row.id),
    [`hn:${r.productId}`],
  )

  // A reader without rules sees no minimum; the rule's own figures stay hidden.
  const partial = (await data(reader)) as Row
  assert.deepEqual(
    (partial.rows as Row[]).map((row) => row.minQuantity),
    ['', ''],
  )
  assert.equal(await data(stranger), 403)
  assert.equal((await stranger.request('/admin/stock/forecast?lang=en')).status, 403)

  // The product's page: when it runs short and why, each operation with what is left, the rule beside it.
  const page = async (
    client: Client,
    path = `/admin/stock/forecast/wh/${encodeURIComponent(r.productId)}?lang=en`,
  ) => {
    const response = await client.request(path)
    return { status: response.status, html: response.status === 200 ? await response.text() : '' }
  }
  const mine = await page(owner)
  assert.equal(mine.status, 200)
  assert.match(mine.html, /Short from 02\/05\/2030/)
  assert.match(mine.html, /OUT-BIG takes the stock below 0\./)
  assert.match(mine.html, /href="\/admin\/stock\/transfers\/OUT-LATE\?lang=en"/)
  assert.match(mine.html, /Overdue/)
  assert.match(mine.html, /Drafts, not yet in the forecast/)
  assert.match(mine.html, /Replenishment rule/)
  const theirs = await page(reader)
  assert.equal(theirs.status, 200)
  assert.doesNotMatch(theirs.html, /Replenishment rule/)
  assert.equal(
    (await page(owner, `/admin/stock/forecast/nowhere/${encodeURIComponent(r.productId)}?lang=en`)).status,
    404,
  )
  assert.equal((await page(stranger)).status, 403)
})
