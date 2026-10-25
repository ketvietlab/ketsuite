import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import {
  stayBookHref,
  stayBookQueryFromUrl,
} from '../packages/ketsuite/src/modules/hospitality_core/stay-book-query.ts'
import { STAY_BOOK_HOUSE_LIMIT } from '../packages/ketsuite/src/modules/hospitality_core/functions/stay-book.ts'
import { createStayDueReader } from '../packages/ketsuite/src/modules/hospitality_core/collections/stay-book.tsx'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }
type House = {
  query: Record<string, unknown>
  total: number
  page: number
  pages: number
  rows: Row[]
  counts: { view: Record<string, number> }
  houseIsEmpty: boolean
  partial: boolean
}

const call = (name: string, args: Record<string, unknown>, adapter: Adapter, company = scope.company) =>
  roomFixtureCall(name, args, { adapter, manifest, scope: { ...scope, company } })
const search = async (
  adapter: Adapter,
  input: Record<string, unknown> = {},
  reader: { company: string; branches: string[] | null } = scope,
) =>
  (await callFn('hospitality_core.searchStays', input, { adapter, manifest, scope: reader })).value as House
const insert = async (adapter: Adapter, table: string, rows: Record<string, unknown>[]) => {
  const names = Object.keys(rows[0]!)
  await adapter.run(
    `INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(', ')}) VALUES ${rows
      .map(() => `(${names.map(() => '?').join(', ')})`)
      .join(', ')}`,
    rows.flatMap((row) => names.map((name) => row[name])),
  )
}
// Ho Chi Minh City is UTC+7: the hotel's desk is on 1 September.
const local = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`).toISOString()
type Stay = {
  id: string
  room?: string | null
  property?: string
  type?: string
  guest?: string
  state?: string
  checkIn?: string
  checkOut?: string
  company?: string
  booking?: Record<string, unknown> | null
}
const stayRow = (stay: Stay) => ({
  id: stay.id,
  companyId: stay.company ?? scope.company,
  code: `${stay.id}-S`,
  folioId: `${stay.id}:folio`,
  reservationId: stay.booking === null ? null : `${stay.id}:booking`,
  partnerId: stay.guest ?? 'guest',
  propertyId: stay.property ?? 'hotel',
  roomTypeId: stay.type ?? 'deluxe',
  currentRoomId: stay.room === undefined ? null : stay.room,
  bookingType: 'nightly',
  checkIn: stay.checkIn ?? local('2026-08-30', '14:00'),
  checkOut: stay.checkOut ?? local('2026-09-04', '12:00'),
  adults: 2,
  children: 0,
  billingMode: 'upfront',
  rate: '100',
  state: stay.state ?? 'checked_in',
})
const bookingRow = (stay: Stay) => ({
  id: `${stay.id}:booking`,
  companyId: stay.company ?? scope.company,
  code: `DP-${stay.id.toUpperCase()}`,
  propertyId: stay.property ?? 'hotel',
  roomTypeId: stay.type ?? 'deluxe',
  folioId: `${stay.id}:folio`,
  stayId: stay.id,
  partnerId: stay.guest ?? 'guest',
  provider: 'direct',
  bookingType: 'nightly',
  checkIn: stay.checkIn ?? local('2026-08-30', '14:00'),
  checkOut: stay.checkOut ?? local('2026-09-04', '12:00'),
  adults: 2,
  children: 0,
  rate: '100',
  quantity: '5',
  billingMode: 'upfront',
  amountTotal: '500',
  currency: 'VND',
  state: stay.state === 'checked_out' ? 'checked_out' : 'checked_in',
  guestVip: null,
  guestLoyaltyTier: null,
  arrivalNote: null,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  ...stay.booking,
})
const stays = async (adapter: Adapter, list: Stay[]) => {
  for (let start = 0; start < list.length; start += 400) {
    const slice = list.slice(start, start + 400)
    await insert(adapter, 'hospitality_core_stay', slice.map(stayRow))
    const booked = slice.filter((stay) => stay.booking !== null)
    if (booked.length) await insert(adapter, 'hospitality_core_reservation', booked.map(bookingRow))
  }
}

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
  await call(
    'partner.savePartner',
    { id: 'guest', kind: 'person', name: 'Nguyễn An', phone: '0900000001', email: 'an@example.invalid' },
    adapter,
  )
  await call('partner.savePartner', { id: 'second', kind: 'person', name: 'Trần Bình' }, adapter)
  await call('partner.savePartner', { id: 'third', kind: 'person', name: 'Lê Châu' }, adapter)
  for (const id of ['hotel', 'resort']) {
    await call(
      'hospitality_core.saveProperty',
      {
        id,
        code: id.toUpperCase(),
        // The resort sorts first by name, the hotel after it.
        name: id === 'hotel' ? 'Ket Hotel' : 'Biển Resort',
        accommodationType: 'hotel',
        timezone: 'Asia/Ho_Chi_Minh',
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
  for (const room of ['9', '10', '101', '305'])
    await call(
      'hospitality_core.saveRoom',
      { id: room, propertyId: 'hotel', roomTypeId: 'deluxe', code: room, name: room },
      adapter,
    )
  await call(
    'hospitality_core.saveRoom',
    { id: 'v2', propertyId: 'resort', roomTypeId: 'villa', code: 'V2', name: 'V2' },
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

/** The house: one stay per desk question, plus the ones the list leaves out. */
const seed = (adapter: Adapter) =>
  stays(adapter, [
    // Leaves on the hotel's today, at the standard time.
    { id: 'today', room: '305', checkOut: local('2026-09-01', '12:00') },
    // Overdue: was due out yesterday and is still in.
    { id: 'overdue', room: '10', guest: 'second', checkOut: local('2026-08-31', '12:00') },
    // Leaves tomorrow, two hours past the standard time.
    {
      id: 'late',
      room: '9',
      guest: 'third',
      checkOut: local('2026-09-02', '14:00'),
      booking: { guestVip: true, guestLoyaltyTier: 'gold_elite', arrivalNote: 'Phòng tầng cao' },
    },
    // An OTA departure saved at midnight reads as the standard time.
    {
      id: 'midnight',
      room: '101',
      checkOut: local('2026-09-05', '00:00'),
      booking: { guestLoyaltyTier: 'none' },
    },
    // In without a room on the plan yet, and without a reservation.
    { id: 'unroomed', room: null, booking: null, checkOut: local('2026-09-06', '12:00') },
    // The resort's desk is still on 31 August, so its 1 September is tomorrow.
    { id: 'villa', room: 'v2', property: 'resort', type: 'villa', checkOut: local('2026-09-01', '12:00') },
    // Not in the house.
    { id: 'draft', room: '101', state: 'draft' },
    { id: 'gone', room: '101', state: 'checked_out' },
    { id: 'cancelled', state: 'cancelled' },
    { id: 'foreign', property: 'foreign', company: 'other', guest: 'other-party' },
  ])

test('the in-house list reads the stays checked in now, by room, with the desk questions counted', async () => {
  const adapter = await boot()
  try {
    await seed(adapter)
    const house = await search(adapter)
    // By property name, then room number as numbers read; a stay without a room last.
    assert.deepEqual(
      house.rows.map((row) => row.id),
      ['villa', 'late', 'overdue', 'midnight', 'today', 'unroomed'],
    )
    assert.deepEqual(house.counts.view, { all: 6, departing: 2, tomorrow: 2, vip: 1 })
    assert.equal(house.houseIsEmpty, false)
    assert.equal(house.partial, false)
    const byId = new Map(house.rows.map((row) => [row.id, row]))
    // The row is the reservation's: its code, its id for the link, its guest benefits and requests.
    assert.deepEqual(byId.get('late'), {
      id: 'late',
      code: 'DP-LATE',
      reservation: { id: 'late:booking' },
      guest: 'Lê Châu',
      vip: true,
      loyalty: 'gold_elite',
      property: { id: 'hotel' },
      roomType: { id: 'deluxe', name: 'Deluxe' },
      room: '9',
      arrival: '2026-08-30',
      departure: '2026-09-02',
      nights: 3,
      nightsStayed: 2,
      departsIn: 1,
      checkOut: '12:00',
      lateCheckout: '14:00',
      adults: 2,
      children: 0,
      request: 'Phòng tầng cao',
    })
    assert.deepEqual(
      [
        byId.get('midnight')!.lateCheckout,
        byId.get('midnight')!.checkOut,
        byId.get('midnight')!.loyalty,
        byId.get('overdue')!.departsIn,
      ],
      [null, '12:00', null, -1],
    )
    assert.deepEqual([byId.get('unroomed')!.code, byId.get('unroomed')!.reservation], ['unroomed-S', null])
    // The resort's own business date decides its departures.
    assert.equal(byId.get('villa')!.departsIn, 1)
    // No contact details ride in a row.
    assert.doesNotMatch(JSON.stringify(house.rows), /0900000001|example\.invalid/)

    const ids = async (input: Record<string, unknown>) =>
      (await search(adapter, input)).rows.map((row) => row.id)
    // Departing today holds the overdue departure; view counts ignore the view.
    const departing = await search(adapter, { view: 'departing' })
    assert.deepEqual(
      [departing.rows.map((row) => row.id), departing.counts.view],
      [['overdue', 'today'], house.counts.view],
    )
    assert.deepEqual(await ids({ view: 'tomorrow' }), ['villa', 'late'])
    assert.deepEqual(await ids({ view: 'vip' }), ['late'])
    assert.deepEqual(await ids({ sort: '-room' }), [
      'unroomed',
      'today',
      'midnight',
      'overdue',
      'late',
      'villa',
    ])
    assert.deepEqual(await ids({ sort: 'departure' }), [
      'overdue',
      'villa',
      'today',
      'late',
      'midnight',
      'unroomed',
    ])
    assert.deepEqual(await ids({ sort: '-departure' }), [
      'unroomed',
      'midnight',
      'late',
      'villa',
      'today',
      'overdue',
    ])
    assert.deepEqual(await ids({ sort: 'guest' }), [
      'late',
      'villa',
      'midnight',
      'today',
      'unroomed',
      'overdue',
    ])
    assert.deepEqual(await ids({ propertyId: 'resort' }), ['villa'])

    // A search matches booking code, guest and room without accents, and its counts follow it.
    const named = await search(adapter, { q: 'nguyen an' })
    assert.deepEqual(
      named.rows.map((row) => row.id),
      ['villa', 'midnight', 'today', 'unroomed'],
    )
    assert.deepEqual(named.counts.view, { all: 4, departing: 1, tomorrow: 1, vip: 0 })
    assert.deepEqual(await ids({ q: 'TRẦN' }), ['overdue'])
    assert.deepEqual(await ids({ q: '305' }), ['today'])
    assert.deepEqual(await ids({ q: 'dp-late' }), ['late'])
    assert.deepEqual(await ids({ q: 'unroomed-s' }), ['unroomed'])
    const none = await search(adapter, { q: 'zzqxw' })
    assert.deepEqual([none.total, none.houseIsEmpty], [0, false])

    // The input as applied: old facet and sorts fall back, a page past the end is the last one.
    const applied = await search(adapter, { view: 'owing', sort: '-balance', pageSize: 2, page: 99 })
    assert.deepEqual(
      [
        applied.query.view,
        applied.query.sort,
        applied.page,
        applied.pages,
        applied.rows.map((row) => row.id),
      ],
      ['all', 'room', 3, 3, ['today', 'unroomed']],
    )

    // Another company sees only its own house; a reader with no property sees an empty one.
    assert.deepEqual(
      (await search(adapter, {}, { company: 'other', branches: null })).rows.map((row) => row.id),
      ['foreign'],
    )
    const unscoped = await search(adapter, {}, { company: 'acme', branches: ['nowhere'] })
    assert.deepEqual([unscoped.total, unscoped.houseIsEmpty], [0, true])
  } finally {
    await adapter.close()
  }
})

test('an empty house says so, and a house past the read bound says it is partial', async () => {
  const adapter = await boot()
  try {
    const empty = await search(adapter)
    assert.deepEqual([empty.total, empty.houseIsEmpty, empty.partial], [0, true, false])
    await stays(
      adapter,
      Array.from({ length: STAY_BOOK_HOUSE_LIMIT + 1 }, (_, index) => ({
        id: `s${String(index).padStart(4, '0')}`,
        booking: null,
      })),
    )
    const full = await search(adapter, { pageSize: 100 })
    assert.deepEqual([full.total, full.partial, full.houseIsEmpty], [STAY_BOOK_HOUSE_LIMIT, true, false])
  } finally {
    await adapter.close()
  }
})

test('the in-house list writes only its own names on the URL and reads them back', () => {
  const properties = [{ id: 'hotel' }, { id: 'resort' }]
  const plain = stayBookQueryFromUrl(new URL('http://x/admin/hospitality/stays?company=acme'), properties)
  assert.deepEqual(plain, { propertyId: null, view: 'all', q: '', sort: 'room', page: 1, pageSize: 25 })
  assert.equal(
    stayBookHref('/admin/hospitality/stays?company=acme&lang=en', plain),
    '/admin/hospitality/stays?company=acme&lang=en',
  )
  const query = {
    ...plain,
    propertyId: 'resort',
    view: 'vip' as const,
    q: ' Lê ',
    sort: '-departure' as const,
    page: 2,
  }
  const href = stayBookHref('/admin/hospitality/stays?company=acme', query)
  assert.equal(
    href,
    '/admin/hospitality/stays?company=acme&property=resort&view=vip&q=L%C3%AA&sort=-departure&page=2',
  )
  assert.deepEqual(stayBookQueryFromUrl(new URL(href, 'http://x'), properties), { ...query, q: 'Lê' })
  // Links written for the facet and sorts the list no longer has land on the whole house by room.
  assert.deepEqual(
    stayBookQueryFromUrl(new URL('http://x/s?view=owing&sort=balance&property=gone&page=0'), properties),
    plain,
  )
})

test('the in-house list asks billing for the rows shown and keeps only the latest answer', async () => {
  const asked: unknown[] = []
  const pending: Array<{ resolve: (value: Response) => void; signal: AbortSignal }> = []
  const reader = createStayDueReader({
    source: '/_ket/fn/hospitality_billing.getStayDues',
    fetch: (async (url: string, init: RequestInit) => {
      asked.push([url, JSON.parse(String(init.body))])
      return new Promise<Response>((resolve) => pending.push({ resolve, signal: init.signal! }))
    }) as unknown as typeof fetch,
  })
  const answer = (rows: unknown, ok = true) =>
    Response.json(ok ? { ok: true, value: { rows } } : { ok: false })
  const first = reader.read(['a', 'b'])
  const second = reader.read(['b', 'c'])
  // The page changed before billing answered: the first read is cancelled and cannot land.
  assert.equal(pending[0]!.signal.aborted, true)
  pending[0]!.resolve(answer([{ id: 'a', due: '9', currency: 'VND', known: true, shared: 1 }]))
  pending[1]!.resolve(
    answer([
      { id: 'b', due: '120000', currency: 'VND', known: true, shared: 3 },
      { id: 'c', known: 'yes' },
    ]),
  )
  await Promise.all([first, second])
  assert.deepEqual(asked, [
    ['/_ket/fn/hospitality_billing.getStayDues', { ids: ['a', 'b'] }],
    ['/_ket/fn/hospitality_billing.getStayDues', { ids: ['b', 'c'] }],
  ])
  // An id billing did not answer properly is unknown, not paid.
  assert.deepEqual(Object.fromEntries(reader.dues()), {
    b: { id: 'b', due: '120000', currency: 'VND', known: true, shared: 3 },
    c: { id: 'c', due: null, currency: null, known: false, shared: 1 },
  })
  // A failed read marks its rows and keeps the others' last answer.
  const third = reader.read(['c'])
  pending[2]!.resolve(answer(null, false))
  await third
  assert.deepEqual(
    [reader.dues().get('b'), reader.dues().get('c')],
    [{ id: 'b', due: '120000', currency: 'VND', known: true, shared: 3 }, 'failed'],
  )
  // An empty page asks nothing.
  await reader.read([])
  assert.equal(asked.length, 3)
})
