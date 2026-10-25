import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import { roomFixtureCall } from './helpers/hospitality-room-fixture.ts'
import {
  folioBookHref,
  folioBookQueryFromUrl,
} from '../packages/ketsuite/src/modules/hospitality_core/folio-book-query.ts'
import { FOLIO_BOOK_MATCHES } from '../packages/ketsuite/src/modules/hospitality_core/functions/folio-book.ts'
import { createFolioDueReader } from '../packages/ketsuite/src/modules/hospitality_core/collections/folio-book.tsx'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }
type Register = {
  query: Record<string, unknown>
  total: number
  page: number
  pages: number
  rows: Row[]
  counts: { view: Record<string, number> }
  isEmpty: boolean
  partial: boolean
}

const call = (name: string, args: Record<string, unknown>, adapter: Adapter, company = scope.company) =>
  roomFixtureCall(name, args, { adapter, manifest, scope: { ...scope, company } })
const search = async (
  adapter: Adapter,
  input: Record<string, unknown> = {},
  reader: { company: string; branches: string[] | null } = scope,
) =>
  (await callFn('hospitality_core.searchFolios', input, { adapter, manifest, scope: reader }))
    .value as Register
const codes = (register: Register) => register.rows.map((row) => row.code)
const insert = async (adapter: Adapter, table: string, rows: Record<string, unknown>[]) => {
  const names = Object.keys(rows[0]!)
  await adapter.run(
    `INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(', ')}) VALUES ${rows
      .map(() => `(${names.map(() => '?').join(', ')})`)
      .join(', ')}`,
    rows.flatMap((row) => names.map((name) => row[name])),
  )
}
// Ho Chi Minh City is UTC+7.
const local = (date: string, time = '14:00') => new Date(`${date}T${time}:00+07:00`).toISOString()

type Folio = {
  id: string
  state: string
  partner?: string
  property?: string
  total: string
  opened: string
  closed?: string
  company?: string
  /** Stays on the folio: their room now, their state, and the rooms a departed one slept in, in order. */
  stays?: Array<{ room?: string | null; state?: string; slept?: string[] }>
  booking?: boolean
}
const folios = async (adapter: Adapter, list: Folio[]) => {
  await insert(
    adapter,
    'hospitality_core_folio',
    list.map((folio) => ({
      id: folio.id,
      companyId: folio.company ?? scope.company,
      code: `PC-${folio.id.toUpperCase()}`,
      propertyId: folio.property ?? 'hotel',
      partnerId: folio.partner ?? 'guest',
      state: folio.state,
      amountTotal: folio.total,
      version: 1,
      openedAt: local(folio.opened),
      closedAt: folio.closed ? local(folio.closed, '12:00') : null,
    })),
  )
  const stays = list.flatMap((folio) =>
    (folio.stays ?? []).map((stay, index) => ({ folio, stay, id: `${folio.id}-s${index}` })),
  )
  if (stays.length)
    await insert(
      adapter,
      'hospitality_core_stay',
      stays.map(({ folio, stay, id }) => ({
        id,
        companyId: folio.company ?? scope.company,
        code: id.toUpperCase(),
        folioId: folio.id,
        reservationId: null,
        partnerId: folio.partner ?? 'guest',
        propertyId: folio.property ?? 'hotel',
        roomTypeId: (folio.property ?? 'hotel') === 'hotel' ? 'deluxe' : 'villa',
        currentRoomId: stay.room ?? null,
        bookingType: 'nightly',
        checkIn: local(folio.opened),
        checkOut: local('2026-09-04', '12:00'),
        adults: 2,
        children: 0,
        billingMode: 'upfront',
        rate: '100',
        state: stay.state ?? 'checked_in',
      })),
    )
  const slept = stays.flatMap(({ folio, stay, id }) =>
    (stay.slept ?? []).map((room, index) => ({
      id: `${id}-a${index}`,
      companyId: folio.company ?? scope.company,
      stayId: id,
      propertyId: folio.property ?? 'hotel',
      roomId: room,
      roomTypeId: 'deluxe',
      startAt: local(folio.opened, `1${index}:00`),
      endAt: local(folio.opened, `1${index + 1}:00`),
      state: 'closed',
      reason: null,
    })),
  )
  if (slept.length) await insert(adapter, 'hospitality_core_room_assignment', slept)
  const booked = list.filter((folio) => folio.booking !== false)
  if (booked.length)
    await insert(
      adapter,
      'hospitality_core_reservation',
      booked.map((folio) => ({
        id: `${folio.id}:booking`,
        companyId: folio.company ?? scope.company,
        code: `DP-${folio.id.toUpperCase()}`,
        propertyId: folio.property ?? 'hotel',
        roomTypeId: (folio.property ?? 'hotel') === 'hotel' ? 'deluxe' : 'villa',
        folioId: folio.id,
        stayId: null,
        partnerId: folio.partner ?? 'guest',
        provider: 'direct',
        bookingType: 'nightly',
        checkIn: local(folio.opened),
        checkOut: local('2026-09-04', '12:00'),
        adults: 2,
        children: 0,
        rate: '100',
        quantity: '5',
        billingMode: 'upfront',
        amountTotal: folio.total,
        currency: 'VND',
        state: folio.state === 'open' ? 'checked_in' : 'checked_out',
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z',
      })),
    )
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
  return adapter
}

