import {
  and,
  asc,
  defineFn,
  desc,
  eq,
  from,
  gte,
  ilike,
  inArray,
  isNull,
  likeLiteral,
  lt,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, Expr, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn, zonedMidnight } from '../calendar.ts'
import {
  RESERVATION_BOOK_STATUSES,
  RESERVATION_BOOK_VIEWS,
  reservationBookQuery,
} from '../reservation-book-query.ts'
import type { ReservationBookQuery, ReservationBookStatus as Status } from '../reservation-book-query.ts'
import { readRecord } from './command.ts'
import { roomStatusDay } from './room-blocks.ts'

/** A guest-name search follows at most this many guest records; past it the answer says it is partial. */
export const RESERVATION_BOOK_GUEST_MATCHES = 500
/** Bookings holding a searched room now; past this the answer says it is partial. */
export const RESERVATION_BOOK_ROOM_MATCHES = 500
const MAX_PROPERTIES = 200
// A stay moves rooms a few times at most; its room history is read whole up to this.
const ASSIGNMENTS_PER_STAY = 20

export type BookProperty = {
  id: string
  name: string
  timezone: string
  businessDate: string
  tomorrow: string
  /** The property's standard check-out time, `HH:MM`. */
  checkOut: string
}

const OPEN = ['confirmed', 'checked_in']
// A draft is not yet a booking the desk works; the book holds the rest.
const BOOKED = [...OPEN, 'checked_out', 'cancelled', 'no_show']
// "Cần xử lý trước" (HOS-DEC-030): the desk's groups in order. Open ones run from the earliest arrival, finished
// ones from the latest, so each group reads on the property's schedule index.
const RELEVANCE: readonly Status[] = [
  'arriving',
  'departing',
  'in_house',
  'confirmed',
  'checked_out',
  'cancelled',
]
const FINISHED: readonly Status[] = ['checked_out', 'cancelled']
// A room code as rooms are saved: Latin letters, digits, dot, underscore or hyphen.
const ROOM_CODE = /^[A-Za-z0-9._-]{1,20}$/

