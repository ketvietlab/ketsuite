import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'
const blank = () => ({
  added: [],
  updated: [] as { id: string; values: Row }[],
  removed: [] as string[],
  order: null,
})
async function seed(t: TestContext) {
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
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
  const picked = ((picking.moves as Row[])[0]!.lines as Row[])[0]!
  const complete = () =>
    r.save('stock.completePicking', {
      id: 'order:delivery',
      quantities: [{ moveLineId: picked.id, quantity: 3 }],
      createBackorder: false,
    })
  const grid = async (values: Row, revision?: unknown) =>
    r.call('sale.applyLineGrid', {
      id: 'order',
      expectedRevision: revision ?? (await order()).revision,
      changes: { ...blank(), updated: [{ id: 'line', values }] },
    })
  return { ...r, order, grid, complete }
}
test('D33b confirmed grid retains ordered quantity after overdelivery while changing exact price', async (t) => {
  const r = await seed(t)
  await r.complete()
  const before = await r.order()
  assert.equal((await r.grid({ priceUnit: '123.45', productUomQty: 2 })).ok, true)
  const after = await r.order()
  const line = (after.lines as Row[])[0]!
  assert.equal(line.id, 'line')
  assert.equal(line.priceUnit, '123.45')
  assert.equal(line.productUomQty, '2')
  assert.deepEqual(after.moves, before.moves)
  assert.equal(Number(after.amountTotal), 247)
  const savedRevision = after.revision
  assert.equal((await r.grid({ priceUnit: '123.45', productUomQty: 2 })).revision, savedRevision)
})
test('D33b confirmed grid refuses reduction using unsynced stock history and rolls back price', async (t) => {
  const r = await seed(t)
  await r.complete()
  const before = await r.order()
  const reduced = await r.grid({ productUomQty: 1, priceUnit: '900' })
  assert.equal(reduced.ok, false)
  // The grid shows one summary for every line, so the refusal names the line and its least quantity.
  assert.deepEqual(
    [(reduced.errors as Row[])[0]!.messageKey, (reduced.errors as Row[])[0]!.params],
    ['sale.error.belowSettledNamed', { minimum: '3', name: (before.lines as Row[])[0]!.name }],
  )
  assert.deepEqual(await r.order(), before)
  assert.equal((await r.grid({ productUomQty: 2.5 })).ok, true)
  assert.equal(((await r.order()).moves as Row[]).length, 1)
  assert.equal((await r.grid({ productUomQty: 4 })).ok, true)
  let pending = ((await r.order()).moves as Row[]).filter(
    (row) => !['done', 'cancel'].includes(String(row.state)),
  )
  assert.equal(pending.length, 1)
  assert.equal(Number(pending[0]!.productUomQty), 1)
  assert.equal((await r.grid({ productUomQty: 5 })).ok, true)
  pending = ((await r.order()).moves as Row[]).filter(
    (row) => !['done', 'cancel'].includes(String(row.state)),
  )
  assert.equal(pending.length, 1)
  assert.equal(Number(pending[0]!.productUomQty), 2)
})
test('D33b confirmed grid preserves invoice lines and refuses reductions below unsynced invoicing', async (t) => {
  const r = await seed(t)
  for (const [id, accountType] of [
    ['revenue', 'income'],
    ['receivable', 'asset_receivable'],
  ])
    await r.save('account.saveAccount', { id, code: id, name: id, accountType })
  await r.save('account.saveJournal', { id: 'journal', name: 'Sales', code: 'SAL', type: 'sale' })
  await r.save('sale.createInvoice', {
    id: 'invoice',
    orderId: 'order',
    journalId: 'journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  const source = await r.app.adapter!.all(`SELECT * FROM account_move_line WHERE "saleLineId" = 'line'`)
  await r.app.adapter!.exec(`UPDATE sale_order_line SET "qtyInvoiced" = '0' WHERE id = 'line'`)
  const before = await r.order()
  assert.equal((await r.grid({ productUomQty: 1 })).ok, false)
  assert.deepEqual(await r.order(), before)
  assert.equal((await r.grid({ priceUnit: '200', discount: 10 })).ok, true)
  assert.deepEqual(
    await r.app.adapter!.all(`SELECT * FROM account_move_line WHERE "saleLineId" = 'line'`),
    source,
  )
})
test('D33b confirmed grid keeps a delivered line, refuses generated fields and stale patches', async (t) => {
  const r = await seed(t)
  await r.complete()
  const before = await r.order()
  for (const values of [
    { productId: 'other' },
    { productUomId: 'box' },
    { qtyDelivered: '99' },
    { priceSubtotal: '1' },
  ]) {
    assert.equal((await r.grid(values)).ok, false)
    assert.deepEqual(await r.order(), before)
  }
  const removed = await r.call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: before.revision,
    changes: { ...blank(), removed: ['line'] },
  })
  assert.deepEqual(
    [(removed.errors as Row[])[0]!.messageKey, (removed.errors as Row[])[0]!.params],
    ['sale.error.lineSettled', { name: (before.lines as Row[])[0]!.name }],
  )
  assert.deepEqual(await r.order(), before)
  const results = await Promise.all(
    [120, 130].map((price) => r.grid({ priceUnit: String(price) }, before.revision)),
  )
  assert.equal(results.filter((result) => result.ok === true).length, 1)
  assert.equal((await r.grid({ priceUnit: '1' }, before.revision)).ok, false)
})