/** The register: one folio per question it answers, and the ones it leaves out. */
const seed = (adapter: Adapter) =>
  folios(adapter, [
    // In the house, in 305.
    { id: 'in', state: 'open', total: '500', opened: '2026-08-30', stays: [{ room: '305' }] },
    // One purchase of three rooms; a cancelled copy holds no room.
    {
      id: 'group',
      state: 'open',
      partner: 'second',
      total: '3000',
      opened: '2026-08-31',
      stays: [{ room: '101' }, { room: '9' }, { room: '10' }, { room: null, state: 'cancelled' }],
    },
    // Left on 28 August, moved from 101 to 305 on the way.
    {
      id: 'left',
      state: 'closed',
      partner: 'third',
      total: '800',
      opened: '2026-08-25',
      closed: '2026-08-28',
      stays: [{ room: null, state: 'checked_out', slept: ['101', '305'] }],
    },
    {
      id: 'villa',
      state: 'open',
      property: 'resort',
      total: '1200',
      opened: '2026-08-29',
      stays: [{ room: 'v2' }],
    },
    // A cancelled booking that kept its fee: closed, never slept in the room it held.
    {
      id: 'fee',
      state: 'closed',
      partner: 'second',
      total: '200',
      opened: '2026-08-20',
      closed: '2026-08-21',
      stays: [{ room: null, state: 'cancelled', slept: ['9'] }],
    },
    // Not begun, or nothing held: not in the register.
    { id: 'draft', state: 'draft', total: '700', opened: '2026-09-02' },
    { id: 'void', state: 'cancelled', total: '0', opened: '2026-08-22' },
    // Another company's.
    {
      id: 'foreign',
      state: 'open',
      property: 'foreign',
      company: 'other',
      total: '900',
      opened: '2026-08-30',
    },
  ])

