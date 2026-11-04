import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('K-CONSU goods not kept in stock are delivered and received, and leave the stock ledger as it was', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: false, tracking: 'none' })
  const quants = async () => (await r.app.adapter!.all(`SELECT id FROM stock_quant`)).filter(Boolean).length
  const picking = (id: unknown) => r.call('stock.getPicking', { id })

  // A sales order's delivery holds what it needs from nowhere and goes out.
  await r.add({ productUomId: 'box', productUomQty: '2' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  const assigned = await r.call('stock.assignPicking', { id: 'order:delivery' })
  assert.equal(assigned.ok, true, JSON.stringify(assigned))
  assert.equal(assigned.state, 'assigned')
  assert.deepEqual(assigned.shortages, [])
  // Holding again takes nothing more.
  await r.save('stock.assignPicking', { id: 'order:delivery' })
  const lines = ((await picking('order:delivery')).moves as Row[])[0]!.lines as Row[]
  assert.deepEqual(
    lines.map((line) => Number(line.quantity)),
    [24],
  )
  const done = await r.call('stock.completePicking', { id: 'order:delivery' })
  assert.equal(done.ok, true, JSON.stringify(done))
  assert.equal((await picking('order:delivery')).state, 'done')
  await r.save('sale.syncDeliveries', { id: 'order' })
  assert.equal(((await r.call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!.qtyDelivered, '2')

  // A purchase receipt takes what arrived.
  await r.save('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor' })
  await r.save('partner.grantRole', { id: 'vendor-role', partnerId: 'vendor', role: 'supplier' })
  await r.save('purchase.createOrder', { id: 'po', partnerId: 'vendor', pickingTypeId: 'wh:incoming' })
  await r.save('purchase.addLine', {
    id: 'po:line',
    orderId: 'po',
    productId: r.productId,
    productQty: '3',
    productUomId: 'each',
    priceUnit: '50',
  })
  await r.save('purchase.confirmOrder', { id: 'po' })
  const receipt = ((await r.call('purchase.getOrder', { id: 'po' })).pickings as Row[] | undefined)?.[0]
  const receiptId =
    receipt?.id ??
    (await r.app.adapter!.all(`SELECT "pickingId" FROM stock_move WHERE "purchaseLineId" = 'po:line'`))[0]!
      .pickingId
  const move = ((await picking(receiptId)).moves as Row[])[0]!
  await r.save('stock.saveMoveLine', { id: 'po-line', moveId: move.id, quantity: '3' })
  const received = await r.call('stock.completePicking', { id: receiptId })
  assert.equal(received.ok, true, JSON.stringify(received))
  assert.equal((await picking(receiptId)).state, 'done')

  // Neither touched a quant: the goods are not kept in stock.
  assert.equal(await quants(), 0)
})

test('K-CONSU a delivery of goods not kept in stock can be cancelled, and refuses a lot', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: false, tracking: 'none' })
  await r.add({ productUomId: 'each', productUomQty: '5' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  const move = ((await r.call('stock.getPicking', { id: 'order:delivery' })).moves as Row[])[0]!
  const refused = await r.call('stock.reserveMove', {
    id: move.id,
    selections: [{ lotId: 'any', quantity: '5', stockRevision: 'x' }],
  })
  assert.equal(refused.ok, false)
  assert.equal((await r.call('stock.reserveMove', { id: move.id })).state, 'assigned')
  assert.equal((await r.call('stock.cancelPicking', { id: 'order:delivery' })).ok, true)
  assert.equal((await r.call('stock.getPicking', { id: 'order:delivery' })).state, 'cancel')
})
