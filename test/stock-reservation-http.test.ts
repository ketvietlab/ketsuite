import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { setup } from './fixtures/sale/commerce.ts'

/**
 * K60: a storable product with `held` units in the warehouse's stock, at noon in Hà Nội on 31 January
 * 2030. A storekeeper and a seller work in it.
 */
async function seed(t: TestContext, held = '5', options: { worker?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t, options)
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  const stock = (id: string, locationId: string, countedQuantity: string) =>
    r.save('stock.adjustInventory', {
      id,
      productId: r.productId,
      locationId,
      inventoryLocationId: 'count',
      countedQuantity,
      productUomId: 'each',
    })
  await stock('opening', 'wh:stock', held)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  await r.fixture('user.saveRole', { id: 'sales-only', name: 'Sales only' })
  for (const fnKey of ['sale.listOrders', 'sale.getOrder'])
    await r.fixture('user.grantFunction', { id: `sales-only:${fnKey}`, roleId: 'sales-only', fnKey })
  const users: Record<string, ReturnType<typeof r.app.client.anonymous>> = {}
  for (const [id, roleId] of [
    ['keeper', 'commerce.warehouse-operator'],
    ['seller', 'sales-only'],
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
  const warehouse = (input: Row = {}) =>
    r.call('stock.saveWarehouse', { id: 'wh', name: 'Warehouse', code: 'WH', ...input })
  /** A confirmed transfer of `quantity` goods out of the warehouse on its scheduled day. */
  /** `confirm` null leaves it a draft. */
  const transfer = async (
    id: string,
    input: Row = {},
    quantity = '5',
    confirm: Row | null = { reserve: true },
  ) => {
    const { pickingTypeId = 'wh:outgoing', ...rest } = input
    await r.save('stock.createPicking', { id, name: id, pickingTypeId, ...rest })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: quantity,
    })
    return confirm ? r.save('stock.confirmPicking', { id, ...confirm }) : { ok: true, id }
  }
  const picking = async (id: string) => (await r.call('stock.getPicking', { id })) as Row
  const lines = async (id: string) =>
    ((await picking(id)).moves as Row[]).flatMap((move) => move.lines as Row[])
  const reserved = async (locationId = 'wh:stock') => {
    const quants = (await r.call('stock.listQuants', {
      productId: r.productId,
      locationId,
    })) as unknown as Row[]
    return quants.reduce((sum, row) => sum + Number(row.reservedQuantity), 0)
  }
  const key = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.messageKey
  return { ...r, as, users, warehouse, transfer, picking, lines, reserved, key, stock }
}

