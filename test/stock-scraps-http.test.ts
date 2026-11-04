import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { setup } from './fixtures/sale/commerce.ts'

// PostgreSQL numbers its placeholders; SQLite takes `?`.
const sql = (text: string) => {
  let n = 0
  return process.env.KET_COMMERCE_PG ? text.replace(/\?/g, () => `$${++n}`) : text
}

/** Ten goods counted at 1,000 each in a warehouse that posts its stock journal. */
async function seed(t: TestContext, tracking: 'none' | 'lot' = 'none') {
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
  await r.save('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking })
  await r.save('product.setCost', { productId: r.productId, standardPrice: '1000' })
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
  const count = (id: string, countedQuantity: string, lotId?: string) =>
    r.save('stock.adjustInventory', {
      id,
      productId: r.productId,
      locationId: 'wh:stock',
      inventoryLocationId: 'count',
      countedQuantity,
      productUomId: 'each',
      ...(lotId ? { lotId } : {}),
    })
  const key = (result: Row) => ((result.errors as Row[] | undefined)?.[0] as Row | undefined)?.messageKey
  const draft = (id: string, input: Row = {}) =>
    r.call('stock.saveScrap', {
      id,
      warehouseId: 'wh',
      productId: r.productId,
      quantity: '3',
      reason: 'damaged',
      ...input,
    })
  const scrap = async (id: string) => (await r.call('stock.getScrap', { id })) as Row
  const held = async () => {
    const [row] = await r.app.adapter!.all(sql(`SELECT quantity, value FROM stock_product_valuation`))
    return [String(Number(row!.quantity)), String(Number(row!.value))]
  }
  const onHand = async (locationId: string) => {
    const quants = (await r.call('stock.listQuants', {
      productId: r.productId,
      locationId,
    })) as unknown as Row[]
    return quants.reduce((sum, row) => sum + Number(row.quantity), 0)
  }
  const entry = async (moveId: string) =>
    (
      await r.app.adapter!.all(
        sql(`SELECT "accountId", debit, credit FROM account_move_line WHERE "moveId" = ? ORDER BY sequence`),
        [moveId],
      )
    ).map((row) => [row.accountId, Number(row.debit), Number(row.credit)])
  return { ...r, count, key, draft, scrap, held, onHand, entry }
}

test('K59 a validated scrap order takes its goods to the scrap location at cost, and undoing it brings them back at that value', async (t) => {
  const r = await seed(t)
  await r.count('opening', '10')
  assert.deepEqual(await r.draft('first'), { ok: true, id: 'first' })
  const first = await r.scrap('first')
  assert.deepEqual(
    [first.name, first.state, first.locationId, first.held, first.ruleReady],
    ['WH/HH/0001', 'draft', 'wh:stock', '10', false],
  )
  assert.equal((await r.draft('second', { quantity: '1' })).ok, true)
  assert.equal((await r.scrap('second')).name, 'WH/HH/0002')
  assert.equal(r.key(await r.draft('nothing', { quantity: '0' })), 'stock.error.scrapQuantity')
  assert.equal(r.key(await r.draft('why', { reason: 'bored' })), 'stock.error.scrapReason')
  assert.equal(r.key(await r.draft('where', { warehouseId: 'nowhere' })), 'stock.error.scrapWarehouse')
  assert.equal(r.key(await r.draft('unplaced', { warehouseId: undefined })), 'stock.error.scrapWarehouse')

  // More than the warehouse holds stays a draft.
  assert.equal((await r.draft('first', { quantity: '11' })).ok, true)
  assert.equal(r.key(await r.call('stock.validateScrap', { id: 'first' })), 'stock.error.scrapExceedsHeld')
  assert.equal((await r.scrap('first')).state, 'draft')
  assert.equal((await r.draft('first', { quantity: '3' })).ok, true)

  assert.deepEqual(await r.call('stock.validateScrap', { id: 'first' }), { ok: true, id: 'first' })
  const done = await r.scrap('first')
  assert.deepEqual([done.state, done.operationId, done.held], ['done', 'first:scrap', null])
  assert.deepEqual([await r.onHand('wh:stock'), await r.onHand('wh:scrap')], [7, 3])
  assert.deepEqual(await r.held(), ['7', '7000'])
  assert.deepEqual(await r.entry('stock-valuation:first:scrap'), [
    ['632', 3000, 0],
    ['156', 0, 3000],
  ])
  const operation = await r.call('stock.getPicking', { id: 'first:scrap' })
  assert.deepEqual(
    [operation.name, operation.state, operation.locationDestId],
    ['WH/HH/0001', 'done', 'wh:scrap'],
  )
  // The line names the goods, and the hidden scrap type still reads as a name.
  assert.deepEqual(
    [operation.pickingTypeName, (operation.moves as Row[]).map((move) => move.name)],
    ['Scrap', ['Goods']],
  )
  // A replay answers the same order; a validated order is no longer a draft.
  assert.deepEqual(await r.call('stock.validateScrap', { id: 'first' }), { ok: true, id: 'first' })
  assert.equal(r.key(await r.draft('first')), 'stock.error.scrapNotDraft')
  assert.equal(r.key(await r.call('stock.cancelScrap', { id: 'first' })), 'stock.error.scrapNotDraft')

  // A dearer receipt moves the average before the scrap is undone; the goods come back at what they left at.
  await r.save('stock.createPicking', { id: 'dear', name: 'dear', pickingTypeId: 'wh:incoming' })
  await r.save('stock.addMove', {
    id: 'dear-move',
    pickingId: 'dear',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '5',
  })
  await r.save('stock.confirmPicking', { id: 'dear' })
  await r.save('stock.saveMoveLine', { id: 'dear-line', moveId: 'dear-move', quantity: '5' })
  await r.save('stock.setReceiptUnitCost', { id: 'dear-line', unitCost: '2000' })
  assert.equal((await r.call('stock.completePicking', { id: 'dear', createBackorder: false })).ok, true)
  assert.deepEqual(await r.held(), ['12', '17000'])
  assert.equal(
    r.key(await r.call('stock.undoScrap', { id: 'first', reason: ' ' })),
    'stock.error.scrapUndoReason',
  )
  assert.deepEqual(await r.call('stock.undoScrap', { id: 'first', reason: 'Counted wrong' }), {
    ok: true,
    id: 'first',
  })
  const undone = await r.scrap('first')
  assert.deepEqual(
    [undone.state, undone.undoId, undone.undoReason],
    ['reversed', 'first:undo', 'Counted wrong'],
  )
  assert.deepEqual([await r.onHand('wh:stock'), await r.onHand('wh:scrap')], [15, 0])
  assert.deepEqual(await r.held(), ['15', '20000'])
  assert.deepEqual(await r.entry('stock-valuation:first:undo'), [
    ['156', 3000, 0],
    ['632', 0, 3000],
  ])
  assert.deepEqual(await r.call('stock.undoScrap', { id: 'first', reason: 'again' }), {
    ok: true,
    id: 'first',
  })
  assert.equal(
    r.key(await r.call('stock.undoScrap', { id: 'second', reason: 'x' })),
    'stock.error.scrapNotDone',
  )

  // Cancelling a draft leaves the goods where they are.
  assert.deepEqual(await r.call('stock.cancelScrap', { id: 'second' }), { ok: true, id: 'second' })
  assert.equal((await r.scrap('second')).state, 'cancel')
  assert.equal(r.key(await r.call('stock.validateScrap', { id: 'second' })), 'stock.error.scrapNotDraft')
})

test('K59 a scrap takes only goods no transfer holds, and one opened from a transfer scraps from where it takes them', async (t) => {
  const r = await seed(t)
  await r.count('opening', '10')
  await r.add({ productUomId: 'each', productUomQty: '3' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  const move = ((await r.call('stock.getPicking', { id: 'order:delivery' })).moves as Row[])[0]!
  await r.save('stock.reserveMove', { id: move.id })

  const source = await r.call('stock.getScrapSource', { pickingId: 'order:delivery' })
  assert.deepEqual(
    [source.warehouseId, source.locationId, source.products],
    ['wh', 'wh:stock', [r.productId]],
  )
  assert.equal(await r.call('stock.getScrapSource', { pickingId: 'opening:picking' }), null)
  assert.equal(
    (
      await r.call('stock.saveScrap', {
        id: 'from-delivery',
        pickingId: 'order:delivery',
        productId: r.productId,
        quantity: '8',
        reason: 'lost',
      })
    ).ok,
    true,
  )
  const opened = await r.scrap('from-delivery')
  assert.deepEqual(
    [opened.warehouseId, opened.locationId, opened.pickingId, opened.held],
    ['wh', 'wh:stock', 'order:delivery', '7'],
  )
  assert.equal(
    r.key(await r.call('stock.validateScrap', { id: 'from-delivery' })),
    'stock.error.scrapExceedsHeld',
  )
  assert.equal((await r.draft('from-delivery', { quantity: '7' })).ok, true)
  assert.equal((await r.call('stock.validateScrap', { id: 'from-delivery' })).ok, true)
  assert.equal(await r.onHand('wh:stock'), 3)
  assert.equal(
    r.key(
      await r.call('stock.saveScrap', {
        id: 'from-count',
        pickingId: 'opening:picking',
        productId: r.productId,
        quantity: '1',
        reason: 'lost',
      }),
    ),
    'stock.error.scrapPicking',
  )
  // The scrap transfer itself is not a source of another scrap.
  assert.equal(await r.call('stock.getScrapSource', { pickingId: 'from-delivery:scrap' }), null)
})

test('K37 scrapping a lot from its page validates at once, suggests the reason from the lot and keeps it in the history', async (t) => {
  const r = await seed(t, 'lot')
  await r.save('stock.createLot', {
    id: 'old',
    productId: r.productId,
    name: 'OLD-1',
    expirationDate: '2030-01-01T00:00:00.000Z',
  })
  await r.save('stock.createLot', { id: 'fresh', productId: r.productId, name: 'FRESH-1' })
  await r.count('old-count', '4', 'old')
  await r.count('fresh-count', '6', 'fresh')
  const scrapLot = (id: string, input: Row = {}) =>
    r.call('stock.scrapLot', { id, lotId: 'old', warehouseId: 'wh', note: 'Mould on the cartons', ...input })
  assert.equal(r.key(await scrapLot('blank', { note: '  ' })), 'stock.error.scrapNote')
  assert.equal(r.key(await scrapLot('too-many', { quantity: '5' })), 'stock.error.scrapExceedsHeld')
  assert.deepEqual(await scrapLot('lot-scrap'), { ok: true, id: 'lot-scrap' })
  const scrap = await r.scrap('lot-scrap')
  assert.deepEqual(
    [scrap.state, scrap.quantity, scrap.reason, scrap.lotId, scrap.note, scrap.name],
    ['done', '4', 'expired', 'old', 'Mould on the cartons', 'WH/HH/0001'],
  )
  assert.equal(await r.onHand('wh:scrap'), 4)
  assert.deepEqual(await scrapLot('lot-scrap'), { ok: true, id: 'lot-scrap' })
  assert.equal(r.key(await scrapLot('lot-scrap', { lotId: 'fresh' })), 'stock.error.scrapIdTaken')
  assert.equal(r.key(await scrapLot('empty')), 'stock.error.scrapNothingHeld')
  // A fresh lot suggests damage; a quantity takes only part of it.
  assert.equal((await scrapLot('part', { lotId: 'fresh', quantity: '2' })).ok, true)
  assert.deepEqual([(await r.scrap('part')).reason, (await r.scrap('part')).quantity], ['damaged', '2'])
  const history = (await r.call('stock.listLotHistory', { lotId: 'old' })) as unknown as Row[]
  const kept = history.find((row) => row.reason === 'scrap')!
  assert.deepEqual(
    [(kept.after as Row).scrap, (kept.after as Row).quantity, (kept.after as Row).note],
    ['WH/HH/0001', '4', 'Mould on the cartons'],
  )
  // A lot-tracked draft needs a lot of its product.
  assert.equal(r.key(await r.draft('no-lot')), 'stock.error.scrapLot')
  assert.equal((await r.draft('with-lot', { lotId: 'fresh' })).ok, true)
  assert.equal((await r.call('stock.undoScrap', { id: 'lot-scrap', reason: 'Wrong lot' })).ok, true)
  assert.ok(
    ((await r.call('stock.listLotHistory', { lotId: 'old' })) as unknown as Row[]).some(
      (row) => row.reason === 'scrapUndo',
    ),
  )
  // The lot's page offers scrapping to whoever may scrap a lot.
  const lotPage = (await (await r.app.client.request('/admin/stock/record/lot/fresh/context?lang=en')).json())
    .data
  assert.equal(lotPage.scrapLot, true)
  assert.deepEqual(
    lotPage.choices.warehouses.map((row: Row) => row.id),
    ['wh'],
  )
})

test('K59 replenishing orders the scrapped quantity again by the product rule, and only managers validate', async (t) => {
  const r = await seed(t)
  await r.count('opening', '10')
  assert.equal((await r.draft('ask', { replenish: true })).ok, true)
  assert.equal(r.key(await r.call('stock.validateScrap', { id: 'ask' })), 'stock.error.scrapNoRule')
  assert.equal((await r.scrap('ask')).state, 'draft')
  await r.save('partner.savePartner', { id: 'east', name: 'East', kind: 'company' })
  await r.save('purchase.saveSupplierInfo', {
    id: 'east-goods',
    partnerId: 'east',
    productTemplateId: 'goods',
    productUomId: 'each',
    minQty: '1',
    price: '900',
    delay: 2,
    sequence: 1,
  })
  await r.save('stock.saveOrderpoint', {
    id: 'rule',
    productId: r.productId,
    warehouseId: 'wh',
    locationId: 'wh:stock',
    trigger: 'manual',
    minQuantity: '1',
    maxQuantity: '20',
    replenishmentUomId: 'each',
    source: 'supplier',
    vendorId: null,
    leadDays: null,
  })
  assert.equal((await r.scrap('ask')).ruleReady, true)
  assert.deepEqual(await r.call('stock.validateScrap', { id: 'ask' }), { ok: true, id: 'ask' })
  // #1737: the supplier rule asks the vendor for a quotation, which the scrap keeps.
  const replenished = await r.scrap('ask')
  assert.equal(replenished.replenishmentPickingId, null)
  assert.ok(replenished.replenishmentOrderId)
  const rfq = await r.call('purchase.getOrder', { id: replenished.replenishmentOrderId })
  assert.deepEqual([rfq.state, rfq.partnerId, (rfq.lines as Row[])[0]!.productQty], ['draft', 'east', '3'])
  const links = async (client = r.app.client) =>
    (await (await client.request('/admin/stock/scrap/ask/context?lang=en')).json()).data.links
  assert.match((await links()).replenishment, /^\/admin\/purchase\/rfqs\/[^?]+\?/)

  await r.fixture('user.saveRole', { id: 'keeper', name: 'Keeper' })
  await r.fixture('user.createUser', {
    id: 'keeper',
    login: 'keeper',
    password: 'test-password',
    name: 'Keeper',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'keeper-company', userId: 'keeper', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'keeper-role', userId: 'keeper', roleId: 'keeper' })
  for (const fnKey of ['stock.saveScrap', 'stock.getScrap', 'stock.listScraps', 'stock.cancelScrap'])
    await r.fixture('user.grantFunction', { id: fnKey, roleId: 'keeper', fnKey })
  const keeper = r.app.client.anonymous()
  await keeper.login({ login: 'keeper', password: 'test-password' })
  // A keeper who may not read purchase orders sees that it was replenished, but no link into Purchase.
  assert.equal((await links(keeper)).replenishment, null)
  const post = (fn: string, body: Row) =>
    keeper.request(`/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const drafted = await post('stock.saveScrap', {
    id: 'kept',
    warehouseId: 'wh',
    productId: r.productId,
    quantity: '1',
    reason: 'damaged',
  })
  assert.equal(drafted.status, 200)
  for (const [fn, body] of [
    ['stock.validateScrap', { id: 'kept' }],
    ['stock.undoScrap', { id: 'ask', reason: 'x' }],
    ['stock.scrapLot', { id: 'sneaky', lotId: 'none', warehouseId: 'wh', note: 'x' }],
  ] as const)
    assert.equal((await post(fn, body)).status, 403, fn)
})

test('K59 the scrap orders screen lists drafts first, opens each order in its modal and stays locked without the right', async (t) => {
  const r = await seed(t)
  await r.count('opening', '10')
  await r.add({ productUomId: 'each', productUomQty: '3' })
  await r.save('sale.confirmOrder', { id: 'order' })
  await r.save('stock.confirmPicking', { id: 'order:delivery' })
  // The draft has the older number: the queue, not the number, puts it first.
  assert.equal((await r.draft('newer', { quantity: '2', reason: 'lost' })).ok, true)
  assert.equal((await r.draft('older', { quantity: '1' })).ok, true)
  assert.equal((await r.call('stock.validateScrap', { id: 'older' })).ok, true)

  const page = await r.app.client.request('/admin/stock/scraps?lang=en')
  assert.equal(page.status, 200)
  const markup = await page.text()
  assert.match(markup, /stock\.scrap-results/)
  assert.match(markup, /stock-scrap-help/)
  // The record modal mounts from the backend runtime slot; without it a row link opens nothing.
  assert.match(markup, /data-island="stock\.scrap-modal"/)
  assert.match(markup, /record=stock\.scrap(%3A|:)new/)
  const data = async (href: string) => {
    const response = await r.app.client.request('/admin/stock/scraps/data?lang=en', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ href }),
    })
    return (await response.json()).value
  }
  const listed = await data('/admin/stock/scraps?lang=en')
  assert.deepEqual(
    listed.rows.map((row: Row) => [row.name, row.stateText, row.reasonText, row.warehouse]),
    [
      ['WH/HH/0001', 'Draft', 'Lost', 'Warehouse'],
      ['WH/HH/0002', 'Done', 'Damaged', 'Warehouse'],
    ],
  )
  assert.match(listed.rows[0].href, /record=stock\.scrap(%3A|:)newer/)
  assert.equal((await data('/admin/stock/scraps?lang=en&q=HH%2F0002')).rows.length, 1)
  assert.equal((await data('/admin/stock/scraps?lang=en&warehouse=elsewhere')).rows.length, 0)

  const context = async (path: string, client = r.app.client) =>
    (await (await client.request(path)).json()).data
  const fromDelivery = await context('/admin/stock/scrap/new/context?lang=en&picking=order%3Adelivery')
  assert.deepEqual(
    [fromDelivery.record.warehouseId, fromDelivery.record.pickingId, fromDelivery.record.productId],
    ['wh', 'order:delivery', r.productId],
  )
  assert.equal(fromDelivery.permissions.validateScrap, true)
  // A saved draft still names its transfer; a done order no longer offers it.
  assert.equal(
    (
      await r.call('stock.saveScrap', {
        id: 'kept',
        pickingId: 'order:delivery',
        productId: r.productId,
        quantity: '1',
        reason: 'damaged',
      })
    ).ok,
    true,
  )
  const kept = await context('/admin/stock/scrap/kept/context?lang=en')
  assert.deepEqual(kept.source, { name: fromDelivery.source.name, products: [r.productId] })
  assert.ok(fromDelivery.source.name)
  assert.equal((await r.call('stock.validateScrap', { id: 'kept' })).ok, true)
  assert.equal((await context('/admin/stock/scrap/kept/context?lang=en')).source, null)
  const transfer = await context('/admin/stock/transfer/order:delivery/context?lang=en')
  assert.match(
    transfer.scrapHref,
    /\/admin\/stock\/scraps\?lang=en&picking=order%3Adelivery&record=stock\.scrap%3Anew/,
  )
  assert.equal((await context('/admin/stock/transfer/older:scrap/context?lang=en')).scrapHref, null)
  const done = await context('/admin/stock/scrap/older/context?lang=en')
  assert.match(done.links.operation, /^\/admin\/stock\/transfers\/older%3Ascrap\?/)
  assert.equal(done.value, '₫1,000')
  assert.equal(done.source, null)

  await r.fixture('user.saveRole', { id: 'seller', name: 'Seller' })
  await r.fixture('user.createUser', {
    id: 'seller',
    login: 'seller',
    password: 'test-password',
    name: 'Seller',
    defaultCompanyId: 'acme',
  })
  await r.fixture('user.grantCompany', { id: 'seller-company', userId: 'seller', companyId: 'acme' })
  await r.fixture('user.assignRole', { id: 'seller-role', userId: 'seller', roleId: 'seller' })
  for (const fnKey of ['stock.listPickings', 'stock.getPicking', 'stock.getScrap'])
    await r.fixture('user.grantFunction', { id: fnKey, roleId: 'seller', fnKey })
  const seller = r.app.client.anonymous()
  await seller.login({ login: 'seller', password: 'test-password' })
  const locked = await seller.request('/admin/stock/scraps?lang=en')
  assert.equal(locked.status, 403)
  assert.match(await locked.text(), /You cannot see scrap orders/)
  assert.equal((await seller.request('/admin/stock/scrap/new/context?lang=en')).status, 403)
  // Without the valuation right the order shows no value, and a transfer offers no scrap to a reader.
  assert.equal((await context('/admin/stock/scrap/older/context?lang=en', seller)).value, null)
  assert.equal(
    (await context('/admin/stock/transfer/order:delivery/context?lang=en', seller)).scrapHref,
    null,
  )
})
