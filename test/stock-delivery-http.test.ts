import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { seed } from './fixtures/stock/delivery.ts'
import { sql } from './fixtures/stock/landed-costs.ts'

test('K45 carriers have a fixed code, a unique name, rates and exactly one default in use; each is a partner', async (t) => {
  const r = await seed(t)
  const ghn = (await r.call('stock.getCarrier', { id: 'ghn' })) as Row
  // The first carrier is the default.
  assert.deepEqual(
    [
      ghn.code,
      ghn.name,
      ghn.baseFee,
      ghn.extraKgFee,
      ghn.codFeeRate,
      ghn.isDefault,
      ghn.state,
      ghn.management,
    ],
    ['GHN', 'Giao Hàng Nhanh', '20000', '5000', '1.5', true, 'active', 'tenant'],
  )
  assert.equal((await r.call('partner.getPartner', { id: ghn.partnerId })).name, 'Giao Hàng Nhanh')
  const carrier = (values: Row) =>
    r.call('stock.saveCarrier', {
      id: 'vtp',
      code: 'VTP',
      name: 'Viettel Post',
      baseFee: '18000',
      extraKgFee: '4000',
      codFeeRate: '1',
      ...values,
    })
  assert.deepEqual(r.refusal(await carrier({ code: 'v' })), ['code', 'stock.error.carrierCode'])
  assert.deepEqual(r.refusal(await carrier({ code: 'GHN' })), ['code', 'stock.error.carrierCodeTaken'])
  assert.deepEqual(r.refusal(await carrier({ name: 'giao hàng nhanh' })), [
    'name',
    'stock.error.carrierNameTaken',
  ])
  assert.deepEqual(r.refusal(await carrier({ baseFee: '-1' })), ['baseFee', 'stock.error.carrierFee'])
  assert.deepEqual(r.refusal(await carrier({ codFeeRate: '10.01' })), [
    'codFeeRate',
    'stock.error.carrierCodRate',
  ])
  // A carrier the hosting provider books for the company is a later phase.
  assert.deepEqual(r.refusal(await carrier({ management: 'platform' })), [
    'management',
    'stock.error.carrierManagementUnavailable',
  ])
  r.done(await carrier({ code: 'vtp' }))
  assert.equal(((await r.call('stock.getCarrier', { id: 'vtp' })) as Row).code, 'VTP')
  assert.deepEqual(r.refusal(await carrier({ code: 'VTP2' })), ['code', 'stock.error.carrierCodeFixed'])
  // There is always one default, and it is in use.
  assert.deepEqual(r.refusal(await r.call('stock.saveCarrier', { id: 'ghn', isDefault: false })), [
    'isDefault',
    'stock.error.carrierDefaultRequired',
  ])
  assert.deepEqual(r.refusal(await r.call('stock.archiveCarrier', { id: 'ghn' })), [
    'id',
    'stock.error.carrierDefaultArchive',
  ])
  r.done(await carrier({ isDefault: true, name: 'Viettel Post VN' }))
  assert.equal((await r.call('partner.getPartner', { id: `vtp:partner` })).name, 'Viettel Post VN')
  r.done(await r.call('stock.archiveCarrier', { id: 'ghn' }))
  assert.deepEqual(r.refusal(await r.call('stock.saveCarrier', { id: 'ghn', isDefault: true })), [
    'isDefault',
    'stock.error.carrierDefaultArchived',
  ])
  // An archived carrier is not offered, and takes no new parcel.
  assert.deepEqual(
    ((await r.call('stock.listCarriers', {})) as unknown as Row[]).map((row) => [row.id, row.isDefault]),
    [['vtp', true]],
  )
  assert.deepEqual(
    ((await r.call('stock.listCarriers', { includeArchived: true })) as unknown as Row[]).map((row) => [
      row.id,
      row.state,
    ]),
    [
      ['vtp', 'active'],
      ['ghn', 'archived'],
    ],
  )
  r.done(await r.make())
  assert.deepEqual(r.refusal(await r.call('stock.saveShipment', { id: 'parcel', carrierId: 'ghn' })), [
    'carrierId',
    'stock.error.shipmentCarrier',
  ])
  r.done(await r.call('stock.activateCarrier', { id: 'ghn' }))
  r.done(await r.call('stock.saveShipment', { id: 'parcel', carrierId: 'ghn' }))
})