test('K60 the warehouse chooses when its transfers take goods: on confirmation, by hand, or days before the scheduled date', async (t) => {
  const r = await seed(t, '20')
  for (const [input, field] of [
    [{ reservationMethod: 'sometimes' }, 'reservationMethod'],
    [{ reservationDaysBefore: 366 }, 'reservationDaysBefore'],
    [{ reservationDaysBefore: -1 }, 'reservationDaysBefore'],
    [{ reservationDaysBeforePriority: 400 }, 'reservationDaysBeforePriority'],
  ] as const) {
    const refused = await r.warehouse(input)
    assert.equal(refused.ok, false, JSON.stringify(input))
    assert.equal(((refused.errors as Row[])[0] as Row).field, field)
  }
  assert.equal(r.key(await r.warehouse({ reservationMethod: 'sometimes' })), 'stock.error.reservationMethod')
  assert.deepEqual(((await r.warehouse({ reservationDaysBefore: 366 })).errors as Row[])[0]!.params, {
    max: 365,
  })

  // A warehouse that never chose reserves by hand, as transfers always have; receipts never reserve.
  const manual = await r.transfer('manual', { scheduledDate: '2030-02-10T03:00:00.000Z' })
  assert.deepEqual(manual, { ok: true, id: 'manual' })
  assert.deepEqual((await r.picking('manual')).reservation, { method: 'manual', reserveFrom: null })
  assert.deepEqual([(await r.picking('manual')).state, await r.reserved()], ['confirmed', 0])
  await r.transfer('receipt', { pickingTypeId: 'wh:incoming' }, '1')
  assert.deepEqual((await r.picking('receipt')).reservation, { method: null, reserveFrom: null })
  assert.deepEqual(
    [(await r.picking('receipt')).reserves, (await r.picking('manual')).reserves],
    [false, true],
  )
  // A receipt's open lines are goods arriving: Unreserve leaves them alone.
  assert.equal((await r.call('stock.assignPicking', { id: 'receipt' })).ok, true)
  await r.save('stock.saveMoveLine', { id: 'arriving', moveId: 'receipt-move', quantity: '1' })
  const arriving = (await r.lines('receipt')).length
  assert.ok(arriving > 0)
  assert.equal(
    r.key(await r.call('stock.unreservePicking', { id: 'receipt' })),
    'stock.error.pickingNotReserving',
  )
  assert.equal((await r.lines('receipt')).length, arriving)

  // On confirmation: a person confirming reserves at once. A module confirming as part of its own
  // work (no `reserve`) keeps the reservation in its own hands.
  assert.equal((await r.warehouse({ reservationMethod: 'at_confirm' })).ok, true)
  assert.deepEqual(await r.transfer('confirmed', {}, '2'), { ok: true, id: 'confirmed', state: 'assigned' })
  assert.equal(await r.reserved(), 2)
  assert.deepEqual(await r.transfer('module', {}, '1', {}), { ok: true, id: 'module' })
  assert.equal((await r.picking('module')).state, 'confirmed')
  // The transfer page confirms as a person does.
  await r.transfer('page', {}, '1', null)
  assert.equal((await r.picking('page')).state, 'draft')
  const confirm = transferModalDefinition.commands!.confirm!
  assert.equal(confirm.fn, 'stock.confirmPicking')
  const confirmed = (await r.call(
    confirm.fn,
    (confirm.input as (form: FormData, c: { id: string }) => Row)(new FormData(), { id: 'page' }),
  )) as Row
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed))
  assert.equal((await r.picking('page')).state, 'assigned')
  assert.equal(await r.reserved(), 3)
  // Confirming twice reserves once.
  assert.deepEqual(await r.call('stock.confirmPicking', { id: 'confirmed', reserve: true }), {
    ok: true,
    id: 'confirmed',
  })
  assert.equal(await r.reserved(), 3)

  // By date: the scheduled civil day in Hà Nội, less the days; priority transfers less their own days.
  assert.equal(
    (
      await r.warehouse({
        reservationMethod: 'by_date',
        reservationDaysBefore: 2,
        reservationDaysBeforePriority: 5,
      })
    ).ok,
    true,
  )
  // 18:00 UTC on the 9th is already the 10th in Hà Nội.
  await r.transfer('later', { scheduledDate: '2030-02-09T18:00:00.000Z' }, '1')
  assert.deepEqual((await r.picking('later')).reservation, { method: 'by_date', reserveFrom: '2030-02-08' })
  await r.transfer('urgent', { scheduledDate: '2030-02-09T18:00:00.000Z', priority: true }, '1')
  assert.deepEqual((await r.picking('urgent')).reservation, { method: 'by_date', reserveFrom: '2030-02-05' })
  assert.equal((await r.picking('urgent')).priority, true)
  assert.deepEqual(
    [(await r.picking('later')).state, (await r.picking('urgent')).state],
    ['confirmed', 'confirmed'],
  )
  // The day has come: confirming reserves. (Its name sorts first; its date does not.)
  assert.deepEqual(await r.transfer('arrival', { scheduledDate: '2030-02-02T03:00:00.000Z' }, '1'), {
    ok: true,
    id: 'arrival',
    state: 'assigned',
  })
  // A cancelled transfer is never due.
  await r.transfer('dropped', { scheduledDate: '2030-02-01T03:00:00.000Z' }, '1', {})
  assert.equal((await r.call('stock.cancelPicking', { id: 'dropped' })).ok, true)

  // Due now and still short: the transfer a module confirmed. Those that hold all they need are left be.
  assert.deepEqual(await r.call('stock.reservePickings', { due: true }), {
    ok: true,
    results: [{ id: 'module', name: 'module', state: 'assigned' }],
  })
  assert.equal(await r.reserved(), 5)
  // 18:00 UTC on the 4th is already the 5th in Hà Nội: the priority transfer's day.
  t.mock.timers.setTime(Date.parse('2030-02-04T18:00:00.000Z'))
  await r.app.client.login({ login: 'owner', password: 'test-password' })
  assert.deepEqual(await r.call('stock.reservePickings', { due: true }), {
    ok: true,
    results: [{ id: 'urgent', name: 'urgent', state: 'assigned' }],
  })
  assert.equal((await r.picking('later')).state, 'confirmed')

  // Clearing the priority days gives priority transfers the same days as the rest.
  assert.equal((await r.warehouse({ reservationDaysBeforePriority: null })).ok, true)
  assert.deepEqual((await r.picking('urgent')).reservation, { method: 'by_date', reserveFrom: '2030-02-08' })
  // Changing the method leaves what open transfers hold.
  assert.equal((await r.warehouse({ reservationMethod: 'manual' })).ok, true)
  assert.equal((await r.picking('urgent')).state, 'assigned')
  assert.deepEqual((await r.picking('urgent')).reservation, { method: 'manual', reserveFrom: null })
  assert.deepEqual(await r.call('stock.reservePickings', { due: true }), { ok: true, results: [] })
})

