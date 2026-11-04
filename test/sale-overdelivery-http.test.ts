import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { invoiceQuantities } from '../packages/ketsuite/src/modules/sale/invoice-quantities.ts'
import { setup } from './fixtures/sale/commerce.ts'
async function seed(t: TestContext, policy = 'delivery') {
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('sale.setInvoicePolicy', { templateId: 'goods', invoicePolicy: policy })
  await r.save('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'opening',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'each',
  })
  await r.add({ productUomId: 'each', productUomQty: '2' })
  await r.save('sale.confirmOrder', { id: 'order' })
  const order = () => r.call('sale.getOrder', { id: 'order' })
  const move = ((await order()).moves as Row[])[0]!
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  await r.save('stock.reserveMove', { id: move.id })
  const picking = await r.call('stock.getPicking', { id: 'order:delivery' })
  const line = ((picking.moves as Row[])[0]!.lines as Row[])[0]!
  const complete = (quantity: number) =>
    r.call('stock.completePicking', {
      id: 'order:delivery',
      quantities: [{ moveLineId: line.id, quantity }],
      createBackorder: false,
    })
  for (const [id, code, accountType] of [
    ['revenue', 'REV', 'income'],
    ['receivable', 'REC', 'asset_receivable'],
  ])
    await r.save('account.saveAccount', { id, code, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  const invoice = (id = 'invoice') =>
    r.call('sale.createInvoice', {
      id,
      orderId: 'order',
      journalId: 'journal',
      revenueAccountId: 'revenue',
      receivableAccountId: 'receivable',
    })
  return { ...r, move, line, order, complete, invoice }
}
test('D33 outgoing overdelivery consumes available stock and invoices the whole delivered quantity once', async (t) => {
  const r = await seed(t)
  assert.equal((await r.complete(3)).ok, true)
  assert.equal((await r.complete(3)).ok, true)
  await r.save('sale.syncDeliveries', { id: 'order' })
  let order = await r.order()
  assert.equal((order.lines as Row[])[0]!.qtyDelivered, '3')
  assert.equal((order.lines as Row[])[0]!.productUomQty, '2')
  assert.equal(order.invoiceStatus, 'to invoice')
  assert.equal((order.lines as Row[])[0]!.qtyToInvoice, '3')
  assert.equal((order.lines as Row[])[0]!.qtyOverToInvoice, '1')
  assert.equal((await r.invoice()).ok, true)
  assert.equal((await r.invoice()).ok, true)
  order = await r.order()
  assert.equal(order.invoiceStatus, 'invoiced')
  const lines = await r.app.adapter!.all(`SELECT quantity FROM account_move_line WHERE "saleLineId" = 'line'`)
  assert.equal(lines.length, 1)
  assert.equal(String(lines[0]!.quantity), '3')
  const quants = await r.app.adapter!.all(
    `SELECT quantity, "reservedQuantity" FROM stock_quant WHERE "locationId" = 'wh:stock'`,
  )
  assert.equal(String(quants[0]!.quantity), '7')
  assert.equal(String(quants[0]!.reservedQuantity), '0')
})
test('K2 a completed delivery counts on its order at once, without Đồng bộ giao hàng', async (t) => {
  const r = await seed(t)
  assert.equal((await r.complete(3)).ok, true)
  const order = await r.order()
  assert.equal((order.lines as Row[])[0]!.qtyDelivered, '3')
  assert.equal(order.invoiceStatus, 'to invoice')
  await r.save('sale.syncDeliveries', { id: 'order' })
  assert.equal(((await r.order()).lines as Row[])[0]!.qtyDelivered, '3')
})
test('K2 validating a delivery from its page counts it on the order', async (t) => {
  const r = await seed(t)
  await r.save('stock.saveMoveLine', { id: r.line.id, moveId: r.move.id, quantity: '2', picked: true })
  assert.equal(
    (await r.call('stock.validatePicking', { id: 'order:delivery', backorder: 'cancel' })).ok,
    true,
  )
  assert.equal(((await r.order()).lines as Row[])[0]!.qtyDelivered, '2')
})
test('D33 order-based overdelivery becomes upselling only after all billable lines are invoiced', async (t) => {
  const r = await seed(t, 'order')
  assert.equal((await r.complete(3)).ok, true)
  await r.save('sale.syncDeliveries', { id: 'order' })
  assert.equal((await r.order()).invoiceStatus, 'to invoice')
  assert.equal((await r.invoice()).ok, true)
  assert.equal((await r.order()).invoiceStatus, 'upselling')
  assert.equal((await r.invoice('nothing-extra')).ok, false)
})
test('D33 outgoing overdelivery cannot consume unavailable or another move reserved stock', async (t) => {
  const r = await seed(t)
  assert.equal((await r.complete(11)).ok, false)
  assert.notEqual((await r.call('stock.getPicking', { id: 'order:delivery' })).state, 'done')
  await r.save('stock.createPicking', { id: 'other-delivery', name: 'Other', pickingTypeId: 'wh:outgoing' })
  await r.save('stock.addMove', {
    id: 'other-move',
    name: 'Other',
    pickingId: 'other-delivery',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '8',
  })
  await r.save('stock.confirmPicking', { id: 'other-delivery' })
  await r.save('stock.reserveMove', { id: 'other-move' })
  assert.equal((await r.complete(3)).ok, false)
  const quants = await r.app.adapter!.all(
    `SELECT quantity, "reservedQuantity" FROM stock_quant WHERE "locationId" = 'wh:stock'`,
  )
  assert.equal(String(quants[0]!.quantity), '10')
  assert.equal(String(quants[0]!.reservedQuantity), '10')
})

for (const [id, type, source, destination] of [
  ['receipt', 'incoming', 'supplier', 'stock'],
  ['internal', 'internal', 'stock', 'output'],
  ['supplier-return', 'outgoing', 'stock', 'supplier'],
  ['customer-return', 'incoming', 'customer', 'stock'],
])
  test(`D33 ${id} still refuses done above demand and rolls back all stock writes`, async (t) => {
    const r = await seed(t)
    await r.save('stock.createPicking', {
      id,
      name: id,
      pickingTypeId: `wh:${type}`,
      locationId: `wh:${source}`,
      locationDestId: `wh:${destination}`,
    })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      name: id,
      pickingId: id,
      productId: r.productId,
      productUomId: 'each',
      productUomQty: '2',
    })
    await r.save('stock.confirmPicking', { id })
    await r.save('stock.saveMoveLine', {
      id: `${id}-line`,
      moveId: `${id}-move`,
      quantity: '3',
      picked: true,
    })
    const before = await r.app.adapter!.all('SELECT * FROM stock_quant ORDER BY id')
    const result = await r.call('stock.validatePicking', { id, backorder: 'cancel' })
    assert.equal(result.ok, false)
    assert.match(JSON.stringify(result.errors), /doneOverDemand/)
    assert.deepEqual(await r.app.adapter!.all('SELECT * FROM stock_quant ORDER BY id'), before)
    assert.notEqual((await r.call('stock.getPicking', { id })).state, 'done')
  })