test('K46 a parcel collects what is left of an order paid on delivery, books its fees, hands its delivery over whole and posts the cash on delivery', async (t) => {
  const r = await seed(t)
  // The queue offers the delivery without a parcel.
  assert.deepEqual(
    ((await r.call('stock.listDispatchQueue', {})) as unknown as Row[]).map((row) => [
      row.id,
      row.status,
      row.cod,
    ]),
    [['order:delivery', 'noShipment', '300000']],
  )
  r.done(await r.make())
  let parcel = await r.shipment()
  assert.deepEqual(
    [
      parcel.name,
      parcel.state,
      parcel.carrierId,
      parcel.weight,
      parcel.cod,
      parcel.saleOrderId,
      parcel.partnerId,
    ],
    ['WH/VD/0001', 'draft', 'ghn', '1', '300000', 'order', 'buyer'],
  )
  assert.deepEqual(parcel.fees, { shipping: '20000', cod: '4500', total: '24500' })
  assert.equal(parcel.codLimit, '300000')
  assert.deepEqual(parcel.saleOrder, {
    id: 'order',
    name: (await r.call('sale.getOrder', { id: 'order' })).name,
  })
  // A delivery has one parcel at a time.
  assert.deepEqual(r.refusal(await r.make('again')), ['pickingId', 'stock.error.shipmentHasParcel'])
  // Weight above 0, at most 50 kg, two decimals; cash no more than the order.
  for (const weight of ['0', '50.01', '1.234', 'x'])
    assert.deepEqual(r.refusal(await r.call('stock.saveShipment', { id: 'parcel', weight })), [
      'weight',
      'stock.error.shipmentWeightInvalid',
    ])
  assert.deepEqual(r.refusal(await r.call('stock.saveShipment', { id: 'parcel', cod: '300001' })), [
    'cod',
    'stock.error.shipmentCodInvalid',
  ])
  r.done(await r.call('stock.saveShipment', { id: 'parcel', weight: '2.01', note: 'Gọi trước' }))
  // Two kilograms begun after the first.
  assert.deepEqual((await r.shipment()).fees, { shipping: '30000', cod: '4500', total: '34500' })
  // Handing over waits for booking.
  assert.deepEqual(r.refusal(await r.call('stock.handOverShipment', { id: 'parcel' })), [
    'id',
    'stock.error.shipmentState',
  ])
  r.done(await r.call('stock.bookShipment', { id: 'parcel', weight: '1.2' }))
  parcel = await r.shipment()
  assert.deepEqual(
    [parcel.state, parcel.trackingCode, parcel.shippingFee, parcel.codFee, parcel.bookedDate, parcel.weight],
    ['booked', 'GHN203000001', '25000', '4500', '2030-01-31', '1.2'],
  )
  // Rates changed after booking do not touch what booking charged.
  r.done(await r.call('stock.saveCarrier', { id: 'ghn', baseFee: '99000' }))
  assert.deepEqual((await r.shipment()).fees, { shipping: '25000', cod: '4500', total: '29500' })
  // Booked, the parcel is read-only; booking again changes nothing.
  assert.deepEqual(r.refusal(await r.call('stock.saveShipment', { id: 'parcel', weight: '3' })), [
    'id',
    'stock.error.shipmentState',
  ])
  r.done(await r.call('stock.bookShipment', { id: 'parcel' }))
  assert.equal((await r.shipment()).trackingCode, 'GHN203000001')
  // Not all the goods are held: handing over would split the delivery.
  assert.equal((await r.shipment()).ready, false)
  assert.deepEqual(
    ((await r.call('stock.listDispatchQueue', {})) as unknown as Row[]).map((row) => [
      row.status,
      row.shipmentName,
    ]),
    [['waiting', 'WH/VD/0001']],
  )
  assert.deepEqual(r.refusal(await r.call('stock.handOverShipment', { id: 'parcel' })), [
    'id',
    'stock.error.shipmentNotReady',
  ])
  await r.reserve()
  assert.deepEqual(
    ((await r.call('stock.listDispatchQueue', {})) as unknown as Row[]).map((row) => row.status),
    ['toHandOver'],
  )
  r.done(await r.call('stock.handOverShipment', { id: 'parcel' }))
  parcel = await r.shipment()
  assert.deepEqual([parcel.state, parcel.handedDate, parcel.attempts], ['shipping', '2030-01-31', 1])
  assert.equal((await r.call('stock.getPicking', { id: 'order:delivery' })).state, 'done')
  // The order counts its delivery at once, and the delivery left the queue.
  assert.equal(((await r.call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!.qtyDelivered, '2')
  assert.deepEqual(await r.call('stock.listDispatchQueue', {}), [])
  r.done(await r.call('stock.handOverShipment', { id: 'parcel' }))
  // A parcel handed over is not cancelled.
  assert.deepEqual(r.refusal(await r.call('stock.cancelShipment', { id: 'parcel', reason: 'x' })), [
    'id',
    'stock.error.shipmentState',
  ])
  t.mock.timers.setTime(Date.parse('2030-02-01T03:00:00.000Z'))
  r.done(await r.call('stock.deliverShipment', { id: 'parcel' }))
  parcel = await r.shipment()
  assert.deepEqual([parcel.state, parcel.deliveredDate], ['delivered', '2030-02-01'])
  // The customer paid the carrier: the debt moves from the customer to the carrier.
  assert.deepEqual(await r.entry(parcel.codEntryId), [
    ['1388', 300000, 0, 'ghn:partner'],
    ['131', 0, 300000, 'buyer'],
  ])
  assert.deepEqual(await r.entryHead(parcel.codEntryId), [
    'kho',
    '2030-02-01',
    'posted',
    'GHN203000001 · WH/VD/0001',
  ])
  assert.match(String((parcel.codEntry as Row).name), /^KHO\/2030\//)
  r.done(await r.call('stock.deliverShipment', { id: 'parcel' }))
  assert.equal(
    (await r.app.adapter!.all(sql(`SELECT id FROM account_move WHERE id LIKE 'stock-shipment-cod:%'`)))
      .length,
    1,
  )
  const overview = (await r.call('stock.getDeliveryOverview', {})) as Row
  assert.deepEqual(
    (overview.carriers as Row[]).map((row) => [row.id, row.toSettle, row.codShipping, row.codHeld]),
    [['ghn', 1, '0', '300000']],
  )
})

test('K46 a delivery paid later collects nothing by default; a cancelled parcel charges nothing and frees its delivery', async (t) => {
  const r = await seed(t, { onDelivery: false })
  r.done(await r.make())
  assert.equal((await r.shipment()).cod, '0')
  r.done(await r.call('stock.bookShipment', { id: 'parcel', trackingCode: 'abc-123' }))
  assert.equal((await r.shipment()).trackingCode, 'ABC-123')
  assert.deepEqual(r.refusal(await r.call('stock.cancelShipment', { id: 'parcel', reason: ' ' })), [
    'reason',
    'stock.error.deliveryReasonRequired',
  ])
  r.done(await r.call('stock.cancelShipment', { id: 'parcel', reason: 'Khách đổi địa chỉ' }))
  const parcel = await r.shipment()
  assert.deepEqual(
    [parcel.state, parcel.shippingFee, parcel.codFee, parcel.cancelReason, parcel.openPickingId],
    ['cancel', '0', '0', 'Khách đổi địa chỉ', null],
  )
  assert.deepEqual(
    ((await r.call('stock.listDispatchQueue', {})) as unknown as Row[]).map((row) => row.status),
    ['noShipment'],
  )
  r.done(await r.make('second'))
  assert.equal((await r.shipment('second')).name, 'WH/VD/0002')
  // A code another live parcel of the carrier has is refused.
  assert.deepEqual(r.refusal(await r.call('stock.bookShipment', { id: 'second', trackingCode: 'x' })), [
    'trackingCode',
    'stock.error.shipmentTrackingInvalid',
  ])
  r.done(await r.call('stock.bookShipment', { id: 'second', trackingCode: 'ABC-123' }))
})

test("K46 a tracking code is the carrier's once; a delivery completed without its parcel is no longer booked or given one", async (t) => {
  const r = await seed(t)
  // A second delivery to a customer, outside any order: it collects nothing unless the warehouse says.
  await r.save('stock.createPicking', {
    id: 'walk-in',
    name: 'walk-in',
    pickingTypeId: 'wh:outgoing',
  })
  await r.save('stock.addMove', {
    id: 'walk-in-move',
    pickingId: 'walk-in',
    name: 'Goods',
    productId: r.productId,
    productUomId: 'each',
    productUomQty: '1',
  })
  await r.save('stock.confirmPicking', { id: 'walk-in' })
  r.done(await r.make())
  r.done(await r.call('stock.bookShipment', { id: 'parcel', trackingCode: 'SAME-1' }))
  r.done(await r.make('walk', 'walk-in'))
  const walk = await r.shipment('walk')
  assert.deepEqual([walk.cod, walk.saleOrder, walk.codLimit], ['0', null, '100000000'])
  assert.deepEqual(r.refusal(await r.call('stock.bookShipment', { id: 'walk', trackingCode: 'same-1' })), [
    'trackingCode',
    'stock.error.shipmentTrackingTaken',
  ])
  // The delivery is done by hand: its draft parcel cannot be booked, and it gets no other.
  await r.reserve('walk-in')
  assert.equal((await r.call('stock.completePicking', { id: 'walk-in', createBackorder: false })).ok, true)
  assert.deepEqual(r.refusal(await r.call('stock.bookShipment', { id: 'walk' })), [
    'id',
    'stock.error.shipmentPickingClosed',
  ])
  r.done(await r.call('stock.cancelShipment', { id: 'walk', reason: 'Khách tự lấy' }))
  assert.deepEqual(r.refusal(await r.make('walk-2', 'walk-in')), [
    'pickingId',
    'stock.error.shipmentPickingClosed',
  ])
  // A receipt is not a delivery to a customer.
  await r.save('stock.createPicking', { id: 'in', name: 'in', pickingTypeId: 'wh:incoming' })
  assert.deepEqual(r.refusal(await r.make('in-parcel', 'in')), ['pickingId', 'stock.error.shipmentPicking'])
})

test('K46 a failed parcel is tried again or brought back on a return of its delivery, collecting nothing', async (t) => {
  const r = await seed(t)
  await r.ship()
  assert.deepEqual(r.refusal(await r.call('stock.failShipment', { id: 'parcel', reason: '' })), [
    'reason',
    'stock.error.deliveryReasonRequired',
  ])
  r.done(await r.call('stock.failShipment', { id: 'parcel', reason: 'Không liên lạc được' }))
  assert.deepEqual(
    ((await r.call('stock.listShipments', {})) as unknown as Row[]).map((row) => [row.state, row.failReason]),
    [['failed', 'Không liên lạc được']],
  )
  r.done(await r.call('stock.retryShipment', { id: 'parcel' }))
  assert.deepEqual([(await r.shipment()).state, (await r.shipment()).attempts], ['shipping', 2])
  r.done(await r.call('stock.failShipment', { id: 'parcel', reason: 'Từ chối nhận' }))
  const back = await r.call('stock.returnShipment', { id: 'parcel' })
  assert.deepEqual(back, { ok: true, id: 'parcel', returnId: 'parcel:return' })
  const parcel = await r.shipment()
  assert.deepEqual(
    [
      parcel.state,
      parcel.returnedDate,
      parcel.codFee,
      parcel.shippingFee,
      (parcel.returnPicking as Row).state,
    ],
    ['returned', '2030-01-31', '0', '25000', 'confirmed'],
  )
  // A retry reopens the same return.
  assert.deepEqual(await r.call('stock.returnShipment', { id: 'parcel' }), back)
  assert.equal(
    (await r.app.adapter!.all(sql(`SELECT id FROM stock_picking WHERE id = ?`), ['parcel:return'])).length,
    1,
  )
  // Nothing was collected: no entry.
  assert.equal(parcel.codEntryId, null)
})

test('K47 a statement takes what the carrier closed by its day, posts its fees and settles net through the bank', async (t) => {
  const r = await seed(t)
  await r.ship()
  const save = (values: Row = {}) =>
    r.call('stock.saveDeliveryStatement', { id: 'ds', carrierId: 'ghn', date: '2030-01-31', ...values })
  assert.deepEqual(r.refusal(await save()), ['date', 'stock.error.statementNothing'])
  r.done(await r.call('stock.deliverShipment', { id: 'parcel' }))
  assert.deepEqual(r.refusal(await save({ date: '2030-02-01' })), [
    'date',
    'stock.error.statementDateInvalid',
  ])
  // Delivered on the 31st: not on a statement up to the 30th.
  assert.deepEqual(r.refusal(await save({ date: '2030-01-30' })), ['date', 'stock.error.statementNothing'])
  r.done(await save())
  let statement = (await r.call('stock.getDeliveryStatement', { id: 'ds' })) as Row
  assert.deepEqual(
    [statement.name, statement.state, statement.cod, statement.fees, statement.net, statement.pending],
    ['GHN/DS/0001', 'draft', '300000', '29500', '270500', 0],
  )
  assert.deepEqual(
    (statement.lines as Row[]).map((line) => [line.name, line.cod, line.fee, line.outcome]),
    [['WH/VD/0001', '300000', '29500', 'delivered']],
  )
  // A parcel is on one open statement.
  assert.deepEqual(r.refusal(await save({ id: 'ds2' })), ['date', 'stock.error.statementNothing'])
  assert.equal((await r.shipment()).statement && ((await r.shipment()).statement as Row).name, 'GHN/DS/0001')
  r.done(await r.call('stock.postDeliveryStatement', { id: 'ds' }))
  statement = (await r.call('stock.getDeliveryStatement', { id: 'ds' })) as Row
  assert.deepEqual(await r.entry(statement.feeEntryId), [
    ['641', 29500, 0, null],
    ['331', 0, 29500, 'ghn:partner'],
  ])
  assert.deepEqual((await r.entryHead(statement.feeEntryId))!.slice(0, 2), ['kho', '2030-01-31'])
  assert.deepEqual(r.refusal(await save()), ['id', 'stock.error.statementState'])
  assert.deepEqual(r.refusal(await r.call('stock.cancelDeliveryStatement', { id: 'ds', reason: 'x' })), [
    'id',
    'stock.error.statementState',
  ])
  assert.deepEqual(
    r.refusal(
      await r.call('stock.settleDeliveryStatement', { id: 'ds', paidDate: '2030-01-30', journalId: 'bank' }),
    ),
    ['paidDate', 'stock.error.statementPaidDateInvalid'],
  )
  assert.deepEqual(
    r.refusal(
      await r.call('stock.settleDeliveryStatement', { id: 'ds', paidDate: '2030-01-31', journalId: 'kho' }),
    ),
    ['journalId', 'stock.error.statementJournalInvalid'],
  )
  assert.deepEqual(
    ((await r.call('stock.listSettlementJournals', {})) as unknown as Row[]).map((row) => row.id),
    ['bank'],
  )
  r.done(
    await r.call('stock.settleDeliveryStatement', { id: 'ds', paidDate: '2030-01-31', journalId: 'bank' }),
  )
  statement = (await r.call('stock.getDeliveryStatement', { id: 'ds' })) as Row
  assert.deepEqual(
    [statement.state, statement.paidDate, statement.paymentJournalName],
    ['paid', '2030-01-31', 'Ngân hàng'],
  )
  // The fees come off what the carrier collected; the bank takes the rest.
  assert.deepEqual(await r.entry(statement.paymentEntryId), [
    ['331', 29500, 0, 'ghn:partner'],
    ['1388', 0, 29500, 'ghn:partner'],
    ['1121', 270500, 0, null],
    ['1388', 0, 270500, 'ghn:partner'],
  ])
  assert.equal((await r.entryHead(statement.paymentEntryId))![0], 'bank')
  r.done(
    await r.call('stock.settleDeliveryStatement', { id: 'ds', paidDate: '2030-01-31', journalId: 'bank' }),
  )
  const overview = (await r.call('stock.getDeliveryOverview', {})) as Row
  assert.deepEqual(
    (overview.carriers as Row[]).map((row) => [row.toSettle, row.codHeld]),
    [[0, '0']],
  )
})

test('K47 a returned parcel only charges its carrying; the bank pays the carrier what fees exceed; a dropped draft frees its parcels', async (t) => {
  const r = await seed(t)
  await r.ship()
  r.done(await r.call('stock.failShipment', { id: 'parcel', reason: 'Từ chối nhận' }))
  r.done(await r.call('stock.returnShipment', { id: 'parcel' }))
  r.done(await r.call('stock.saveDeliveryStatement', { id: 'ds', carrierId: 'ghn' }))
  let statement = (await r.call('stock.getDeliveryStatement', { id: 'ds' })) as Row
  assert.deepEqual([statement.cod, statement.fees, statement.net], ['0', '25000', '-25000'])
  r.done(await r.call('stock.cancelDeliveryStatement', { id: 'ds', reason: 'Lập nhầm' }))
  r.done(await r.call('stock.saveDeliveryStatement', { id: 'ds2', carrierId: 'ghn' }))
  statement = (await r.call('stock.getDeliveryStatement', { id: 'ds2' })) as Row
  assert.equal(statement.name, 'GHN/DS/0002')
  r.done(await r.call('stock.postDeliveryStatement', { id: 'ds2' }))
  r.done(
    await r.call('stock.settleDeliveryStatement', { id: 'ds2', paidDate: '2030-01-31', journalId: 'bank' }),
  )
  statement = (await r.call('stock.getDeliveryStatement', { id: 'ds2' })) as Row
  assert.deepEqual(await r.entry(statement.paymentEntryId), [
    ['331', 25000, 0, 'ghn:partner'],
    ['1121', 0, 25000, null],
  ])
})

test('K47 a locked period refuses delivering, posting and settling and writes nothing; missing accounts say which setup', async (t) => {
  const r = await seed(t)
  await r.ship()
  r.done(
    await r.call('stock.saveAccountingSetting', {
      journalId: 'kho',
      valuationAccountId: '156',
      supplierAccountId: '151',
      productionAccountId: '1541',
      cogsAccountId: '632',
      gainAccountId: '711',
      lossAccountId: '811',
      deliveryFeeAccountId: '',
      carrierCodAccountId: '',
      receivableAccountId: '',
      carrierPayableAccountId: '',
    }),
  )
  assert.deepEqual(r.refusal(await r.call('stock.deliverShipment', { id: 'parcel' })), [
    'id',
    'stock.error.deliveryAccountMissing',
  ])
  // A form without the shipping accounts keeps them.
  r.done(
    await r.call('stock.saveAccountingSetting', {
      journalId: 'kho',
      valuationAccountId: '156',
      supplierAccountId: '151',
      productionAccountId: '1541',
      cogsAccountId: '632',
      gainAccountId: '711',
      lossAccountId: '811',
      deliveryFeeAccountId: '641',
      carrierCodAccountId: '1388',
      receivableAccountId: '131',
      carrierPayableAccountId: '331',
    }),
  )
  r.done(
    await r.call('stock.saveAccountingSetting', {
      journalId: 'kho',
      valuationAccountId: '156',
      supplierAccountId: '151',
      productionAccountId: '1541',
      cogsAccountId: '632',
      gainAccountId: '711',
      lossAccountId: '811',
    }),
  )
  assert.equal(((await r.call('stock.getAccountingSetting', {})) as Row).carrierCodAccountId, '1388')
  await r.save('account.changePeriodLock', {
    id: 'close-january',
    scope: 'all',
    through: '2030-01-31',
    reason: 'Close',
  })
  assert.deepEqual(r.refusal(await r.call('stock.deliverShipment', { id: 'parcel' })), [
    'id',
    'stock.error.valuationPeriodLocked',
  ])
  assert.equal((await r.shipment()).state, 'shipping')
  assert.equal(
    (await r.app.adapter!.all(sql(`SELECT id FROM account_move WHERE id LIKE 'stock-shipment-cod:%'`)))
      .length,
    0,
  )
  // Delivered and stated in an open period, posted and settled in a closed one.
  const lock = (id: string, through: string) =>
    r.save('account.changePeriodLock', { id, scope: 'all', through, reason: id })
  await lock('reopen', '2030-01-30')
  r.done(await r.call('stock.deliverShipment', { id: 'parcel' }))
  r.done(await r.call('stock.saveDeliveryStatement', { id: 'ds', carrierId: 'ghn' }))
  await lock('close-again', '2030-01-31')
  assert.deepEqual(r.refusal(await r.call('stock.postDeliveryStatement', { id: 'ds' })), [
    'id',
    'stock.error.valuationPeriodLocked',
  ])
  assert.equal(((await r.call('stock.getDeliveryStatement', { id: 'ds' })) as Row).state, 'draft')
  await lock('reopen-again', '2030-01-30')
  r.done(await r.call('stock.postDeliveryStatement', { id: 'ds' }))
  await lock('close-last', '2030-01-31')
  assert.deepEqual(
    r.refusal(
      await r.call('stock.settleDeliveryStatement', { id: 'ds', paidDate: '2030-01-31', journalId: 'bank' }),
    ),
    ['id', 'stock.error.valuationPeriodLocked'],
  )
  const statement = (await r.call('stock.getDeliveryStatement', { id: 'ds' })) as Row
  assert.deepEqual([statement.state, statement.paymentEntryId], ['posted', null])
})

test('K48 ticked deliveries get draft parcels and ticked parcels are handed over; the rest say why', async (t) => {
  const r = await seed(t)
  assert.deepEqual(r.refusal(await r.call('stock.createShipments', { ids: [] })), [
    'ids',
    'stock.error.deliverySelectionRequired',
  ])
  const made = await r.call('stock.createShipments', {
    ids: ['order:delivery', 'order:delivery', 'wh:missing'],
  })
  assert.deepEqual(
    [(made.done as Row[]).map((row) => row.id), (made.skipped as Row[]).map((row) => [row.id, row.reason])],
    [['order:delivery'], [['wh:missing', 'closed']]],
  )
  const again = await r.call('stock.createShipments', { ids: ['order:delivery'] })
  assert.deepEqual(
    (again.skipped as Row[]).map((row) => row.reason),
    ['hasShipment'],
  )
  const [parcel] = (await r.call('stock.listShipments', {})) as unknown as Row[]
  let handed = await r.call('stock.handOverShipments', { ids: [parcel!.id] })
  assert.deepEqual(
    (handed.skipped as Row[]).map((row) => row.reason),
    ['notBooked'],
  )
  r.done(await r.call('stock.bookShipment', { id: parcel!.id }))
  handed = await r.call('stock.handOverShipments', { ids: [parcel!.id] })
  assert.deepEqual(
    (handed.skipped as Row[]).map((row) => row.reason),
    ['waitingGoods'],
  )
  await r.reserve()
  handed = await r.call('stock.handOverShipments', { ids: [parcel!.id] })
  assert.deepEqual([(handed.done as Row[]).length, (handed.skipped as Row[]).length], [1, 0])
  assert.equal(((await r.call('sale.getOrder', { id: 'order' })).lines as Row[])[0]!.qtyDelivered, '2')
})

test('K49 the warehouse works parcels, every stock reader follows them, statements are accounting’s and read with value', async (t) => {
  const r = await seed(t)
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  r.done(await r.make())
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
    'commerce.warehouse-operator',
    'commerce.accountant',
    'commerce.tenant-auditor',
  ]) {
    const client = await r.signIn(roleId)
    can[roleId] = [
      (await status(client, 'listShipments', {})) === 200,
      (await status(client, 'saveShipment', { id: 'parcel', note: roleId })) === 200,
      (await status(client, 'handOverShipment', { id: 'parcel' })) !== 403,
      (await status(client, 'saveCarrier', { id: 'ghn', name: 'Giao Hàng Nhanh' })) === 200,
      (await status(client, 'listDeliveryStatements', {})) === 200,
      (await status(client, 'saveDeliveryStatement', { id: `ds-${roleId}`, carrierId: 'ghn' })) !== 403,
    ]
  }
  assert.deepEqual(can, {
    'commerce.warehouse-manager': [true, true, true, true, true, false],
    'commerce.warehouse-operator': [true, true, true, false, false, false],
    'commerce.accountant': [true, false, false, false, true, true],
    'commerce.tenant-auditor': [true, false, false, false, true, false],
  })
})