test('K60 reserving together serves priority first, unreserving gives back only unpicked goods, and the list reserves its checked transfers', async (t) => {
  const r = await seed(t)
  await r.transfer('early', { scheduledDate: '2030-02-01T03:00:00.000Z' })
  await r.transfer('urgent', { scheduledDate: '2030-02-03T03:00:00.000Z', priority: true })
  assert.equal(await r.reserved(), 0)

  // The list's bulk form posts its checked rows.
  const BULK = '/admin/stock/transfers/bulk?lang=vi'
  const form = (
    fields: Record<string, string>,
    headers: Record<string, string> = {},
    client = r.app.client,
  ) =>
    client.post(BULK, new URLSearchParams(fields), {
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      redirect: 'manual',
    })
  const page = await (await r.app.client.get('/admin/stock/transfers?lang=vi')).text()
  assert.match(
    page,
    /<form data-ui="bulk-form" id="stock-transfer-bulk"[^>]*action="\/admin\/stock\/transfers\/bulk\?lang=vi"/,
  )
  assert.equal((await r.app.client.request(BULK)).status, 405)
  const crossSite = await form(
    { action: 'reserve', 'selected.early': '1' },
    { origin: 'https://cross-site.example' },
  )
  assert.equal(crossSite.status, 403)
  assert.equal((await form({ action: 'ship', 'selected.early': '1' })).status, 400)
  assert.equal((await form({ action: 'reserve', 'selected.nowhere': '1' })).status, 400)
  const nothing = await form({ action: 'reserve', returnTo: '/admin/stock/transfers?q=WH' })
  assert.deepEqual([nothing.status, nothing.headers.get('location')], [303, '/admin/stock/transfers?q=WH'])
  assert.equal((await form({ action: 'reserve', 'selected.early': '1' }, {}, r.users.seller!)).status, 403)
  assert.equal(await r.reserved(), 0)

  const reserved = await form({
    action: 'reserve',
    // Only the list may be returned to.
    returnTo: '/admin/users?q=1',
    'selected.early': '1',
    'selected.urgent': '1',
  })
  assert.equal(reserved.status, 303)
  assert.equal(reserved.headers.get('location'), '/admin/stock/transfers?lang=vi')
  // Five units, two transfers of five: the priority one, though scheduled later, takes them.
  assert.deepEqual(
    [(await r.picking('urgent')).state, (await r.picking('early')).state],
    ['assigned', 'confirmed'],
  )
  assert.equal(await r.reserved(), 5)

  // The storekeeper unreserves; the seller cannot.
  assert.deepEqual(await r.as('seller', 'stock.unreservePicking', { id: 'urgent' }), { status: 403 })
  assert.deepEqual(await r.as('seller', 'stock.reservePickings', { ids: ['early'] }), { status: 403 })
  assert.deepEqual(await r.as('keeper', 'stock.unreservePicking', { id: 'urgent' }), {
    ok: true,
    id: 'urgent',
    state: 'confirmed',
    released: '5',
  })
  assert.equal(await r.reserved(), 0)
  assert.deepEqual(await r.lines('urgent'), [])

  // Two units picked by hand stay when the rest is given back.
  await r.save('stock.saveMoveLine', {
    id: 'urgent-picked',
    moveId: 'urgent-move',
    quantity: '2',
    picked: true,
  })
  assert.equal((await r.as('keeper', 'stock.reservePickings', { ids: ['urgent', 'early'] })).ok, true)
  assert.equal(await r.reserved(), 5)
  assert.deepEqual(await r.call('stock.unreservePicking', { id: 'urgent' }), {
    ok: true,
    id: 'urgent',
    state: 'assigned',
    released: '3',
  })
  assert.equal(await r.reserved(), 2)
  // The move keeps what was picked, short of its demand.
  const [move] = (await r.picking('urgent')).moves as Row[]
  assert.deepEqual([move!.state, Number(move!.quantity)], ['partially_available', 2])
  assert.deepEqual(
    (await r.lines('urgent')).map((line) => [line.id, Number(line.quantity), line.picked]),
    [['urgent-picked', 2, true]],
  )

  // A finished transfer holds nothing to give back.
  assert.equal((await r.call('stock.cancelPicking', { id: 'early' })).ok, true)
  assert.equal(r.key(await r.call('stock.unreservePicking', { id: 'early' })), 'stock.error.pickingClosed')
  assert.equal((await r.call('stock.unreservePicking', { id: 'nowhere' })).ok, false)
  assert.equal((await r.call('stock.reservePickings', { ids: [] })).ok, false)
  // A cancelled transfer chosen with an open one is left alone.
  assert.equal((await r.call('stock.reservePickings', { ids: ['early', 'urgent'] })).ok, true)
  assert.equal((await r.picking('early')).state, 'cancel')
})

