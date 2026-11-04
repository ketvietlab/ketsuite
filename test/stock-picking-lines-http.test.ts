import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

/**
 * The transfer grid's save: goods at noon in Hà Nội on 31 January 2030, lot-tracked or not. A
 * storekeeper, a stock manager and a role that holds only the grid's own function work in it.
 */
async function seed(t: TestContext, tracking: 'lot' | 'none') {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', {
    templateId: 'goods',
    isStorable: true,
    tracking,
    shelfLifeMonths: 12,
  })
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await r.fixture('user.saveRole', { id: 'grid-only', name: 'Grid only' })
  for (const fnKey of ['stock.savePickingLines', 'stock.getPicking'])
    await r.fixture('user.grantFunction', { id: `grid-only:${fnKey}`, roleId: 'grid-only', fnKey })
  const users: Record<string, ReturnType<typeof r.app.client.anonymous>> = {}
  for (const [id, roleId] of [
    ['keeper', 'commerce.warehouse-operator'],
    ['manager', 'commerce.warehouse-manager'],
    ['gridOnly', 'grid-only'],
  ] as const) {
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'test-password',
      name: id,
      defaultCompanyId: 'acme',
    })
    await r.fixture('user.grantCompany', { id: `${id}-company`, userId: id, companyId: 'acme' })
    await r.fixture('user.assignRole', { id: `${id}-role`, userId: id, roleId })
    users[id] = r.app.client.anonymous()
    await users[id]!.login({ login: id, password: 'test-password' })
  }
  /** Calls a function as one of the users: the answer, or the HTTP status when the call is refused. */
  const as = async (user: string, fn: string, body: Row) => {
    const response = await users[user]!.request(`/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.status !== 200) return { status: response.status } as Row
    const answer = (await response.json()) as Row
    return (answer.value ?? answer) as Row
  }
  const transfer = async (id: string, pickingTypeId: string) => {
    await r.save('stock.createPicking', { id, name: id, pickingTypeId })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: '5',
    })
    await r.save('stock.confirmPicking', { id })
  }
  const grid = (user: string, id: string, lines: unknown) => as(user, 'stock.savePickingLines', { id, lines })
  const lines = async (id: string) =>
    new Map(
      (
        await r.app.adapter!.all(
          `SELECT id, quantity, "receiptLotName", picked, "unitCost" FROM stock_move_line WHERE "pickingId" = '${id}'`,
        )
      ).map((line) => [
        String(line.id),
        [Number(line.quantity), line.receiptLotName ?? null, Boolean(line.picked), line.unitCost ?? null],
      ]),
    )
  const key = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.messageKey
  return { ...r, as, transfer, grid, lines, key }
}

test('K30/K24 the receipt grid saves new and changed lines with their lots and prices at once, or nothing', async (t) => {
  const r = await seed(t, 'lot')
  await r.transfer('in', 'wh:incoming')
  const move = 'in-move'
  assert.deepEqual(
    await r.grid('keeper', 'in', [
      { id: 'a', moveId: move, quantity: '3', name: 'BATCH-1', expirationDate: '2031-01-01', picked: true },
      { id: 'b', moveId: move, quantity: '2', name: '', expirationDate: '', picked: true },
    ]),
    { ok: true, id: 'in' },
  )
  assert.deepEqual([...(await r.lines('in'))].sort(), [
    ['a', [3, 'BATCH-1', true, null]],
    ['b', [2, '', true, null]],
  ])
  // Lots are written only when the receipt completes.
  assert.deepEqual(await r.call('stock.listLots', { productId: r.productId }), [])

  // One refused line keeps every other line of the save as it was.
  const read = async () => {
    const picking = await r.call('stock.getPicking', { id: 'in' })
    return new Map(((picking.moves as Row[])[0]!.lines as Row[]).map((line) => [String(line.id), line]))
  }
  const revision = String((await read()).get('a')!.receiptRevision)
  const changeA = {
    id: 'a',
    moveId: move,
    quantity: '1',
    name: 'BATCH-1',
    expirationDate: '2031-01-01',
    picked: true,
  }
  assert.equal(
    r.key(
      await r.grid('keeper', 'in', [
        { ...changeA, expectedRevision: revision },
        { id: 'c', moveId: move, quantity: '1', name: '!bad', expirationDate: '', picked: true },
      ]),
    ),
    'stock.error.receiptName',
  )
  assert.deepEqual(
    [(await r.lines('in')).get('a'), (await r.lines('in')).has('c')],
    [[3, 'BATCH-1', true, null], false],
  )
  // A line changed since it was read is not overwritten.
  assert.equal(
    r.key(await r.grid('keeper', 'in', [{ ...changeA, expectedRevision: 'stale' }])),
    'stock.error.receiptConflict',
  )
  assert.deepEqual(await r.grid('keeper', 'in', [{ ...changeA, expectedRevision: revision }]), {
    ok: true,
    id: 'in',
  })
  assert.deepEqual((await r.lines('in')).get('a'), [1, 'BATCH-1', true, null])

  // Pricing takes setReceiptUnitCost: a storekeeper is refused as a whole, a manager prices.
  assert.deepEqual(await r.grid('keeper', 'in', [{ id: 'b', moveId: move, unitCost: '1500' }]), {
    status: 403,
  })
  assert.deepEqual(await r.grid('manager', 'in', [{ id: 'b', moveId: move, unitCost: '1500.50' }]), {
    ok: true,
    id: 'in',
  })
  assert.deepEqual((await r.lines('in')).get('b'), [2, '', true, '1500.5'])
  assert.equal(
    r.key(await r.grid('manager', 'in', [{ id: 'b', moveId: move, unitCost: '-1' }])),
    'stock.error.receiptUnitCostInvalid',
  )
  // A role holding only the grid's function writes nothing it could not write itself.
  assert.deepEqual(
    await r.grid('gridOnly', 'in', [
      { id: 'b', moveId: move, quantity: '1', name: '', expirationDate: '', picked: true },
    ]),
    { status: 403 },
  )
  assert.deepEqual((await r.lines('in')).get('b'), [2, '', true, '1500.5'])

  // Every line must belong to this transfer.
  await r.transfer('other', 'wh:incoming')
  await r.grid('keeper', 'other', [
    { id: 'o', moveId: 'other-move', quantity: '1', name: '', expirationDate: '', picked: true },
  ])
  for (const line of [
    { id: 'o', moveId: move, quantity: '1', name: '', expirationDate: '', picked: true },
    { id: 'x', moveId: 'other-move', quantity: '1', name: '', expirationDate: '', picked: true },
    { id: '', moveId: move, quantity: '1' },
    'a',
  ])
    assert.equal(
      r.key(await r.grid('keeper', 'in', [line])),
      'stock.error.pickingLineMissing',
      JSON.stringify(line),
    )
  assert.equal(r.key(await r.grid('keeper', 'in', { id: 'a' })), 'stock.error.pickingLinesInvalid')
  // A grid draft the modal could not read arrives as null and is refused by name.
  assert.equal(r.key(await r.grid('keeper', 'in', null)), 'stock.error.pickingLinesInvalid')
  assert.deepEqual(
    [(await r.lines('other')).get('o'), (await r.lines('in')).has('x')],
    [[1, '', true, null], false],
  )

  // A completed receipt takes no more lines.
  assert.equal((await r.call('stock.completePicking', { id: 'in', createBackorder: false })).ok, true)
  assert.equal(
    r.key(await r.grid('keeper', 'in', [{ ...changeA, quantity: '2', expectedRevision: revision }])),
    'stock.error.pickingClosed',
  )
})

test('K30 the delivery grid picks lines as recording them one by one did, holding stock for them', async (t) => {
  const r = await seed(t, 'none')
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'opening',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'count',
    countedQuantity: '5',
    productUomId: 'each',
  })
  await r.transfer('out', 'wh:outgoing')
  const reserved = async () =>
    Number(
      (
        await r.app.adapter!.all(`SELECT "reservedQuantity" FROM stock_quant WHERE "locationId" = 'wh:stock'`)
      )[0]!.reservedQuantity,
    )
  const line = (quantity: string, picked = true) => ({
    id: 'p',
    moveId: 'out-move',
    quantity,
    lotId: null,
    picked,
  })
  assert.deepEqual(await r.grid('keeper', 'out', [line('2')]), { ok: true, id: 'out' })
  assert.deepEqual([(await r.lines('out')).get('p'), await reserved()], [[2, null, true, null], 2])
  assert.deepEqual(await r.grid('keeper', 'out', [line('3', false)]), { ok: true, id: 'out' })
  assert.deepEqual([(await r.lines('out')).get('p'), await reserved()], [[3, null, false, null], 3])
  // A refused line leaves the stock held as it was.
  assert.equal((await r.grid('keeper', 'out', [line('4'), { ...line('0'), id: 'q' }])).ok, false)
  assert.deepEqual(
    [(await r.lines('out')).get('p'), (await r.lines('out')).has('q'), await reserved()],
    [[3, null, false, null], false, 3],
  )
  assert.deepEqual(await r.grid('gridOnly', 'out', [line('1')]), { status: 403 })
  assert.equal(await reserved(), 3)
})

test('#1814 a receipt whose lines were all unticked completes what they hold, never zero', async (t) => {
  const r = await seed(t, 'none')
  await r.transfer('in', 'wh:incoming')
  assert.deepEqual(
    await r.grid('keeper', 'in', [{ id: 'a', moveId: 'in-move', quantity: '5', picked: true }]),
    { ok: true, id: 'in' },
  )
  // The storekeeper unticks Picked: no line is ticked, so the receipt is done as typed.
  assert.deepEqual(
    await r.grid('keeper', 'in', [{ id: 'a', moveId: 'in-move', quantity: '5', picked: false }]),
    { ok: true, id: 'in' },
  )
  const quantityPicked = async () => {
    const [quantity, , picked] = (await r.lines('in')).get('a')!
    return [quantity, picked]
  }
  assert.deepEqual(await quantityPicked(), [5, false])
  assert.equal((await r.as('keeper', 'stock.validatePicking', { id: 'in', backorder: 'cancel' })).ok, true)
  assert.equal((await r.call('stock.getPicking', { id: 'in' })).state, 'done')
  assert.deepEqual(await quantityPicked(), [5, true])
  const [quant] = await r.app.adapter!.all(
    `SELECT quantity FROM stock_quant WHERE "productId" = '${r.productId}' AND "locationId" = 'wh:stock'`,
  )
  assert.equal(Number(quant?.quantity), 5)
})
