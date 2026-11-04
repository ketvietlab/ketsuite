import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { seed } from './fixtures/stock/landed-costs.ts'

test('K64 a landed cost raises the goods still held, sends the share already sold to cost of sales, owes the vendor', async (t) => {
  const r = await seed(t)
  await r.receive('r1', '60', '70000')
  await r.deliver('out', '20')
  assert.deepEqual(await r.held(), [40, 2_800_000])
  assert.deepEqual(await r.draft(), { ok: true, id: 'lc' })
  const saved = (await r.call('stock.getLandedCost', { id: 'lc' })) as Row
  assert.deepEqual(
    [saved.name, saved.state, saved.date, saved.vendorId, saved.pickingIds, saved.total],
    ['CPMT/2030/0001', 'draft', '2030-01-30', 'carrier', ['r1'], '360000'],
  )
  // A draft moves nothing.
  assert.deepEqual(await r.held(), [40, 2_800_000])

  assert.deepEqual(await r.call('stock.postLandedCost', { id: 'lc' }), { ok: true, id: 'lc' })
  // 40 of the 60 received are still held: two thirds into stock, a third into the cost of what was sold.
  assert.deepEqual(await r.held(), [40, 3_040_000])
  assert.equal(await r.cost(), 76_000)
  assert.deepEqual(await r.entry('stock-landed-cost:lc'), [
    ['156', 240_000, 0, 'carrier'],
    ['331', 0, 240_000, 'carrier'],
    ['632', 120_000, 0, 'carrier'],
    ['331', 0, 120_000, 'carrier'],
  ])
  const posted = (await r.call('stock.getLandedCost', { id: 'lc' })) as Row
  assert.deepEqual([posted.state, posted.accountMoveId], ['posted', 'stock-landed-cost:lc'])
  assert.deepEqual(
    (posted.allocations as Row[]).map((row) => [
      row.pickingId,
      row.moveId,
      Number(row.amount),
      Number(row.stockAmount),
      Number(row.cogsAmount),
    ]),
    [['r1', 'r1-move', 360_000, 240_000, 120_000]],
  )
  // Posting again changes nothing; a posted cost is neither edited nor dropped.
  assert.deepEqual(await r.call('stock.postLandedCost', { id: 'lc' }), { ok: true, id: 'lc' })
  assert.deepEqual(await r.held(), [40, 3_040_000])
  assert.deepEqual(r.refusal(await r.draft({ lines: [] })), ['id', 'stock.error.landedCostNotDraft'])
  assert.deepEqual(r.refusal(await r.call('stock.cancelLandedCost', { id: 'lc', reason: 'x' })), [
    'id',
    'stock.error.landedCostNotDraft',
  ])
  // The receipt keeps what it was received at.
  assert.equal(((await r.call('stock.getPickingValuation', { id: 'r1' })) as Row).total, '4200000')
  // The next cost of the year takes the next number.
  await r.draft({ id: 'lc2' })
  assert.equal(((await r.call('stock.getLandedCost', { id: 'lc2' })) as Row).name, 'CPMT/2030/0002')
})

test('K64 costs spread by quantity, value or evenly over several receipts, the last line taking the rounding', async (t) => {
  const r = await seed(t)
  await r.receive('r1', '60', '70000')
  await r.receive('r2', '40', '50000')
  await r.draft({
    pickingIds: ['r1', 'r2'],
    lines: [
      { name: 'Freight', splitMethod: 'quantity', amount: '1000000' },
      { name: 'Duty', splitMethod: 'value', amount: '620000' },
      { name: 'Handling', splitMethod: 'equal', amount: '300001' },
    ],
  })
  assert.equal(((await r.call('stock.getLandedCost', { id: 'lc' })) as Row).total, '1920001')
  await r.call('stock.postLandedCost', { id: 'lc' })
  const allocations = ((await r.call('stock.getLandedCost', { id: 'lc' })) as Row).allocations as Row[]
  const of = (line: string) =>
    allocations
      .filter((row) => String(row.lineId).endsWith(line))
      .map((row) => [row.moveId, Number(row.amount), Number(row.cogsAmount)])
  assert.deepEqual(of(':1'), [
    ['r1-move', 600_000, 0],
    ['r2-move', 400_000, 0],
  ])
  // 4 200 000 against 2 000 000.
  assert.deepEqual(of(':2'), [
    ['r1-move', 420_000, 0],
    ['r2-move', 200_000, 0],
  ])
  assert.deepEqual(of(':3'), [
    ['r1-move', 150_001, 0],
    ['r2-move', 150_000, 0],
  ])
  // Nothing has left: all of it is stock.
  assert.deepEqual(await r.held(), [100, 6_200_000 + 1_920_001])
})

