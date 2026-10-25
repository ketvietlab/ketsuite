import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import {
  dateKeyIn,
  addCalendarDays,
  zonedDateTime,
} from '../packages/ketsuite/src/modules/hospitality_core/calendar.ts'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }
const futureDate = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const onlineCheckIn = futureDate(10)
const onlineCheckOut = futureDate(12)
/** The ledger is keyed by property-local calendar date; arrival is the first night. */
const onlineFrom = onlineCheckIn
/** Well inside the free-cancellation window of the seeded policy. */
const onlineCancelAt = new Date().toISOString()
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  roomFixtureCall(name, args, { adapter, manifest, scope })

async function boot(cleanRooms = false): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Công ty ACME' }, adapter)
  await call(
    'company.saveCompany',
    { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' },
    adapter,
  )
  await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('partner.savePartner', { id: 'companion', kind: 'person', name: 'Trần Bình' }, adapter)
  await call(
    'hospitality_core.saveProperty',
    { id: 'hotel', code: 'HCM', name: 'Ket Hotel', accommodationType: 'hotel' },
    adapter,
  )
  await call(
    'hospitality_core.saveRoomType',
    {
      id: 'deluxe',
      propertyId: 'hotel',
      code: 'DLX',
      name: 'Deluxe',
      baseRate: '100',
      published: true,
    },
    adapter,
  )
  for (const room of ['101', '102'])
    await call(
      'hospitality_core.saveRoom',
      { id: room, propertyId: 'hotel', roomTypeId: 'deluxe', code: room, name: room },
      adapter,
    )
  if (cleanRooms)
    for (const id of ['101', '102']) {
      const room = (await call('hospitality_core.getRoom', { id }, adapter)).value as Row
      const clean = await call(
        'hospitality_core.completeRoomCleaning',
        { roomId: id, expectedVersion: room.version, requestKey: `housekeeping-fixture-clean-${id}` },
        adapter,
      )
      assert.equal((clean.value as Row).ok, true)
    }
  await openProperty('hotel', 'deluxe', adapter)
  return adapter
}

/** The desk books only an open property, and opening needs a rate. */
async function openProperty(propertyId: string, roomTypeId: string, adapter: Adapter): Promise<void> {
  await call(
    'hospitality_core.saveRatePlan',
    {
      id: `${propertyId}-rate`,
      propertyId,
      roomTypeId,
      code: 'HK-RATE',
      name: 'Housekeeping fixture rate',
      rateType: 'nightly',
      amount: '100',
    },
    adapter,
  )
  const property = (await call('hospitality_core.getProperty', { id: propertyId }, adapter)).value as Row
  const opened = await call(
    'hospitality_core.setPropertyLifecycle',
    {
      propertyId,
      lifecycle: 'active',
      expectedVersion: property.version,
      requestKey: `${propertyId}-fixture-open`,
    },
    adapter,
  )
  assert.equal((opened.value as Row).ok, true, JSON.stringify(opened.value))
}

/** Every adult arriving is declared at check-in. */
const arrivalGuests = [
  {
    fullName: 'Synthetic guest',
    type: 'passport',
    number: 'TEST1234',
    birth: '1990-01-01',
    gender: 'female',
    nationality: 'VN',
  },
]

/**
 * The business day locks earlier dates, so a test of the fixed-date fixture runs on
 * the day the reservation was booked.
 */
const onBookingDay = (t: TestContext, at = '2026-08-20T00:00:00.000Z') =>
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at) })

const reservation = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  propertyId: 'hotel',
  roomTypeId: 'deluxe',
  partnerId: 'guest',
  bookingType: 'nightly',
  checkIn: '2026-09-01T14:00:00.000Z',
  checkOut: '2026-09-03T12:00:00.000Z',
  rate: '100',
  createdAt: '2026-08-20T00:00:00.000Z',
  ...extra,
})

