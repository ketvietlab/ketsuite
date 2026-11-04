import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

const blank = () => ({
  added: [] as Row[],
  updated: [] as Row[],
  removed: [] as string[],
  order: null as unknown,
})

/** A confirmed order reopened as a draft quotation: its line keeps the delivery it already started. */
async function seed(t: TestContext) {
  const r = await setup(t)
  await r.add()
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.app.adapter!.run("UPDATE sale_order SET state = 'draft' WHERE id = 'order'")
  const order = () => r.call('sale.getOrder', { id: 'order' })
  const grid = async (changes: Row) =>
    r.call('sale.applyLineGrid', {
      id: 'order',
      expectedRevision: (await order()).revision,
      changes: { ...blank(), ...changes },
    })
  const code = (result: Row) => {
    const error = (result.errors as Row[] | undefined)?.[0]
    return error?.code ?? error?.messageKey
  }
  const moves = async () =>
    (await r.app.adapter!.all(`SELECT id FROM stock_move WHERE "saleLineId" = 'line'`)).map((row) => row.id)
  const added = (values: Row = {}) => ({
    id: 'new-1',
    index: 1,
    values: {
      displayType: null,
      productId: r.productId,
      name: '',
      productUomId: 'each',
      productUomQty: 3,
      priceUnit: null,
      priceAutomatic: true,
      discount: 0,
      taxId: '',
      ...values,
    },
  })
  return { ...r, order, grid, code, moves, added }
}

test('a quotation with history changes its saved lines in place and adds product lines after them', async (t) => {
  const r = await seed(t)
  const history = await r.moves()
  assert.equal(history.length, 1)
  const before = await r.order()
  const result = await r.grid({
    updated: [{ id: 'line', values: { productUomQty: 4, priceUnit: '150' } }],
    added: [r.added(), r.added({ productUomQty: 1, priceUnit: '90' })].map((entry, index) => ({
      ...entry,
      id: `new-${index}`,
    })),
  })
  assert.equal(result.ok, true)
  const after = await r.order()
  assert.ok(Number(after.revision) > Number(before.revision))
  assert.equal(result.revision, after.revision)
  const lines = (after.lines as Row[]).toSorted((a, b) => Number(a.sequence) - Number(b.sequence))
  // The saved line keeps its ID, and with it the delivery that references it.
  assert.equal(lines[0]!.id, 'line')
  assert.deepEqual([lines[0]!.productUomQty, lines[0]!.priceUnit], ['4', '150'])
  assert.deepEqual(await r.moves(), history)
  // New lines follow it, in the grid's order, with server IDs.
  assert.deepEqual(
    lines.slice(1).map((line) => [line.productUomQty, line.productUomId, line.priceUnit]),
    [
      ['3', 'each', '100'],
      ['1', 'each', '90'],
    ],
  )
  assert.ok(lines.slice(1).every((line) => !String(line.id).startsWith('new-')))
  assert.ok(Number(lines[1]!.sequence) > Number(lines[0]!.sequence))
  assert.ok(Number(lines[2]!.sequence) > Number(lines[1]!.sequence))
  // Adding alone still moves the quotation to a new revision, so a stale grid cannot save over it.
  const added = await r.grid({ added: [r.added()] })
  assert.equal(added.ok, true)
  const latest = await r.order()
  assert.ok(Number(latest.revision) > Number(after.revision))
  assert.equal(added.revision, latest.revision)
  assert.equal((latest.lines as Row[]).length, 4)
})

test('a quotation with history keeps its saved lines, their order and their product, all or nothing', async (t) => {
  const r = await seed(t)
  const before = await r.order()
  for (const [changes, code] of [
    [{ removed: ['line'] }, 'sale.error.historyGridStructure'],
    [{ order: ['new-1', 'line'], added: [r.added()] }, 'sale.error.historyGridStructure'],
    [
      { added: [r.added({ displayType: 'section', name: 'Phần', productId: null, productUomId: null })] },
      'sale.error.historyGridStructure',
    ],
    [{ updated: [{ id: 'line', values: { productUomId: 'case' } }] }, 'sale.error.confirmedGridIdentity'],
    [
      { updated: [{ id: 'line', values: { productUomId: 'case' } }], added: [r.added()] },
      'sale.error.confirmedGridIdentity',
    ],
  ] as const) {
    const result = await r.grid(changes)
    assert.equal(result.ok, false, JSON.stringify(changes))
    assert.equal(r.code(result), code, JSON.stringify(changes))
  }
  // A refused new line rolls back the change made to the saved one.
  const refused = await r.grid({
    updated: [{ id: 'line', values: { priceUnit: '150' } }],
    added: [r.added({ productUomQty: -1 })],
  })
  assert.equal(refused.ok, false)
  assert.deepEqual(await r.order(), before)
})

test('two grids saved from the same revision of a quotation with history add lines once', async (t) => {
  const r = await seed(t)
  const before = await r.order()
  const results = await Promise.all(
    [3, 4].map((qty) =>
      r.call('sale.applyLineGrid', {
        id: 'order',
        expectedRevision: before.revision,
        changes: { ...blank(), added: [r.added({ productUomQty: qty })] },
      }),
    ),
  )
  assert.equal(results.filter((result) => result.ok === true).length, 1)
  assert.equal(((await r.order()).lines as Row[]).length, 2)
})

test('a quotation with history changed while its grid saves refuses the grid', {
  skip: !process.env.KET_COMMERCE_PG && 'needs PostgreSQL row locks',
}, async (t) => {
  const r = await seed(t)
  const adapter = r.app.adapter!
  let pending: Promise<Row> | undefined
  await adapter.tx(async (db) => {
    // Another writer holds the order and moves it on. The grid reads the committed revision, then
    // must wait on its claim and be refused, not add its line behind that writer.
    await db.run("UPDATE sale_order SET revision = revision + 1 WHERE id = 'order'")
    pending = r.grid({ added: [r.added()] })
    for (let tries = 0; tries < 200; tries++) {
      const [row] = await adapter.all('SELECT count(*) AS waiting FROM pg_locks WHERE NOT granted')
      if (Number(row!.waiting) > 0) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  })
  const result = await pending!
  assert.equal(result.ok, false)
  assert.equal(r.code(result), 'sale.error.orderChanged')
  assert.equal(((await r.order()).lines as Row[]).length, 1)
})