test("K64 goods moved between the company's own warehouses are still held; a delivery uses the oldest first", async (t) => {
  const r = await seed(t)
  await r.receive('r1', '10', '1000')
  t.mock.timers.setTime(Date.parse('2030-01-31T06:00:00.000Z'))
  await r.receive('r2', '10', '1000')
  // All of r1 moves to Hà Nội: still the company's.
  await r.transfer('to-hn', 'internal', '10', { locationId: 'wh:stock', locationDestId: 'hn:stock' })
  await r.save('stock.reserveMove', { id: 'to-hn-move' })
  await r.complete('to-hn')
  t.mock.timers.setTime(Date.parse('2030-01-31T07:00:00.000Z'))
  // Ten leave: the oldest, r1's, first.
  await r.deliver('out', '10')
  await r.draft({
    pickingIds: ['r1', 'r2'],
    lines: [{ name: 'Freight', splitMethod: 'equal', amount: '2000' }],
  })
  await r.call('stock.postLandedCost', { id: 'lc' })
  assert.deepEqual(
    (((await r.call('stock.getLandedCost', { id: 'lc' })) as Row).allocations as Row[]).map((row) => [
      row.moveId,
      Number(row.stockAmount),
      Number(row.cogsAmount),
    ]),
    [
      ['r1-move', 0, 1000],
      ['r2-move', 1000, 0],
    ],
  )
})