test('hospitality operations: booking engine creates one atomic reservation, folio, stay, charge and guest', async (t) => {
  onBookingDay(t)
  const adapter = await boot()
  try {
    const created = await call('hospitality_core.createReservation', reservation('r1'), adapter)
    assert.deepEqual(
      created.value,
      { ok: true, id: 'r1', folioId: 'r1:folio', stayId: 'r1:stay', existing: false, errors: [] },
      JSON.stringify(created.value),
    )
    const retry = await call('hospitality_core.createReservation', reservation('r1'), adapter)
    assert.equal((retry.value as Row).existing, true)

    const stored = (
      await adapter.all(
        'SELECT state, quantity, "amountTotal", "stayId" FROM hospitality_core_reservation WHERE id = ?',
        ['r1'],
      )
    )[0]!
    assert.deepEqual(
      { ...stored },
      { state: 'confirmed', quantity: '2', amountTotal: '200', stayId: 'r1:stay' },
    )
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_folio'))[0]!.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_stay'))[0]!.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_charge'))[0]!.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_stay_guest'))[0]!.n, 1)

    const invalid = await call(
      'hospitality_core.createReservation',
      reservation('bad', { roomTypeId: 'missing' }),
      adapter,
    )
    assert.equal((invalid.value as Row).ok, false)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_reservation'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: quote is read-only and reflects committed room-night inventory', async (t) => {
  onBookingDay(t)
  const adapter = await boot()
  try {
    const args = {
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      bookingType: 'nightly',
      checkIn: '2026-09-01T14:00:00.000Z',
      checkOut: '2026-09-03T12:00:00.000Z',
    }
    const initial = (await call('hospitality_core.quoteReservation', args, adapter)).value as Row
    assert.deepEqual(
      {
        ok: initial.ok,
        rate: initial.rate,
        quantity: initial.quantity,
        amountTotal: initial.amountTotal,
        minimumAvailable: initial.minimumAvailable,
      },
      { ok: true, rate: '100', quantity: '2', amountTotal: '200', minimumAvailable: 2 },
    )
    assert.equal(
      Number((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_availability_ledger'))[0]?.n),
      0,
      'quoting does not materialize inventory rows',
    )

    await call('hospitality_core.createReservation', reservation('quoted-r1'), adapter)
    const afterOne = (await call('hospitality_core.quoteReservation', args, adapter)).value as Row
    assert.equal(afterOne.ok, true)
    assert.equal(afterOne.minimumAvailable, 1)
    assert.equal(
      Number((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_availability_ledger'))[0]?.n),
      2,
      're-quoting does not mutate the committed ledger',
    )

    await call('hospitality_core.createReservation', reservation('quoted-r2'), adapter)
    const full = (await call('hospitality_core.quoteReservation', args, adapter)).value as Row
    assert.equal(full.ok, false)
    assert.equal(((full.errors as Row[])[0] as Row).code, 'no_availability')
  } finally {
    await adapter.close()
  }
})

const onlineReservation = (id: string, requestKey: string, extra: Record<string, unknown> = {}) => ({
  id,
  requestKey,
  propertyId: 'hotel',
  roomTypeId: 'deluxe',
  partnerId: 'guest',
  checkIn: onlineCheckIn,
  checkOut: onlineCheckOut,
  adults: 2,
  ...extra,
})

test('hospitality online: quote is internal, public-safe and prices only from server configuration', async () => {
  const adapter = await boot()
  try {
    assert.equal(manifest.functions['hospitality_core.quoteAvailability']?.exposure, 'internal')
    assert.equal(manifest.functions['hospitality_core.createOnlineReservation']?.exposure, 'internal')
    const quoted = (
      await call(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(quoted.ok, true)
    assert.equal(quoted.companyId, 'acme')
    assert.equal(quoted.nights, 2)
    assert.deepEqual(quoted.items, [
      {
        roomTypeId: 'deluxe',
        ratePlanId: null,
        availableQuantity: 2,
        requestedQuantity: 1,
        unitRate: '100',
        amountTotal: '200',
        currency: 'VND',
        restrictions: {
          minStay: null,
          maxStay: null,
          closedToArrival: false,
          closedToDeparture: false,
          stopSell: false,
        },
      },
    ])
    await call(
      'hospitality_core.saveRatePlan',
      {
        id: 'web-rate',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        code: 'WEB',
        name: 'Website rate',
        rateType: 'nightly',
        amount: '125',
        isDefault: true,
        active: true,
      },
      adapter,
    )
    const ratePlanQuote = (
      await call(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          ratePlanId: 'web-rate',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(((ratePlanQuote.items as Row[])[0] as Row).unitRate, '125')
    assert.equal(((ratePlanQuote.items as Row[])[0] as Row).amountTotal, '250')
    await assert.rejects(
      call(
        'hospitality_core.createOnlineReservation',
        { ...onlineReservation('unsafe-price', 'unsafe-price'), rate: '1' },
        adapter,
      ),
      /unknown input "rate"/,
    )

    const overCapacity = (
      await call(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 3,
        },
        adapter,
      )
    ).value as Row
    assert.equal(overCapacity.ok, false)
    assert.equal((overCapacity.errors as Row[])[0]?.messageKey, 'hospitality_core.error.capacityExceeded')

    await call(
      'hospitality_core.setRestrictionRange',
      {
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        from: onlineCheckIn,
        to: onlineCheckIn,
        stopSell: true,
      },
      adapter,
    )
    const stopped = (
      await call(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(stopped.ok, false)
    assert.equal((stopped.errors as Row[])[0]?.messageKey, 'hospitality_core.error.stopSell')

    const wrongCompany = (
      await callFn(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 2,
        },
        { adapter, manifest, scope: { company: 'globex', companies: ['globex'], branches: null } },
      )
    ).value as Row
    assert.equal(wrongCompany.ok, false)
    assert.equal((wrongCompany.errors as Row[])[0]?.messageKey, 'hospitality_core.error.propertyNotFound')
  } finally {
    await adapter.close()
  }
})

test('hospitality online: customer cancellation applies the configured policy', async () => {
  const adapter = await boot()
  try {
    await call(
      'hospitality_core.saveCancellationPolicy',
      {
        id: 'non-refundable',
        code: 'NONREF',
        name: 'Non-refundable',
        type: 'non_refundable',
        freeCancellationHours: 0,
        penaltyPercent: '100',
      },
      adapter,
    )
    await call(
      'hospitality_core.saveRoomType',
      {
        id: 'deluxe',
        propertyId: 'hotel',
        code: 'DLX',
        name: 'Deluxe',
        baseRate: '100',
        cancellationPolicyId: 'non-refundable',
        published: true,
      },
      adapter,
    )
    const created = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('nonref-web', 'nonref-web', {
          checkIn: futureDate(20),
          checkOut: futureDate(22),
        }),
        adapter,
      )
    ).value as Row
    assert.equal(created.ok, true)
    const cancelled = (
      await call(
        'hospitality_core.cancelPartnerReservation',
        { id: 'nonref-web', partnerId: 'guest', at: new Date().toISOString() },
        adapter,
      )
    ).value as Row
    assert.equal(cancelled.ok, false)
    assert.equal((cancelled.errors as Row[])[0]?.messageKey, 'hospitality_core.error.cancellationNotAllowed')
    assert.equal(
      (await adapter.all('SELECT state FROM hospitality_core_reservation WHERE id = ?', ['nonref-web']))[0]
        ?.state,
      'confirmed',
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality online: a multi-room checkout becomes one assignable stay per room', async () => {
  const adapter = await boot(true)
  try {
    const created = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-multi', 'checkout-multi', { quantity: 2 }),
        adapter,
      )
    ).value as Row
    assert.equal(created.ok, true)
    assert.equal(created.id, 'web-multi')
    assert.equal(created.quantity, 2)
    // The purchase total is the folio total; each room carries its own nights.
    assert.equal(created.amountTotal, '400')
    const units = created.units as Array<Record<string, string>>
    assert.deepEqual(
      units.map((unit) => unit.reservationId),
      ['web-multi', 'web-multi#2'],
    )
    assert.deepEqual(
      units.map((unit) => unit.amountTotal),
      ['200', '200'],
    )

    // Two rooms, two stays, and both can be given a physical room.
    const stays = (await call('hospitality_core.listStays', { propertyId: 'hotel' }, adapter)).value as Row[]
    assert.equal(stays.length, 2)
    for (const [index, unit] of units.entries()) {
      const arrived = (
        await call(
          'hospitality_core.checkIn',
          {
            stayId: unit.stayId,
            roomId: ['101', '102'][index],
            at: `${onlineCheckIn}T15:00:00.000Z`,
            // Each room declares its own two adults.
            guests: ['A', 'B'].map((adult) => ({
              ...arrivalGuests[0],
              fullName: `Synthetic guest ${index}${adult}`,
              number: `TEST${index}${adult}`,
            })),
          },
          adapter,
        )
      ).value as Row
      assert.equal(arrived.ok, true, JSON.stringify(arrived))
      assert.equal(arrived.roomId, ['101', '102'][index])
    }
    const rooms = (await call('hospitality_core.listRooms', { propertyId: 'hotel' }, adapter)).value as Row[]
    assert.deepEqual(
      rooms.filter((room) => room.status === 'occupied').map((room) => room.code),
      ['101', '102'],
    )

    // One folio holding one charge per room, and the ledger sold both nights twice.
    const folio = (await call('hospitality_core.getFolio', { id: 'web-multi:folio' }, adapter)).value as Row
    assert.equal(Number(folio.amountTotal), 400)
    assert.equal((folio.charges as Row[]).length, 2)
    const ledger = (
      await call(
        'hospitality_core.listInventory',
        { propertyId: 'hotel', roomTypeId: 'deluxe', from: onlineFrom, to: onlineFrom },
        adapter,
      )
    ).value as Row[]
    assert.equal(ledger[0]?.sold, 2)
  } finally {
    await adapter.close()
  }
})

test('hospitality online: a multi-room purchase is listed and cancelled as one booking', async () => {
  const adapter = await boot()
  try {
    await call(
      'hospitality_core.createOnlineReservation',
      onlineReservation('web-multi', 'checkout-multi', { quantity: 2 }),
      adapter,
    )
    // Two reservations, but the guest bought one thing.
    const mine = (await call('hospitality_core.listPartnerReservations', { partnerId: 'guest' }, adapter))
      .value as Row[]
    assert.equal(mine.length, 1)
    assert.equal(mine[0]?.rooms, 2)
    assert.equal(Number(mine[0]?.amountTotal), 400)

    const cancelled = (
      await call(
        'hospitality_core.cancelPartnerReservation',
        { id: 'web-multi', partnerId: 'guest', at: onlineCancelAt },
        adapter,
      )
    ).value as Row
    assert.equal(cancelled.ok, true)
    assert.equal(cancelled.rooms, 2)
    const states = (await call('hospitality_core.listReservations', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.deepEqual(new Set(states.map((row) => row.state)), new Set(['cancelled']))
    const ledger = (
      await call(
        'hospitality_core.listInventory',
        { propertyId: 'hotel', roomTypeId: 'deluxe', from: onlineFrom, to: onlineFrom },
        adapter,
      )
    ).value as Row[]
    assert.equal(ledger[0]?.sold, 0)
  } finally {
    await adapter.close()
  }
})

test('hospitality online: retrying a multi-room checkout never sells a second set', async () => {
  const adapter = await boot()
  try {
    const first = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-multi', 'checkout-multi', { quantity: 2 }),
        adapter,
      )
    ).value as Row
    const again = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-multi', 'checkout-multi', { quantity: 2 }),
        adapter,
      )
    ).value as Row
    assert.equal(again.existing, true)
    assert.deepEqual(again.units, first.units)
    const ledger = (
      await call(
        'hospitality_core.listInventory',
        { propertyId: 'hotel', roomTypeId: 'deluxe', from: onlineFrom, to: onlineFrom },
        adapter,
      )
    ).value as Row[]
    assert.equal(ledger[0]?.sold, 2)

    // Same key, different room count is a different purchase and must be refused.
    const changed = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-multi', 'checkout-multi', { quantity: 1 }),
        adapter,
      )
    ).value as Row
    assert.equal(changed.ok, false)
    assert.equal((changed.errors as Row[])[0]?.code, 'requestConflict')
  } finally {
    await adapter.close()
  }
})

test('hospitality online: reservation, retry, ownership and cancellation remain atomic', async () => {
  const adapter = await boot()
  try {
    const created = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-1', 'checkout-session-1'),
        adapter,
      )
    ).value as Row
    assert.deepEqual(
      {
        ok: created.ok,
        id: created.id,
        companyId: created.companyId,
        rate: created.rate,
        quantity: created.quantity,
        amountTotal: created.amountTotal,
        currency: created.currency,
        existing: created.existing,
      },
      {
        ok: true,
        id: 'web-1',
        companyId: 'acme',
        rate: '100',
        quantity: 1,
        amountTotal: '200',
        currency: 'VND',
        existing: false,
      },
    )
    const retry = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-1-retried', 'checkout-session-1'),
        adapter,
      )
    ).value as Row
    assert.equal(retry.id, 'web-1')
    assert.equal(retry.existing, true)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_reservation'))[0]?.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_folio'))[0]?.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_stay'))[0]?.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_charge'))[0]?.n, 1)

    const conflict = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-conflict', 'checkout-session-1', { checkOut: futureDate(13) }),
        adapter,
      )
    ).value as Row
    assert.equal(conflict.ok, false)
    assert.equal((conflict.errors as Row[])[0]?.messageKey, 'hospitality_core.error.requestConflict')

    const mine = (await call('hospitality_core.listPartnerReservations', { partnerId: 'guest' }, adapter))
      .value as Row[]
    assert.equal(mine.length, 1)
    assert.equal(mine[0]?.companyId, 'acme')
    assert.equal(mine[0]?.cancellationAllowed, true)
    assert.equal('folioId' in mine[0]!, false)
    const stolen = (
      await call('hospitality_core.getPartnerReservation', { id: 'web-1', partnerId: 'companion' }, adapter)
    ).value as Row
    assert.equal(stolen.ok, false)
    assert.equal((stolen.errors as Row[])[0]?.messageKey, 'hospitality_core.error.reservationNotOwned')

    const cancelled = (
      await call(
        'hospitality_core.cancelPartnerReservation',
        { id: 'web-1', partnerId: 'guest', at: new Date().toISOString() },
        adapter,
      )
    ).value as Row
    assert.equal(cancelled.ok, true)
    assert.equal(cancelled.existing, false)
    const retriedCancel = (
      await call(
        'hospitality_core.cancelPartnerReservation',
        { id: 'web-1', partnerId: 'guest', at: new Date().toISOString() },
        adapter,
      )
    ).value as Row
    assert.equal(retriedCancel.existing, true)
    const ledger = await adapter.all(
      'SELECT sold, available FROM hospitality_core_availability_ledger ORDER BY date',
    )
    assert.deepEqual(
      ledger.map((row) => [Number(row.sold), Number(row.available)]),
      [
        [0, 2],
        [0, 2],
      ],
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality online: concurrent SQLite booking admits one reservation without oversell', async () => {
  const adapter = await boot()
  try {
    await adapter.run('UPDATE hospitality_core_room SET active = 0 WHERE id = ?', ['102'])
    const attempts = await Promise.all([
      call('hospitality_core.createOnlineReservation', onlineReservation('race-a', 'race-a'), adapter),
      call('hospitality_core.createOnlineReservation', onlineReservation('race-b', 'race-b'), adapter),
    ])
    const values = attempts.map((attempt) => attempt.value as Row)
    assert.equal(values.filter((value) => value.ok === true).length, 1)
    assert.equal(
      values.filter(
        (value) =>
          value.ok === false &&
          (value.errors as Row[]).some(
            (error) => error.messageKey === 'hospitality_core.error.inventoryUnavailable',
          ),
      ).length,
      1,
    )
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_reservation'))[0]?.n, 1)
    const ledger = await adapter.all('SELECT sold, total FROM hospitality_core_availability_ledger')
    assert.ok(ledger.every((row) => Number(row.sold) === 1 && Number(row.total) === 1))
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: room assignments are append-only across check-in, move and checkout', async () => {
  const adapter = await boot(true)
  try {
    await call('hospitality_core.createReservation', housekeepingReservation('r1'), adapter)
    const checkedIn = await call(
      'hospitality_core.checkIn',
      {
        stayId: 'r1:stay',
        roomId: '101',
        assignmentId: 'a1',
        at: housekeepingAt(0, 14, 5),
        guests: [
          {
            fullName: 'Synthetic guest',
            type: 'passport',
            number: 'TEST1234',
            birth: '1990-01-01',
            gender: 'female',
            nationality: 'VN',
          },
        ],
      },
      adapter,
    )
    assert.equal((checkedIn.value as Row).state, 'checked_in')
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'occupied',
    )

    const moved = await call(
      'hospitality_core.moveRoom',
      {
        stayId: 'r1:stay',
        roomId: '102',
        assignmentId: 'a2',
        reason: 'upgrade',
        at: housekeepingAt(1, 9, 0),
      },
      adapter,
    )
    assert.equal((moved.value as Row).roomId, '102')
    const afterMove = await adapter.all(
      'SELECT id, state, "roomId", "endAt" FROM hospitality_core_room_assignment ORDER BY "startAt"',
    )
    assert.deepEqual(
      afterMove.map((row) => [row.id, row.state, row.roomId, !!row.endAt]),
      [
        ['a1', 'closed', '101', true],
        ['a2', 'active', '102', false],
      ],
    )
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'dirty',
    )
    const moveTasks = await adapter.all(
      `SELECT "roomId", "stayId", "taskType", priority, state, notes
         FROM hospitality_core_cleaning_task
        WHERE id = ?`,
      ['move:a1:clean'],
    )
    assert.deepEqual(
      { ...moveTasks[0] },
      {
        roomId: '101',
        stayId: null,
        taskType: 'checkout_clean',
        priority: 'normal',
        state: 'todo',
        notes: 'upgrade',
      },
    )

    const checkedOut = await call(
      'hospitality_core.checkOut',
      { handover: ['keys', 'charges'], stayId: 'r1:stay', at: housekeepingAt(2, 12, 0) },
      adapter,
    )
    assert.equal((checkedOut.value as Row).state, 'checked_out')
    const stay = (await adapter.all('SELECT state, "currentRoomId" FROM hospitality_core_stay'))[0]!
    assert.deepEqual({ ...stay }, { state: 'checked_out', currentRoomId: null })
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['102']))[0]!.status,
      'dirty',
    )
    assert.equal((await adapter.all('SELECT state FROM hospitality_core_folio'))[0]!.state, 'closed')
    assert.equal(
      (await adapter.all('SELECT state FROM hospitality_core_reservation'))[0]!.state,
      'checked_out',
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: one physical room cannot be checked in twice', async (t) => {
  onBookingDay(t)
  const adapter = await boot(true)
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    await call('hospitality_core.createReservation', reservation('r2'), adapter)
    const first = await call(
      'hospitality_core.checkIn',
      {
        stayId: 'r1:stay',
        roomId: '101',
        assignmentId: 'a1',
        at: '2026-09-01T14:05:00.000Z',
        guests: arrivalGuests,
      },
      adapter,
    )
    assert.equal((first.value as Row).ok, true, JSON.stringify(first.value))
    const collision = await call(
      'hospitality_core.checkIn',
      {
        stayId: 'r2:stay',
        roomId: '101',
        assignmentId: 'a2',
        at: '2026-09-01T14:06:00.000Z',
        guests: arrivalGuests,
      },
      adapter,
    )
    assert.equal((collision.value as Row).ok, false)
    assert.equal(((collision.value as Row).errors as Row[])[0]!.code, 'room_not_available')
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_room_assignment'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: cancellation preserves audit rows and voids operational charges', async (t) => {
  onBookingDay(t)
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    const cancelled = await call(
      'hospitality_core.cancelReservation',
      { id: 'r1', reason: 'guest request', at: '2026-08-25T00:00:00.000Z' },
      adapter,
    )
    assert.equal((cancelled.value as Row).state, 'cancelled')
    assert.equal((await adapter.all('SELECT state FROM hospitality_core_charge'))[0]!.state, 'void')
    const folio = (await adapter.all('SELECT state, "amountTotal" FROM hospitality_core_folio'))[0]!
    assert.deepEqual({ ...folio }, { state: 'cancelled', amountTotal: '0' })
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_reservation'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: charges are idempotent and guest lists do not expose contact PII', async (t) => {
  onBookingDay(t, '2026-08-25T10:05:00.000Z')
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    await call('hospitality_core.createReservation', reservation('r2'), adapter)
    const charge = {
      id: 'spa-1',
      folioId: 'r1:folio',
      stayId: 'r1:stay',
      description: 'Spa',
      type: 'spa',
      quantity: '1',
      unitPrice: '25',
      sourceKey: 'spa:visit:1',
    }
    const first = await call('hospitality_core.addCharge', charge, adapter)
    const retry = await call('hospitality_core.addCharge', { ...charge, id: 'spa-retry' }, adapter)
    assert.equal((first.value as Row).amount, '25')
    assert.equal((retry.value as Row).id, 'spa-1')
    assert.equal((retry.value as Row).existing, true)
    assert.equal(
      (await adapter.all('SELECT "amountTotal" FROM hospitality_core_folio WHERE id = ?', ['r1:folio']))[0]!
        .amountTotal,
      '225',
    )
    const tampered = await call(
      'hospitality_core.voidCharge',
      { id: 'spa-1', folioId: 'r2:folio', reason: 'tampered route scope' },
      adapter,
    )
    assert.equal((tampered.value as Row).ok, false)
    assert.equal(((tampered.value as Row).errors as Row[])[0]!.code, 'folio_mismatch')
    assert.equal(
      (await adapter.all('SELECT state FROM hospitality_core_charge WHERE id = ?', ['spa-1']))[0]!.state,
      'active',
    )
    const voided = await call(
      'hospitality_core.voidCharge',
      {
        id: 'spa-1',
        folioId: 'r1:folio',
        reason: 'posted twice',
        voidedAt: '2026-08-25T10:00:00.000Z',
      },
      adapter,
    )
    const voidRetry = await call(
      'hospitality_core.voidCharge',
      { id: 'spa-1', folioId: 'r1:folio', reason: 'retry must not change evidence' },
      adapter,
    )
    assert.deepEqual(
      {
        ok: (voided.value as Row).ok,
        amount: (voided.value as Row).amount,
        amountTotal: (voided.value as Row).amountTotal,
        existing: (voided.value as Row).existing,
      },
      { ok: true, amount: '25', amountTotal: '200', existing: false },
    )
    assert.equal((voidRetry.value as Row).existing, true)
    const storedCharge = (
      await adapter.all('SELECT state, "voidedAt", "voidReason" FROM hospitality_core_charge WHERE id = ?', [
        'spa-1',
      ])
    )[0]!
    assert.deepEqual(
      { ...storedCharge },
      { state: 'void', voidedAt: '2026-08-25T10:00:00.000Z', voidReason: 'posted twice' },
    )
    assert.equal(
      (await adapter.all('SELECT "amountTotal" FROM hospitality_core_folio WHERE id = ?', ['r1:folio']))[0]!
        .amountTotal,
      '200',
    )

    await call(
      'hospitality_core.addStayGuest',
      { id: 'g2', stayId: 'r1:stay', partnerId: 'companion', displayName: 'Trần Bình' },
      adapter,
    )
    const guests = (await call('hospitality_core.listStayGuests', { stayId: 'r1:stay' }, adapter))
      .value as Row[]
    assert.deepEqual(
      guests.map((guest) => Object.keys(guest).sort()),
      [
        ['displayName', 'id', 'primary', 'stayId'],
        ['displayName', 'id', 'primary', 'stayId'],
      ],
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: identity documents use storage references and safe projections', async (t) => {
  onBookingDay(t)
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    const unregistered = await call(
      'hospitality_core.saveGuestDocument',
      {
        id: 'doc1',
        stayId: 'r1:stay',
        partnerId: 'companion',
        type: 'passport',
        number: 'P7654321',
        fullName: 'TRAN BINH',
      },
      adapter,
    )
    assert.equal((unregistered.value as Row).ok, false)
    assert.equal(((unregistered.value as Row).errors as Row[])[0]?.code, 'guest_not_registered')

    const saved = await call(
      'hospitality_core.saveGuestDocument',
      {
        id: 'doc1',
        stayId: 'r1:stay',
        partnerId: 'guest',
        type: 'passport',
        number: 'P1234567',
        fullName: 'NGUYEN AN',
        dateOfBirth: '1990-05-12T00:00:00.000Z',
        nationality: 'VN',
        permanentAddress: 'private address',
        ocrRaw: { confidence: 0.99 },
      },
      adapter,
    )
    assert.equal((saved.value as Row).ok, true)
    await call(
      'hospitality_core.addStayGuest',
      { id: 'g2', stayId: 'r1:stay', partnerId: 'companion', displayName: 'Trần Bình' },
      adapter,
    )
    const reassigned = await call(
      'hospitality_core.saveGuestDocument',
      {
        id: 'doc1',
        stayId: 'r1:stay',
        partnerId: 'companion',
        type: 'passport',
        fullName: 'TRAN BINH',
      },
      adapter,
    )
    assert.equal((reassigned.value as Row).ok, false)
    assert.equal(((reassigned.value as Row).errors as Row[])[0]?.code, 'document_owner_immutable')

    const documents = (await call('hospitality_core.listGuestDocuments', { stayId: 'r1:stay' }, adapter))
      .value as Row[]
    assert.equal(documents[0]!.numberLast4, '4567')
    assert.equal(documents[0]!.dateOfBirthPresent, true)
    assert.equal('number' in documents[0]!, false)
    assert.equal('permanentAddress' in documents[0]!, false)
    assert.equal('ocrRaw' in documents[0]!, false)
    assert.doesNotMatch(JSON.stringify(documents), /P1234567|private address|confidence/)
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: tape chart keeps assigned and unassigned stays in one schedule', async (t) => {
  // The schedule is historical: its booking and arrival happen on their own day.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-01T14:10:00.000Z') })
  const adapter = await boot(true)
  try {
    for (const id of ['r1', 'r2']) {
      const created = await call('hospitality_core.createReservation', reservation(id), adapter)
      assert.notEqual((created.value as Row).ok, false, JSON.stringify(created.value))
    }
    const arrived = await call(
      'hospitality_core.checkIn',
      {
        stayId: 'r1:stay',
        roomId: '101',
        assignmentId: 'a1',
        at: '2026-09-01T14:05:00.000Z',
        guests: [
          {
            fullName: 'Nguyễn An',
            type: 'passport',
            number: 'TEST1234',
            birth: '1990-01-01',
            gender: 'female',
            nationality: 'VN',
          },
        ],
      },
      adapter,
    )
    assert.notEqual((arrived.value as Row).ok, false, JSON.stringify(arrived.value))
    const chart = (
      await call(
        'hospitality_core.getTapeChart',
        { propertyId: 'hotel', from: '2026-09-01T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z' },
        adapter,
      )
    ).value as Row
    assert.equal((chart.rooms as Row[]).length, 2)
    assert.deepEqual((chart.events as Row[]).map((event) => [event.stayId, event.roomId]).sort(), [
      ['r1:stay', '101'],
      ['r2:stay', null],
    ])
    // The plan reads names only: no contact, documents or money on a bar.
    assert.deepEqual(Object.keys((chart.rooms as Row[])[0]!).sort(), [
      'code',
      'floorId',
      'id',
      'name',
      'roomTypeId',
      'status',
    ])
    assert.deepEqual(Object.keys((chart.events as Row[])[0]!).sort(), [
      'end',
      'guest',
      'id',
      'provider',
      'reservationId',
      'roomId',
      'roomTypeId',
      'start',
      'state',
      'stayId',
    ])
    assert.equal((chart.events as Row[]).find((event) => event.stayId === 'r1:stay')!.guest, 'Nguyễn An')
    // A window wider than the plan's is cut to 62 nights rather than read whole.
    const wide = (
      await call(
        'hospitality_core.getTapeChart',
        { propertyId: 'hotel', from: '2026-09-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' },
        adapter,
      )
    ).value as Row
    assert.equal(
      Math.round((Date.parse(String(wide.to)) - Date.parse('2026-09-01T00:00:00.000Z')) / 86_400_000),
      62,
    )
    // Another company or a property outside the reader's branches sees an empty plan, not this one.
    const foreign = (
      await roomFixtureCall(
        'hospitality_core.getTapeChart',
        { propertyId: 'hotel', from: '2026-09-01T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z' },
        { adapter, manifest, scope: { company: 'other', branches: null } },
      )
    ).value as Row
    assert.deepEqual([foreign.rooms, foreign.events], [[], []])
    const branchless = (
      await roomFixtureCall(
        'hospitality_core.getRoomPlanPeek',
        { id: 'r1' },
        { adapter, manifest, scope: { company: 'acme', branches: ['elsewhere'] } },
      )
    ).value as Row
    assert.equal(branchless.record, null)
    // A block covering the business day is today's truth for the room, whatever its housekeeping status
    // says; one starting later leaves today alone. Both rooms are sold on the 1st, so two more are blocked.
    for (const id of ['103', '104'])
      await call(
        'hospitality_core.saveRoom',
        { id, propertyId: 'hotel', roomTypeId: 'deluxe', code: id, name: id },
        adapter,
      )
    const statusOf = async (id: string) =>
      (
        (
          (
            await call(
              'hospitality_core.getTapeChart',
              { propertyId: 'hotel', from: '2026-09-01T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z' },
              adapter,
            )
          ).value as Row
        ).rooms as Row[]
      ).find((row) => row.id === id)!.status
    const block = async (id: string, dateFrom: string, dateTo: string) => {
      const room = (await call('hospitality_core.getRoom', { id }, adapter)).value as Row
      const blocked = await call(
        'hospitality_core.blockRoom',
        {
          roomId: id,
          kind: 'ooo',
          dateFrom,
          dateTo,
          reason: 'Synthetic leak',
          expectedVersion: room.version ?? 0,
          requestKey: `plan-block-${id}`,
        },
        adapter,
      )
      assert.notEqual((blocked.value as Row).ok, false, JSON.stringify(blocked.value))
    }
    await block('104', '2026-09-05', '2026-09-06')
    await block('103', '2026-09-01', '2026-09-02')
    assert.equal(await statusOf('103'), 'out_of_order')
    assert.notEqual(await statusOf('104'), 'out_of_order')

    // The peek: the few facts the desk decides on, without contact or identity details.
    const peek = ((await call('hospitality_core.getRoomPlanPeek', { id: 'r1' }, adapter)).value as Row)
      .record as Row
    assert.equal(peek.state, 'checked_in')
    assert.deepEqual(peek.guest, { name: 'Nguyễn An' })
    assert.deepEqual(peek.room, { code: '101' })
    assert.equal(typeof (peek.folio as Row | null)?.id, 'string')
    assert.deepEqual(Object.keys(peek).sort(), [
      'adults',
      'amountTotal',
      'arrival',
      'benefits',
      'checkIn',
      'checkOut',
      'children',
      'code',
      'currency',
      'folio',
      'guarantee',
      'guest',
      'id',
      'nights',
      'propertyId',
      'room',
      'roomType',
      'source',
      'state',
    ])
    assert.equal(
      ((await call('hospitality_core.getRoomPlanPeek', { id: 'missing' }, adapter)).value as Row).record,
      null,
    )
    // The frame: the reader's properties and the chosen one's types and floors, no rooms.
    const frame = (await call('hospitality_core.getRoomPlanFrame', {}, adapter)).value as Row
    assert.equal((frame.property as Row).id, 'hotel')
    assert.deepEqual(frame.types, [{ id: 'deluxe', code: 'DLX', name: 'Deluxe' }])
    assert.ok((frame.floors as Row[]).length >= 1)
    assert.equal('rooms' in frame, false)
    const strangers = (
      await roomFixtureCall(
        'hospitality_core.getRoomPlanFrame',
        {},
        { adapter, manifest, scope: { company: 'other', branches: null } },
      )
    ).value as Row
    assert.deepEqual([strangers.property, strangers.properties], [null, []])
    // A departed stay's peek still names the room it slept in, though the room no longer holds it.
    t.mock.timers.setTime(Date.parse('2026-09-03T04:05:00.000Z'))
    const departed = await call(
      'hospitality_core.checkOut',
      { stayId: 'r1:stay', at: '2026-09-03T04:00:00.000Z', handover: ['keys', 'charges'] },
      adapter,
    )
    assert.notEqual((departed.value as Row).ok, false, JSON.stringify(departed.value))
    const gone = ((await call('hospitality_core.getRoomPlanPeek', { id: 'r1' }, adapter)).value as Row)
      .record as Row
    assert.deepEqual([gone.state, gone.room], ['checked_out', { code: '101' }])

    // The room board and the plan answer "is this room out today" alike: on 3 September room 103's block
    // has passed its planned end but nobody reopened it, so it still holds the room; 104's starts later.
    await adapter.run(
      'UPDATE hospitality_core_property SET businessDate = ? WHERE id = ? AND companyId = ?',
      ['2026-09-03', 'hotel', 'acme'],
    )
    const board = (await call('hospitality_core.getRoomBoard', { propertyId: 'hotel', peek: '104' }, adapter))
      .value as Row
    const onBoard = (id: string) => (board.rows as Row[]).find((row) => row.id === id)?.status
    assert.deepEqual(
      [await statusOf('103'), onBoard('103'), (board.selected as Row).status],
      ['out_of_order', 'out_of_order', 'dirty'],
    )
    assert.notEqual(await statusOf('104'), 'out_of_order')
    assert.notEqual(onBoard('104'), 'out_of_order')
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: nightly quantity follows the property calendar, not UTC dates', async (t) => {
  onBookingDay(t)
  const adapter = await boot()
  try {
    await call(
      'hospitality_core.saveProperty',
      {
        id: 'honolulu',
        code: 'HNL',
        name: 'Ket Honolulu',
        accommodationType: 'hotel',
        timezone: 'Pacific/Honolulu',
      },
      adapter,
    )
    await call(
      'hospitality_core.saveRoomType',
      { id: 'ocean', propertyId: 'honolulu', code: 'OCN', name: 'Ocean', baseRate: '100' },
      adapter,
    )
    await call(
      'hospitality_core.saveRoom',
      { id: 'hnl-101', propertyId: 'honolulu', roomTypeId: 'ocean', code: '101', name: '101' },
      adapter,
    )
    await openProperty('honolulu', 'ocean', adapter)
    const created = await call(
      'hospitality_core.createReservation',
      reservation('honolulu-night', {
        propertyId: 'honolulu',
        roomTypeId: 'ocean',
        checkIn: '2026-09-02T01:00:00.000Z',
        checkOut: '2026-09-02T21:00:00.000Z',
      }),
      adapter,
    )
    assert.equal((created.value as Row).ok, true)
    const row = (
      await adapter.all('SELECT quantity, "amountTotal" FROM hospitality_core_reservation WHERE id = ?', [
        'honolulu-night',
      ])
    )[0]!
    assert.deepEqual({ ...row }, { quantity: '1', amountTotal: '100' })
  } finally {
    await adapter.close()
  }
})

const housekeepingAt = (offset: number, hour: number, minute: number) =>
  zonedDateTime(
    addCalendarDays(dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh'), offset),
    hour,
    minute,
    'Asia/Ho_Chi_Minh',
  ).toISOString()
const housekeepingReservation = (id: string) =>
  reservation(id, { checkIn: housekeepingAt(0, 14, 0), checkOut: housekeepingAt(2, 12, 0) })
const arriveHousekeeping = async (input: Record<string, unknown>, adapter: Adapter) => {
  const result = await call(
    'hospitality_core.checkIn',
    {
      ...input,
      earlyFee: 'waived',
      earlyReason: 'Synthetic housekeeping fixture',
      guests: arrivalGuests,
    },
    adapter,
  )
  assert.equal((result.value as Row).ok, true, JSON.stringify(result.value))
  return result
}

test('hospitality housekeeping: checkout creates one urgent task and cleaning restores the room', async () => {
  const adapter = await boot(true)
  try {
    const created = await call(
      'hospitality_core.createReservation',
      housekeepingReservation('clean'),
      adapter,
    )
    assert.equal((created.value as Row).ok, true, JSON.stringify(created.value))
    await arriveHousekeeping(
      {
        stayId: 'clean:stay',
        roomId: '101',
        assignmentId: 'clean:assignment',
        at: housekeepingAt(0, 14, 5),
      },
      adapter,
    )
    await call(
      'hospitality_core.checkOut',
      { handover: ['keys', 'charges'], stayId: 'clean:stay', at: housekeepingAt(2, 12, 0) },
      adapter,
    )
    await call(
      'hospitality_core.checkOut',
      { handover: ['keys', 'charges'], stayId: 'clean:stay', at: housekeepingAt(2, 12, 0) },
      adapter,
    )

    const tasks = await adapter.all(
      'SELECT id, state, priority, "taskType", "roomId" FROM hospitality_core_cleaning_task',
    )
    assert.deepEqual(
      tasks.map((row) => ({ ...row })),
      [
        {
          id: 'checkout:clean:stay',
          state: 'todo',
          priority: 'urgent',
          taskType: 'checkout_clean',
          roomId: '101',
        },
      ],
    )
    const detail = (await call('hospitality_core.getCleaningTask', { id: 'checkout:clean:stay' }, adapter))
      .value as Row
    assert.equal((detail.room as Row).status, 'dirty')
    assert.equal((detail.property as Row).name, 'Ket Hotel')
    assert.equal((detail.stay as Row).code, 'S-CLEAN')
    const hidden = await callFn(
      'hospitality_core.getCleaningTask',
      { id: 'checkout:clean:stay' },
      { adapter, manifest, scope: { company: 'globex', branches: null } },
    )
    assert.equal(hidden.value, null, 'a company cannot open another company’s housekeeping task')
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'dirty',
    )

    const started = await call(
      'hospitality_core.startCleaningTask',
      { id: 'checkout:clean:stay', at: housekeepingAt(2, 12, 5) },
      adapter,
    )
    assert.equal((started.value as Row).state, 'in_progress')
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'cleaning',
    )

    const completed = await call(
      'hospitality_core.completeCleaningTask',
      {
        checklist: ['linen', 'bathroom', 'supplies', 'final'],
        id: 'checkout:clean:stay',
        at: housekeepingAt(2, 12, 30),
      },
      adapter,
    )
    assert.equal((completed.value as Row).state, 'done')
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'available',
    )
    const summary = (await call('hospitality_core.cleaningTaskSummary', { propertyId: 'hotel' }, adapter))
      .value as Row
    assert.deepEqual(summary, { todo: 0, inProgress: 0, done: 1, cancelled: 0 })
  } finally {
    await adapter.close()
  }
})

test('hospitality housekeeping: room board is scoped, exact and rejects unsafe status changes', async () => {
  const adapter = await boot(true)
  try {
    const missingReason = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'available', status: 'maintenance' },
      adapter,
    )
    assert.equal((missingReason.value as Row).ok, false)
    assert.equal(((missingReason.value as Row).errors as Row[])[0]!.code, 'room_status_note_required')

    const bypassHousekeeping = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'available', status: 'available' },
      adapter,
    )
    assert.equal(
      ((bypassHousekeeping.value as Row).errors as Row[])[0]!.code,
      'room_status_available_managed',
    )

    const serviced = await call(
      'hospitality_core.setRoomStatus',
      {
        id: '101',
        expectedStatus: 'available',
        status: 'maintenance',
        note: 'Khóa nước tầng 1.',
      },
      adapter,
    )
    assert.equal((serviced.value as Row).status, 'maintenance')
    const serviceRetry = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'maintenance', status: 'maintenance' },
      adapter,
    )
    assert.equal((serviceRetry.value as Row).status, 'maintenance')
    const stale = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'available', status: 'dirty' },
      adapter,
    )
    assert.equal(((stale.value as Row).errors as Row[])[0]!.code, 'transition_conflict')

    const summary = (await call('hospitality_core.roomStatusSummary', { propertyId: 'hotel' }, adapter))
      .value as Row
    assert.deepEqual(summary, {
      available: 1,
      occupied: 0,
      dirty: 0,
      cleaning: 0,
      maintenance: 1,
      outOfOrder: 0,
    })
    const detail = (await call('hospitality_core.getHousekeepingRoom', { id: '101' }, adapter)).value as Row
    assert.equal((detail.property as Row).name, 'Ket Hotel')
    assert.equal((detail.roomType as Row).name, 'Deluxe')
    assert.equal(detail.note, 'Khóa nước tầng 1.')
    const hidden = await callFn(
      'hospitality_core.getHousekeepingRoom',
      { id: '101' },
      { adapter, manifest, scope: { company: 'globex', branches: null } },
    )
    assert.equal(hidden.value, null)

    const wrongTaskType = await call(
      'hospitality_core.createCleaningTask',
      { id: 'wrong-service-task', code: 'HK-WRONG', roomId: '101', taskType: 'inspection' },
      adapter,
    )
    assert.equal(((wrongTaskType.value as Row).errors as Row[])[0]!.code, 'cleaning_room_status')
    await call(
      'hospitality_core.createCleaningTask',
      { id: 'maintenance-task', code: 'HK-MAINT', roomId: '101', taskType: 'maintenance' },
      adapter,
    )
    const releaseBlocked = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'maintenance', status: 'dirty' },
      adapter,
    )
    assert.equal(((releaseBlocked.value as Row).errors as Row[])[0]!.code, 'room_task_open')
    await call('hospitality_core.cancelCleaningTask', { id: 'maintenance-task' }, adapter)
    await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'maintenance', status: 'dirty' },
      adapter,
    )
    await call(
      'hospitality_core.createCleaningTask',
      { id: 'room-board-clean', code: 'HK-ROOM-BOARD', roomId: '101', taskType: 'inspection' },
      adapter,
    )
    const taskBlocked = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'dirty', status: 'out_of_order', note: 'Khóa phòng.' },
      adapter,
    )
    assert.equal(((taskBlocked.value as Row).errors as Row[])[0]!.code, 'room_task_open')

    await call('hospitality_core.startCleaningTask', { id: 'room-board-clean' }, adapter)
    const cleaningBlocked = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'cleaning', status: 'maintenance', note: 'Dừng việc.' },
      adapter,
    )
    assert.equal(((cleaningBlocked.value as Row).errors as Row[])[0]!.code, 'room_cleaning')
    await call(
      'hospitality_core.completeCleaningTask',
      { checklist: ['linen', 'bathroom', 'supplies', 'final'], id: 'room-board-clean' },
      adapter,
    )

    const created = await call(
      'hospitality_core.createReservation',
      housekeepingReservation('occupied-board'),
      adapter,
    )
    assert.equal((created.value as Row).ok, true, JSON.stringify(created.value))
    await arriveHousekeeping(
      {
        stayId: 'occupied-board:stay',
        roomId: '102',
        assignmentId: 'occupied-board:assignment',
        at: housekeepingAt(0, 14, 5),
      },
      adapter,
    )
    const occupiedBlocked = await call(
      'hospitality_core.setRoomStatus',
      { id: '102', expectedStatus: 'occupied', status: 'maintenance', note: 'Không an toàn.' },
      adapter,
    )
    assert.equal(((occupiedBlocked.value as Row).errors as Row[])[0]!.code, 'room_occupied')
    const occupied = (await call('hospitality_core.getHousekeepingRoom', { id: '102' }, adapter)).value as Row
    assert.equal((occupied.currentStay as Row).code, 'S-OCCUPIED-BOARD')
    assert.equal(((occupied.currentStay as Row).partner as Row).name, 'Nguyễn An')
  } finally {
    await adapter.close()
  }
})