test('D33b confirmed multi-line save rolls back earlier price changes on a later refusal', async (t) => {
  const r = await setup(t)
  await r.add({ productUomId: 'each' })
  await r.add({ id: 'second-line', productUomId: 'each' })
  await r.save('sale.confirmOrder', { id: 'order' })
  const before = await r.call('sale.getOrder', { id: 'order' })
  const result = await r.call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: before.revision,
    changes: {
      ...blank(),
      updated: [
        { id: 'line', values: { priceUnit: '123' } },
        { id: 'second-line', values: { productUomQty: -1 } },
      ],
    },
  })
  assert.equal(result.ok, false)
  assert.deepEqual(await r.call('sale.getOrder', { id: 'order' }), before)
})
test('D33b confirmed grid retains locked and external ownership boundaries', async (t) => {
  const r = await seed(t)
  await r.app.adapter!.exec(`UPDATE sale_order SET locked = TRUE WHERE id = 'order'`)
  assert.equal((await r.grid({ priceUnit: '999' })).ok, false)
  await r.app.adapter!.exec(
    `UPDATE sale_order SET locked = FALSE, "orderAuthority" = 'external' WHERE id = 'order'`,
  )
  assert.equal((await r.grid({ priceUnit: '999' })).ok, false)
  assert.equal(((await r.order()).lines as Row[])[0]!.priceUnit, '100')
})

test('D33b confirmed structural and free lines preserve identities and never create stock demand', async (t) => {
  const r = await setup(t)
  await r.save('sale.addLine', {
    id: 'section',
    orderId: 'order',
    displayType: 'section',
    name: 'Services',
    productUomQty: '0',
  })
  await r.save('sale.addLine', {
    id: 'free',
    orderId: 'order',
    name: 'Consulting',
    productUomQty: '2',
    priceUnit: '100',
  })
  await r.save('sale.confirmOrder', { id: 'order' })
  const before = await r.call('sale.getOrder', { id: 'order' })
  assert.equal(
    (
      await r.call('sale.applyLineGrid', {
        id: 'order',
        expectedRevision: before.revision,
        changes: {
          ...blank(),
          updated: [
            { id: 'section', values: { name: 'Consulting services' } },
            { id: 'free', values: { name: 'Training', productUomQty: 3, priceUnit: '200' } },
          ],
        },
      })
    ).ok,
    true,
  )
  const after = await r.call('sale.getOrder', { id: 'order' })
  assert.equal((after.moves as Row[]).length, 0)
  assert.equal((after.lines as Row[]).find((line) => line.id === 'free')!.name, 'Training')
  assert.equal(Number(after.amountTotal), 600)
})

