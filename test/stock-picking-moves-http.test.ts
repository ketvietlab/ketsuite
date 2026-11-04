import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

test('the products grid adds every new product line at once, or none, and only as addMove would', async (t) => {
  const r = await setup(t)
  await r.save('uom.saveUnit', { id: 'litre', name: 'Litre', relativeFactor: '1' })
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await r.fixture('user.saveRole', { id: 'grid-only', name: 'Grid only' })
  for (const fnKey of ['stock.addMoves', 'stock.getPicking'])
    await r.fixture('user.grantFunction', { id: `grid-only:${fnKey}`, roleId: 'grid-only', fnKey })
  const users: Record<string, ReturnType<typeof r.app.client.anonymous>> = {}
  for (const [id, roleId] of [
    ['keeper', 'commerce.warehouse-operator'],
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
  /** Saves the grid as one of the users: the answer, or the HTTP status when the call is refused. */
  const grid = async (user: string, pickingId: string, moves: unknown) => {
    const response = await users[user]!.request('/_ket/fn/stock.addMoves', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pickingId, moves }),
    })
    if (response.status !== 200) return { status: response.status } as Row
    const answer = (await response.json()) as Row
    return (answer.value ?? answer) as Row
  }
  const key = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.messageKey
  const field = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.field
  const movesOf = async (pickingId: string) =>
    (
      await r.app.adapter!.all(
        `SELECT id, "productUomId", "productUomQty", state, "locationId" FROM stock_move WHERE "pickingId" = '${pickingId}' ORDER BY id`,
      )
    ).map((move) => [move.id, move.productUomId, Number(move.productUomQty), move.state, move.locationId])
  await r.save('stock.createPicking', { id: 'in', name: 'in', pickingTypeId: 'wh:incoming' })
  const line = (id: string, productUomId: string, productUomQty: string) => ({
    id,
    name: 'Goods',
    productId: r.productId,
    productUomId,
    productUomQty,
  })

  // Two new lines join the draft transfer at its locations; a box is held as twelve.
  assert.deepEqual(await grid('keeper', 'in', [line('a', 'box', '2'), line('b', 'each', '3')]), {
    ok: true,
    id: 'in',
  })
  const added = await movesOf('in')
  assert.deepEqual(
    added.map((move) => move.slice(0, 4)),
    [
      ['a', 'each', 24, 'draft'],
      ['b', 'each', 3, 'draft'],
    ],
  )
  assert.ok(added.every((move) => move[4] === added[0]![4] && move[4]))
  // A retried save writes nothing twice.
  assert.deepEqual(await grid('keeper', 'in', [line('a', 'box', '2'), line('b', 'each', '3')]), {
    ok: true,
    id: 'in',
  })
  assert.equal((await movesOf('in')).length, 2)

  // One refused line keeps every other line of the save out.
  const litres = await grid('keeper', 'in', [line('c', 'each', '1'), line('d', 'litre', '1')])
  assert.deepEqual([litres.ok, field(litres)], [false, 'productUomId'])
  const zero = await grid('keeper', 'in', [line('c', 'each', '1'), line('d', 'each', '0')])
  assert.deepEqual([zero.ok, field(zero)], [false, 'productUomQty'])
  assert.deepEqual(
    (await movesOf('in')).map((move) => move[0]),
    ['a', 'b'],
  )

  // Every move id must be new or this transfer's own, and the moves a list.
  await r.save('stock.createPicking', { id: 'other', name: 'other', pickingTypeId: 'wh:incoming' })
  assert.deepEqual(await grid('keeper', 'other', [line('o', 'each', '1')]), { ok: true, id: 'other' })
  for (const entry of [line('o', 'each', '1'), line('', 'each', '1'), 'a', null])
    assert.equal(
      key(await grid('keeper', 'in', [entry])),
      'stock.error.pickingLineMissing',
      JSON.stringify(entry),
    )
  for (const moves of [{ id: 'a' }, null])
    assert.equal(
      key(await grid('keeper', 'in', moves)),
      'stock.error.pickingLinesInvalid',
      JSON.stringify(moves),
    )
  assert.deepEqual(
    [(await movesOf('in')).map((move) => move[0]), (await movesOf('other')).map((move) => move[0])],
    [['a', 'b'], ['o']],
  )

  // A role holding only the grid's function adds nothing.
  assert.deepEqual(await grid('gridOnly', 'in', [line('g', 'each', '1')]), { status: 403 })
  assert.equal((await movesOf('in')).length, 2)

  // A confirmed transfer takes new lines as confirmed; a cancelled or unknown one takes none.
  assert.equal((await r.call('stock.confirmPicking', { id: 'in' })).ok, true)
  assert.deepEqual(await grid('keeper', 'in', [line('e', 'each', '1')]), { ok: true, id: 'in' })
  assert.deepEqual((await movesOf('in')).find((move) => move[0] === 'e')?.[3], 'confirmed')
  assert.equal((await r.call('stock.cancelPicking', { id: 'other' })).ok, true)
  for (const pickingId of ['other', 'missing'])
    assert.equal(
      key(await grid('keeper', pickingId, [line('f', 'each', '1')])),
      'stock.error.pickingClosed',
      pickingId,
    )
  assert.equal((await movesOf('other')).length, 1)
})