test('hospitality housekeeping: stayover cleaning never makes an occupied room available', async () => {
  const adapter = await boot(true)
  try {
    const created = await call(
      'hospitality_core.createReservation',
      housekeepingReservation('stayover'),
      adapter,
    )
    assert.equal((created.value as Row).ok, true, JSON.stringify(created.value))
    await arriveHousekeeping(
      {
        stayId: 'stayover:stay',
        roomId: '101',
        assignmentId: 'stayover:assignment',
        at: housekeepingAt(0, 14, 5),
      },
      adapter,
    )
    await call(
      'hospitality_core.createCleaningTask',
      {
        id: 'stayover-clean',
        code: 'HK-STAYOVER',
        roomId: '101',
        stayId: 'stayover:stay',
        taskType: 'daily_clean',
      },
      adapter,
    )
    await call('hospitality_core.startCleaningTask', { id: 'stayover-clean' }, adapter)
    await call(
      'hospitality_core.completeCleaningTask',
      { checklist: ['linen', 'bathroom', 'supplies', 'final'], id: 'stayover-clean' },
      adapter,
    )

    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'occupied',
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality housekeeping: a room stays cleaning until its last active task finishes', async () => {
  const adapter = await boot(true)
  try {
    await call('hospitality_core.setRoomStatus', { id: '101', status: 'dirty' }, adapter)
    for (const id of ['clean-a', 'clean-b']) {
      await call(
        'hospitality_core.createCleaningTask',
        {
          id,
          code: id.toUpperCase(),
          roomId: '101',
          taskType: id === 'clean-a' ? 'daily_clean' : 'inspection',
        },
        adapter,
      )
      await call('hospitality_core.startCleaningTask', { id }, adapter)
    }
    await call(
      'hospitality_core.completeCleaningTask',
      { checklist: ['linen', 'bathroom', 'supplies', 'final'], id: 'clean-a' },
      adapter,
    )
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'cleaning',
    )
    await call(
      'hospitality_core.completeCleaningTask',
      { checklist: ['linen', 'bathroom', 'supplies', 'final'], id: 'clean-b' },
      adapter,
    )
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'available',
    )
  } finally {
    await adapter.close()
  }
})