const instant = (value: unknown): Date | null => {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** The properties the reader may see, with the day each one's desk is on. */
export async function bookProperties(ctx: Ctx): Promise<BookProperty[]> {
  const P = ctx.table('hospitality_core.Property')
  let read = from(P).where(eq(P.companyId!, ctx.scope.company), eq(P.active, true))
  if (ctx.scope.branches) read = read.where(inArray(P.branchId!, ctx.scope.branches))
  const rows = await ctx.db.all(read.orderBy(asc(P.name), asc(P.id)).limit(MAX_PROPERTIES))
  return rows.map((row) => {
    const timezone = String(row.timezone || 'UTC')
    const businessDate = roomStatusDay(row)
    return {
      id: String(row.id),
      name: String(row.name ?? ''),
      timezone,
      businessDate,
      tomorrow: zonedMidnight(addCalendarDays(businessDate, 1), timezone).toISOString(),
      checkOut: String(row.defaultCheckOut ?? ''),
    }
  })
}

const empty = (query: ReservationBookQuery) => ({
  query,
  total: 0,
  page: 1,
  pages: 1,
  rows: [],
  counts: {
    status: Object.fromEntries(RESERVATION_BOOK_STATUSES.map((id) => [id, 0])),
    view: Object.fromEntries(RESERVATION_BOOK_VIEWS.map((id) => [id, 0])),
  },
  bookIsEmpty: true,
  partial: false,
})

/**
 * The bookings a search names besides by code: guests whose name holds the words, and the stays that hold a room
 * of that exact code now. Both reads are bounded; `partial` says one of them stopped short.
 */
async function searchedBy(ctx: Ctx, properties: BookProperty[], needle: string) {
  const R = ctx.table('hospitality_core.Reservation')
  const pattern = `%${likeLiteral(needle)}%`
  const parts: Expr[] = [
    ilike(R.code, pattern, true),
    ilike(R.channelRef!, pattern, true),
    ilike(R.externalId!, pattern, true),
  ]
  let partial = false
  const P = ctx.table('partner.Partner')
  let guests = from(P)
    .select(P.id)
    .where(ilike(P.name, pattern, true))
  if (P.$columns.includes('companyId') && ctx.scope.company)
    guests = guests.where(eq(P.companyId!, ctx.scope.company))
  const named = await ctx.db.all(guests.orderBy(asc(P.id)).limit(RESERVATION_BOOK_GUEST_MATCHES + 1))
  if (named.length > RESERVATION_BOOK_GUEST_MATCHES) partial = true
  if (named.length)
    parts.push(
      inArray(
        R.partnerId,
        named.slice(0, RESERVATION_BOOK_GUEST_MATCHES).map((row) => row.id),
      ),
    )
  if (ROOM_CODE.test(needle)) {
    const Room = ctx.table('hospitality_core.Room')
    const rooms = await ctx.db.all(
      from(Room)
        .select(Room.id)
        .where(
          eq(Room.companyId!, ctx.scope.company),
          inArray(
            Room.propertyId,
            properties.map((row) => row.id),
          ),
          ilike(Room.code, likeLiteral(needle), true),
        )
        .limit(properties.length),
    )
    if (rooms.length) {
      const A = ctx.table('hospitality_core.RoomAssignment')
      const holding = await ctx.db.all(
        from(A)
          .select(A.stayId)
          .where(
            eq(A.companyId!, ctx.scope.company),
            inArray(
              A.roomId,
              rooms.map((row) => row.id),
            ),
            inArray(A.state, ['held', 'active']),
          )
          .limit(RESERVATION_BOOK_ROOM_MATCHES + 1),
      )
      if (holding.length > RESERVATION_BOOK_ROOM_MATCHES) partial = true
      if (holding.length)
        parts.push(
          inArray(R.stayId!, [
            ...new Set(holding.slice(0, RESERVATION_BOOK_ROOM_MATCHES).map((row) => row.stayId)),
          ]),
        )
    }
  }
  return { condition: or(...parts), partial }
}

/** One page of `[{ id, code, guest, … }]` for the browser to format: ids and plain values, no contact details. */
async function bookRows(ctx: Ctx, bookings: Row[], properties: Map<string, BookProperty>, currency: string) {
  if (!bookings.length) return []
  const read = async (model: string, ids: unknown[], columns: string[]) => {
    const T = ctx.table(model)
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return new Map<unknown, Row>()
    let query = from(T)
      .select(...columns.map((name) => T[name]!))
      .where(inArray(T.id, unique))
    if (T.$columns.includes('companyId') && ctx.scope.company)
      query = query.where(eq(T.companyId!, ctx.scope.company))
    return new Map((await ctx.db.all(query.limit(unique.length))).map((row) => [row.id, row]))
  }
  const guests = await read(
    'partner.Partner',
    bookings.map((row) => row.partnerId),
    ['id', 'name'],
  )
  const types = await read(
    'hospitality_core.RoomType',
    bookings.map((row) => row.roomTypeId),
    ['id', 'name'],
  )
  const stays = await read(
    'hospitality_core.Stay',
    bookings.map((row) => row.stayId),
    ['id', 'reservationId', 'currentRoomId'],
  )
  // A booking names the room it sleeps in, else the first room held for it, else the last one it slept in.
  const A = ctx.table('hospitality_core.RoomAssignment')
  const stayIds = [...stays.keys()]
  const assignments = stayIds.length
    ? await ctx.db.all(
        from(A)
          .select(A.stayId, A.roomId, A.state, A.startAt)
          .where(eq(A.companyId!, ctx.scope.company), inArray(A.stayId, stayIds))
          .orderBy(asc(A.startAt), asc(A.id))
          .limit(stayIds.length * ASSIGNMENTS_PER_STAY),
      )
    : []
  const byStay = Map.groupBy(assignments, (row) => row.stayId)
  const roomOf = (booking: Row) => {
    const stay = stays.get(booking.stayId)
    if (
      !stay ||
      stay.reservationId !== booking.id ||
      ['cancelled', 'no_show'].includes(String(booking.state))
    )
      return null
    const held = byStay.get(stay.id) ?? []
    return (
      stay.currentRoomId ??
      held.find((row) => row.state === 'active')?.roomId ??
      held.find((row) => row.state === 'held')?.roomId ??
      held.findLast((row) => row.state === 'closed')?.roomId ??
      null
    )
  }
  const rooms = await read('hospitality_core.Room', bookings.map(roomOf), ['id', 'code', 'name'])
  return bookings.map((booking) => {
    const property = properties.get(String(booking.propertyId))!
    const arrival = instant(booking.checkIn),
      departure = instant(booking.checkOut)
    const arrivalDay = arrival ? dateKeyIn(arrival, property.timezone) : '',
      departureDay = departure ? dateKeyIn(departure, property.timezone) : ''
    const room = rooms.get(roomOf(booking))
    return {
      id: String(booking.id),
      code: String(booking.code),
      guest: String(guests.get(booking.partnerId)?.name ?? ''),
      vip: booking.guestVip === true,
      loyalty: booking.guestLoyaltyTier ? String(booking.guestLoyaltyTier) : null,
      property: { id: property.id },
      roomType: { id: String(booking.roomTypeId), name: String(types.get(booking.roomTypeId)?.name ?? '') },
      room: room ? String(room.code ?? room.name ?? '') : null,
      arrival: arrivalDay,
      departure: departureDay,
      nights:
        arrivalDay && departureDay
          ? Math.max(0, Math.round((Date.parse(departureDay) - Date.parse(arrivalDay)) / 86_400_000))
          : 0,
      adults: Number(booking.adults ?? 0),
      children: Number(booking.children ?? 0),
      source: { id: String(booking.provider ?? 'direct') },
      status: { id: rowStatus(booking, property) },
      guarantee: { kind: String(booking.guaranteeKind ?? 'none') },
      total: { amount: String(booking.amountTotal ?? '0'), currency: String(booking.currency || currency) },
    }
  })
}

const rowStatus = (booking: Row, property: BookProperty) => {
  const state = String(booking.state)
  const before = (value: unknown) => (instant(value)?.toISOString() ?? '') < property.tomorrow
  if (state === 'confirmed') return before(booking.checkIn) ? 'arriving' : 'confirmed'
  if (state === 'checked_in') return before(booking.checkOut) ? 'departing' : 'in_house'
  return state
}

/**
 * `hospitality_core.searchReservations`: one page of one query over the reservation book, as the accepted mock
 * reads it (design/hospitality/reservation-book.mjs, HOS-DEC-030).
 * Input: `{ propertyId?, from?, days?, status?, source?, view?, q?, sort?, page?, pageSize? }`; `from` is the first
 * civil date of the stay window and `days` its length (7, 14 or 30; `null` for every date).
 * Output: `{ query, total, page, pages, rows, counts: { status, view }, bookIsEmpty, partial }`, `query` being the
 * input as applied so the caller can correct its URL. Status counts ignore the status filter; view counts honour
 * it. A stay touches the window from its arrival night to its departure morning, in its property's clock; status
 * follows each property's business date. Every predicate and count runs in the scoped database.
 */
export const searchReservationsHandler: FnSpec['handler'] = async (ctx, args) => {
  const properties = ctx.scope.company ? await bookProperties(ctx) : []
  const query = reservationBookQuery(args, properties)
  const shown = query.propertyId ? properties.filter((row) => row.id === query.propertyId) : properties
  if (!shown.length) return empty(query)
  const R = ctx.table('hospitality_core.Reservation')
  const byProperty = new Map(shown.map((row) => [row.id, row]))
  // Each property speaks for its own window and its own today; one condition per property, joined.
  const each = (part: (property: BookProperty) => Expr[]) =>
    or(...shown.map((property) => and(eq(R.propertyId, property.id), ...part(property))))
  const window = (property: BookProperty): Expr[] =>
    query.from === null || query.days === null
      ? []
      : [
          lt(
            R.checkIn,
            zonedMidnight(addCalendarDays(query.from, query.days), property.timezone).toISOString(),
          ),
          gte(R.checkOut, zonedMidnight(query.from, property.timezone).toISOString()),
        ]
  const status =
    (id: Status) =>
    (property: BookProperty): Expr[] =>
      id === 'arriving'
        ? [eq(R.state, 'confirmed'), lt(R.checkIn, property.tomorrow)]
        : id === 'confirmed'
          ? [eq(R.state, 'confirmed'), gte(R.checkIn, property.tomorrow)]
          : id === 'departing'
            ? [eq(R.state, 'checked_in'), lt(R.checkOut, property.tomorrow)]
            : id === 'in_house'
              ? [eq(R.state, 'checked_in'), gte(R.checkOut, property.tomorrow)]
              : id === 'checked_out'
                ? [eq(R.state, 'checked_out')]
                : id === 'cancelled'
                  ? [inArray(R.state, ['cancelled', 'no_show'])]
                  : [inArray(R.state, BOOKED)]
  const book = from(R).where(eq(R.companyId!, ctx.scope.company))
  const bookIsEmpty = !(await ctx.db.one(
    book
      .select(R.id)
      .where(each(() => [inArray(R.state, BOOKED)]))
      .limit(1),
  ))
  const needle = query.q
  const search = needle ? await searchedBy(ctx, shown, needle) : null
  const narrowed = [
    ...(query.source ? [eq(R.provider, query.source)] : []),
    ...(search ? [search.condition] : []),
  ]
  const scoped = (id: Status) =>
    book.where(
      each((property) => [...window(property), ...status(id)(property)]),
      ...narrowed,
    )
  const statusCounts = Object.fromEntries(
    await Promise.all(
      RESERVATION_BOOK_STATUSES.map(async (id) => [id, await ctx.db.count(scoped(id))] as const),
    ),
  )
  const unguaranteed = and(inArray(R.state, OPEN), or(isNull(R.guaranteeKind!), eq(R.guaranteeKind!, 'none')))
  const viewCounts = {
    all: statusCounts[query.status]!,
    unguaranteed: await ctx.db.count(scoped(query.status).where(unguaranteed)),
  }
  const viewed = (read: ReturnType<typeof scoped>) =>
    query.view === 'unguaranteed' ? read.where(unguaranteed) : read
  const total = viewCounts[query.view]
  const pages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(pages, query.page)
  const columns = [
    R.id,
    R.code,
    R.propertyId,
    R.roomTypeId,
    R.partnerId,
    R.stayId!,
    R.provider,
    R.checkIn,
    R.checkOut,
    R.adults,
    R.children,
    R.amountTotal,
    R.currency!,
    R.state,
    R.guaranteeKind!,
    R.guestVip!,
    R.guestLoyaltyTier!,
  ]
  let bookings: Row[] = []
  if (query.sort === 'relevance') {
    // Group by group, skipping whole groups before the page; a page that crosses a boundary reads on.
    let skip = (page - 1) * query.pageSize
    for (const id of RELEVANCE) {
      if (query.status !== 'all' && query.status !== id) continue
      const group = viewed(scoped(id))
      const size = query.view === 'all' ? statusCounts[id]! : await ctx.db.count(group)
      if (skip >= size) {
        skip -= size
        continue
      }
      const order = FINISHED.includes(id) ? desc : asc
      bookings.push(
        ...(await ctx.db.all(
          group
            .select(...columns)
            .orderBy(order(R.checkIn), asc(R.code), asc(R.id))
            .limit(query.pageSize - bookings.length)
            .offset(skip),
        )),
      )
      skip = 0
      if (bookings.length === query.pageSize) break
    }
  } else {
    const order = query.sort.startsWith('-') ? desc : asc
    const field = query.sort.endsWith('arrival') ? R.checkIn : R.amountTotal
    bookings = await ctx.db.all(
      viewed(scoped(query.status))
        .select(...columns)
        .orderBy(order(field), asc(R.code), asc(R.id))
        .limit(query.pageSize)
        .offset((page - 1) * query.pageSize),
    )
  }
  return {
    query: { ...query, page },
    total,
    page,
    pages,
    rows: await bookRows(
      ctx,
      bookings,
      byProperty,
      String((await readRecord(ctx, 'company.Company', ctx.scope.company))?.currency || 'VND'),
    ),
    counts: { status: statusCounts, view: viewCounts },
    bookIsEmpty,
    partial: search?.partial ?? false,
  }
}

/** What the book's server render needs for its frame: the properties shown and the day each one's desk is on. */
export const getReservationBookFrameHandler: FnSpec['handler'] = async (ctx) => ({
  properties: ctx.scope.company
    ? (await bookProperties(ctx)).map(({ id, name, businessDate }) => ({ id, name, businessDate }))
    : [],
})

export const reservationBookFunctions = {
  getReservationBookFrame: defineFn({
    input: {},
    output: { properties: 'json' },
    effects: ['read:hospitality_core.Property'],
    handler: getReservationBookFrameHandler,
  }),
  searchReservations: defineFn({
    input: {
      propertyId: 'id?',
      from: 'text?',
      days: 'int?',
      status: 'text?',
      source: 'text?',
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
      bookIsEmpty: 'bool',
      partial: 'bool',
    },
    effects: [
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Property',
      'read:hospitality_core.Stay',
      'read:hospitality_core.RoomAssignment',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomType',
      'read:partner.Partner',
      'read:company.Company',
    ],
    handler: searchReservationsHandler,
  }),
}