test('K60 every hour the worker reserves transfers whose day has come, and short ones on confirmation, only in warehouses that reserve on their own', async (t) => {
  const r = await seed(t, '5', { worker: true })
  assert.equal((await r.warehouse({ reservationMethod: 'by_date', reservationDaysBefore: 1 })).ok, true)
  await r.save('stock.saveWarehouse', { id: 'side', name: 'Side', code: 'SD' })
  await r.stock('side-opening', 'side:stock', '5')
  // Confirmed by a module, so only the schedule reserves them.
  await r.transfer('tomorrow', { scheduledDate: '2030-02-01T03:00:00.000Z' }, '2', {})
  await r.transfer('next-week', { scheduledDate: '2030-02-07T03:00:00.000Z' }, '2', {})
  await r.transfer(
    'side-today',
    { pickingTypeId: 'side:outgoing', scheduledDate: '2030-01-31T03:00:00.000Z' },
    '2',
    {},
  )
  // On confirmation: a transfer still short when goods turn up by a count, and one a person gave back.
  await r.save('stock.saveWarehouse', {
    id: 'auto',
    name: 'Auto',
    code: 'AU',
    reservationMethod: 'at_confirm',
  })
  await r.stock('auto-opening', 'auto:stock', '2')
  await r.transfer('auto-paused', { pickingTypeId: 'auto:outgoing' }, '2')
  assert.equal((await r.call('stock.unreservePicking', { id: 'auto-paused' })).ok, true)
  await r.transfer(
    'auto-short',
    { pickingTypeId: 'auto:outgoing', scheduledDate: '2030-02-09T03:00:00.000Z' },
    '4',
  )
  await r.stock('auto-count', 'auto:stock', '6')
  assert.equal(await r.reserved('auto:stock'), 2)
  const worker = r.app.worker!
  // A schedule seen for the first time waits for its next tick.
  await worker.sweepSchedules()
  await r.app.drainJobs()
  assert.equal((await r.picking('tomorrow')).state, 'confirmed')

  t.mock.timers.setTime(Date.parse('2030-01-31T06:00:00.000Z'))
  assert.ok((await worker.sweepSchedules()) >= 1)
  await r.app.drainJobs()
  assert.deepEqual(
    [
      (await r.picking('tomorrow')).state,
      (await r.picking('next-week')).state,
      (await r.picking('side-today')).state,
      (await r.picking('auto-short')).state,
      (await r.picking('auto-paused')).state,
    ],
    ['assigned', 'confirmed', 'confirmed', 'assigned', 'confirmed'],
  )
  assert.deepEqual(
    [await r.reserved(), await r.reserved('side:stock'), await r.reserved('auto:stock')],
    [2, 0, 4],
  )

  // A company whose warehouses only reserve on confirmation still gets its run.
  assert.equal((await r.warehouse({ reservationMethod: 'at_confirm' })).ok, true)
  await r.transfer('short', {}, '3', {})
  await r.stock('recount', 'wh:stock', '8')
  t.mock.timers.setTime(Date.parse('2030-01-31T07:00:00.000Z'))
  assert.ok((await worker.sweepSchedules()) >= 1)
  await r.app.drainJobs()
  assert.deepEqual(
    [(await r.picking('short')).state, (await r.picking('next-week')).state],
    ['assigned', 'assigned'],
  )
})