// Mock `applyGridLines` (owner 25/10): a confirmed order adds, removes, reorders and re-products lines
// in its grid; only what was delivered or invoiced keeps its product and its place.
async function second(r: Awaited<ReturnType<typeof setup>>) {
  await r.save('product.saveRecord', {
    id: 'other-goods',
    name: 'Other goods',
    type: 'goods',
    defaultCode: 'OTHER',
    uomId: 'each',
    listPrice: '50',
    saleOk: true,
  })
  const variants = (await r.call('product.listVariants', { templateId: 'other-goods' })) as unknown as Row[]
  return String(variants[0]!.id)
}
const movesOf = (r: Awaited<ReturnType<typeof setup>>, where: string) =>
  r.app.adapter!.all(
    `SELECT id, "saleLineId", "pickingId", "productId", "productUomQty", state FROM stock_move WHERE ${where} ORDER BY id`,
  ) as Promise<Row[]>
const changed = (r: Awaited<ReturnType<typeof setup>>, revision: unknown, changes: Row) =>
  r.call('sale.applyLineGrid', {
    id: 'order',
    expectedRevision: revision,
    changes: { ...blank(), ...changes },
  })

test('D33b confirmed grid adds lines that join the open delivery and sections without demand', async (t) => {
  const r = await seed(t)
  const other = await second(r)
  const before = await r.order()
  const saved = await changed(r, before.revision, {
    added: [
      { id: 'new-1', index: 1, values: { productId: other, productUomQty: 3, priceAutomatic: true } },
      { id: 'new-2', index: 0, values: { displayType: 'section', name: 'Extra' } },
    ],
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const after = await r.order()
  const lines = after.lines as Row[]
  assert.deepEqual(
    lines.map((line) => [line.displayType ?? null, line.productId ?? null]),
    [
      ['section', null],
      [null, r.productId],
      [null, other],
    ],
  )
  const added = lines[2]!
  assert.deepEqual([added.name, added.priceUnit, added.productUomQty], ['Other goods', '50', '3'])
  const [move] = await movesOf(r, `"saleLineId" = '${String(added.id)}'`)
  assert.deepEqual(
    [move!.pickingId, move!.productId, Number(move!.productUomQty)],
    ['order:delivery', other, 3],
  )
  assert.equal(Number(after.amountTotal), Number(before.amountTotal) + 150)
})

test('D33b confirmed grid gives an added line its own delivery once the order has none open', async (t) => {
  const r = await seed(t)
  const other = await second(r)
  await r.complete()
  const before = await r.order()
  assert.equal(
    (
      await changed(r, before.revision, {
        added: [{ id: 'new-1', index: 1, values: { productId: other, productUomQty: 1 } }],
      })
    ).ok,
    true,
  )
  const line = ((await r.order()).lines as Row[]).find((row) => row.productId === other)!
  const [move] = await movesOf(r, `"saleLineId" = '${String(line.id)}'`)
  assert.notEqual(move!.pickingId, 'order:delivery')
  const [picking] = (await r.app.adapter!.all(
    `SELECT state, "pickingTypeId" FROM stock_picking WHERE id = '${String(move!.pickingId)}'`,
  )) as Row[]
  assert.deepEqual([picking!.state === 'done', picking!.pickingTypeId], [false, 'wh:outgoing'])
})

test('D33b confirmed grid removes an undelivered line and cancels what it waited for', async (t) => {
  const r = await seed(t)
  const other = await second(r)
  let order = await r.order()
  await changed(r, order.revision, {
    added: [{ id: 'new-1', index: 1, values: { productId: other, productUomQty: 2 } }],
  })
  order = await r.order()
  const extra = (order.lines as Row[]).find((line) => line.productId === other)!
  const [waiting] = await movesOf(r, `"saleLineId" = '${String(extra.id)}'`)
  const saved = await changed(r, order.revision, { removed: [String(extra.id)] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const after = await r.order()
  assert.deepEqual(
    (after.lines as Row[]).map((line) => line.id),
    ['line'],
  )
  const [cancelled] = await movesOf(r, `id = '${String(waiting!.id)}'`)
  assert.deepEqual([cancelled!.state, cancelled!.saleLineId], ['cancel', null])
  // The rest of the delivery stays open for the line that remains.
  const [kept] = await movesOf(r, `"saleLineId" = 'line'`)
  assert.equal(kept!.state === 'cancel', false)
  assert.equal(Number(after.amountTotal), 200)
})

test('D33b confirmed grid gives an undelivered line another product under the same ID', async (t) => {
  const r = await seed(t)
  const other = await second(r)
  const before = await r.order()
  const [old] = await movesOf(r, `"saleLineId" = 'line'`)
  const saved = await r.grid({ productId: other, productUomId: null, priceUnit: null, priceAutomatic: true })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const line = ((await r.order()).lines as Row[])[0]!
  assert.deepEqual(
    [line.id, line.productId, line.name, line.priceUnit, line.productUomQty],
    ['line', other, 'Other goods', '50', '2'],
  )
  const [cancelled] = await movesOf(r, `id = '${String(old!.id)}'`)
  assert.deepEqual([cancelled!.state, cancelled!.saleLineId], ['cancel', null])
  const [replacement] = await movesOf(r, `"saleLineId" = 'line'`)
  assert.deepEqual([replacement!.productId, Number(replacement!.productUomQty)], [other, 2])
  assert.notEqual(before.revision, (await r.order()).revision)
})

test('D33b confirmed grid names a picked line it cannot remove and rolls back the whole save', async (t) => {
  const r = await seed(t)
  const other = await second(r)
  await r.app.adapter!.exec(`UPDATE stock_move_line SET picked = TRUE`)
  const before = await r.order()
  const refused = await changed(r, before.revision, {
    added: [{ id: 'new-1', index: 1, values: { productId: other, productUomQty: 1 } }],
    removed: ['line'],
  })
  assert.deepEqual(
    [(refused.errors as Row[])[0]!.messageKey, (refused.errors as Row[])[0]!.params],
    ['sale.error.linePicked', { name: (before.lines as Row[])[0]!.name }],
  )
  assert.deepEqual(await r.order(), before)
  assert.equal((await movesOf(r, `"productId" = '${other}'`)).length, 0)
})

test('D33b confirmed grid reorders lines and removes a free line', async (t) => {
  const r = await seed(t)
  const before = await r.order()
  assert.equal(
    (
      await changed(r, before.revision, {
        added: [{ id: 'new-1', index: 1, values: { name: 'Gift wrap', productUomQty: 1, priceUnit: '10' } }],
        order: ['new-1', 'line'],
      })
    ).ok,
    true,
  )
  let order = await r.order()
  const free = (order.lines as Row[])[0]!
  assert.deepEqual([free.name, (order.lines as Row[])[1]!.id], ['Gift wrap', 'line'])
  assert.equal((await movesOf(r, `"saleLineId" = '${String(free.id)}'`)).length, 0)
  assert.equal((await changed(r, order.revision, { removed: [String(free.id)] })).ok, true)
  order = await r.order()
  assert.deepEqual(
    (order.lines as Row[]).map((line) => line.id),
    ['line'],
  )
})

test('D33b confirmed grid keeps one delivery when a save replaces every waiting line', async (t) => {
  const r = await seed(t)
  const other = await second(r)
  const before = await r.order()
  const saved = await changed(r, before.revision, {
    removed: ['line'],
    added: [{ id: 'new-1', index: 0, values: { productId: other, productUomQty: 1 } }],
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const line = ((await r.order()).lines as Row[])[0]!
  const [move] = await movesOf(r, `"saleLineId" = '${String(line.id)}'`)
  assert.equal(move!.pickingId, 'order:delivery')
  const [picking] = (await r.app.adapter!.all(
    `SELECT state FROM stock_picking WHERE id = 'order:delivery'`,
  )) as Row[]
  assert.notEqual(picking!.state, 'cancel')
})