test('D33 native picked lines may exceed demand while retaining finite stock and replay safety', async (t) => {
  const r = await seed(t)
  await r.save('stock.saveMoveLine', { id: r.line.id, moveId: r.move.id, quantity: '3', picked: true })
  const picking = await r.call('stock.getPicking', { id: 'order:delivery' })
  assert.equal((picking.moves as Row[])[0]!.allowOverdelivery, true)
  await r.save('stock.validatePicking', { id: 'order:delivery', backorder: 'cancel' })
  await r.save('stock.validatePicking', { id: 'order:delivery', backorder: 'cancel' })
  const quants = await r.app.adapter!.all(
    `SELECT quantity, "reservedQuantity" FROM stock_quant WHERE "locationId" = 'wh:stock'`,
  )
  assert.equal(String(quants[0]!.quantity), '7')
  assert.equal(String(quants[0]!.reservedQuantity), '0')
})

test('D33 catalogue can retain or increase ordered quantity after overdelivery without re-delivering it', async (t) => {
  const r = await seed(t)
  await r.complete(3)
  await r.save('sale.syncDeliveries', { id: 'order' })
  const quantity = async (value: string) =>
    r.call('sale.setCatalogueQuantity', {
      id: 'order',
      productId: r.productId,
      quantity: value,
      expectedRevision: (await r.order()).revision,
    })
  assert.equal((await quantity('2')).ok, true)
  assert.equal((await quantity('1')).ok, false)
  assert.equal((await quantity('2.5')).ok, true)
  assert.equal(((await r.order()).moves as Row[]).filter((m) => m.state !== 'done').length, 0)
  assert.equal((await quantity('4')).ok, true)
  const pending = ((await r.order()).moves as Row[]).filter((m) => m.state !== 'done')
  assert.equal(pending.length, 1)
  assert.equal(pending[0]!.productUomQty, '1')
  assert.equal((await quantity('5')).ok, true)
  const resized = ((await r.order()).moves as Row[]).filter((m) => m.state !== 'done')
  assert.equal(resized.length, 1)
  assert.equal(resized[0]!.productUomQty, '2')
})

test('D33 competing completions consume stock once and cannot overdraw the balance', async (t) => {
  const r = await seed(t)
  const results = await Promise.all([r.complete(3), r.complete(3)])
  assert.ok(results.every((value) => value.ok === true))
  const quants = await r.app.adapter!.all(`SELECT quantity FROM stock_quant WHERE "locationId" = 'wh:stock'`)
  assert.equal(String(quants[0]!.quantity), '7')
})

test('D33 invoice preview counts only the unbilled excess and keeps decimal quantities exact', () => {
  assert.deepEqual(
    invoiceQuantities({ productUomQty: '2', qtyDelivered: '5', qtyInvoiced: '4' }, 'delivery'),
    { qtyToInvoice: '1', qtyOverDelivered: '3', qtyOverToInvoice: '1' },
  )
  assert.deepEqual(
    invoiceQuantities({ productUomQty: '0.2', qtyDelivered: '0.5', qtyInvoiced: '0.3' }, 'delivery'),
    { qtyToInvoice: '0.2', qtyOverDelivered: '0.3', qtyOverToInvoice: '0.2' },
  )
  assert.deepEqual(invoiceQuantities({ productUomQty: '2', qtyDelivered: '3', qtyInvoiced: '2' }, 'order'), {
    qtyToInvoice: '0',
    qtyOverDelivered: '1',
    qtyOverToInvoice: '0',
  })
  assert.deepEqual(
    invoiceQuantities({ displayType: 'section', productUomQty: '2', qtyDelivered: '3' }, 'delivery'),
    { qtyToInvoice: '0', qtyOverDelivered: '0', qtyOverToInvoice: '0' },
  )
})