test('the folio register reads the folios that have begun, opened last first, with their state counted', async () => {
  const adapter = await boot()
  try {
    await seed(adapter)
    const all = await search(adapter)
    assert.deepEqual(
      [all.total, all.counts.view, all.isEmpty, all.partial],
      [5, { all: 5, open: 3, closed: 2 }, false, false],
    )
    assert.deepEqual(codes(all), ['PC-GROUP', 'PC-IN', 'PC-VILLA', 'PC-LEFT', 'PC-FEE'])
    const row = (code: string) => all.rows.find((item) => item.code === code)!
    // A group names its rooms in room order; a folio that left names the last room it slept in; one never roomed
    // names none. No contact detail travels with a row.
    assert.deepEqual(
      ['PC-GROUP', 'PC-IN', 'PC-VILLA', 'PC-LEFT', 'PC-FEE'].map((code) => row(code).rooms),
      [['9', '10', '101'], ['305'], ['V2'], ['305'], []],
    )
    assert.deepEqual(row('PC-LEFT'), {
      id: 'left',
      code: 'PC-LEFT',
      guest: 'Lê Châu',
      property: { id: 'hotel' },
      state: 'closed',
      total: { amount: '800', currency: 'VND' },
      rooms: ['305'],
      opened: '2026-08-25',
      closed: '2026-08-28',
    })
    assert.deepEqual(
      [row('PC-IN').state, row('PC-IN').closed, row('PC-VILLA').property],
      ['open', null, { id: 'resort' }],
    )
    assert.equal(/example\.invalid|0900000001/.test(JSON.stringify(all)), false)
    // A facet narrows the rows, not the counts.
    for (const [view, expected] of [
      ['open', ['PC-GROUP', 'PC-IN', 'PC-VILLA']],
      ['closed', ['PC-LEFT', 'PC-FEE']],
    ] as const) {
      const viewed = await search(adapter, { view })
      assert.deepEqual([codes(viewed), viewed.counts.view], [expected, all.counts.view], view)
    }
    const resort = await search(adapter, { propertyId: 'resort' })
    assert.deepEqual([codes(resort), resort.counts.view], [['PC-VILLA'], { all: 1, open: 1, closed: 0 }])
    // Headers order by code or by total, as values.
    for (const [sort, expected] of [
      ['title', ['PC-FEE', 'PC-GROUP', 'PC-IN', 'PC-LEFT', 'PC-VILLA']],
      ['-title', ['PC-VILLA', 'PC-LEFT', 'PC-IN', 'PC-GROUP', 'PC-FEE']],
      ['-total', ['PC-GROUP', 'PC-VILLA', 'PC-LEFT', 'PC-IN', 'PC-FEE']],
      ['total', ['PC-FEE', 'PC-IN', 'PC-LEFT', 'PC-VILLA', 'PC-GROUP']],
    ] as const)
      assert.deepEqual(codes(await search(adapter, { sort })), expected, sort)
    // Pages hold their size; a page past the end is the last one, and the answer says so.
    const last = await search(adapter, { pageSize: 2, page: 99 })
    assert.deepEqual([codes(last), last.page, last.pages, last.query.page], [['PC-FEE'], 3, 3, 3])
    // Another company reads its own register only.
    const other = await search(adapter, {}, { company: 'other', branches: null })
    assert.deepEqual([codes(other), other.counts.view], [['PC-FOREIGN'], { all: 1, open: 1, closed: 0 }])
    // Unknown values fall back: links to the facet and sorts the list no longer has read the whole register.
    const fallback = await search(adapter, { view: 'owing', sort: 'balance', propertyId: 'foreign' })
    assert.deepEqual(
      [fallback.query.view, fallback.query.sort, fallback.query.propertyId, fallback.total],
      ['all', '-opened', null, 5],
    )
  } finally {
    await adapter.close()
  }
})

test('the folio register finds folio and booking codes, guests by name, and a room held now', async () => {
  const adapter = await boot()
  try {
    await seed(adapter)
    const found = async (q: string, input: Record<string, unknown> = {}) => search(adapter, { q, ...input })
    assert.deepEqual(codes(await found('group')), ['PC-GROUP'])
    assert.deepEqual(codes(await found('DP-LEFT')), ['PC-LEFT'])
    // A guest's folios, and the counts follow the search.
    const named = await found('Trần')
    assert.deepEqual(
      [codes(named), named.counts.view],
      [['PC-GROUP', 'PC-FEE'], { all: 2, open: 1, closed: 1 }],
    )
    // A room is matched whole and only for the guest in it now: 305's departed guest is history.
    assert.deepEqual(codes(await found('305')), ['PC-IN'])
    // A departed stay that still names its room (older records) is history too.
    await folios(adapter, [
      {
        id: 'legacy',
        state: 'closed',
        total: '100',
        opened: '2026-08-10',
        closed: '2026-08-12',
        stays: [{ room: '305', state: 'checked_out' }],
      },
    ])
    assert.deepEqual(codes(await found('305')), ['PC-IN'])
    assert.deepEqual(codes(await found('v2')), ['PC-VILLA'])
    const none = await found('30')
    assert.deepEqual([none.total, none.isEmpty], [0, false])
    // A name past the lookup's bound says the answer is partial.
    await insert(
      adapter,
      'partner_partner',
      Array.from({ length: FOLIO_BOOK_MATCHES + 1 }, (_, index) => ({
        id: `bulk-${index}`,
        name: `Bulk Guest ${index}`,
        kind: 'person',
        active: 1,
      })),
    )
    assert.deepEqual([(await found('Bulk')).partial, (await found('Bùi')).partial], [true, false])
  } finally {
    await adapter.close()
  }
})

