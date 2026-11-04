import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setup } from './fixtures/sale/commerce.ts'

// UTC+14: noon UTC on 31 May is already 1 June there, and still 31 May in UTC and in Viet Nam, so a page
// that writes days where the server runs reads a day early on any machine this suite runs on.
const ZONE = 'Pacific/Kiritimati'
const MOMENT = '2031-05-31T12:00:00.000Z'

test('#1774 lots and transfers write their days where the reader keeps the books, not where the server runs', async (t) => {
  const r = await setup(t)
  await r.app.fixture.call('user.setTimezone', { timezone: ZONE }, { actor: 'owner' })
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'lot' })
  await r.save('stock.createLot', {
    id: 'late-may',
    productId: r.productId,
    name: 'LO-31-05',
    expirationDate: MOMENT,
  })
  await r.save('stock.createPicking', {
    id: 'planned',
    name: 'WH/IN/PLANNED',
    pickingTypeId: 'wh:incoming',
    scheduledDate: MOMENT,
  })
  const day = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: ZONE }).format(
    new Date(MOMENT),
  )
  assert.equal(day, '1/6/31')

  const lots = await (await r.app.client.get('/admin/stock/lots?lang=vi')).text()
  assert.match(lots, /LO-31-05[\s\S]*?1\/6\/31/)
  assert.doesNotMatch(lots, /31\/5\/31/)

  const transfers = await (await r.app.client.get('/admin/stock/transfers?lang=vi')).text()
  assert.match(transfers, /WH\/IN\/PLANNED[\s\S]*?1\/6\/31/)
  assert.doesNotMatch(transfers, /31\/5\/31/)
})

test('C30 a transfer planned by day keeps its moment where the company keeps its books', async (t) => {
  const r = await setup(t)
  const at = async () =>
    String(
      (
        (await r.app.adapter!.all(`SELECT "scheduledDate" FROM stock_picking WHERE id = 'planned'`)) as Array<
          Record<string, unknown>
        >
      )[0]?.scheduledDate,
    )
  // A bare day is midnight in Viet Nam, the company's zone: 17:00 UTC the day before.
  await r.save('stock.createPicking', {
    id: 'planned',
    name: 'WH/IN/PLANNED',
    pickingTypeId: 'wh:incoming',
    scheduledDate: '2031-06-01',
  })
  assert.equal(await at(), '2031-05-31T17:00:00.000Z')
  const picking = { id: 'planned', name: 'WH/IN/PLANNED', pickingTypeId: 'wh:incoming' }
  await r.save('stock.savePicking', { ...picking, scheduledDate: '2031-05-31T02:30:00.000Z' })
  // Saving the day it already has leaves the moment alone…
  await r.save('stock.savePicking', { ...picking, scheduledDate: '2031-05-31' })
  assert.equal(await at(), '2031-05-31T02:30:00.000Z')
  // …and another day keeps its time of day there (09:30 in Viet Nam).
  await r.save('stock.savePicking', { ...picking, scheduledDate: '2031-06-04' })
  assert.equal(await at(), '2031-06-04T02:30:00.000Z')
})
