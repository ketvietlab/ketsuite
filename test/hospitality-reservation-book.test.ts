import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import {
  reservationBookHref,
  reservationBookQueryFromUrl,
} from '../packages/ketsuite/src/modules/hospitality_core/reservation-book-query.ts'
import { RESERVATION_BOOK_GUEST_MATCHES } from '../packages/ketsuite/src/modules/hospitality_core/functions/reservation-book.ts'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }
type Book = {
  query: Record<string, unknown>
  total: number
  page: number
  pages: number
  rows: Row[]
  counts: { status: Record<string, number>; view: Record<string, number> }
  bookIsEmpty: boolean
  partial: boolean
}

const call = (name: string, args: Record<string, unknown>, adapter: Adapter, company = scope.company) =>
  roomFixtureCall(name, args, { adapter, manifest, scope: { ...scope, company } })
const search = async (adapter: Adapter, input: Record<string, unknown> = {}, company = scope.company) =>
  (
    await callFn('hospitality_core.searchReservations', input, {
      adapter,
      manifest,
      scope: { ...scope, company },
    })
  ).value as Book
const insert = async (adapter: Adapter, table: string, row: Record<string, unknown>) => {
  const names = Object.keys(row)
  await adapter.run(
    `INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    names.map((name) => row[name]),
  )
}
// Ho Chi Minh City is UTC+7: the desk's 1 September runs from 31 August 17:00 to 1 September 17:00 UTC.
const local = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`).toISOString()
let made = 0
const booking = async (adapter: Adapter, id: string, extra: Record<string, unknown> = {}) => {
  made++
  await insert(adapter, 'hospitality_core_reservation', {
    id,
    companyId: scope.company,
    code: `DP-${String(made).padStart(3, '0')}`,
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    folioId: `${id}:folio`,
    partnerId: 'guest',
    provider: 'direct',
    bookingType: 'nightly',
    checkIn: local('2026-09-01', '14:00'),
    checkOut: local('2026-09-03', '12:00'),
    adults: 2,
    children: 0,
    rate: '100',
    quantity: '2',
    billingMode: 'upfront',
    amountTotal: '200',
    currency: 'VND',
    state: 'confirmed',
    guaranteeKind: 'card',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...extra,
  })
}
const stay = async (adapter: Adapter, reservationId: string, extra: Record<string, unknown> = {}) => {
  await insert(adapter, 'hospitality_core_stay', {
    id: `${reservationId}:stay`,
    companyId: scope.company,
    code: `${reservationId}-S`,
    folioId: `${reservationId}:folio`,
    reservationId,
    partnerId: 'guest',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    bookingType: 'nightly',
    checkIn: local('2026-09-01', '14:00'),
    checkOut: local('2026-09-03', '12:00'),
    adults: 2,
    children: 0,
    billingMode: 'upfront',
    rate: '100',
    state: 'draft',
    ...extra,
  })
  await adapter.run('UPDATE hospitality_core_reservation SET "stayId" = ? WHERE id = ?', [
    `${reservationId}:stay`,
    reservationId,
  ])
}
const assignment = async (
  adapter: Adapter,
  reservationId: string,
  roomId: string,
  state: string,
  at: string,
) =>
  insert(adapter, 'hospitality_core_room_assignment', {
    id: `${reservationId}:${roomId}:${state}`,
    companyId: scope.company,
    stayId: `${reservationId}:stay`,
    propertyId: 'hotel',
    roomId,
    roomTypeId: 'deluxe',
    startAt: at,
    state,
  })

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  for (const companyId of ['acme', 'other']) {
    await call(
      'partner.savePartner',
      { id: `${companyId}-party`, kind: 'company', name: companyId },
      adapter,
      companyId,
    )
    await call(
      'company.saveCompany',
      { id: companyId, partnerId: `${companyId}-party`, currency: 'VND' },
      adapter,
      companyId,
    )
  }
  await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('partner.savePartner', { id: 'second', kind: 'person', name: 'Trần Bình' }, adapter)
  for (const [id, timezone] of [
    ['hotel', 'Asia/Ho_Chi_Minh'],
    ['resort', 'Asia/Ho_Chi_Minh'],
  ] as const) {
    await call(
      'hospitality_core.saveProperty',
      {
        id,
        code: id.toUpperCase(),
        name: id === 'hotel' ? 'Ket Hotel' : 'Ket Resort',
        accommodationType: 'hotel',
        timezone,
      },
      adapter,
    )
    await call(
      'hospitality_core.saveRoomType',
      {
        id: id === 'hotel' ? 'deluxe' : 'villa',
        propertyId: id,
        code: 'T',
        name: id === 'hotel' ? 'Deluxe' : 'Villa',
        baseRate: '100',
      },
      adapter,
    )
  }
  for (const room of ['101', '102', '305'])
    await call(
      'hospitality_core.saveRoom',
      { id: room, propertyId: 'hotel', roomTypeId: 'deluxe', code: room, name: room },
      adapter,
    )
  await call(
    'hospitality_core.saveProperty',
    {
      id: 'foreign',
      code: 'FOR',
      name: 'Foreign Hotel',
      accommodationType: 'hotel',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    adapter,
    'other',
  )
  // The hotel's desk is on 1 September; the resort's audit has not closed 31 August yet.
  await adapter.run('UPDATE hospitality_core_property SET "businessDate" = ? WHERE id = ?', [
    '2026-09-01',
    'hotel',
  ])
  await adapter.run('UPDATE hospitality_core_property SET "businessDate" = ? WHERE id = ?', [
    '2026-08-31',
    'resort',
  ])
  return adapter
}

/** One booking per desk question, plus the ones the book leaves out. */
async function seed(adapter: Adapter) {
  made = 0
  await booking(adapter, 'arriving', { guaranteeKind: null, channelRef: 'AG-10427' })
  await booking(adapter, 'late', { checkIn: local('2026-08-31', '14:00'), amountTotal: '300' })
  await booking(adapter, 'later', {
    checkIn: local('2026-09-05', '14:00'),
    checkOut: local('2026-09-07', '12:00'),
    guaranteeKind: 'none',
    provider: 'agoda',
    partnerId: 'second',
  })
  // Exactly the hotel's midnight into 2 September: tomorrow, so confirmed rather than due in.
  await booking(adapter, 'edge', {
    checkIn: local('2026-09-02', '00:00'),
    checkOut: local('2026-09-04', '12:00'),
  })
  await booking(adapter, 'inhouse', {
    state: 'checked_in',
    checkIn: local('2026-08-30', '14:00'),
    checkOut: local('2026-09-04', '12:00'),
    amountTotal: '500',
  })
  await booking(adapter, 'leaving', {
    state: 'checked_in',
    checkIn: local('2026-08-29', '14:00'),
    checkOut: local('2026-09-01', '12:00'),
    guaranteeKind: null,
  })
  await booking(adapter, 'departed', {
    state: 'checked_out',
    checkIn: local('2026-08-25', '14:00'),
    checkOut: local('2026-08-28', '12:00'),
  })
  await booking(adapter, 'cancelled', { state: 'cancelled', checkIn: local('2026-09-02', '14:00') })
  await booking(adapter, 'noshow', {
    state: 'no_show',
    checkIn: local('2026-08-31', '14:00'),
    guaranteeKind: null,
  })
  await booking(adapter, 'draft', { state: 'draft' })
  await booking(adapter, 'resort-arrival', {
    propertyId: 'resort',
    roomTypeId: 'villa',
    checkIn: local('2026-09-01', '14:00'),
  })
  await booking(adapter, 'foreign', { companyId: 'other', propertyId: 'foreign' })
  // Rooms: in house in 101, a room held for the later arrival in 305, and 305 slept in by the departed guest.
  await stay(adapter, 'inhouse', { state: 'checked_in', currentRoomId: '101' })
  await assignment(adapter, 'inhouse', '101', 'active', local('2026-08-30', '14:00'))
  await stay(adapter, 'later')
  await assignment(adapter, 'later', '305', 'held', local('2026-09-05', '14:00'))
  await stay(adapter, 'departed', { state: 'checked_out' })
  await assignment(adapter, 'departed', '305', 'closed', local('2026-08-25', '14:00'))
}

test('reservation book: desk statuses follow each property business date and counts answer the controls', async () => {
  const adapter = await boot()
  try {
    await seed(adapter)
    const hotel = await search(adapter, { propertyId: 'hotel', days: null, pageSize: 100 })
    const statusOf = (answer: Book) =>
      Object.fromEntries(answer.rows.map((row) => [row.id, (row.status as Row).id]))
    assert.deepEqual(statusOf(hotel), {
      arriving: 'arriving',
      late: 'arriving',
      later: 'confirmed',
      edge: 'confirmed',
      inhouse: 'in_house',
      leaving: 'departing',
      departed: 'checked_out',
      cancelled: 'cancelled',
      noshow: 'no_show',
    })
    // Drafts and other companies' bookings are not in the book.
    assert.equal(hotel.total, 9)
    assert.deepEqual(hotel.counts.status, {
      all: 9,
      arriving: 2,
      in_house: 1,
      departing: 1,
      confirmed: 2,
      checked_out: 1,
      cancelled: 2,
    })
    // The resort is still on 31 August: its arrival on 1 September is tomorrow there.
    const resort = await search(adapter, { propertyId: 'resort', days: null })
    assert.equal((resort.rows[0]!.status as Row).id, 'confirmed')
    assert.equal((await search(adapter, { propertyId: 'resort' })).query.from, '2026-08-31')
    // Every property: each booking on its own property's day, today being the newest one.
    const every = await search(adapter, { days: null, pageSize: 100 })
    assert.equal(every.total, 10)
    assert.equal(every.counts.status.arriving, 2)
    assert.equal((await search(adapter, {})).query.from, '2026-09-01')

    // Status counts ignore the status filter; view counts honour it.
    const open = await search(adapter, { propertyId: 'hotel', days: null, status: 'arriving' })
    assert.equal(open.counts.status.all, 9)
    assert.deepEqual(open.counts.view, { all: 2, unguaranteed: 1 })
    const unguaranteed = await search(adapter, {
      propertyId: 'hotel',
      days: null,
      view: 'unguaranteed',
      pageSize: 100,
    })
    // A booking without a guarantee that is already over is not an open question.
    assert.deepEqual(unguaranteed.rows.map((row) => row.id).sort(), ['arriving', 'later', 'leaving'])

    // The default window is fourteen nights from today: a stay touches it from arrival night to departure morning.
    const window = await search(adapter, { propertyId: 'hotel', pageSize: 100 })
    assert.deepEqual(window.query, {
      propertyId: 'hotel',
      from: '2026-09-01',
      days: 14,
      status: 'all',
      source: null,
      view: 'all',
      q: '',
      sort: 'relevance',
      page: 1,
      pageSize: 100,
    })
    assert.deepEqual(window.rows.map((row) => row.id).includes('departed'), false)
    assert.equal(
      window.rows.some((row) => row.id === 'leaving'),
      true,
      'a departure on the first morning is in',
    )
    const later = await search(adapter, { propertyId: 'hotel', from: '2026-09-07', days: 7, pageSize: 100 })
    assert.deepEqual(
      later.rows.map((row) => row.id),
      ['later'],
      'a departure on the window’s first morning',
    )
    assert.equal((await search(adapter, { propertyId: 'hotel', from: '2026-09-08', days: 7 })).total, 0)

    // A row is ids and plain values: dates in the property's clock, a room, the money and no contact details.
    const row = hotel.rows.find((item) => item.id === 'inhouse')!
    assert.deepEqual(Object.keys(row).sort(), [
      'adults',
      'arrival',
      'children',
      'code',
      'departure',
      'guarantee',
      'guest',
      'id',
      'loyalty',
      'nights',
      'property',
      'room',
      'roomType',
      'source',
      'status',
      'total',
      'vip',
    ])
    assert.deepEqual(
      [row.arrival, row.departure, row.nights, row.room, row.guest, row.total],
      ['2026-08-30', '2026-09-04', 5, '101', 'Nguyễn An', { amount: '500', currency: 'VND' }],
    )
    assert.equal(hotel.rows.find((item) => item.id === 'later')!.room, '305', 'the room held for an arrival')
    assert.equal(
      hotel.rows.find((item) => item.id === 'departed')!.room,
      '305',
      'the room a departed guest slept in',
    )
    assert.equal(hotel.rows.find((item) => item.id === 'arriving')!.room, null)

    // A property that never took a booking says so; a query that matched none does not.
    assert.equal((await search(adapter, { propertyId: 'hotel', q: 'zzqxw' })).bookIsEmpty, false)
    await call(
      'hospitality_core.saveProperty',
      {
        id: 'empty',
        code: 'EMP',
        name: 'Ket Empty',
        accommodationType: 'hotel',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      adapter,
    )
    const none = await search(adapter, { propertyId: 'empty' })
    assert.equal(none.bookIsEmpty, true)
    assert.equal(none.total, 0)
    assert.equal(
      (await search(adapter, { days: null }, 'other')).total,
      1,
      'the other company sees only its own',
    )
  } finally {
    await adapter.close()
  }
})

test('reservation book: "needs action first" pages through the desk groups and sorts are stable', async () => {
  const adapter = await boot()
  try {
    await seed(adapter)
    const whole = await search(adapter, { propertyId: 'hotel', days: null, pageSize: 100 })
    assert.deepEqual(
      whole.rows.map((row) => row.id),
      ['late', 'arriving', 'leaving', 'inhouse', 'edge', 'later', 'departed', 'cancelled', 'noshow'],
    )
    // Any page size reads the same order, across the boundaries between groups.
    for (const pageSize of [1, 2, 3, 4]) {
      const ids: unknown[] = []
      for (let page = 1; ; page++) {
        const answer = await search(adapter, { propertyId: 'hotel', days: null, page, pageSize })
        ids.push(...answer.rows.map((row) => row.id))
        if (page >= answer.pages) break
      }
      assert.deepEqual(
        ids,
        whole.rows.map((row) => row.id),
        `pageSize ${pageSize}`,
      )
    }
    // Within a filter and a view the groups still page exactly.
    const view = await search(adapter, {
      propertyId: 'hotel',
      days: null,
      view: 'unguaranteed',
      page: 2,
      pageSize: 1,
    })
    assert.deepEqual(
      view.rows.map((row) => row.id),
      ['leaving'],
    )
    const arrival = await search(adapter, { propertyId: 'hotel', days: null, sort: '-arrival', pageSize: 3 })
    assert.deepEqual(
      arrival.rows.map((row) => row.id),
      ['later', 'cancelled', 'edge'],
    )
    const total = await search(adapter, { propertyId: 'hotel', days: null, sort: '-total', pageSize: 2 })
    assert.deepEqual(
      total.rows.map((row) => row.id),
      ['inhouse', 'late'],
    )
    // Unknown values fall back, an old status link still lands, pages clamp and a page holds at most 100.
    const odd = await search(adapter, {
      propertyId: 'nowhere',
      from: '2026-02-31',
      days: 9,
      status: 'in-house',
      source: 'fax',
      view: 'unroomed',
      sort: 'guest',
      page: 99,
      pageSize: 1000,
    })
    assert.deepEqual(odd.query, {
      propertyId: null,
      from: '2026-09-01',
      days: 14,
      status: 'in_house',
      source: null,
      view: 'all',
      q: '',
      sort: 'relevance',
      page: 1,
      pageSize: 100,
    })
    assert.equal((await search(adapter, { days: null, status: 'confirmed', page: 5, pageSize: 1 })).page, 3)
  } finally {
    await adapter.close()
  }
})

test('reservation book: search reads codes, guests and a whole room, and says when a guest search fell short', async () => {
  const adapter = await boot()
  try {
    await seed(adapter)
    const ids = async (q: string) =>
      (await search(adapter, { propertyId: 'hotel', days: null, q, pageSize: 100 })).rows
        .map((row) => row.id)
        .sort()
    assert.deepEqual(await ids('DP-003'), ['later'])
    assert.deepEqual(await ids('ag-104'), ['arriving'], 'a channel reference, in any case')
    assert.deepEqual(await ids('Trần'), ['later'])
    assert.deepEqual(await ids('%'), [], 'a wildcard is a literal')
    // A whole room code finds who holds it or sleeps in it now, not who slept in it before.
    assert.deepEqual(await ids('305'), ['later'])
    assert.deepEqual(await ids('101'), ['inhouse'])
    assert.deepEqual(await ids('30'), [], 'part of a room number names no room')
    const plain = await search(adapter, { propertyId: 'hotel', days: null, q: 'Nguyễn' })
    assert.equal(plain.partial, false)
    // More matching guest records than the read follows: the answer says it is partial.
    for (let i = 0; i <= RESERVATION_BOOK_GUEST_MATCHES; i++)
      await insert(adapter, 'partner_partner', {
        id: `crowd-${String(i).padStart(4, '0')}`,
        kind: 'person',
        name: `Khách Đông ${i}`,
        active: 1,
      })
    const crowded = await search(adapter, { propertyId: 'hotel', days: null, q: 'Khách Đông' })
    assert.equal(crowded.partial, true)
    assert.equal(crowded.total, 0)
    assert.equal(
      (await search(adapter, { propertyId: 'hotel', days: null, q: 'Khách Đông 1' })).partial,
      false,
    )
  } finally {
    await adapter.close()
  }
})

test('reservation book: the URL keeps defaults off and reads old links', () => {
  const properties = [
    { id: 'hotel', businessDate: '2026-09-01' },
    { id: 'resort', businessDate: '2026-08-31' },
  ]
  const path = '/admin/hospitality/reservations?company=acme&lang=en'
  const plain = reservationBookQueryFromUrl(new URL(path, 'http://x.local'), properties)
  assert.equal(reservationBookHref(path, plain, properties), path)
  const query = { ...plain, propertyId: 'resort', from: '2026-08-31', status: 'in_house' as const, page: 2 }
  // The resort's today stays off its link; another day is written as a date.
  assert.equal(
    reservationBookHref(path, query, properties),
    '/admin/hospitality/reservations?company=acme&lang=en&property=resort&status=in_house&page=2',
  )
  const all = reservationBookQueryFromUrl(
    new URL(`${path}&days=all&status=departed&from=2026-08-01`, 'http://x.local'),
    properties,
  )
  assert.deepEqual([all.days, all.from, all.status], [null, null, 'checked_out'])
  assert.equal(reservationBookHref(path, all, properties), `${path}&days=all&status=checked_out`)
  const dated = reservationBookQueryFromUrl(
    new URL(`${path}&from=2026-09-08&days=7`, 'http://x.local'),
    properties,
  )
  assert.deepEqual([dated.from, dated.days], ['2026-09-08', 7])
  assert.equal(reservationBookHref(path, dated, properties), `${path}&from=2026-09-08&days=7`)
})
