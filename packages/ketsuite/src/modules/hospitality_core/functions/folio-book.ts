import { asc, defineFn, desc, eq, from, ilike, inArray, likeLiteral, or } from '@ketvietlab/ketjs'
import type { Ctx, Expr, FnSpec, Row } from '@ketvietlab/ketjs'
import { dateKeyIn } from '../calendar.ts'
import { FOLIO_BOOK_VIEWS, folioBookQuery } from '../folio-book-query.ts'
import type { FolioBookQuery, FolioBookSort } from '../folio-book-query.ts'
import { readRecord } from './command.ts'
import { bookProperties, getReservationBookFrameHandler } from './reservation-book.ts'
import type { BookProperty } from './reservation-book.ts'
import { readByIds } from './stay-book.ts'

/** A search by booking code, guest name or room follows at most this many records; past it the answer is partial. */
export const FOLIO_BOOK_MATCHES = 500
// The folios that have begun: a draft is a booking's, a cancelled one without a fee holds nothing (HOS-DEC-032).
const REGISTER = ['open', 'closed']
const ROOM_CODE = /^[A-Za-z0-9._-]{1,20}$/
// A page reads at most this many stays per folio (a group's rooms) and assignments per departed stay.
const STAYS_PER_FOLIO = 50
const ASSIGNMENTS_PER_STAY = 20

export type FolioBookRow = {
  id: string
  code: string
  guest: string
  property: { id: string }
  state: 'open' | 'closed'
  total: { amount: string; currency: string }
  /** The rooms its stays sleep in now, or slept in last, in room order; none before a room was given. */
  rooms: string[]
  /** Property-local civil dates. */
  opened: string
  closed: string | null
}