test('K64 a draft names completed valued receipts, a vendor, a past day and up to 20 costs; a dropped draft says why', async (t) => {
  const r = await seed(t)
  await r.receive('r1', '60', '70000')
  await r.deliver('out', '20')
  // Goods a customer brought back are not a purchase.
  await r.save('stock.createReturn', { id: 'out', returnId: 'back' })
  await r.save('stock.saveMoveLine', {
    id: 'back-line',
    moveId: (((await r.call('stock.getPicking', { id: 'back' })) as Row).moves as Row[])[0]!.id,
    quantity: '1',
    picked: true,
  })
  await r.complete('back')
  await r.transfer('open', 'incoming', '5')
  assert.deepEqual(
    ((await r.call('stock.listLandableReceipts', {})) as unknown as Row[]).map((row) => [
      row.id,
      (row.moves as Row[]).map((move) => [move.units, move.value]),
    ]),
    [['r1', [['60', '4200000']]]],
  )
  for (const [args, refused] of [
    [{ date: '2030-02-01' }, ['date', 'stock.error.landedCostDate']],
    [{ date: '30/01/2030' }, ['date', 'stock.error.landedCostDate']],
    [{ vendorId: 'nobody' }, ['vendorId', 'stock.error.landedCostVendor']],
    [{ pickingIds: ['out'] }, ['pickingIds', 'stock.error.landedCostReceipt']],
    [{ pickingIds: ['back'] }, ['pickingIds', 'stock.error.landedCostReceipt']],
    [{ pickingIds: ['open'] }, ['pickingIds', 'stock.error.landedCostReceipt']],
    [
      { lines: Array.from({ length: 21 }, () => ({ name: 'x', amount: '1' })) },
      ['lines', 'stock.error.landedCostTooManyLines'],
    ],
    [{ lines: [{ name: ' ', amount: '1' }] }, ['lines.0.name', 'stock.error.landedCostLineName']],
    [
      { lines: [{ name: 'x', splitMethod: 'weight', amount: '1' }] },
      ['lines.0.splitMethod', 'stock.error.landedCostSplit'],
    ],
    [{ lines: [{ name: 'x', amount: '0' }] }, ['lines.0.amount', 'stock.error.landedCostAmount']],
    [{ lines: [{ name: 'x', amount: '1.5' }] }, ['lines.0.amount', 'stock.error.landedCostAmount']],
  ] as const)
    assert.deepEqual(r.refusal(await r.draft(args)), refused, JSON.stringify(args))
  assert.equal(((await r.call('stock.listLandedCosts', {})) as unknown as Row[]).length, 0)
  // A draft may wait for its vendor, receipts and costs; posting needs them.
  assert.equal((await r.draft({ vendorId: null, pickingIds: [], lines: [] })).ok, true)
  assert.deepEqual(r.refusal(await r.call('stock.postLandedCost', { id: 'lc' })), [
    'vendorId',
    'stock.error.landedCostVendor',
  ])
  await r.draft({ pickingIds: [], lines: [] })
  assert.deepEqual(r.refusal(await r.call('stock.postLandedCost', { id: 'lc' })), [
    'lines',
    'stock.error.landedCostNoLines',
  ])
  await r.draft({ pickingIds: [] })
  assert.deepEqual(r.refusal(await r.call('stock.postLandedCost', { id: 'lc' })), [
    'pickingIds',
    'stock.error.landedCostReceipt',
  ])
  // Saving again replaces the costs.
  await r.draft({ lines: [{ name: 'Insurance', splitMethod: 'value', amount: '1000' }] })
  assert.deepEqual(
    (((await r.call('stock.getLandedCost', { id: 'lc' })) as Row).lines as Row[]).map((line) => [
      line.name,
      line.splitMethod,
      line.amount,
    ]),
    [['Insurance', 'value', '1000']],
  )
  assert.deepEqual(r.refusal(await r.call('stock.cancelLandedCost', { id: 'lc', reason: ' ' })), [
    'reason',
    'stock.error.landedCostCancelReason',
  ])
  assert.deepEqual(await r.call('stock.cancelLandedCost', { id: 'lc', reason: 'Billed twice' }), {
    ok: true,
    id: 'lc',
  })
  const dropped = (await r.call('stock.getLandedCost', { id: 'lc' })) as Row
  assert.deepEqual([dropped.state, dropped.cancelReason], ['cancel', 'Billed twice'])
  assert.deepEqual(r.refusal(await r.call('stock.postLandedCost', { id: 'lc' })), [
    'id',
    'stock.error.landedCostNotDraft',
  ])
  assert.deepEqual(await r.held(), [41, 2_870_000])
})

test('K64 the stock manager and the accountant draft, only the accountant posts, audit reads, the storekeeper sees none', async (t) => {
  const r = await seed(t)
  await r.receive('r1', '60', '70000')
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const status = async (
    client: { request: (path: string, init?: RequestInit) => Promise<Response> },
    fn: string,
    body: Row,
  ) =>
    (
      await client.request(`/_ket/fn/stock.${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).status
  const can: Record<string, boolean[]> = {}
  for (const roleId of [
    'commerce.warehouse-manager',
    'commerce.accountant',
    'commerce.tenant-auditor',
    'commerce.warehouse-operator',
  ]) {
    const client = await r.signIn(roleId)
    const id = `lc-${roleId}`
    can[roleId] = [
      (await status(client, 'listLandedCosts', {})) === 200,
      // The vendor picker reads partners through the cost's own grant, not the contact book's.
      (await status(client, 'listLandedCostVendors', { search: 'carr' })) === 200,
      (await status(client, 'saveLandedCost', {
        id,
        vendorId: 'carrier',
        pickingIds: ['r1'],
        lines: [{ name: 'Freight', amount: '600' }],
      })) === 200,
      // Posting someone else's draft, or their own.
      (await status(client, 'postLandedCost', { id: 'shared' })) !== 403,
    ]
  }
  assert.deepEqual(await r.call('stock.listLandedCostVendors', { search: 'CARR' }), [
    { id: 'carrier', name: 'Carrier' },
  ])
  await r.draft({ id: 'shared' })
  assert.deepEqual(can, {
    'commerce.warehouse-manager': [true, true, true, false],
    'commerce.accountant': [true, true, true, true],
    'commerce.tenant-auditor': [true, false, false, false],
    'commerce.warehouse-operator': [false, false, false, false],
  })
})
