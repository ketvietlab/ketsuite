import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('K17 transfers take their warehouse number by kind, whoever makes them, and keep it on replay', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  const name = async (id: unknown) => String((await r.call('stock.getPicking', { id })).name)

  // A count that adds stock comes in: the warehouse's first receipt number.
  const counted = await r.call('stock.adjustInventory', {
    id: 'opening',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'count',
    countedQuantity: '10',
    productUomId: 'each',
  })
  assert.equal(await name(counted.pickingId), 'WH/NK/0001')

  // A sales order's delivery goes out; completing part of it numbers the rest as the next delivery.
  await r.add({ productUomId: 'each', productUomQty: '3' })
  await r.save('sale.confirmOrder', { id: 'order' })
  assert.equal(await name('order:delivery'), 'WH/XK/0001')
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  const move = ((await r.call('stock.getPicking', { id: 'order:delivery' })).moves as Row[])[0]!
  await r.save('stock.reserveMove', { id: move.id })
  const line = ((await r.call('stock.getPicking', { id: 'order:delivery' })).moves as Row[])[0]!
    .lines as Row[]
  const { backorderId } = await r.call('stock.completePicking', {
    id: 'order:delivery',
    quantities: [{ moveLineId: line[0]!.id, quantity: 2 }],
    createBackorder: true,
  })
  assert.equal(await name(backorderId), 'WH/XK/0002')

  // A return comes back in, after the count.
  assert.equal((await r.call('stock.createReturn', { id: 'order:delivery', returnId: 'back' })).ok, true)
  assert.equal(await name('back'), 'WH/NK/0002')

  // A transfer made by hand with no name takes the next number of its kind; a typed name stays, and a
  // replay keeps the number it took.
  await r.save('stock.createPicking', { id: 'move-in', pickingTypeId: 'wh:internal' })
  await r.save('stock.createPicking', { id: 'move-in', pickingTypeId: 'wh:internal' })
  await r.save('stock.createPicking', { id: 'typed', name: 'Shelf swap', pickingTypeId: 'wh:internal' })
  await r.save('stock.createPicking', { id: 'move-next', pickingTypeId: 'wh:internal' })
  assert.deepEqual(
    [await name('move-in'), await name('typed'), await name('move-next')],
    ['WH/CK/0001', 'Shelf swap', 'WH/CK/0002'],
  )
})
