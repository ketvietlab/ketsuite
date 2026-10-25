import { asc, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { dateKeyIn, timeKeyIn } from '../calendar.ts'
import { STAY_BOOK_VIEWS, foldText, stayBookQuery } from '../stay-book-query.ts'
import type { StayBookQuery, StayBookSort, StayBookView } from '../stay-book-query.ts'
import { bookProperties, getReservationBookFrameHandler } from './reservation-book.ts'
import type { BookProperty } from './reservation-book.ts'

/**
 * The house is read whole up to this many stays (HOS-DEC-031): a property's rooms bound it, a chain shown at once
 * may pass it, and then the answer says it is partial.
 */
export const STAY_BOOK_HOUSE_LIMIT = 2000
// Related records are read by id in slices of this many.
const SLICE = 500

export type StayBookRow = {
  id: string
  code: string
  /** The reservation the stay was checked in from; its page is where the desk works the stay. */
  reservation: { id: string } | null
  guest: string
  vip: boolean
  loyalty: string | null
  property: { id: string }
  roomType: { id: string; name: string }
  room: string | null
  arrival: string
  departure: string
  nights: number
  nightsStayed: number
  /** Days from the property's business date to the departure; 0 or less is today, overdue included. */
  departsIn: number
  /** The property's standard check-out time. */
  checkOut: string
  /** The stay's own departure time when it is past the standard one. */
  lateCheckout: string | null
  adults: number
  children: number
  request: string | null
}
type Held = StayBookRow & { folded: string }

const instant = (value: unknown): Date | null => {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
const daysBetween = (from: string, to: string) =>
  from && to ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) : 0

const empty = (query: StayBookQuery) => ({
  query,
  total: 0,
  page: 1,
  pages: 1,
  rows: [],
  counts: { view: Object.fromEntries(STAY_BOOK_VIEWS.map((id) => [id, 0])) },
  houseIsEmpty: true,
  partial: false,
})

/** Records of one model by id, in slices, inside the reader's company. */
export async function readByIds(ctx: Ctx, model: string, ids: unknown[], columns: string[]) {
  const T = ctx.table(model)
  const unique = [...new Set(ids.filter(Boolean))]
  const found = new Map<unknown, Row>()
  for (let start = 0; start < unique.length; start += SLICE) {
    const slice = unique.slice(start, start + SLICE)
    let query = from(T)
      .select(...columns.map((name) => T[name]!))
      .where(inArray(T.id, slice))
    if (T.$columns.includes('companyId') && ctx.scope.company)
      query = query.where(eq(T.companyId!, ctx.scope.company))
    for (const row of await ctx.db.all(query.limit(slice.length))) found.set(row.id, row)
  }
  return found
}

/** The stays checked in at the properties shown, as rows, up to the house limit. */
async function readHouse(ctx: Ctx, shown: BookProperty[]) {
  const S = ctx.table('hospitality_core.Stay')
  const stays = await ctx.db.all(
    from(S)
      .select(
        S.id,
        S.code,
        S.reservationId!,
        S.partnerId,
        S.propertyId,
        S.roomTypeId,
        S.currentRoomId!,
        S.checkIn,
        S.checkOut,
        S.adults,
        S.children,
      )
      .where(
        eq(S.companyId!, ctx.scope.company),
        inArray(
          S.propertyId,
          shown.map((row) => row.id),
        ),
        eq(S.state, 'checked_in'),
      )
      .orderBy(asc(S.id))
      .limit(STAY_BOOK_HOUSE_LIMIT + 1),
  )
  const house = stays.slice(0, STAY_BOOK_HOUSE_LIMIT)
  // One read after another: a function's database handle runs one statement at a time.
  const guests = await readByIds(
    ctx,
    'partner.Partner',
    house.map((row) => row.partnerId),
    ['id', 'name'],
  )
  const rooms = await readByIds(
    ctx,
    'hospitality_core.Room',
    house.map((row) => row.currentRoomId),
    ['id', 'code', 'name'],
  )
  const types = await readByIds(
    ctx,
    'hospitality_core.RoomType',
    house.map((row) => row.roomTypeId),
    ['id', 'name'],
  )
  const bookings = await readByIds(
    ctx,
    'hospitality_core.Reservation',
    house.map((row) => row.reservationId),
    ['id', 'code', 'guestVip', 'guestLoyaltyTier', 'arrivalNote'],
  )
  const byProperty = new Map(shown.map((row) => [row.id, row]))
  const rows = house.map((stay): Held => {
    const property = byProperty.get(String(stay.propertyId))!
    const arrival = instant(stay.checkIn),
      departure = instant(stay.checkOut)
    const arrivalDay = arrival ? dateKeyIn(arrival, property.timezone) : '',
      departureDay = departure ? dateKeyIn(departure, property.timezone) : ''
    const leaves = departure ? timeKeyIn(departure, property.timezone) : ''
    const booking = bookings.get(stay.reservationId)
    const room = rooms.get(stay.currentRoomId)
    const nights = Math.max(0, daysBetween(arrivalDay, departureDay))
    const row: StayBookRow = {
      id: String(stay.id),
      code: String(booking?.code ?? stay.code),
      reservation: booking ? { id: String(booking.id) } : null,
      guest: String(guests.get(stay.partnerId)?.name ?? ''),
      vip: booking?.guestVip === true,
      // A tier id (`gold_elite`); `none` is no tier.
      loyalty:
        booking?.guestLoyaltyTier && booking.guestLoyaltyTier !== 'none'
          ? String(booking.guestLoyaltyTier)
          : null,
      property: { id: property.id },
      roomType: { id: String(stay.roomTypeId), name: String(types.get(stay.roomTypeId)?.name ?? '') },
      room: room ? String(room.code ?? room.name ?? '') : null,
      arrival: arrivalDay,
      departure: departureDay,
      nights,
      nightsStayed: Math.min(nights, Math.max(0, daysBetween(arrivalDay, property.businessDate))),
      departsIn: daysBetween(property.businessDate, departureDay),
      checkOut: property.checkOut,
      // A departure saved at midnight or before the standard time reads as the standard time.
      lateCheckout: property.checkOut && leaves > property.checkOut ? leaves : null,
      adults: Number(stay.adults ?? 0),
      children: Number(stay.children ?? 0),
      request: booking?.arrivalNote ? String(booking.arrivalNote) : null,
    }
    return { ...row, folded: foldText(`${row.code} ${stay.code} ${row.guest} ${row.room ?? ''}`) }
  })
  return { rows, partial: stays.length > STAY_BOOK_HOUSE_LIMIT }
}

const VIEWS: Record<StayBookView, (row: Held) => boolean> = {
  all: () => true,
  departing: (row) => row.departsIn <= 0,
  tomorrow: (row) => row.departsIn === 1,
  vip: (row) => row.vip,
}
const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' })
// Rooms read as the desk reads them: by property, then by number; a stay without a room comes last.
const roomOrder = (names: Map<string, string>) => (a: Held, b: Held) =>
  collator.compare(names.get(a.property.id) ?? '', names.get(b.property.id) ?? '') ||
  Number(a.room === null) - Number(b.room === null) ||
  collator.compare(a.room ?? '', b.room ?? '') ||
  a.code.localeCompare(b.code) ||
  a.id.localeCompare(b.id)
const ORDERS: Record<StayBookSort, (byRoom: (a: Held, b: Held) => number) => (a: Held, b: Held) => number> = {
  room: (byRoom) => byRoom,
  '-room': (byRoom) => (a, b) => byRoom(b, a),
  departure: (byRoom) => (a, b) => a.departure.localeCompare(b.departure) || byRoom(a, b),
  '-departure': (byRoom) => (a, b) => b.departure.localeCompare(a.departure) || byRoom(a, b),
  guest: (byRoom) => (a, b) => collator.compare(a.guest, b.guest) || byRoom(a, b),
}

/**
 * `hospitality_core.searchStays`: one page of one query over the guests in the house now, as the accepted mock
 * reads it (design/hospitality/stay-book.mjs, HOS-DEC-031).
 * Input: `{ propertyId?, view?, q?, sort?, page?, pageSize? }`. Output: `{ query, total, page, pages, rows,
 * counts: { view }, houseIsEmpty, partial }`, `query` being the input as applied so the caller can correct its URL.
 * View counts ignore the view. The house of the properties shown is read once, up to its limit, and searched without
 * accents by booking code, guest and room; `partial` says it ran past the limit. What a stay owes is billing's
 * (`hospitality_billing.getStayDues`).
 */
export const searchStaysHandler: FnSpec['handler'] = async (ctx, args) => {
  const properties = ctx.scope.company ? await bookProperties(ctx) : []
  const query = stayBookQuery(args, properties)
  const shown = query.propertyId ? properties.filter((row) => row.id === query.propertyId) : properties
  if (!shown.length) return empty(query)
  const house = await readHouse(ctx, shown)
  if (!house.rows.length) return { ...empty(query), partial: house.partial }
  const needle = foldText(query.q)
  const scope = needle ? house.rows.filter((row) => row.folded.includes(needle)) : house.rows
  const matching = scope
    .filter(VIEWS[query.view])
    .sort(ORDERS[query.sort](roomOrder(new Map(shown.map((row) => [row.id, row.name])))))
  const pages = Math.max(1, Math.ceil(matching.length / query.pageSize))
  const page = Math.min(pages, query.page)
  return {
    query: { ...query, page },
    total: matching.length,
    page,
    pages,
    rows: matching
      .slice((page - 1) * query.pageSize, page * query.pageSize)
      .map(({ folded: _, ...row }): StayBookRow => row),
    counts: {
      view: Object.fromEntries(STAY_BOOK_VIEWS.map((id) => [id, scope.filter(VIEWS[id]).length])),
    },
    houseIsEmpty: false,
    partial: house.partial,
  }
}

export const stayBookFunctions = {
  getStayBookFrame: defineFn({
    input: {},
    output: { properties: 'json' },
    effects: ['read:hospitality_core.Property'],
    handler: getReservationBookFrameHandler,
  }),
  searchStays: defineFn({
    input: {
      propertyId: 'id?',
      view: 'text?',
      q: 'text?',
      sort: 'text?',
      page: 'int?',
      pageSize: 'int?',
    },
    output: {
      query: 'json',
      total: 'int',
      page: 'int',
      pages: 'int',
      rows: 'json',
      counts: 'json',
      houseIsEmpty: 'bool',
      partial: 'bool',
    },
    effects: [
      'read:hospitality_core.Stay',
      'read:hospitality_core.Property',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomType',
      'read:partner.Partner',
    ],
    handler: searchStaysHandler,
  }),
}
