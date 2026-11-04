import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setup } from './fixtures/sale/commerce.ts'

const plain = (value: string | undefined) => value?.replace(/<[^>]*>/g, '').trim()
const decode = (value: string) => value.replaceAll('&amp;', '&')

/** Each on-hand row by lot: its in date and the targets of its Open links, by label. */
type Line = { inDate: string | undefined; open: Record<string, string> }

async function lines(
  client: { request: (path: string) => Promise<Response> },
  lang = 'vi',
): Promise<Record<string, Line>> {
  const response = await client.request(`/admin/stock/inventory?lang=${lang}`)
  assert.equal(response.status, 200)
  const html = await response.text()
  const cell = (row: string, col: string) =>
    new RegExp(`data-col="${col}"[^>]*>([\\s\\S]*?)</td>`).exec(row)?.[1]
  return Object.fromEntries(
    [...html.matchAll(/<tr[^>]*data-row="[^"]+"[\s\S]*?<\/tr>/g)].map(([row]) => [
      plain(cell(row, 'lot')),
      {
        inDate: plain(cell(row, 'inDate')),
        open: Object.fromEntries(
          [...(cell(row, 'open') ?? '').matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
            ([, href, label]) => [plain(label), decode(href!)],
          ),
        ),
      },
    ]),
  )
}

test('K58 on hand: each row says when its goods first came in, and opens its history and its replenishment', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('stock.saveWarehouse', { id: 'hn', name: 'Hà Nội', code: 'HN' })
  const count = async (lot: string, countedQuantity: string, id = `count-${lot}`, locationId = 'wh:stock') =>
    r.save('stock.adjustInventory', {
      id,
      productId: r.productId,
      locationId,
      inventoryLocationId: 'count',
      countedQuantity,
      productUomId: 'each',
      lotId: lot,
    })
  for (const lot of ['EARLY', 'LATE'])
    await r.save('stock.createLot', {
      id: lot,
      productId: r.productId,
      name: lot,
      expirationDate: '2031-06-01T00:00:00Z',
    })
  await count('EARLY', '4')
  // Half past midnight on 1 February in Hà Nội; a longer jump would outlive the session.
  t.mock.timers.setTime(Date.parse('2030-01-31T17:30:00.000Z'))
  await count('LATE', '2', 'count-LATE', 'hn:stock')
  // More of an earlier lot later on keeps the day it first came in.
  await count('EARLY', '9', 'recount-EARLY')
  await r.save('stock.saveOrderpoint', {
    id: 'rule',
    productId: r.productId,
    warehouseId: 'wh',
    locationId: 'wh:stock',
    trigger: 'manual',
    minQuantity: '5',
    maxQuantity: '20',
    replenishmentUomId: 'each',
  })

  const owner = r.app.client as unknown as { request: (path: string) => Promise<Response> }
  const seen = await lines(owner)
  assert.deepEqual(seen.EARLY, {
    inDate: '31/1/30',
    open: {
      'Lịch sử': '/admin/stock/moves?q=EARLY&lang=vi',
      'Bổ sung': '/admin/stock/replenishment/rule?lang=vi',
    },
  })
  // Hà Nội keeps no rule for the product: Replenishment opens the rules searched for it.
  assert.equal(seen.LATE!.inDate, '1/2/30')
  assert.equal(seen.LATE!.open['Lịch sử'], '/admin/stock/moves?q=LATE&lang=vi')
  assert.equal(seen.LATE!.open['Bổ sung'], '/admin/stock/replenishment?q=GOODS&lang=vi')
})

test('K58 only readers of the history see History; only readers of rules see Replenishment', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'opening',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'count',
    countedQuantity: '3',
    productUomId: 'each',
  })
  // What the on-hand page itself reads.
  const page = [
    'stock.listQuants',
    'stock.listStorableProducts',
    'stock.listLocations',
    'stock.listLots',
    'stock.listPickingTypes',
    'stock.listRoutes',
    'stock.listWarehouses',
    'uom.listUnits',
  ]
  const labels = async (id: string, extra: string[]) => {
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await r.fixture('user.saveRole', { id: `${id}-role`, name: id })
    await r.fixture('user.assignRole', { id: `${id}-assignment`, userId: id, roleId: `${id}-role` })
    for (const fnKey of [...page, ...extra])
      await r.fixture('user.grantFunction', { id: `${id}-${fnKey}`, roleId: `${id}-role`, fnKey })
    const client = r.app.client.anonymous()
    await client.login({ login: id, password: 'test-password' })
    const [row] = Object.values(await lines(client, 'en'))
    return Object.keys(row!.open)
  }
  assert.deepEqual(await labels('counter', []), [])
  assert.deepEqual(await labels('historian', ['stock.listMoveHistory']), ['History'])
  assert.deepEqual(await labels('planner', ['stock.listOrderpoints']), ['Replenishment'])
})
