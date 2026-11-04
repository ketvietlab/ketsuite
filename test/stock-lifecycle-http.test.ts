import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { setup } from './fixtures/sale/commerce.ts'

/** K18: 5 storable goods in the warehouse's stock and a storekeeper working them. */
async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  await r.save('stock.adjustInventory', {
    id: 'opening',
    productId: r.productId,
    locationId: 'wh:stock',
    inventoryLocationId: 'count',
    countedQuantity: '5',
    productUomId: 'each',
  })
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await r.fixture('user.createUser', {
    id: 'keeper',
    login: 'keeper',
    password: 'test-password',
    name: 'keeper',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'keeper-company', userId: 'keeper', companyId: 'acme' })
  await r.fixture('user.assignRole', {
    id: 'keeper-role',
    userId: 'keeper',
    roleId: 'commerce.warehouse-operator',
  })
  const keeper = r.app.client.anonymous()
  await keeper.login({ login: 'keeper', password: 'test-password' })
  /** Calls a function as the storekeeper: the answer, or the HTTP status when the call is refused. */
  const asKeeper = async (fn: string, body: Row) => {
    const response = await keeper.request(`/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.status !== 200) return { status: response.status } as Row
    const answer = (await response.json()) as Row
    return (answer.value ?? answer) as Row
  }
  /** A transfer of `quantity` goods out of the warehouse; `state` says how far it goes. */
  const transfer = async (
    id: string,
    input: Row = {},
    quantity: string | null = '1',
    state: 'draft' | 'confirmed' | 'assigned' | 'done' = 'confirmed',
  ) => {
    const { pickingTypeId = 'wh:outgoing', ...rest } = input
    await r.save('stock.createPicking', { id, name: id, pickingTypeId, ...rest })
    if (quantity)
      await r.save('stock.addMove', {
        id: `${id}-move`,
        pickingId: id,
        name: 'Goods',
        productId: r.productId,
        productUomId: 'each',
        productUomQty: quantity,
      })
    if (state === 'draft') return
    await r.save('stock.confirmPicking', { id })
    // The warehouse reserves by hand, as it does unless it chose otherwise.
    if (state !== 'confirmed') await r.save('stock.assignPicking', { id })
    if (state === 'done') await r.save('stock.completePicking', { id, createBackorder: false })
  }
  const picking = async (id: string) => (await r.call('stock.getPicking', { id })) as Row
  const reserved = async () => {
    const quants = (await r.call('stock.listQuants', {
      productId: r.productId,
      locationId: 'wh:stock',
    })) as unknown as Row[]
    return quants.reduce((sum, row) => sum + Number(row.reservedQuantity), 0)
  }
  const key = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.messageKey
  return { ...r, keeper, asKeeper, transfer, picking, reserved, key }
}

test('K18 a person cancels a transfer with a reason it keeps; a blank one cancels nothing', async (t) => {
  const r = await seed(t)
  await r.transfer('held', {}, '3', 'assigned')
  assert.equal(await r.reserved(), 3)
  // The storekeeper cancels transfers (K21, owner 26/10/2026), but never without saying why.
  for (const reason of ['', '   ']) {
    const refused = await r.asKeeper('stock.cancelPicking', { id: 'held', reason })
    assert.equal(refused.ok, false, JSON.stringify(refused))
    assert.deepEqual(refused.errors, [{ field: 'reason', messageKey: 'stock.error.cancelReason' }])
  }
  assert.equal((await r.picking('held')).state, 'assigned')
  assert.equal(await r.reserved(), 3)
  // The page's dialog posts its reason; what was held goes back to stock.
  const cancel = transferModalDefinition.commands!.cancel!
  assert.equal(cancel.fn, 'stock.cancelPicking')
  const form = new FormData()
  form.set('reason', '  Khách đổi ý  ')
  const input = (cancel.input as (form: FormData, c: { id: string }) => Row)(form, { id: 'held' })
  assert.deepEqual(input, { id: 'held', reason: '  Khách đổi ý  ' })
  const cancelled = await r.asKeeper(cancel.fn, input)
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled))
  const held = await r.picking('held')
  assert.equal(held.state, 'cancel')
  assert.equal(held.cancelReason, 'Khách đổi ý')
  assert.equal(await r.reserved(), 0)
  // The cancelled transfer's page reads the reason back.
  const context = await r.keeper.get('/admin/stock/transfer/held/context?lang=vi')
  assert.equal(context.status, 200)
  assert.equal(((await context.json()) as { data: { record: Row } }).data.record.cancelReason, 'Khách đổi ý')
  // A flow cancelling with its own document passes no reason and keeps none.
  await r.transfer('flow')
  assert.deepEqual(await r.call('stock.cancelPicking', { id: 'flow' }), { ok: true, id: 'flow' })
  assert.equal((await r.picking('flow')).cancelReason ?? null, null)
  // A completed transfer is not cancelled, whatever the reason.
  await r.transfer('shipped', {}, '1', 'done')
  assert.equal(r.key(await r.asKeeper('stock.cancelPicking', { id: 'shipped', reason: 'Nhầm' })), undefined)
  assert.equal((await r.picking('shipped')).state, 'done')
})

test('K18 the transfer list works ready, waiting, then draft by date; closed transfers last, newest first', async (t) => {
  const r = await seed(t)
  const day = (date: string) => ({ scheduledDate: `2030-02-${date}T03:00:00.000Z` })
  // Two shipped, one on each day: of the 5, 3 are left.
  await r.transfer('DONE-OLD', day('02'), '1', 'done')
  t.mock.timers.setTime(new Date('2030-02-01T05:00:00.000Z').getTime())
  await r.transfer('DONE-NEW', day('20'), '1', 'done')
  // Ready transfers come first by date, whatever order they were made in.
  await r.transfer('READY-LATE', day('10'), '1', 'assigned')
  await r.transfer('READY-SOON', day('03'), '2', 'assigned')
  await r.transfer('DRAFT-SOON', day('01'), '1', 'draft')
  // Waiting outranks a draft due earlier: nothing is left to hold for it.
  await r.transfer('WAITING', day('05'), '1', 'assigned')
  await r.transfer('CONFIRMED', day('04'), '1', 'confirmed')
  await r.transfer('CANCELLED', day('06'), '1', 'draft')
  await r.call('stock.cancelPicking', { id: 'CANCELLED', reason: 'Trùng phiếu' })
  const states = Object.fromEntries(
    await Promise.all(
      ['READY-LATE', 'READY-SOON', 'WAITING', 'CONFIRMED'].map(async (id) => [
        id,
        (await r.picking(id)).state,
      ]),
    ),
  )
  assert.deepEqual(states, {
    'READY-LATE': 'assigned',
    'READY-SOON': 'assigned',
    WAITING: 'confirmed',
    CONFIRMED: 'confirmed',
  })
  const order = async () => {
    const html = await (await r.app.client.get('/admin/stock/transfers?lang=vi')).text()
    // The opening count's adjustment is done before any of them and closes the list.
    return [...html.matchAll(/data-row="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((id) => id !== 'opening:picking')
  }
  assert.deepEqual(await order(), [
    'READY-SOON',
    'READY-LATE',
    'CONFIRMED',
    'WAITING',
    'DRAFT-SOON',
    'CANCELLED',
    'DONE-NEW',
    'DONE-OLD',
  ])
})

test('K20 cancelling a sales order cancels its open delivery and gives back what it held', async (t) => {
  const r = await seed(t)
  await r.add({ productUomId: 'each', productUomQty: '3' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  await r.save('stock.assignPicking', { id: 'order:delivery' })
  assert.equal((await r.picking('order:delivery')).state, 'assigned')
  assert.equal(await r.reserved(), 3)
  await r.save('sale.cancelOrder', { id: 'order' })
  const delivery = await r.picking('order:delivery')
  assert.equal(delivery.state, 'cancel')
  assert.equal(delivery.cancelReason ?? null, null)
  assert.ok((delivery.moves as Row[]).every((move) => move.state === 'cancel'))
  assert.equal(await r.reserved(), 0)
})