const instant = (value: unknown): Date | null => {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' })

const empty = (query: FolioBookQuery) => ({
  // An empty answer has one page, so the query it applied asks for that one.
  query: { ...query, page: 1 },
  total: 0,
  page: 1,
  pages: 1,
  rows: [],
  counts: { view: Object.fromEntries(FOLIO_BOOK_VIEWS.map((id) => [id, 0])) },
  isEmpty: true,
  partial: false,
})

/**
 * The folios a search names besides by their own code: those of bookings whose code holds the words, of guests
 * whose name does, and the open folio of the guest sleeping now in a room of that exact code. Each read is bounded;
 * `partial` says one of them stopped short.
 */
async function searchedBy(ctx: Ctx, shown: BookProperty[], needle: string) {
  const F = ctx.table('hospitality_core.Folio')
  const pattern = `%${likeLiteral(needle)}%`
  const propertyIds = shown.map((row) => row.id)
  const parts: Expr[] = [ilike(F.code, pattern, true)]
  let partial = false
  const bounded = (rows: Row[], column: string) => {
    if (rows.length > FOLIO_BOOK_MATCHES) partial = true
    return [...new Set(rows.slice(0, FOLIO_BOOK_MATCHES).map((row) => row[column]))]
  }
  const R = ctx.table('hospitality_core.Reservation')
  const booked = bounded(
    await ctx.db.all(
      from(R)
        .select(R.folioId)
        .where(
          eq(R.companyId!, ctx.scope.company),
          inArray(R.propertyId, propertyIds),
          or(
            ilike(R.code, pattern, true),
            ilike(R.channelRef!, pattern, true),
            ilike(R.externalId!, pattern, true),
          ),
        )
        .orderBy(asc(R.id))
        .limit(FOLIO_BOOK_MATCHES + 1),
    ),
    'folioId',
  )
  if (booked.length) parts.push(inArray(F.id, booked))
  const P = ctx.table('partner.Partner')
  let guests = from(P)
    .select(P.id)
    .where(ilike(P.name, pattern, true))
  if (P.$columns.includes('companyId') && ctx.scope.company)
    guests = guests.where(eq(P.companyId!, ctx.scope.company))
  const named = bounded(await ctx.db.all(guests.orderBy(asc(P.id)).limit(FOLIO_BOOK_MATCHES + 1)), 'id')
  if (named.length) parts.push(inArray(F.partnerId, named))
  if (ROOM_CODE.test(needle)) {
    const Room = ctx.table('hospitality_core.Room')
    const rooms = await ctx.db.all(
      from(Room)
        .select(Room.id)
        .where(
          eq(Room.companyId!, ctx.scope.company),
          inArray(Room.propertyId, propertyIds),
          ilike(Room.code, likeLiteral(needle), true),
        )
        .limit(shown.length),
    )
    if (rooms.length) {
      const S = ctx.table('hospitality_core.Stay')
      const inside = bounded(
        await ctx.db.all(
          from(S)
            .select(S.folioId)
            .where(
              eq(S.companyId!, ctx.scope.company),
              inArray(
                S.currentRoomId!,
                rooms.map((row) => row.id),
              ),
              eq(S.state, 'checked_in'),
            )
            .limit(FOLIO_BOOK_MATCHES + 1),
        ),
        'folioId',
      )
      // Only a stay in the house holds its room now; one that left keeps it as history.
      if (inside.length) parts.push(inArray(F.id, inside))
    }
  }
  return { condition: or(...parts), partial }
}

/** One page of `[{ id, code, guest, … }]` for the browser to format: ids and plain values, no contact or money due. */
async function folioRows(ctx: Ctx, folios: Row[], properties: Map<string, BookProperty>, currency: string) {
  if (!folios.length) return []
  const ids = folios.map((row) => row.id)
  const guests = await readByIds(
    ctx,
    'partner.Partner',
    folios.map((row) => row.partnerId),
    ['id', 'name'],
  )
  const S = ctx.table('hospitality_core.Stay')
  const stays = await ctx.db.all(
    from(S)
      .select(S.id, S.folioId, S.currentRoomId!)
      .where(
        eq(S.companyId!, ctx.scope.company),
        inArray(S.folioId, ids),
        inArray(S.state, ['checked_in', 'checked_out']),
      )
      .orderBy(asc(S.id))
      .limit(ids.length * STAYS_PER_FOLIO),
  )
  // A stay that left names the last room it slept in.
  const departed = stays.filter((row) => !row.currentRoomId).map((row) => row.id)
  const A = ctx.table('hospitality_core.RoomAssignment')
  const assignments = departed.length
    ? await ctx.db.all(
        from(A)
          .select(A.stayId, A.roomId)
          .where(
            eq(A.companyId!, ctx.scope.company),
            inArray(A.stayId, departed),
            inArray(A.state, ['active', 'closed']),
          )
          .orderBy(asc(A.startAt), asc(A.id))
          .limit(departed.length * ASSIGNMENTS_PER_STAY),
      )
    : []
  const lastRoom = new Map(assignments.map((row) => [row.stayId, row.roomId]))
  const roomOf = (stay: Row) => stay.currentRoomId ?? lastRoom.get(stay.id) ?? null
  const rooms = await readByIds(ctx, 'hospitality_core.Room', stays.map(roomOf), ['id', 'code', 'name'])
  const byFolio = Map.groupBy(stays, (row) => row.folioId)
  return folios.map((folio): FolioBookRow => {
    const property = properties.get(String(folio.propertyId))!
    const opened = instant(folio.openedAt),
      closed = instant(folio.closedAt)
    const codes = (byFolio.get(folio.id) ?? []).flatMap((stay) => {
      const room = rooms.get(roomOf(stay))
      return room ? [String(room.code ?? room.name ?? '')] : []
    })
    return {
      id: String(folio.id),
      code: String(folio.code),
      guest: String(guests.get(folio.partnerId)?.name ?? ''),
      property: { id: property.id },
      state: folio.state === 'closed' ? 'closed' : 'open',
      total: { amount: String(folio.amountTotal ?? '0'), currency },
      rooms: [...new Set(codes)].sort(collator.compare),
      opened: opened ? dateKeyIn(opened, property.timezone) : '',
      closed: closed && folio.state === 'closed' ? dateKeyIn(closed, property.timezone) : null,
    }
  })
}

/**
 * `hospitality_core.searchFolios`: one page of one query over the folio register, as the accepted mock reads it
 * (design/shared/hospitality-collection-book.mjs `folios`, HOS-DEC-032).
 * Input: `{ propertyId?, view?, q?, sort?, page?, pageSize? }`. Output: `{ query, total, page, pages, rows,
 * counts: { view }, isEmpty, partial }`, `query` being the input as applied so the caller can correct its URL.
 * The register is the folios that have begun (open or closed) at the properties shown; view counts follow the search
 * and ignore the view. `isEmpty` tells a register with no folio at all from a query that matched none. What a folio
 * still owes and its invoice are billing's (`hospitality_billing.getFolioDues`).
 */
export const searchFoliosHandler: FnSpec['handler'] = async (ctx, args) => {
  const properties = ctx.scope.company ? await bookProperties(ctx) : []
  const query = folioBookQuery(args, properties)
  const shown = query.propertyId ? properties.filter((row) => row.id === query.propertyId) : properties
  if (!shown.length) return empty(query)
  const F = ctx.table('hospitality_core.Folio')
  const register = from(F).where(
    eq(F.companyId!, ctx.scope.company),
    inArray(
      F.propertyId,
      shown.map((row) => row.id),
    ),
    inArray(F.state, REGISTER),
  )
  const search = query.q ? await searchedBy(ctx, shown, query.q) : null
  const scope = search ? register.where(search.condition) : register
  const open = await ctx.db.count(scope.where(eq(F.state, 'open')))
  const closed = await ctx.db.count(scope.where(eq(F.state, 'closed')))
  const view = { all: open + closed, open, closed }
  const total = view[query.view]
  // A search that found nothing still says whether the register holds any folio at all.
  const isEmpty = view.all === 0 && (!search || (await ctx.db.count(register)) === 0)
  if (isEmpty) return { ...empty(query), partial: search?.partial ?? false }
  const pages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(pages, query.page)
  const ORDERS: Record<FolioBookSort, ReturnType<typeof asc>[]> = {
    '-opened': [desc(F.openedAt), desc(F.code), desc(F.id)],
    title: [asc(F.code), asc(F.id)],
    '-title': [desc(F.code), desc(F.id)],
    '-total': [desc(F.amountTotal), asc(F.code), asc(F.id)],
    total: [asc(F.amountTotal), asc(F.code), asc(F.id)],
  }
  const folios = await ctx.db.all(
    (query.view === 'all' ? scope : scope.where(eq(F.state, query.view)))
      .select(F.id, F.code, F.propertyId, F.partnerId, F.state, F.amountTotal, F.openedAt, F.closedAt!)
      .orderBy(...ORDERS[query.sort])
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize),
  )
  const currency = String((await readRecord(ctx, 'company.Company', ctx.scope.company))?.currency || 'VND')
  return {
    query: { ...query, page },
    total,
    page,
    pages,
    rows: await folioRows(ctx, folios, new Map(shown.map((row) => [row.id, row])), currency),
    counts: { view },
    isEmpty: false,
    partial: search?.partial ?? false,
  }
}

export const folioBookFunctions = {
  getFolioBookFrame: defineFn({
    input: {},
    output: { properties: 'json' },
    effects: ['read:hospitality_core.Property'],
    handler: getReservationBookFrameHandler,
  }),
  searchFolios: defineFn({
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
      isEmpty: 'bool',
      partial: 'bool',
    },
    effects: [
      'read:hospitality_core.Folio',
      'read:hospitality_core.Property',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Stay',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomAssignment',
      'read:partner.Partner',
      'read:company.Company',
    ],
    handler: searchFoliosHandler,
  }),
}