test('K60 goods a receipt or transfer brings in go to the transfers waiting for them, priority first, unless a person gave theirs back or the warehouse reserves by hand', async (t) => {
  const r = await seed(t, '2', { worker: true })
  assert.equal((await r.warehouse({ reservationMethod: 'at_confirm' })).ok, true)
  /** A receipt of `quantity` goods, done. */
  const receive = async (id: string, quantity: string, pickingTypeId = 'wh:incoming') => {
    await r.transfer(id, { pickingTypeId }, quantity, {})
    await r.save('stock.saveMoveLine', { id: `${id}-line`, moveId: `${id}-move`, quantity })
    assert.equal((await r.call('stock.completePicking', { id, createBackorder: false })).ok, true)
  }
  const states = async (...ids: string[]) =>
    Promise.all(
      ids.map(async (id) => {
        const [move] = (await r.picking(id)).moves as Row[]
        return [id, Number(move!.quantity)]
      }),
    )

  // A person gives back what `paused` took: nothing of its own reserves it again.
  await r.transfer('paused', { scheduledDate: '2030-02-01T03:00:00.000Z' }, '2')
  assert.equal(await r.reserved(), 2)
  assert.equal((await r.as('keeper', 'stock.unreservePicking', { id: 'paused' })).ok, true)
  assert.equal((await r.picking('paused')).reservationPaused, true)
  await r.transfer('early', { scheduledDate: '2030-02-02T03:00:00.000Z' })
  await r.transfer('urgent', { scheduledDate: '2030-02-05T03:00:00.000Z', priority: true })
  await r.transfer('later', { scheduledDate: '2030-02-07T03:00:00.000Z' }, '3')
  assert.deepEqual(await states('paused', 'early', 'urgent', 'later'), [
    ['paused', 0],
    ['early', 2],
    ['urgent', 0],
    ['later', 0],
  ])

  // Six arrive. Once the receipt commits, the priority transfer takes its five, then the soonest
  // scheduled what is left.
  await receive('in', '6')
  assert.equal((await r.picking('urgent')).state, 'confirmed')
  assert.equal(await r.app.drainJobs(), 1)
  assert.deepEqual(await states('paused', 'early', 'urgent', 'later'), [
    ['paused', 0],
    ['early', 3],
    ['urgent', 5],
    ['later', 0],
  ])
  assert.equal((await r.picking('urgent')).state, 'assigned')
  assert.equal(await r.reserved(), 8)

  // Pressing reserve lifts the pause, though nothing is free: the next goods reach it, scheduled first.
  assert.equal((await r.as('keeper', 'stock.assignPicking', { id: 'paused' })).ok, true)
  assert.equal((await r.picking('paused')).reservationPaused, false)
  await receive('in-2', '2')
  assert.equal(await r.app.drainJobs(), 1)
  assert.deepEqual(await states('paused', 'early', 'later'), [
    ['paused', 2],
    ['early', 3],
    ['later', 0],
  ])

  // A transfer into the warehouse brings goods too.
  await r.save('stock.saveWarehouse', { id: 'side', name: 'Side', code: 'SD' })
  await r.stock('side-opening', 'side:stock', '4')
  await r.transfer(
    'to-wh',
    { pickingTypeId: 'wh:internal', locationId: 'side:stock', locationDestId: 'wh:stock' },
    '3',
  )
  assert.equal(Number(((await r.picking('to-wh')).moves as Row[])[0]!.quantity), 3)
  assert.equal((await r.call('stock.completePicking', { id: 'to-wh', createBackorder: false })).ok, true)
  assert.equal(await r.app.drainJobs(), 1)
  assert.deepEqual(await states('early', 'later'), [
    ['early', 5],
    ['later', 1],
  ])

  // Only what came in moves on: another product counted in waits for the hourly run.
  await r.save('product.saveRecord', {
    id: 'other',
    name: 'Other',
    type: 'goods',
    defaultCode: 'OTHER',
    uomId: 'each',
    listPrice: '10',
  })
  await r.save('stock.configureProduct', { templateId: 'other', isStorable: true, tracking: 'none' })
  const [other] = (await r.call('product.listVariants', { templateId: 'other' })) as unknown as Row[]
  await r.save('stock.createPicking', { id: 'other-out', name: 'other-out', pickingTypeId: 'wh:outgoing' })
  await r.save('stock.addMove', {
    id: 'other-out-move',
    pickingId: 'other-out',
    name: 'Other',
    productId: other!.id,
    productUomId: 'each',
    productUomQty: '1',
  })
  await r.save('stock.confirmPicking', { id: 'other-out', reserve: true })
  await r.save('stock.adjustInventory', {
    id: 'other-count',
    productId: other!.id,
    locationId: 'wh:stock',
    inventoryLocationId: 'count',
    countedQuantity: '1',
    productUomId: 'each',
  })
  // A receipt naming it but bringing none frees none of it.
  await r.transfer('in-3', { pickingTypeId: 'wh:incoming' }, '1', null)
  await r.save('stock.addMove', {
    id: 'in-3-other',
    pickingId: 'in-3',
    name: 'Other',
    productId: other!.id,
    productUomId: 'each',
    productUomQty: '1',
  })
  await r.save('stock.confirmPicking', { id: 'in-3' })
  await r.save('stock.saveMoveLine', { id: 'in-3-line', moveId: 'in-3-move', quantity: '1' })
  assert.equal((await r.call('stock.completePicking', { id: 'in-3', createBackorder: false })).ok, true)
  assert.equal(await r.app.drainJobs(), 1)
  assert.deepEqual(await states('other-out', 'later'), [
    ['other-out', 0],
    ['later', 2],
  ])

  // A warehouse that reserves by hand keeps what arrives free.
  await r.transfer('side-out', { pickingTypeId: 'side:outgoing' }, '1')
  await receive('side-in', '1', 'side:incoming')
  await r.app.drainJobs()
  assert.deepEqual(await states('side-out'), [['side-out', 0]])
  assert.equal(await r.reserved('side:stock'), 0)
})

