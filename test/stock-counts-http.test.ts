import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

/**
 * A warehouse holding ten goods at 1,000 each and a lot-tracked serum at 2,500: lot SOON (4, expiring first)
 * and lot LATE (2). It posts its stock journal; a storekeeper, a stock manager and a seller work in it.
 */
async function seed(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-31T05:00:00.000Z') })
  const r = await setup(t)
  await r.save('product.saveRecord', {
    expectedRevisionId: (await r.call('product.getTemplate', { id: 'goods' })).revisionId,
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    defaultCode: 'GOODS',
    uomId: 'each',
    listPrice: '100',
    saleOk: true,
    purchaseOk: true,
  })
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await r.save('product.setCost', { productId: r.productId, standardPrice: '1000' })
  await r.save('product.saveRecord', {
    id: 'serum',
    name: 'Serum',
    type: 'goods',
    defaultCode: 'SERUM',
    uomId: 'each',
    listPrice: '300',
    saleOk: true,
  })
  await r.save('stock.configureProduct', { templateId: 'serum', isStorable: true, tracking: 'lot' })
  const serum = String(
    ((await r.call('product.listVariants', { templateId: 'serum' })) as unknown as Row[])[0]!.id,
  )
  await r.save('product.setCost', { productId: serum, standardPrice: '2500' })
  await r.save('stock.saveLocation', { id: 'count', name: 'Count', usage: 'inventory' })
  for (const [id, accountType, reconcile] of [
    ['156', 'asset_current', false],
    ['151', 'asset_current', false],
    ['1541', 'asset_current', false],
    ['632', 'expense_direct_cost', false],
    ['33811', 'liability_current', true],
    ['13811', 'asset_receivable', true],
  ] as const)
    await r.save('account.saveAccount', { id, code: id, name: id, accountType, reconcile })
  await r.save('account.saveJournal', { id: 'kho', name: 'Kho', code: 'KHO', type: 'general' })
  await r.save('stock.saveAccountingSetting', {
    journalId: 'kho',
    valuationAccountId: '156',
    supplierAccountId: '151',
    productionAccountId: '1541',
    cogsAccountId: '632',
    gainAccountId: '33811',
    lossAccountId: '13811',
  })
  const book = (id: string, productId: string, countedQuantity: string, lotId?: string) =>
    r.save('stock.adjustInventory', {
      id,
      productId,
      locationId: 'wh:stock',
      inventoryLocationId: 'count',
      countedQuantity,
      productUomId: 'each',
      ...(lotId ? { lotId } : {}),
    })
  await book('opening', r.productId, '10')
  await r.save('stock.createLot', {
    id: 'late',
    productId: serum,
    name: 'LATE',
    expirationDate: '2031-06-30T00:00:00.000Z',
  })
  await r.save('stock.createLot', {
    id: 'soon',
    productId: serum,
    name: 'SOON',
    expirationDate: '2030-06-30T00:00:00.000Z',
  })
  await book('late-opening', serum, '2', 'late')
  await book('soon-opening', serum, '4', 'soon')
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  // Commerce's sales roles hold no stock bundle (K38); KetSuite's public template lends them stock.view for
  // availability, so the seller here works sales alone.
  await r.fixture('user.saveRole', { id: 'sales-only', name: 'Sales only' })
  for (const fnKey of ['sale.listOrders', 'sale.getOrder'])
    await r.fixture('user.grantFunction', { id: `sales-only:${fnKey}`, roleId: 'sales-only', fnKey })
  // A counter records figures but may not drop lines from the count.
  await r.fixture('user.saveRole', { id: 'figures-only', name: 'Figures only' })
  await r.fixture('user.grantFunction', {
    id: 'figures-only:save',
    roleId: 'figures-only',
    fnKey: 'stock.saveCountLines',
  })
  const users: Record<string, ReturnType<typeof r.app.client.anonymous>> = {}
  for (const [id, roleId] of [
    ['keeper', 'commerce.warehouse-operator'],
    ['manager', 'commerce.warehouse-manager'],
    ['seller', 'sales-only'],
    ['counter', 'figures-only'],
    ['accountant', 'commerce.accountant'],
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
  const key = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.messageKey
  const params = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.params
  const session = async (id: string) => (await r.call('stock.getCountSession', { id })) as Row
  const lines = async (id: string) => (await session(id)).lines as Row[]
  /** Counts a session's lines by position; a missing figure leaves its line uncounted. */
  const countAll = async (user: string, id: string, figures: string[], reasons: string[] = []) =>
    as(user, 'stock.saveCountLines', {
      id,
      lines: (await lines(id))
        .map((line, index) => ({
          lineId: line.id,
          counted: figures[index],
          reasonCode: 'other',
          ...(reasons[index] ? { reason: reasons[index] } : {}),
        }))
        .filter((line) => line.counted !== undefined),
    })
  const onHand = async (productId: string, lotId?: string) => {
    const quants = (await r.call('stock.listQuants', {
      productId,
      locationId: 'wh:stock',
    })) as unknown as Row[]
    return quants
      .filter((row) => !lotId || row.lotId === lotId)
      .reduce((sum, row) => sum + Number(row.quantity), 0)
  }
  const entry = async (pickingId: string) => {
    const valuation = (await r.call('stock.getPickingValuation', { id: pickingId })) as Row
    return (
      await r.app.adapter!.all(
        sql(`SELECT "accountId", debit, credit FROM account_move_line WHERE "moveId" = ? ORDER BY sequence`),
        [valuation.accountMoveId],
      )
    ).map((row) => [row.accountId, Number(row.debit), Number(row.credit)])
  }
  return { ...r, serum, book, as, key, params, session, lines, countAll, onHand, entry }
}

test('K33 K34 a count starts from what the warehouse holds and hides the book until it is sent for approval', async (t) => {
  const r = await seed(t)
  await r.save('stock.saveWarehouse', { id: 'east', name: 'East', code: 'EA' })
  assert.equal(
    r.key(await r.as('keeper', 'stock.startCountSession', { id: 'none', warehouseId: 'east' })),
    'stock.error.countNothingHeld',
  )
  const started = await r.as('keeper', 'stock.startCountSession', { id: 'first', warehouseId: 'wh' })
  assert.deepEqual([started.ok, started.name], [true, 'WH/KK/0001'])
  assert.equal((await r.as('keeper', 'stock.startCountSession', { id: 'first', warehouseId: 'wh' })).ok, true)
  const second = await r.as('keeper', 'stock.startCountSession', { id: 'second', warehouseId: 'wh' })
  assert.equal(r.key(second), 'stock.error.countOverlap')
  assert.deepEqual(r.params(second), { name: 'WH/KK/0001' })

  // Products by code, a product's lots soonest expiring first; blind by default, so no book while counting.
  const counting = await r.session('first')
  assert.equal(counting.blind, true)
  assert.deepEqual(
    (counting.lines as Row[]).map((line) => [line.productId, line.lotId, line.expected, line.difference]),
    [
      [r.productId, null, null, null],
      [r.serum, 'soon', null, null],
      [r.serum, 'late', null, null],
    ],
  )
  assert.deepEqual([counting.lineCount, counting.countedLines, counting.differingLines], [3, 0, null])
  const listed = ((await r.call('stock.listCountSessions', {})) as unknown as Row[])[0]!
  assert.deepEqual([listed.name, listed.differingLines, 'lines' in listed], ['WH/KK/0001', null, false])

  assert.equal(r.key(await r.countAll('keeper', 'first', ['-1', '4', '2'])), 'stock.error.countQuantity')
  assert.equal((await r.countAll('keeper', 'first', ['8', '4'])).ok, true)
  const partial = await r.as('keeper', 'stock.submitCountSession', { id: 'first' })
  assert.equal(r.key(partial), 'stock.error.countUncounted')
  assert.deepEqual(r.params(partial), { left: 1 })
  assert.equal((await r.countAll('keeper', 'first', ['8', '4', '3'], ['Vỡ hai hộp'])).ok, true)
  assert.equal((await r.as('keeper', 'stock.submitCountSession', { id: 'first' })).ok, true)

  // Sent for approval: everyone sees the book, the differences and who counted.
  const review = await r.session('first')
  assert.equal(review.state, 'review')
  assert.deepEqual(
    (review.lines as Row[]).map((line) => [
      Number(line.expected),
      Number(line.counted),
      Number(line.difference),
      line.countedBy,
    ]),
    [
      [10, 8, -2, 'keeper'],
      [4, 4, 0, 'keeper'],
      [2, 3, 1, 'keeper'],
    ],
  )
  assert.equal((review.lines as Row[])[0]!.reason, 'Vỡ hai hộp')
  assert.equal(review.differingLines, 2)
  assert.equal(review.submittedBy, 'keeper')
  assert.equal(r.key(await r.countAll('keeper', 'first', ['9', '4', '3'])), 'stock.error.countNotCounting')

  // An open count shows the book when it is not blind.
  assert.equal(
    (await r.as('manager', 'stock.cancelCountSession', { id: 'first', reason: 'Làm lại' })).ok,
    true,
  )
  assert.equal(
    (await r.as('keeper', 'stock.startCountSession', { id: 'open', warehouseId: 'wh', blind: false })).name,
    'WH/KK/0002',
  )
  assert.deepEqual(
    (await r.lines('open')).map((line) => Number(line.expected)),
    [10, 4, 2],
  )
})

test('K35 K36 approval by someone else books shortages and excesses at cost and keeps them in the lot history', async (t) => {
  const r = await seed(t)
  await r.as('keeper', 'stock.startCountSession', { id: 'count', warehouseId: 'wh' })
  await r.countAll('keeper', 'count', ['8', '4', '3'])
  await r.as('keeper', 'stock.submitCountSession', { id: 'count' })
  assert.equal((await r.as('keeper', 'stock.approveCountSession', { id: 'count' })).status, 403)
  // The storekeeper cannot return either: returning is the approver's.
  assert.equal((await r.as('keeper', 'stock.returnCountSession', { id: 'count', reason: 'x' })).status, 403)

  const approved = await r.as('manager', 'stock.approveCountSession', { id: 'count' })
  assert.equal(approved.ok, true)
  const done = await r.session('count')
  assert.deepEqual(
    [done.state, done.approvedBy, done.shortagePickingId, done.excessPickingId],
    ['done', 'manager', 'count:shortage', 'count:excess'],
  )
  assert.equal((await r.as('manager', 'stock.approveCountSession', { id: 'count' })).ok, true)
  // What approval booked stays booked: a done count is no longer cancelled.
  assert.equal(
    r.key(await r.as('manager', 'stock.cancelCountSession', { id: 'count', reason: 'Nhầm' })),
    'stock.error.countNotOpen',
  )
  assert.equal((await r.session('count')).state, 'done')
  // The excess came into the stock location, yet a count adjustment is no operation to scrap from.
  assert.equal(await r.call('stock.getScrapSource', { pickingId: 'count:excess' }), null)

  const shortage = await r.call('stock.getPicking', { id: 'count:shortage' })
  const excess = await r.call('stock.getPicking', { id: 'count:excess' })
  assert.deepEqual(
    [shortage.name, shortage.state, shortage.locationId, shortage.locationDestId],
    ['WH/KK/0001/XK', 'done', 'wh:stock', 'wh:adjustment'],
  )
  assert.deepEqual(
    [excess.name, excess.state, excess.locationId, excess.locationDestId],
    ['WH/KK/0001/NK', 'done', 'wh:adjustment', 'wh:stock'],
  )
  // Each line names its goods; the hidden count type still reads as a name, not an id.
  assert.deepEqual(
    [shortage.pickingTypeName, (shortage.moves as Row[]).map((move) => move.name)],
    ['Physical count', ['Goods']],
  )
  assert.deepEqual(
    [await r.onHand(r.productId), await r.onHand(r.serum, 'soon'), await r.onHand(r.serum, 'late')],
    [8, 4, 3],
  )
  assert.deepEqual(await r.entry('count:shortage'), [
    ['13811', 2000, 0],
    ['156', 0, 2000],
  ])
  assert.deepEqual(await r.entry('count:excess'), [
    ['156', 2500, 0],
    ['33811', 0, 2500],
  ])
  const history = (await r.app.adapter!.all(
    sql(`SELECT reason, before, after FROM stock_lot_history WHERE "lotId" = ? ORDER BY at`),
    ['late'],
  )) as Row[]
  const adjustment = history.find((row) => row.reason === 'countAdjustment')!
  const json = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value) as Row
  assert.deepEqual(
    [json(adjustment.before).quantity, json(adjustment.after).count, json(adjustment.after).quantity],
    ['2', 'WH/KK/0001', '3'],
  )
  assert.equal(
    history.some((row) => row.reason === 'countAdjustment' && json(row.after).quantity === '4'),
    false,
  )
  // An approved count frees the warehouse for the next one.
  assert.equal((await r.as('keeper', 'stock.startCountSession', { id: 'next', warehouseId: 'wh' })).ok, true)
})

test('K35 whoever counted does not approve, a changed book refuses approval, and returning recounts what changed', async (t) => {
  const r = await seed(t)
  await r.as('manager', 'stock.startCountSession', { id: 'count', warehouseId: 'wh', blind: false })
  await r.countAll('keeper', 'count', ['10', '3', '2'])
  // The manager counts one line again: they may no longer approve, though they could still return.
  const [first] = await r.lines('count')
  assert.equal(
    (
      await r.as('manager', 'stock.saveCountLines', {
        id: 'count',
        lines: [{ lineId: first!.id, counted: '10' }],
      })
    ).ok,
    true,
  )
  await r.as('keeper', 'stock.submitCountSession', { id: 'count' })
  assert.equal((await r.session('count')).state, 'review')
  assert.equal(
    r.key(await r.as('manager', 'stock.approveCountSession', { id: 'count' })),
    'stock.error.countSelfApproval',
  )
  // The owner neither counted nor submitted it.
  const owned = await r.call('stock.getCountSession', { id: 'count' })
  assert.equal(owned.selfCounted, false)

  // Goods moved since the count: the book no longer matches what was counted.
  await r.book('later', r.productId, '12')
  await r.save('stock.createLot', { id: 'fresh', productId: r.serum, name: 'FRESH' })
  await r.book('fresh-opening', r.serum, '1', 'fresh')
  const refused = await r.call('stock.approveCountSession', { id: 'count' })
  assert.equal(r.key(refused), 'stock.error.countStockChanged')
  assert.deepEqual(r.params(refused), { product: 'Goods' })
  assert.equal((await r.session('count')).state, 'review')
  assert.equal(await r.onHand(r.serum, 'soon'), 4)

  assert.equal(
    r.key(await r.as('manager', 'stock.returnCountSession', { id: 'count', reason: ' ' })),
    'stock.error.countReason',
  )
  assert.equal(
    (await r.as('manager', 'stock.returnCountSession', { id: 'count', reason: 'Có hàng nhập giữa chừng' }))
      .ok,
    true,
  )
  const returned = await r.session('count')
  assert.deepEqual(
    [returned.state, returned.returnReason, returned.returnedBy, returned.submittedBy],
    ['counting', 'Có hàng nhập giữa chừng', 'manager', null],
  )
  assert.deepEqual(
    (returned.lines as Row[]).map((line) => [line.lotId, Number(line.expected), line.counted]),
    [
      [null, 12, null],
      ['soon', 4, '3'],
      ['late', 2, '2'],
      ['fresh', 1, null],
    ],
  )
  assert.equal(r.key(await r.call('stock.submitCountSession', { id: 'count' })), 'stock.error.countUncounted')
})

test('K33 found goods join the count with an existing lot, lines can be removed, and a count can be cancelled', async (t) => {
  const r = await seed(t)
  await r.save('stock.createLot', { id: 'spare', productId: r.serum, name: 'SPARE' })
  await r.save('product.saveRecord', {
    id: 'other',
    name: 'Other',
    type: 'goods',
    defaultCode: 'OTHER',
    uomId: 'each',
    listPrice: '1',
    saleOk: true,
  })
  await r.save('stock.configureProduct', { templateId: 'other', isStorable: true, tracking: 'lot' })
  const other = String(
    ((await r.call('product.listVariants', { templateId: 'other' })) as unknown as Row[])[0]!.id,
  )
  await r.save('stock.createLot', { id: 'foreign', productId: other, name: 'FOREIGN' })
  await r.as('keeper', 'stock.startCountSession', { id: 'count', warehouseId: 'wh' })
  const add = (lineId: string, input: Row) =>
    r.as('keeper', 'stock.addCountLine', { id: 'count', lineId, counted: '1', ...input })
  assert.equal(r.key(await add('dup', { productId: r.productId })), 'stock.error.countLineTaken')
  assert.equal(r.key(await add('nolot', { productId: r.serum })), 'stock.error.countLot')
  assert.equal(r.key(await add('foreign', { productId: r.serum, lotId: 'foreign' })), 'stock.error.countLot')
  assert.equal(
    r.key(await add('lotted', { productId: r.productId, lotId: 'spare' })),
    'stock.error.countLotUntracked',
  )
  assert.equal(
    r.key(await add('neg', { productId: r.serum, lotId: 'spare', counted: '-1' })),
    'stock.error.countQuantity',
  )
  assert.equal((await add('found', { productId: r.serum, lotId: 'spare', reason: 'Trên kệ B' })).ok, true)
  assert.equal((await add('found', { productId: r.serum, lotId: 'spare' })).ok, true)
  const found = (await r.lines('count')).find((line) => line.id === 'found')!
  assert.deepEqual(
    [found.found, found.counted, found.countedBy, found.reason],
    [true, '1', 'keeper', 'Trên kệ B'],
  )
  assert.equal((await r.as('keeper', 'stock.removeCountLine', { id: 'count', lineId: 'found' })).ok, true)
  assert.equal((await r.as('keeper', 'stock.removeCountLine', { id: 'count', lineId: 'found' })).ok, true)
  assert.equal((await r.lines('count')).length, 3)

  // The count sheet saves as one grid: figures and dropped lines in one call, all or nothing.
  assert.equal((await add('again', { productId: r.serum, lotId: 'spare' })).ok, true)
  const first = String((await r.lines('count'))[0]!.id)
  const sheet = (removed: string[], lineId = first) =>
    r.as('keeper', 'stock.saveCountLines', { id: 'count', lines: [{ lineId, counted: '4' }], removed })
  assert.equal(r.key(await sheet(['again', 'nowhere'])), 'stock.error.countLineMissing')
  assert.equal(r.key(await sheet(['again'], 'again')), 'stock.error.countLineMissing')
  // Anything but a list of lines is refused by name, not failed on.
  const loose = await r.as('keeper', 'stock.saveCountLines', {
    id: 'count',
    lines: [],
    removed: { id: 'again' },
  })
  assert.equal(r.key(loose), 'stock.error.countLineMissing')
  // A grid draft the modal could not read arrives as null lines.
  const unread = await r.as('keeper', 'stock.saveCountLines', { id: 'count', lines: null })
  assert.equal(r.key(unread), 'stock.error.countQuantity')
  const counted = async () => new Map((await r.lines('count')).map((line) => [String(line.id), line.counted]))
  // Dropping lines through the sheet needs removeCountLine, as removing one does.
  const counter = (removed: string[]) =>
    r.as('counter', 'stock.saveCountLines', {
      id: 'count',
      lines: [{ lineId: first, counted: '3' }],
      removed,
    })
  assert.equal((await counter(['again'])).status, 403)
  assert.deepEqual([(await counted()).get(first), (await counted()).has('again')], [null, true])
  assert.deepEqual(await counter([]), { ok: true, id: 'count' })
  assert.equal((await counted()).get(first), '3')
  assert.deepEqual([(await counted()).get(first), (await counted()).get('again')], ['3', '1'])
  assert.deepEqual(await sheet(['again']), { ok: true, id: 'count' })
  assert.deepEqual([(await counted()).get(first), (await counted()).has('again')], ['4', false])

  assert.equal((await r.as('keeper', 'stock.cancelCountSession', { id: 'count', reason: 'x' })).status, 403)
  assert.equal(
    r.key(await r.as('manager', 'stock.cancelCountSession', { id: 'count', reason: '' })),
    'stock.error.countReason',
  )
  assert.equal(
    (await r.as('manager', 'stock.cancelCountSession', { id: 'count', reason: 'Sai kho' })).ok,
    true,
  )
  assert.equal(
    (await r.as('manager', 'stock.cancelCountSession', { id: 'count', reason: 'Sai kho' })).ok,
    true,
  )
  const cancelled = await r.session('count')
  assert.deepEqual(
    [cancelled.state, cancelled.cancelReason, cancelled.cancelledBy],
    ['cancel', 'Sai kho', 'manager'],
  )
  assert.equal(
    r.key(await r.call('stock.approveCountSession', { id: 'count' })),
    'stock.error.countNotReview',
  )
  assert.equal(
    r.key(
      await r.as('keeper', 'stock.addCountLine', {
        id: 'count',
        lineId: 'late',
        productId: r.productId,
        counted: '1',
      }),
    ),
    'stock.error.countNotCounting',
  )
  assert.equal(await r.onHand(r.productId), 10)
})

test('K36 a locked period refuses approval and a scrap alike, leaving stock and the count as they were', async (t) => {
  const r = await seed(t)
  await r.as('keeper', 'stock.startCountSession', { id: 'count', warehouseId: 'wh' })
  await r.countAll('keeper', 'count', ['9', '4', '2'])
  await r.as('keeper', 'stock.submitCountSession', { id: 'count' })
  await r.save('stock.saveScrap', {
    id: 'scrap',
    warehouseId: 'wh',
    productId: r.productId,
    quantity: '1',
    reason: 'damaged',
  })
  await r.save('account.changePeriodLock', {
    id: 'close-january',
    scope: 'all',
    through: '2030-01-31',
    reason: 'Close',
  })
  assert.equal(
    r.key(await r.as('manager', 'stock.approveCountSession', { id: 'count' })),
    'stock.error.valuationPeriodLocked',
  )
  assert.equal((await r.session('count')).state, 'review')
  assert.equal(
    r.key(await r.call('stock.validateScrap', { id: 'scrap' })),
    'stock.error.valuationPeriodLocked',
  )
  assert.equal((await r.call('stock.getScrap', { id: 'scrap' })).state, 'draft')
  assert.equal(await r.onHand(r.productId), 10)
})

test('K35 approval refuses a count below what a transfer has reserved', async (t) => {
  const r = await seed(t)
  await r.as('keeper', 'stock.startCountSession', { id: 'count', warehouseId: 'wh' })
  // A delivery reserves 3 of the 10 goods; the book itself does not change.
  await r.add({ productUomId: 'each', productUomQty: '3' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  const move = ((await r.call('stock.getPicking', { id: 'order:delivery' })).moves as Row[])[0]!
  await r.save('stock.reserveMove', { id: move.id })
  await r.countAll('keeper', 'count', ['2', '4', '2'])
  await r.as('keeper', 'stock.submitCountSession', { id: 'count' })
  const refused = await r.as('manager', 'stock.approveCountSession', { id: 'count' })
  assert.equal(r.key(refused), 'stock.error.countBelowReserved')
  assert.deepEqual(r.params(refused), { product: 'Goods' })
  assert.equal((await r.session('count')).state, 'review')
  assert.equal(await r.onHand(r.productId), 10)
})

test('K38 the counts screen lists those waiting for approval first, opens each in its modal and stays locked for sales', async (t) => {
  const r = await seed(t)
  await r.save('stock.saveWarehouse', { id: 'east', name: 'East', code: 'EA' })
  await r.save('stock.adjustInventory', {
    id: 'east-stock',
    productId: r.productId,
    locationId: 'east:stock',
    inventoryLocationId: 'count',
    countedQuantity: '2',
    productUomId: 'each',
  })
  await r.as('keeper', 'stock.startCountSession', { id: 'blind', warehouseId: 'wh' })
  await r.as('keeper', 'stock.startCountSession', { id: 'waiting', warehouseId: 'east', blind: false })
  await r.as('keeper', 'stock.saveCountLines', {
    id: 'waiting',
    lines: [{ lineId: (await r.lines('waiting'))[0]!.id, counted: '1', reasonCode: 'other' }],
  })
  await r.as('keeper', 'stock.submitCountSession', { id: 'waiting' })

  const page = await r.app.client.request('/admin/stock/counts?lang=en')
  assert.equal(page.status, 200)
  const markup = await page.text()
  assert.match(markup, /stock\.count-results/)
  assert.match(markup, /id="stock-counts-help"/)
  assert.match(markup, /record=stock\.countSession(%3A|:)new/)
  assert.match(markup, /data-island="stock\.count-session-modal"/)
  assert.match(markup, /href="\/admin\/stock\/counts/)
  const data = async (href: string, client = r.app.client) => {
    const response = await client.request('/admin/stock/counts/data?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ href }),
    })
    return response.status === 200 ? (await response.json()).value : response.status
  }
  const listed = await data('/admin/stock/counts?lang=en')
  assert.deepEqual(
    listed.rows.map((row: Row) => [row.name, row.warehouse, row.linesText, row.differingText, row.stateText]),
    [
      ['EA/KK/0001', 'East', '1', '1', 'Waiting for approval'],
      ['WH/KK/0001', 'Warehouse', '0/3', '—', 'Counting'],
    ],
  )
  assert.match(listed.rows[0].href, /record=stock\.countSession(%3A|:)waiting/)
  assert.equal((await data('/admin/stock/counts?lang=en&q=EA%2FKK')).rows.length, 1)
  assert.equal((await data('/admin/stock/counts?lang=en&warehouse=wh')).rows.length, 1)

  const context = async (path: string) => (await (await r.app.client.request(path)).json()).data
  for (const [lang, label] of [
    ['vi', 'Đếm sai kỳ trước'],
    ['en', 'Previous count error'],
  ]) {
    const envelope = await (
      await r.app.client.request(`/admin/stock/count-session/new/context?lang=${lang}`)
    ).json()
    assert.equal(envelope.messages['stock.countReason.previousCount'], label)
  }
  const fresh = await context('/admin/stock/count-session/new/context?lang=en')
  assert.deepEqual([fresh.record.state, fresh.permissions.startCountSession], ['new', true])
  const waiting = await context('/admin/stock/count-session/waiting/context?lang=en')
  assert.deepEqual(
    [waiting.record.name, waiting.record.state, waiting.permissions.approveCountSession],
    ['EA/KK/0001', 'review', true],
  )
  await r.call('stock.approveCountSession', { id: 'waiting' })
  const approved = await context('/admin/stock/count-session/waiting/context?lang=en')
  assert.match(approved.links.shortage, /^\/admin\/stock\/transfers\/waiting%3Ashortage\?/)
  assert.equal(approved.value.shortage, '₫1,000')
  assert.equal(approved.record.lines[0].value, '₫1,000')
  // A storekeeper reads the same count and its transfers, but not what they were worth.
  const keeper = await r.app.client.anonymous()
  await keeper.login({ login: 'keeper', password: 'test-password' })
  const counted = await keeper.request('/admin/stock/count-session/waiting/context?lang=en')
  assert.equal(counted.status, 200)
  const kept = (await counted.json()).data
  assert.match(kept.links.shortage, /^\/admin\/stock\/transfers\/waiting%3Ashortage\?/)
  assert.deepEqual([kept.value, kept.record.lines[0].value], [null, null])

  const seller = await r.app.client.anonymous()
  await seller.login({ login: 'seller', password: 'test-password' })
  assert.equal((await seller.request('/admin/stock/counts?lang=en')).status, 403)
  assert.equal(await data('/admin/stock/counts?lang=en', seller), 403)
  assert.equal((await seller.request('/admin/stock/count-session/waiting/context?lang=en')).status, 403)
  assert.equal((await r.as('seller', 'stock.listCountSessions', {})).status, 403)
})

test('K62 a partial count covers the products chosen, and two counts of a warehouse share no product', async (t) => {
  const r = await seed(t)
  await r.save('product.saveRecord', {
    id: 'idle',
    name: 'Idle',
    type: 'goods',
    defaultCode: 'IDLE',
    uomId: 'each',
    listPrice: '1',
    saleOk: true,
  })
  await r.save('stock.configureProduct', { templateId: 'idle', isStorable: true, tracking: 'none' })
  const idle = String(
    ((await r.call('product.listVariants', { templateId: 'idle' })) as unknown as Row[])[0]!.id,
  )
  await r.save('product.saveRecord', {
    id: 'fee',
    name: 'Fee',
    type: 'service',
    defaultCode: 'FEE',
    uomId: 'each',
    listPrice: '1',
    saleOk: true,
  })
  const fee = String(
    ((await r.call('product.listVariants', { templateId: 'fee' })) as unknown as Row[])[0]!.id,
  )

  const refused = async (id: string, productIds: unknown) =>
    r.as('keeper', 'stock.startCountSession', { id, warehouseId: 'wh', productIds })
  assert.equal(r.key(await refused('fee', [fee])), 'stock.error.countProductsInvalid')
  const empty = await refused('idle', [idle])
  assert.equal(r.key(empty), 'stock.error.countProductsEmpty')
  assert.equal(((empty.errors as Row[])[0] as Row).field, 'productIds')

  const serumOnly = await r.as('keeper', 'stock.startCountSession', {
    id: 'serum-count',
    warehouseId: 'wh',
    productIds: [r.serum, r.serum],
  })
  assert.deepEqual([serumOnly.ok, serumOnly.name], [true, 'WH/KK/0001'])
  const partial = await r.session('serum-count')
  assert.deepEqual(partial.productIds, [r.serum])
  assert.deepEqual(
    (partial.lines as Row[]).map((line) => line.lotId),
    ['soon', 'late'],
  )
  // Another product counts alongside.
  const goodsOnly = await r.as('keeper', 'stock.startCountSession', {
    id: 'goods-count',
    warehouseId: 'wh',
    productIds: [r.productId],
  })
  assert.equal(goodsOnly.ok, true)
  assert.deepEqual(
    (await r.lines('goods-count')).map((line) => line.productId),
    [r.productId],
  )
  const overlap = await refused('both', [r.productId, idle])
  assert.equal(r.key(overlap), 'stock.error.countOverlap')
  assert.deepEqual(r.params(overlap), { name: 'WH/KK/0002' })
  assert.equal(r.key(await refused('whole', undefined)), 'stock.error.countOverlap')
  const listed = (await r.call('stock.listCountSessions', {})) as unknown as Row[]
  assert.deepEqual(listed.map((row) => [row.id, row.productIds]).sort(), [
    ['goods-count', [r.productId]],
    ['serum-count', [r.serum]],
  ])

  // Found goods stay within the count's products.
  const outside = await r.as('keeper', 'stock.addCountLine', {
    id: 'serum-count',
    lineId: 'found',
    productId: r.productId,
    counted: '1',
  })
  assert.equal(r.key(outside), 'stock.error.countProductOutside')
  assert.deepEqual(r.params(outside), { product: 'Goods' })

  // A return takes in the new lots of the count's own products only.
  assert.equal((await r.countAll('keeper', 'serum-count', ['4', '2'])).ok, true)
  assert.equal((await r.countAll('keeper', 'goods-count', ['10'])).ok, true)
  for (const id of ['serum-count', 'goods-count'])
    assert.equal((await r.as('keeper', 'stock.submitCountSession', { id })).ok, true)
  await r.save('stock.createLot', { id: 'fresh', productId: r.serum, name: 'FRESH' })
  await r.book('fresh-opening', r.serum, '1', 'fresh')
  for (const id of ['serum-count', 'goods-count'])
    assert.equal((await r.as('manager', 'stock.returnCountSession', { id, reason: 'Recount' })).ok, true)
  assert.deepEqual(
    (await r.lines('serum-count')).map((line) => line.lotId),
    ['soon', 'late', 'fresh'],
  )
  assert.deepEqual(
    (await r.lines('goods-count')).map((line) => line.productId),
    [r.productId],
  )

  // The counts list says which counts are partial.
  const owner = r.app.client.anonymous()
  await owner.login({ login: 'manager', password: 'test-password' })
  const response = await owner.request('/admin/stock/counts/data?lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ href: '/admin/stock/counts?lang=en' }),
  })
  const data = ((await response.json()) as Row).value as Row
  assert.deepEqual(((data.rows as Row[]) ?? []).map((row) => row.scopeText).sort(), [
    '1 products',
    '1 products',
  ])
})

test('K62 a warehouse on a cycle falls due its frequency after the last full count, in the company day', async (t) => {
  const r = await seed(t)
  // A month on, the morning's sessions have expired: the manager signs in afresh to read.
  let manager = r.app.client.anonymous()
  const signIn = async () => {
    manager = r.app.client.anonymous()
    await manager.login({ login: 'manager', password: 'test-password' })
  }
  await signIn()
  const asManager = async (fn: string, body: Row) => {
    const response = await manager.request(`/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    assert.equal(response.status, 200)
    const answer = (await response.json()) as Row
    return (answer.value ?? answer) as Row
  }
  const cycle = async () =>
    ((await asManager('stock.listCountCycles', { warehouseId: 'wh' })) as unknown as Row[])[0]!
  /** The overview page without its Help drawer, which names the same things. */
  const overview = async () => {
    const page = await (await manager.request('/admin/stock?lang=vi')).text()
    assert.ok(page.includes('id="stock-overview-help"'))
    return page.slice(0, page.indexOf('id="stock-overview-help"'))
  }
  const warehouse = { id: 'wh', name: 'Warehouse', code: 'WH' }
  assert.deepEqual(
    [(await cycle()).countFrequencyDays, (await cycle()).nextCountDate, (await cycle()).countDue],
    [0, null, false],
  )
  for (const countFrequencyDays of [366, -1]) {
    const refused = await r.call('stock.saveWarehouse', { ...warehouse, countFrequencyDays })
    assert.equal(r.key(refused), 'stock.error.countFrequency')
    assert.deepEqual(r.params(refused), { max: 365 })
  }
  await r.save('stock.saveWarehouse', { ...warehouse, countFrequencyDays: 30 })
  // Saving without a frequency keeps it.
  await r.save('stock.saveWarehouse', { ...warehouse, name: 'Main' })
  // Never counted in full: due today.
  assert.deepEqual(
    [(await cycle()).countFrequencyDays, (await cycle()).lastCountDate, (await cycle()).nextCountDate],
    [30, null, '2030-01-31'],
  )
  assert.equal((await cycle()).countDue, true)

  assert.equal((await r.as('keeper', 'stock.startCountSession', { id: 'full', warehouseId: 'wh' })).ok, true)
  assert.deepEqual(
    [(await cycle()).countDue, (await cycle()).countingId, (await cycle()).countingName],
    [false, 'full', 'WH/KK/0001'],
  )
  assert.equal((await r.countAll('keeper', 'full', ['10', '4', '2'])).ok, true)
  assert.equal((await r.as('keeper', 'stock.submitCountSession', { id: 'full' })).ok, true)
  // 18:00 UTC is already 1 February in Ho Chi Minh City, where the company keeps its books.
  t.mock.timers.setTime(Date.parse('2030-01-31T18:00:00.000Z'))
  assert.equal((await r.as('manager', 'stock.approveCountSession', { id: 'full' })).ok, true)
  assert.deepEqual(
    [(await cycle()).lastCountDate, (await cycle()).nextCountDate, (await cycle()).countDue],
    ['2030-02-01', '2030-03-03', false],
  )

  // A partial count neither moves the date nor keeps a due warehouse from being reported.
  assert.equal(
    (
      await r.as('keeper', 'stock.startCountSession', {
        id: 'part',
        warehouseId: 'wh',
        productIds: [r.serum],
      })
    ).ok,
    true,
  )
  assert.equal((await r.countAll('keeper', 'part', ['4', '2'])).ok, true)
  assert.equal((await r.as('keeper', 'stock.submitCountSession', { id: 'part' })).ok, true)
  t.mock.timers.setTime(Date.parse('2030-03-02T16:59:00.000Z'))
  await signIn()
  assert.equal((await cycle()).countDue, false)
  assert.doesNotMatch(await overview(), /Đến hạn</)
  t.mock.timers.setTime(Date.parse('2030-03-02T17:00:00.000Z'))
  assert.deepEqual([(await cycle()).countDue, (await cycle()).countingId], [true, null])
  assert.equal((await asManager('stock.approveCountSession', { id: 'part' })).ok, true)
  assert.equal((await cycle()).lastCountDate, '2030-02-01')

  // The overview reports it; 0 takes the warehouse off the cycle.
  const due = await overview()
  assert.match(due, /Kiểm kê theo chu kỳ/)
  assert.match(due, /Kho đến hạn kiểm kê[\s\S]*?>1</)
  assert.match(due, /Đến hạn</)
  await asManager('stock.saveWarehouse', { ...warehouse, countFrequencyDays: 0 })
  assert.deepEqual(
    [(await cycle()).countFrequencyDays, (await cycle()).nextCountDate, (await cycle()).countDue],
    [0, null, false],
  )
  assert.doesNotMatch(await overview(), /Kiểm kê theo chu kỳ|Kho đến hạn kiểm kê/)
  // Whoever may not read counts never meets the cycle.
  assert.equal((await r.as('seller', 'stock.listCountCycles', {})).status, 403)
})

test('2014 single-product adjustment never bypasses approval and differing lines require a fixed reason', async (t) => {
  const r = await seed(t)
  const input = {
    id: 'controlled',
    productId: r.productId,
    locationId: 'wh:stock',
    countedQuantity: '8',
    reason: 'Legacy note',
  }
  assert.equal(
    (
      await r.as('keeper', 'stock.adjustInventory', {
        id: 'bypass',
        productId: r.productId,
        locationId: 'wh:stock',
        inventoryLocationId: 'count',
        countedQuantity: '8',
        productUomId: 'each',
      })
    ).status,
    403,
  )
  assert.equal((await r.as('keeper', 'stock.requestInventoryCount', input)).ok, true)
  assert.equal(await r.onHand(r.productId), 10)
  const session = await r.session('controlled')
  assert.equal(session.state, 'counting')
  assert.equal(session.blind, true)
  assert.equal((session.lines as Row[]).length, 1)
  assert.equal((session.lines as Row[])[0].reason, 'Legacy note')
  assert.equal(
    r.key(await r.as('keeper', 'stock.submitCountSession', { id: 'controlled' })),
    'stock.error.countDifferenceReason',
  )
  assert.equal((await r.as('keeper', 'stock.requestInventoryCount', input)).ok, true)
  assert.equal(
    r.key(await r.as('keeper', 'stock.requestInventoryCount', { ...input, id: 'overlap' })),
    'stock.error.countOverlap',
  )
  assert.equal((await r.countAll('keeper', 'controlled', ['8'])).ok, true)
  assert.equal((await r.as('keeper', 'stock.submitCountSession', { id: 'controlled' })).ok, true)
  assert.equal(await r.onHand(r.productId), 10)
  assert.equal((await r.as('manager', 'stock.approveCountSession', { id: 'controlled' })).ok, true)
  assert.equal(await r.onHand(r.productId), 8)
})

test('2014 settlement posts historical differences once, rejects locked periods and tracks partial settlement', async (t) => {
  const r = await seed(t)
  await r.save('account.saveAccount', {
    id: '711',
    code: '711',
    name: 'Other income',
    accountType: 'income_other',
    reconcile: false,
  })
  await r.as('keeper', 'stock.startCountSession', { id: 'settle', warehouseId: 'wh', blind: false })
  const early = { id: 'settle-command', sessionId: 'settle', accountingDate: '2030-02-01', lines: [] }
  assert.equal(
    r.key(await r.as('accountant', 'stock.settleCountDifference', early)),
    'stock.error.countSettlementDone',
  )
  await r.countAll('keeper', 'settle', ['8', '3', '5'])
  await r.as('keeper', 'stock.submitCountSession', { id: 'settle' })
  assert.equal((await r.as('manager', 'stock.approveCountSession', { id: 'settle' })).ok, true)
  const lines = await r.lines('settle')
  const shortage = lines.find((line) => Number(line.difference) < 0)!
  const request = { ...early, lines: [{ lineId: shortage.id, method: '632' }] }
  assert.equal((await r.session('settle')).settlementState, 'pending')
  await r.save('account.createClosePeriod', {
    id: 'count-close',
    periodKey: '2030-02',
    dateFrom: '2030-02-01',
    dateTo: '2030-02-28',
  })
  const closePage = await (
    await r.app.client.request('/admin/accounting/period-closes/count-close?lang=vi')
  ).text()
  assert.ok(closePage.includes('13811/33811 còn số dư từ kiểm kê'))
  assert.ok(closePage.includes('stock.countSession%3Asettle'))

  assert.equal(
    ((await r.call('stock.getCountSettlementWarning', { dateTo: '2030-02-01' })) as unknown as Row[]).some(
      (row) => row.id === 'settle',
    ),
    true,
  )
  assert.equal((await r.as('keeper', 'stock.settleCountDifference', request)).status, 403)
  assert.equal((await r.as('accountant', 'stock.settleCountDifference', request)).ok, true)
  assert.equal((await r.session('settle')).settlementState, 'partial')
  assert.equal((await r.as('accountant', 'stock.settleCountDifference', request)).ok, true)
  assert.equal(
    r.key(
      await r.as('accountant', 'stock.settleCountDifference', { ...request, accountingDate: '2030-02-02' }),
    ),
    'stock.error.countSettlementReplay',
  )
  assert.equal(
    r.key(await r.as('accountant', 'stock.settleCountDifference', { ...request, id: 'duplicate' })),
    'stock.error.countSettlementLines',
  )
  const entries = await r.app.adapter!.all(
    sql('SELECT "accountId", debit, credit FROM account_move_line WHERE "moveId" = ? ORDER BY sequence'),
    ['count-settlement:settle-command'],
  )
  assert.deepEqual(
    entries.map((row) => [row.accountId, Number(row.debit), Number(row.credit)]),
    [
      ['632', 2000, 0],
      ['13811', 0, 2000],
    ],
  )
  const remaining = lines
    .filter((line) => line.id !== shortage.id && Number(line.difference) !== 0)
    .map((line) => ({ lineId: line.id, method: Number(line.difference) > 0 ? '711' : '632' }))
  await r.app.adapter!.run(sql('UPDATE account_period_policy SET "hardThrough" = ? WHERE id = ?'), [
    '2030-02-01',
    'policy',
  ])
  const next = { ...early, id: 'settle-rest', lines: remaining }
  assert.equal(
    r.key(await r.as('accountant', 'stock.settleCountDifference', next)),
    'stock.error.valuationPeriodLocked',
  )
  assert.equal((await r.session('settle')).settlementState, 'partial')
  assert.equal(
    (await r.as('accountant', 'stock.settleCountDifference', { ...next, accountingDate: '2030-02-02' })).ok,
    true,
  )
  assert.equal((await r.session('settle')).settlementState, 'done')
  assert.equal(
    ((await r.call('stock.getCountSettlementWarning', { dateTo: '2030-02-02' })) as unknown as Row[]).some(
      (row) => row.id === 'settle',
    ),
    false,
  )
  assert.equal(
    ((await r.call('stock.getCountSettlementWarning', { dateTo: '2030-02-01' })) as unknown as Row[]).some(
      (row) => row.id === 'settle',
    ),
    true,
  )
})

test('2014 compensation requires a person and posts 1388, 334 and 811 against the count suspense account', async (t) => {
  const r = await seed(t)
  await r.save('partner.savePartner', { id: 'responsible', name: 'Person', kind: 'person' })
  await r.save('partner.savePartner', { id: 'organization', name: 'Organization', kind: 'company' })
  for (const [index, method] of ['1388', '334', '811'].entries()) {
    await r.save('account.saveAccount', {
      id: method,
      code: method,
      name: method,
      accountType: method === '334' ? 'liability_current' : method === '811' ? 'expense' : 'asset_receivable',
      reconcile: method !== '811',
    })
    const id = `comp-${method}`
    await r.as('keeper', 'stock.startCountSession', { id, warehouseId: 'wh', productIds: [r.productId] })
    await r.countAll('keeper', id, [String(9 - index)])
    await r.as('keeper', 'stock.submitCountSession', { id })
    await r.as('manager', 'stock.approveCountSession', { id })
    const line = (await r.lines(id))[0]!
    const request = {
      id: `${id}-command`,
      sessionId: id,
      accountingDate: '2030-02-01',
      lines: [{ lineId: line.id, method }],
    }
    if (method !== '811') {
      assert.equal(
        r.key(await r.as('accountant', 'stock.settleCountDifference', request)),
        'stock.error.countSettlementPerson',
      )
      assert.equal(
        r.key(
          await r.as('accountant', 'stock.settleCountDifference', {
            ...request,
            lines: [{ ...request.lines[0], partnerId: 'organization' }],
          }),
        ),
        'stock.error.countSettlementPerson',
      )
    }
    const lines = [{ ...request.lines[0], ...(method !== '811' ? { partnerId: 'responsible' } : {}) }]
    assert.equal((await r.as('accountant', 'stock.settleCountDifference', { ...request, lines })).ok, true)
    const entry = await r.app.adapter!.all(
      sql(
        'SELECT "accountId", "partnerId", debit, credit FROM account_move_line WHERE "moveId" = ? ORDER BY sequence',
      ),
      [`count-settlement:${id}-command`],
    )
    assert.deepEqual(
      entry.map((row) => [row.accountId, row.partnerId, Number(row.debit), Number(row.credit)]),
      [
        [method, method !== '811' ? 'responsible' : null, 1000, 0],
        ['13811', null, 0, 1000],
      ],
    )
  }
})

test('05-VT freezes approved values, protects values and validates committee and quality totals', async (t) => {
  const r = await seed(t)
  await r.save('stock.startCountSession', { id: 'minutes', warehouseId: 'wh', productIds: [r.productId] })
  const line = (await r.lines('minutes'))[0]!
  const input = {
    id: 'minutes',
    lines: [
      {
        lineId: line.id,
        counted: '8',
        qualityGood: '6',
        qualityPoor: '1',
        qualityLost: '1',
        reasonCode: 'damaged',
      },
    ],
  }
  assert.equal(
    r.key(
      await r.as('keeper', 'stock.saveCountLines', {
        ...input,
        lines: [{ ...input.lines[0], qualityGood: '7' }],
      }),
    ),
    'stock.error.countQualityTotal',
  )
  assert.equal(
    r.key(
      await r.as('keeper', 'stock.saveCountLines', {
        ...input,
        lines: [{ ...input.lines[0], qualityLost: '-1', qualityGood: '8' }],
      }),
    ),
    'stock.error.countQualityTotal',
  )
  assert.equal((await r.as('keeper', 'stock.saveCountLines', input)).ok, true)
  assert.equal(
    r.key(await r.as('keeper', 'stock.saveCountDetails', { id: 'minutes', committee: [null] })),
    'stock.error.countCommittee',
  )
  assert.equal(
    r.key(
      await r.as('keeper', 'stock.saveCountDetails', { id: 'minutes', committee: [{ name: 'Counter' }] }),
    ),
    'stock.error.countCommittee',
  )
  const committee = [{ id: 'chair', name: 'Nguyen An', title: 'Warehouse manager', role: 'Chair' }]
  assert.equal(
    (
      await r.as('keeper', 'stock.saveCountDetails', {
        id: 'minutes',
        committee,
        resolution: 'Investigate damaged goods',
      })
    ).ok,
    true,
  )
  assert.equal(await r.call('stock.getCountReport', { id: 'minutes' }), null)
  assert.equal((await r.as('keeper', 'stock.submitCountSession', { id: 'minutes' })).ok, true)
  assert.equal(
    r.key(await r.as('keeper', 'stock.saveCountDetails', { id: 'minutes', committee: [] })),
    'stock.error.countNotCounting',
  )
  assert.equal((await r.as('manager', 'stock.approveCountSession', { id: 'minutes' })).ok, true)
  const plain = await r.as('keeper', 'stock.getCountReport', { id: 'minutes' })
  assert.equal(plain.valued, false)
  assert.deepEqual(plain.committee, committee)
  assert.equal(plain.resolution, 'Investigate damaged goods')
  const row = (plain.lines as Row[])[0]!
  assert.deepEqual([Number(row.qualityGood), Number(row.qualityPoor), Number(row.qualityLost)], [6, 1, 1])
  assert.equal(Object.hasOwn(row, 'bookValue'), false)
  assert.equal(Object.hasOwn((await r.lines('minutes'))[0]!, 'countBookValue'), false)
  assert.equal((await r.as('keeper', 'stock.getValuedCountReport', { id: 'minutes' })).status, 403)
  const valued = await r.as('accountant', 'stock.getValuedCountReport', { id: 'minutes' })
  const worth = (valued.lines as Row[])[0]!
  assert.deepEqual(
    [Number(worth.bookValue), Number(worth.physicalValue), Number(worth.differenceValue)],
    [10000, 8000, -2000],
  )
  // Simulate a later valuation update without changing the approved count.
  await r.app.adapter!.run(sql('UPDATE product_cost SET "standardPrice" = ? WHERE "productId" = ?'), [
    '9999',
    r.productId,
  ])
  assert.deepEqual(
    (await r.as('accountant', 'stock.getValuedCountReport', { id: 'minutes' })).lines,
    valued.lines,
  )
})