test('check-out readiness answers before the button, not after it', async () => {
  const adapter = await boot()
  try {
    await call(
      'hospitality_core.saveProperty',
      {
        id: 'hotel',
        code: 'HCM',
        name: 'Ket Hotel',
        accommodationType: 'hotel',
        enforceTimes: true,
        defaultCheckOut: '12:00',
      },
      adapter,
    )
    await call(
      'hospitality_core.saveRoom',
      { id: '401', propertyId: 'hotel', roomTypeId: 'deluxe', code: '401', name: '401' },
      adapter,
    )
    await call(
      'hospitality_core.saveRatePlan',
      {
        id: 'checkout-rate',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        code: 'BAR',
        name: 'Standard',
        rateType: 'nightly',
        amount: '200',
      },
      adapter,
    )
    const property = (await call('hospitality_core.getProperty', { id: 'hotel' }, adapter)).value as Row
    const opened = (
      await call(
        'hospitality_core.setPropertyLifecycle',
        {
          propertyId: 'hotel',
          lifecycle: 'active',
          expectedVersion: property.version,
          requestKey: 'checkout-open-property',
        },
        adapter,
      )
    ).value as Row
    assert.equal(opened.ok, true, JSON.stringify(opened.errors))
    // Arrive at 10:00 on the property's civil day three days ago. Anchoring to
    // the clock instead made the check-in an hour later cross the property's
    // midnight whenever the suite ran between 23:00 and 24:00 there.
    const timezone = String(property.timezone)
    const arrivalDay = dateKeyIn(new Date(Date.now() - 3 * 86_400_000), timezone)
    const arrivalAt = zonedDateTime(arrivalDay, 10, 0, timezone)
    // This fixture represents a property whose business day is still open from the arrival date.
    await adapter.run(
      'UPDATE hospitality_core_property SET businessDate = ? WHERE id = ? AND companyId = ?',
      [arrivalDay, 'hotel', 'acme'],
    )
    const today = dateKeyIn(new Date(), timezone)
    const departureAt = zonedDateTime(today, 0, 0, timezone).toISOString()
    const created = (
      await call(
        'hospitality_core.createReservation',
        {
          id: 'departing',
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          partnerId: 'guest',
          bookingType: 'nightly',
          billingMode: 'upfront',
          checkIn: arrivalAt.toISOString(),
          checkOut: departureAt,
          rate: '200',
        },
        adapter,
      )
    ).value as Row
    assert.equal(created.ok, true, JSON.stringify(created.errors))

    // Before check-in there is nothing to check out of, and the reason is the
    // same one `checkOut` would give — read rather than discovered.
    const early = (await call('hospitality_core.checkOutReadiness', { stayId: 'departing:stay' }, adapter))
      .value as Row
    assert.equal(early.ready, false)
    const beforeStay = (await call('hospitality_core.getStay', { id: 'departing:stay' }, adapter))
      .value as Row
    assert.equal(early.stayVersion, Number(beforeStay.version ?? 0))
    assert.deepEqual(
      (early.blockers as Row[]).map((blocker) => blocker.code),
      ['stay_cannot_check_out'],
    )

    const cleaned = (
      await call(
        'hospitality_core.completeRoomCleaning',
        { roomId: '401', expectedVersion: 1, requestKey: 'checkout-fixture-clean-room' },
        adapter,
      )
    ).value as Row
    assert.equal(cleaned.ok, true, JSON.stringify(cleaned.errors))
    const checkedIn = (
      await call(
        'hospitality_core.checkIn',
        {
          stayId: 'departing:stay',
          roomId: '401',
          assignmentId: 'departing:assignment',
          earlyFee: 'waived',
          earlyReason: 'Synthetic early arrival',
          guests: [
            {
              fullName: 'Nguyễn An',
              type: 'passport',
              number: 'TEST1234',
              birth: '1990-01-01',
              gender: 'female',
              nationality: 'VN',
            },
          ],
          at: new Date(arrivalAt.getTime() + 3_600_000).toISOString(),
        },
        adapter,
      )
    ).value as Row
    assert.equal(checkedIn.ok, true, JSON.stringify(checkedIn.errors))
    const ready = (await call('hospitality_core.checkOutReadiness', { stayId: 'departing:stay' }, adapter))
      .value as Row
    assert.deepEqual(
      {
        ready: ready.ready,
        room: ready.roomName,
        guest: ready.guestName,
        late: ready.late,
        // The hour is past and this property enforces it, so the desk is told
        // to write down why before it presses anything.
        lateReasonRequired: ready.lateReasonRequired,
        balance: ready.balance,
        blockers: (ready.blockers as Row[]).length,
      },
      {
        ready: true,
        room: '401',
        guest: 'Nguyễn An',
        late: true,
        lateReasonRequired: true,
        balance: '600',
        blockers: 0,
      },
    )
    assert.equal((ready.charges as Row[]).length, 1, 'the room charge is on the bill')

    // And the reason gets through: without it the operation is refused, which
    // is exactly the dead end the desk used to hit with no way forward.
    const refused = (
      await call(
        'hospitality_core.checkOut',
        { handover: ['keys', 'charges'], stayId: 'departing:stay' },
        adapter,
      )
    ).value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]?.code, 'late_check_out')
    const done = (
      await call(
        'hospitality_core.checkOut',
        { handover: ['keys', 'charges'], stayId: 'departing:stay', lateReason: 'Khách chờ xe sân bay' },
        adapter,
      )
    ).value as Row
    assert.equal(done.ok, true, JSON.stringify(done.errors))

    const after = (await call('hospitality_core.checkOutReadiness', { stayId: 'departing:stay' }, adapter))
      .value as Row
    assert.equal(after.ready, false)
    assert.deepEqual(
      (after.blockers as Row[]).map((blocker) => blocker.code),
      ['stay_already_checked_out'],
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality housekeeping: guest refusal is versioned, replayable and never frees the room', async () => {
  const adapter = await boot(true)
  try {
    const created = await call(
      'hospitality_core.createReservation',
      housekeepingReservation('refusal'),
      adapter,
    )
    assert.equal((created.value as Row).ok, true, JSON.stringify(created.value))
    await arriveHousekeeping(
      {
        stayId: 'refusal:stay',
        roomId: '101',
        assignmentId: 'refusal:assignment',
        at: housekeepingAt(0, 14, 5),
      },
      adapter,
    )
    const made = await call(
      'hospitality_core.createCleaningTask',
      {
        id: 'refusal-clean',
        code: 'HK-REFUSAL',
        roomId: '101',
        stayId: 'refusal:stay',
        taskType: 'daily_clean',
      },
      adapter,
    )
    assert.equal((made.value as Row).ok, true)
    const task = (
      (await call('hospitality_core.getCleaningTaskRecord', { id: 'refusal-clean' }, adapter)).value as Row
    ).record as Row
    const command = {
      id: task.id,
      expectedVersion: Number(task.version ?? 0),
      requestKey: 'decline-daily',
      reason: 'Guest asked for privacy today',
    }
    const blank = await call(
      'hospitality_core.declineCleaningTask',
      { ...command, reason: ' ', requestKey: 'decline-blank' },
      adapter,
    )
    assert.equal((blank.value as Row).ok, false)
    const stale = await call(
      'hospitality_core.declineCleaningTask',
      { ...command, expectedVersion: 999, requestKey: 'decline-stale' },
      adapter,
    )
    assert.equal((stale.value as Row).ok, false)
    const refused = await call('hospitality_core.declineCleaningTask', command, adapter)
    assert.equal((refused.value as Row).ok, true, JSON.stringify(refused.value))
    assert.deepEqual(
      (await call('hospitality_core.declineCleaningTask', command, adapter)).value,
      refused.value,
    )
    const saved = (
      (await call('hospitality_core.getCleaningTaskRecord', { id: task.id }, adapter)).value as Row
    ).record as Row
    assert.equal(saved.state, 'declined')
    assert.equal(saved.declineReason, command.reason)
    assert.ok(saved.declinedAt)
    assert.equal(saved.doneAt, null)
    assert.equal('declinedBy' in saved, false)
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'occupied',
    )
    assert.equal(
      (
        (
          await call(
            'hospitality_core.startCleaningTask',
            { id: task.id, expectedVersion: saved.version, requestKey: 'restart-refused' },
            adapter,
          )
        ).value as Row
      ).ok,
      false,
    )
    const checkout = await call(
      'hospitality_core.createCleaningTask',
      { id: 'refusal-checkout', code: 'HK-REFUSAL-CHECKOUT', roomId: '102', taskType: 'checkout_clean' },
      adapter,
    )
    assert.equal((checkout.value as Row).ok, true)
    const other = (
      (await call('hospitality_core.getCleaningTaskRecord', { id: 'refusal-checkout' }, adapter)).value as Row
    ).record as Row
    assert.equal(
      (
        (
          await call(
            'hospitality_core.declineCleaningTask',
            { ...command, id: other.id, expectedVersion: other.version, requestKey: 'decline-checkout' },
            adapter,
          )
        ).value as Row
      ).ok,
      false,
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality moves: held rooms are excluded and repeated moves preserve cleaning history', async () => {
  const adapter = await boot(true)
  const run = async (name: string, args: Record<string, unknown>) =>
    (await call(name, args, adapter)).value as Row
  try {
    assert.equal(
      (await run('hospitality_core.createReservation', housekeepingReservation('moving'))).ok,
      true,
    )
    await arriveHousekeeping(
      { stayId: 'moving:stay', roomId: '101', assignmentId: 'moving:first', at: housekeepingAt(0, 14, 5) },
      adapter,
    )
    assert.equal(
      (await run('hospitality_core.createReservation', housekeepingReservation('held-other'))).ok,
      true,
    )
    assert.equal(
      (await run('hospitality_core.holdRoom', { stayId: 'held-other:stay', roomId: '102' })).ok,
      true,
    )
    const unavailable = await call(
      'hospitality_core.lookupReservationRooms',
      { reservationId: 'moving', moving: true },
      adapter,
    )
    assert.deepEqual(unavailable.value, [])
    const move = {
      stayId: 'moving:stay',
      roomId: '102',
      assignmentId: 'moving:second',
      reason: 'Guest requested a quieter room',
      at: housekeepingAt(0, 14, 10),
      requestKey: 'move-held-refused',
    }
    assert.equal((await run('hospitality_core.moveRoom', move)).ok, false)
    assert.equal((await run('hospitality_core.releaseRoomHold', { stayId: 'held-other:stay' })).ok, true)
    const rooms = (
      await call(
        'hospitality_core.lookupReservationRooms',
        { reservationId: 'moving', moving: true },
        adapter,
      )
    ).value as Row[]
    assert.deepEqual(
      rooms.map((room) => room.id),
      ['102'],
    )
    assert.equal(
      (await run('hospitality_core.moveRoom', { ...move, reason: ' ', requestKey: 'move-reason-refused' }))
        .ok,
      false,
    )
    assert.equal((await run('hospitality_core.moveRoom', { ...move, requestKey: 'move-accepted' })).ok, true)
    const vacated = await run('hospitality_core.getRoom', { id: '101' })
    assert.equal(vacated.status, 'dirty')
    assert.equal(
      (
        await run('hospitality_core.completeRoomCleaning', {
          roomId: '101',
          expectedVersion: vacated.version,
          requestKey: 'move-clean-old',
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await run('hospitality_core.moveRoom', {
          ...move,
          roomId: '101',
          assignmentId: 'moving:third',
          at: housekeepingAt(0, 14, 15),
          requestKey: 'move-back',
        })
      ).ok,
      true,
    )
    const work = await adapter.all(
      'SELECT "roomId", "taskType" FROM hospitality_core_cleaning_task WHERE id LIKE ?',
      ['move:%'],
    )
    assert.equal(work.length, 2)
    assert.ok(work.every((task) => task.taskType === 'checkout_clean'))
    const history = await adapter.all(
      'SELECT state FROM hospitality_core_room_assignment WHERE "stayId" = ?',
      ['moving:stay'],
    )
    assert.equal(history.filter((row) => row.state === 'closed').length, 2)
    assert.equal(history.filter((row) => row.state === 'active').length, 1)
  } finally {
    await adapter.close()
  }
})

test('hospitality added guest: declaration, headcount and configured extra bed commit once', async () => {
  const adapter = await boot(true)
  const run = async (name: string, args: Record<string, unknown>) =>
    (await call(name, args, adapter)).value as Row
  const versions = async () => {
    const booking = await run('hospitality_core.getReservation', { id: 'extra-person' })
    const stay = await run('hospitality_core.getStay', { id: 'extra-person:stay' })
    return {
      expectedVersion: Number(stay.version ?? 0),
      expectedReservationVersion: Number(booking.version ?? 0),
    }
  }
  try {
    assert.equal(
      (
        await run('hospitality_core.saveRoomType', {
          id: 'deluxe',
          propertyId: 'hotel',
          code: 'DLX',
          name: 'Deluxe',
          defaultCapacity: 2,
          maxAdults: 2,
          maxChildren: 1,
          maxExtraBeds: 1,
          baseRate: '100',
          published: true,
        })
      ).ok,
      true,
    )
    assert.equal(
      (await run('hospitality_core.createReservation', housekeepingReservation('extra-person'))).ok,
      true,
    )
    await arriveHousekeeping(
      {
        stayId: 'extra-person:stay',
        roomId: '101',
        assignmentId: 'extra-person:first',
        at: housekeepingAt(0, 14, 5),
      },
      adapter,
    )
    const person = {
      fullName: 'Additional synthetic adult',
      type: 'passport',
      number: 'ADD12345',
      birth: '1991-01-01',
      nationality: 'VN',
      gender: 'female',
    }
    const first = {
      stayId: 'extra-person:stay',
      guest: person,
      requestKey: 'guest-within-capacity',
      ...(await versions()),
    }
    const result = await run('hospitality_core.addInHouseGuest', first)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.adults, 2)
    assert.deepEqual(await run('hospitality_core.addInHouseGuest', first), result)
    const second = {
      ...first,
      guest: { ...person, number: 'ADD23456' },
      ...(await versions()),
      extraBed: true,
      expectedBedRate: '150000',
      requestKey: 'guest-needs-bed',
    }
    assert.equal(
      (await run('hospitality_core.addInHouseGuest', second)).ok,
      false,
      'Unconfigured extra bed cannot be sold',
    )
    assert.equal(
      (
        await run('hospitality_core.savePropertyCharge', {
          id: 'extra-bed-fee',
          propertyId: 'hotel',
          name: 'Extra bed',
          chargeType: 'extra_bed',
          basis: 'per_night',
          amount: '150000',
          included: false,
          active: true,
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await run('hospitality_core.addInHouseGuest', {
          ...second,
          requestKey: 'guest-price-stale',
          expectedBedRate: '100000',
        })
      ).ok,
      false,
    )
    await adapter.run('UPDATE hospitality_core_folio SET state = ? WHERE id = ?', [
      'closed',
      'extra-person:folio',
    ])
    assert.equal(
      (await run('hospitality_core.addInHouseGuest', second)).ok,
      false,
      'A failed charge rolls back the guest declaration',
    )
    assert.equal((await run('hospitality_core.getStay', { id: first.stayId })).adults, 2)
    assert.equal(
      (await adapter.all('SELECT id FROM hospitality_core_guest_document WHERE "stayId" = ?', [first.stayId]))
        .length,
      2,
    )
    await adapter.run('UPDATE hospitality_core_folio SET state = ? WHERE id = ?', [
      'open',
      'extra-person:folio',
    ])
    const added = await run('hospitality_core.addInHouseGuest', second)
    assert.equal(added.ok, true, JSON.stringify(added))
    assert.equal(added.adults, 3)
    assert.deepEqual(await run('hospitality_core.addInHouseGuest', second), added)
    const charges = await adapter.all('SELECT amount FROM hospitality_core_charge WHERE "sourceKey" LIKE ?', [
      'additional-guest:%',
    ])
    assert.deepEqual(
      charges.map((row) => row.amount),
      ['300000'],
    )
    assert.equal((await run('hospitality_core.getStay', { id: first.stayId })).adults, 3)
    assert.equal((await run('hospitality_core.getReservation', { id: 'extra-person' })).adults, 3)
    assert.equal(
      (
        await run('hospitality_core.addInHouseGuest', {
          ...second,
          ...(await versions()),
          guest: { ...person, number: 'ADD34567' },
          requestKey: 'guest-over-capacity',
        })
      ).ok,
      false,
    )
    const documents = await adapter.all('SELECT id FROM hospitality_core_guest_document WHERE "stayId" = ?', [
      first.stayId,
    ])
    assert.equal(documents.length, 3)
  } finally {
    await adapter.close()
  }
})

test('hospitality physical capacity: arrival refuses an undersized room and automatic assignment skips it', async () => {
  const adapter = await boot(true)
  const run = async (name: string, args: Record<string, unknown>) =>
    (await call(`hospitality_core.${name}`, args, adapter)).value as Row
  try {
    const room = await run('getRoom', { id: '101' })
    assert.equal(
      (
        await run('saveRoom', {
          id: room.id,
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          code: '101',
          name: 'Small',
          capacity: 1,
          expectedVersion: room.version,
          requestKey: 'narrow-empty-room',
        })
      ).ok,
      true,
    )
    assert.equal(
      (await run('createReservation', { ...housekeepingReservation('capacity-arrival'), adults: 2 })).ok,
      true,
    )
    const stayId = 'capacity-arrival:stay'
    const stay = await run('getStay', { id: stayId })
    const property = await run('getProperty', { id: 'hotel' })
    const input = {
      stayId,
      assignmentId: 'capacity-arrival:first',
      at: housekeepingAt(0, 14, 5),
      expectedVersion: stay.version,
      requestKey: 'capacity-arrival',
      guests: ['CAP12345', 'CAP23456'].map((number) => ({
        fullName: 'Synthetic adult',
        type: 'passport',
        number,
        birth: '1990-01-01',
        gender: 'female',
        nationality: 'VN',
      })),
    }
    const refused = await run('checkIn', { ...input, roomId: '101' })
    assert.ok(
      (refused.errors as Row[]).some((error) => error.code === 'room_guest_capacity'),
      JSON.stringify(refused),
    )
    assert.deepEqual(await run('getStay', { id: stayId }), stay)
    assert.equal((await run('getProperty', { id: 'hotel' })).version, property.version)
    assert.equal(
      (await adapter.all('SELECT id FROM hospitality_core_guest_document WHERE "stayId" = ?', [stayId]))
        .length,
      0,
    )
    const choices = (await run('lookupReservationRooms', {
      reservationId: 'capacity-arrival',
      readyOnly: true,
    })) as unknown as Row[]
    assert.deepEqual(
      choices.map((row) => row.id),
      ['102'],
    )
    const arrived = await run('checkIn', input)
    assert.equal(arrived.ok, true, JSON.stringify(arrived))
    assert.equal(arrived.roomId, '102')
    assert.deepEqual(await run('checkIn', input), arrived)
  } finally {
    await adapter.close()
  }
})

test('hospitality physical capacity: children use places and purchased extra beds survive safe moves', async () => {
  const adapter = await boot(true)
  const run = async (name: string, args: Record<string, unknown>) =>
    (await call(`hospitality_core.${name}`, args, adapter)).value as Row
  const versions = async () => ({
    expectedVersion: (await run('getStay', { id: 'family:stay' })).version,
    expectedReservationVersion: (await run('getReservation', { id: 'family' })).version,
  })
  try {
    assert.equal(
      (
        await run('saveRoomType', {
          id: 'deluxe',
          propertyId: 'hotel',
          code: 'DLX',
          name: 'Deluxe',
          defaultCapacity: 2,
          maxAdults: 2,
          maxChildren: 1,
          maxExtraBeds: 1,
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await run('saveRoom', {
          id: 'small-family',
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          code: '103',
          name: 'Small family room',
          capacity: 1,
        })
      ).ok,
      true,
    )
    const small = await run('getRoom', { id: 'small-family' })
    assert.equal(
      (
        await run('completeRoomCleaning', {
          roomId: small.id,
          expectedVersion: small.version,
          requestKey: 'clean-small-family',
        })
      ).ok,
      true,
    )
    assert.equal(
      (await run('createReservation', { ...housekeepingReservation('family'), adults: 1, children: 1 })).ok,
      true,
    )
    await arriveHousekeeping(
      { stayId: 'family:stay', roomId: '101', assignmentId: 'family:first', at: housekeepingAt(0, 14, 5) },
      adapter,
    )
    assert.equal(
      (
        await run('savePropertyCharge', {
          id: 'family-bed',
          propertyId: 'hotel',
          name: 'Extra bed',
          chargeType: 'extra_bed',
          basis: 'per_night',
          amount: '150000',
          included: false,
          active: true,
        })
      ).ok,
      true,
    )
    const plan = (await run('getInHouseGuestPlan', { stayId: 'family:stay' })).plan as Row
    assert.equal(plan.capacity, 1)
    assert.equal(plan.needsBed, true)
    const input = {
      stayId: 'family:stay',
      guest: {
        fullName: 'Synthetic extra adult',
        type: 'passport',
        number: 'FAM12345',
        birth: '1991-01-01',
        nationality: 'VN',
        gender: 'female',
      },
      ...(await versions()),
      requestKey: 'family-add-adult',
      expectedBedRate: '150000',
    }
    const refused = await run('addInHouseGuest', input)
    assert.ok((refused.errors as Row[]).some((error) => error.code === 'additional_guest_bed'))
    assert.equal(Number((await run('getStay', { id: 'family:stay' })).extraBeds ?? 0), 0)
    const added = await run('addInHouseGuest', { ...input, extraBed: true })
    assert.equal(added.ok, true, JSON.stringify(added))
    assert.deepEqual(await run('addInHouseGuest', { ...input, extraBed: true }), added)
    const stay = await run('getStay', { id: 'family:stay' })
    assert.equal(stay.extraBeds, 1)
    const property = await run('getProperty', { id: 'hotel' })
    const move = {
      stayId: stay.id,
      roomId: small.id,
      assignmentId: 'family:moved',
      at: housekeepingAt(0, 15, 0),
      expectedVersion: stay.version,
      requestKey: 'family-move',
      reason: 'Synthetic room move',
    }
    const rejected = await run('moveRoom', move)
    assert.ok(
      (rejected.errors as Row[]).some((error) => error.code === 'room_guest_capacity'),
      JSON.stringify(rejected),
    )
    assert.deepEqual(await run('getStay', { id: stay.id }), stay)
    assert.equal((await run('getProperty', { id: 'hotel' })).version, property.version)
    const choices = (await run('lookupReservationRooms', {
      reservationId: 'family',
      moving: true,
    })) as unknown as Row[]
    assert.deepEqual(
      choices.map((row) => row.id),
      ['102'],
    )
    const moved = await run('moveRoom', { ...move, roomId: '102' })
    assert.equal(moved.ok, true, JSON.stringify(moved))
    assert.deepEqual(await run('moveRoom', { ...move, roomId: '102' }), moved)
    assert.equal((await run('getStay', { id: stay.id })).extraBeds, 1)
    assert.equal((await run('getRoom', { id: '101' })).status, 'dirty')
    assert.equal(
      (
        await adapter.all('SELECT id FROM hospitality_core_charge WHERE "sourceKey" LIKE ?', [
          'additional-guest:%',
        ])
      ).length,
      1,
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality departure: paged charges, stock blockers and required handover protect checkout', async () => {
  const adapter = await boot(true)
  const run = async (name: string, args: Record<string, unknown>) =>
    (await call(name, args, adapter)).value as Row
  try {
    assert.equal(
      (await run('hospitality_core.createReservation', housekeepingReservation('departure'))).ok,
      true,
    )
    await arriveHousekeeping(
      {
        stayId: 'departure:stay',
        roomId: '101',
        assignmentId: 'departure:first',
        at: housekeepingAt(0, 14, 5),
      },
      adapter,
    )
    for (let i = 0; i < 25; i++)
      assert.equal(
        (
          await run('hospitality_core.addCharge', {
            id: `departure-extra-${i}`,
            folioId: 'departure:folio',
            stayId: 'departure:stay',
            description: `Synthetic fee ${i}`,
            type: 'service',
            quantity: '1',
            unitPrice: '1',
          })
        ).ok,
        true,
      )
    const workspace = (
      await run('hospitality_core.getFolioWorkspace', {
        id: 'departure:folio',
        chargePage: 999,
        chargeId: 'departure-extra-0',
      })
    ).record as Row
    assert.equal((workspace.charges as Row).page, 2)
    assert.equal((workspace.charges as Row).total, 26)
    assert.equal(((workspace.charges as Row).rows as Row[]).length, 2)
    assert.equal((workspace.selectedCharge as Row).id, 'departure-extra-0')
    assert.equal((workspace.selectedCharge as Row).sourceKey, undefined)
    assert.equal(((workspace.stays as Row).rows as Row[]).length, 1)
    const preview = await run('hospitality_core.checkOutReadiness', { stayId: 'departure:stay' })
    assert.equal((preview.charges as Row[]).length, 24)
    assert.deepEqual(preview.chargesPage, { page: 1, pages: 2, total: 26 })
    assert.equal(
      (await run('hospitality_core.checkOutReadiness', { stayId: 'departure:stay', page: 999 }))
        .chargesPage &&
        (
          (await run('hospitality_core.checkOutReadiness', { stayId: 'departure:stay', page: 999 }))
            .charges as Row[]
        ).length,
      2,
    )
    assert.ok((preview.blockers as Row[]).some((item) => item.code === 'departure_day_required'))
    await run('uom.saveUnit', { id: 'departure-unit', name: 'Unit', relativeFactor: '1' })
    await run('product.saveTemplate', {
      id: 'departure-product-template',
      name: 'Synthetic minibar',
      type: 'goods',
      uomId: 'departure-unit',
      listPrice: '10',
      saleOk: true,
    })
    await run('product.saveVariant', {
      id: 'departure-product',
      templateId: 'departure-product-template',
      defaultCode: 'DP',
      combinationKey: '',
    })
    const line = {
      id: 'departure-stock',
      stayId: 'departure:stay',
      productId: 'departure-product',
      chargeType: 'minibar',
      fulfillmentKind: 'external_stock',
      recurrence: 'once',
    }
    const savedLine = await run('hospitality_core.saveExtraLine', line)
    assert.equal(savedLine.ok, true, JSON.stringify(savedLine))
    const bookedLine = {
      ...line,
      id: 'departure-booked-stock',
      stayId: undefined,
      reservationId: 'departure',
    }
    assert.equal((await run('hospitality_core.saveExtraLine', bookedLine)).ok, true)
    const pending = await run('hospitality_core.checkOutReadiness', { stayId: 'departure:stay' })
    assert.equal(pending.pendingCount, 2)
    const command = {
      stayId: 'departure:stay',
      handover: ['keys', 'charges'],
      at: housekeepingAt(2, 12, 0),
      requestKey: 'departure-complete',
      departureNotes: 'Keys returned; minibar checked',
    }
    assert.equal((await run('hospitality_core.checkOut', command)).ok, false)
    assert.equal((await run('hospitality_core.saveExtraLine', { ...line, active: false })).ok, true)
    assert.equal(
      (await run('hospitality_core.checkOutReadiness', { stayId: 'departure:stay' })).pendingCount,
      1,
    )
    assert.equal((await run('hospitality_core.saveExtraLine', { ...bookedLine, active: false })).ok, true)
    assert.equal(
      (
        await run('hospitality_core.checkOut', {
          ...command,
          handover: ['keys'],
          requestKey: 'departure-incomplete',
        })
      ).ok,
      false,
    )
    const result = await run('hospitality_core.checkOut', command)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(await run('hospitality_core.checkOut', command), result)
    const stored = (
      await adapter.all(
        'SELECT "departureChecklist", "departureNotes" FROM hospitality_core_stay WHERE id = ?',
        ['departure:stay'],
      )
    )[0]!
    assert.equal(stored.departureNotes, command.departureNotes)
    assert.equal((await run('hospitality_core.getRoom', { id: '101' })).status, 'dirty')
    assert.equal((await run('hospitality_core.getFolio', { id: 'departure:folio' })).state, 'closed')
  } finally {
    await adapter.close()
  }
})

test('hospitality manual folio fees enforce bounds, scope, receipt, stale state and business-day authority', async () => {
  const adapter = await boot(true)
  try {
    const booking = (
      await call(
        'hospitality_core.createReservation',
        reservation('manual-fee-booking', {
          checkIn: `${onlineCheckIn}T14:00:00Z`,
          checkOut: `${onlineCheckOut}T12:00:00Z`,
        }),
        adapter,
      )
    ).value as Row
    assert.equal(booking.ok, true, JSON.stringify(booking))
    const folioId = 'manual-fee-booking:folio'
    const read = async () =>
      ((await call('hospitality_core.getFolioWorkspace', { id: folioId }, adapter)).value as Row)
        .record as Row
    const before = await read()
    const input = {
      folioId,
      type: 'laundry',
      description: 'Two laundry loads confirmed by guest',
      quantity: '2',
      unitPrice: '50000',
      expectedVersion: before.version,
      requestKey: 'manual-fee-first-request',
    }
    const rejected = async (patch: Record<string, unknown>, field: string) => {
      const result = (await call('hospitality_core.postFolioServiceCharge', { ...input, ...patch }, adapter))
        .value as Row
      assert.equal(result.ok, false, JSON.stringify(patch))
      assert.ok(
        (result.errors as Row[]).some((item) => item.field === field),
        JSON.stringify(result),
      )
      assert.equal((await read()).version, before.version)
      assert.equal((await read()).amountTotal, before.amountTotal)
    }
    for (const quantity of ['0', '21', '1.5', '-1']) await rejected({ quantity }, 'quantity')
    for (const unitPrice of ['0', '50000001', '1.5', '-1']) await rejected({ unitPrice }, 'unitPrice')
    for (const type of ['minibar', 'room', 'restaurant', 'discount', 'service'])
      await rejected({ type }, 'type')
    for (const description of ['  ', 'x'.repeat(501)]) await rejected({ description }, 'description')
    for (const deniedScope of [
      { company: 'other', branches: null },
      { company: 'acme', branches: ['outside'] },
    ]) {
      const result = (
        await callFn('hospitality_core.postFolioServiceCharge', input, {
          adapter,
          manifest,
          scope: deniedScope,
        })
      ).value as Row
      assert.equal(result.ok, false)
    }
    assert.equal(
      (
        await adapter.all('SELECT id FROM hospitality_core_command_receipt WHERE "requestKey" = ?', [
          input.requestKey,
        ])
      ).length,
      0,
    )
    const result = (await call('hospitality_core.postFolioServiceCharge', input, adapter)).value as Row
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.amount, '100000')
    assert.deepEqual((await call('hospitality_core.postFolioServiceCharge', input, adapter)).value, result)
    const line = (await adapter.all('SELECT * FROM hospitality_core_charge WHERE id = ?', [result.id]))[0]!
    assert.equal(line.type, 'laundry')
    assert.equal(line.description, input.description)
    assert.equal(line.serviceDate, dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh'))
    assert.equal(line.fulfillmentKind, 'none')
    assert.equal(
      (
        await adapter.all('SELECT id FROM hospitality_core_operational_change WHERE action = ?', [
          'folio-service-charge-posted',
        ])
      ).length,
      1,
    )
    const reused = (
      await call('hospitality_core.postFolioServiceCharge', { ...input, quantity: '3' }, adapter)
    ).value as Row
    assert.equal((reused.errors as Row[])[0]!.code, 'request_reused')
    const stale = (
      await call(
        'hospitality_core.postFolioServiceCharge',
        { ...input, requestKey: 'stale-manual-fee-request' },
        adapter,
      )
    ).value as Row
    assert.equal((stale.errors as Row[])[0]!.code, 'transition_conflict')
    const nextInput = {
      ...input,
      expectedVersion: (await read()).version,
      requestKey: 'manual-fee-upper-bound',
      type: 'transfer',
      quantity: '20',
      unitPrice: '50000000',
    }
    const tomorrow = addCalendarDays(dateKeyIn(new Date(), 'Asia/Ho_Chi_Minh'), 1)
    await adapter.run('UPDATE hospitality_core_property SET "closingDate" = ? WHERE id = ?', [
      tomorrow,
      'hotel',
    ])
    const locked = (await call('hospitality_core.postFolioServiceCharge', nextInput, adapter)).value as Row
    assert.equal((locked.errors as Row[])[0]!.code, 'business_date_locked')
    await adapter.run(
      'UPDATE hospitality_core_property SET "closingDate" = NULL, "businessDate" = ? WHERE id = ?',
      [tomorrow, 'hotel'],
    )
    const upper = (await call('hospitality_core.postFolioServiceCharge', nextInput, adapter)).value as Row
    assert.equal(upper.ok, true, JSON.stringify(upper))
    assert.equal(upper.amount, '1000000000')
    assert.equal(
      (await adapter.all('SELECT "serviceDate" FROM hospitality_core_charge WHERE id = ?', [upper.id]))[0]!
        .serviceDate,
      tomorrow,
    )
    await adapter.run('UPDATE hospitality_core_folio SET state = ? WHERE id = ?', ['closed', folioId])
    const closed = (
      await call(
        'hospitality_core.postFolioServiceCharge',
        { ...input, expectedVersion: (await read()).version, requestKey: 'manual-fee-after-close' },
        adapter,
      )
    ).value as Row
    assert.equal((closed.errors as Row[])[0]!.code, 'folio_not_open')
  } finally {
    await adapter.close()
  }
})