test('K60 goods a cancelled transfer or sales order gave back go to the transfers waiting for them, by date only once their day has come', async (t) => {
  const r = await seed(t, '5', { worker: true })
  assert.equal((await r.warehouse({ reservationMethod: 'at_confirm' })).ok, true)
  await r.add({ productUomId: 'each', productUomQty: '5' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery', reserve: true })
  assert.equal(await r.reserved(), 5)
  await r.transfer('waiting', { scheduledDate: '2030-02-01T03:00:00.000Z' })
  assert.equal((await r.picking('waiting')).state, 'confirmed')

  // Cancelling the order gives its five back and, once it commits, they go on to the transfer.
  assert.equal((await r.call('sale.cancelOrder', { id: 'order' })).ok, true)
  assert.equal(await r.app.drainJobs(), 1)
  assert.equal((await r.picking('waiting')).state, 'assigned')
  assert.equal(await r.reserved(), 5)

  // By date: cancelling `waiting` frees five for the transfer due tomorrow, not next week's.
  assert.equal((await r.warehouse({ reservationMethod: 'by_date', reservationDaysBefore: 1 })).ok, true)
  await r.transfer('next-week', { scheduledDate: '2030-02-03T03:00:00.000Z', priority: true }, '5', {})
  await r.transfer('tomorrow', { scheduledDate: '2030-02-01T03:00:00.000Z' }, '5', {})
  assert.equal(
    (await r.as('keeper', 'stock.cancelPicking', { id: 'waiting', reason: 'Khách đổi ý' })).ok,
    true,
  )
  assert.equal(await r.app.drainJobs(), 1)
  assert.deepEqual(
    [(await r.picking('tomorrow')).state, (await r.picking('next-week')).state],
    ['assigned', 'confirmed'],
  )

  // A cancelled transfer that held nothing frees nothing, and nothing runs.
  assert.equal((await r.call('stock.cancelPicking', { id: 'next-week', reason: 'Gộp phiếu' })).ok, true)
  assert.equal(await r.app.drainJobs(), 0)
})