test('an empty register says so, whatever the search', async () => {
  const adapter = await boot()
  try {
    await folios(adapter, [{ id: 'early', state: 'draft', total: '700', opened: '2026-09-02' }])
    for (const q of ['', 'zzz']) {
      const empty = await search(adapter, { q })
      assert.deepEqual([empty.total, empty.isEmpty, empty.rows], [0, true, []], q)
      // An empty answer has one page, and its applied query asks for that one.
      const paged = await search(adapter, { q, page: 9 })
      assert.deepEqual([paged.page, paged.query.page], [1, 1], q)
    }
    await seed(adapter)
    assert.deepEqual(
      [(await search(adapter, { q: 'zzz' })).isEmpty, (await search(adapter, { q: 'zzz' })).total],
      [false, 0],
    )
  } finally {
    await adapter.close()
  }
})

test('the folio register writes only its own names on the URL and reads them back', () => {
  const properties = [{ id: 'hotel' }, { id: 'resort' }]
  const plain = { propertyId: null, view: 'all', q: '', sort: '-opened', page: 1, pageSize: 25 }
  assert.deepEqual(folioBookQueryFromUrl(new URL('http://x/folios'), properties), plain)
  assert.equal(
    folioBookHref('/admin/hospitality/folios?company=acme&lang=en', plain as never),
    '/admin/hospitality/folios?company=acme&lang=en',
  )
  const query = {
    propertyId: 'resort',
    view: 'closed',
    q: ' Lê ',
    sort: '-total',
    page: 2,
    pageSize: 25,
  } as const
  const href = folioBookHref('/admin/hospitality/folios?company=acme', query)
  assert.equal(
    href,
    '/admin/hospitality/folios?company=acme&property=resort&view=closed&q=L%C3%AA&sort=-total&page=2',
  )
  assert.deepEqual(folioBookQueryFromUrl(new URL(href, 'http://x'), properties), { ...query, q: 'Lê' })
  // The mock's header names its code order `title`; the facet and sorts the register no longer has fall back.
  assert.equal(folioBookQueryFromUrl(new URL('http://x/f?sort=-title'), properties).sort, '-title')
  assert.deepEqual(
    folioBookQueryFromUrl(new URL('http://x/f?view=owing&sort=balance&property=gone&page=0'), properties),
    plain,
  )
})

test('the folio register asks billing for the rows shown, and a missing answer is unknown', async () => {
  const asked: unknown[] = []
  const pending: Array<{ resolve: (value: Response) => void; signal: AbortSignal }> = []
  const reader = createFolioDueReader({
    source: '/_ket/fn/hospitality_billing.getFolioDues',
    fetch: (async (url: string, init: RequestInit) => {
      asked.push([url, JSON.parse(String(init.body))])
      return new Promise<Response>((resolve) => pending.push({ resolve, signal: init.signal! }))
    }) as unknown as typeof fetch,
  })
  const answer = (rows: unknown, ok = true) =>
    Response.json(ok ? { ok: true, value: { rows } } : { ok: false })
  const first = reader.read(['a', 'b'])
  const second = reader.read(['b', 'c'])
  assert.equal(pending[0]!.signal.aborted, true)
  pending[0]!.resolve(answer([{ id: 'a', due: '9', currency: 'VND', known: true, invoice: null }]))
  const invoice = { name: 'INV/2026/0001', status: 'posted' }
  pending[1]!.resolve(
    answer([
      { id: 'b', due: '0', currency: 'VND', known: true, invoice },
      { id: 'c', known: 'yes' },
    ]),
  )
  await Promise.all([first, second])
  assert.deepEqual(asked, [
    ['/_ket/fn/hospitality_billing.getFolioDues', { ids: ['a', 'b'] }],
    ['/_ket/fn/hospitality_billing.getFolioDues', { ids: ['b', 'c'] }],
  ])
  assert.deepEqual(Object.fromEntries(reader.dues()), {
    b: { id: 'b', due: '0', currency: 'VND', known: true, invoice },
    c: { id: 'c', due: null, currency: null, known: false, invoice: null },
  })
  const third = reader.read(['c'])
  pending[2]!.resolve(answer(null, false))
  await third
  assert.equal(reader.dues().get('c'), 'failed')
})
