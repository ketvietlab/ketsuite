import { asc, defineFn, desc, eq, from, gt, inArray, lt } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn, zonedMidnight } from '../calendar.ts'
import { hasPropertyScope, readRecord } from './command.ts'
import { currentRoomBlocks, effectiveRoomStatus, roomStatusDay } from './room-blocks.ts'

/** The plan's widest window: a fortnight back and four weeks ahead, with a margin. */
export const ROOM_PLAN_MAX_DAYS = 62
/** A property's whole room list is drawn (the browser scrolls it virtually); beyond this the plan says so. */
export const ROOM_PLAN_MAX_ROOMS = 2000
/** Stays overlapping the window; beyond this the plan says it is incomplete rather than guessing. */
export const ROOM_PLAN_MAX_EVENTS = 8000

const BATCH = 200

type PlanRoom = {
  id: string
  code: string
  name: string
  roomTypeId: string
  floorId: string | null
  status: string
}
type PlanEvent = {
  id: string
  stayId: string
  reservationId: string | null
  roomId: string | null
  roomTypeId: string
  guest: string
  provider: string
  state: string
  start: string
  end: string
}

const empty = (args: Record<string, unknown>, timezone = 'UTC') => ({
  propertyId: String(args.propertyId ?? ''),
  timezone,
  businessDate: null,
  from: String(args.from ?? ''),
  to: String(args.to ?? ''),
  rooms: [] as PlanRoom[],
  events: [] as PlanEvent[],
  truncated: false,
})

const instant = (value: unknown): Date | null => {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
const iso = (value: unknown) => instant(value)?.toISOString() ?? String(value ?? '')

/** A block covering the business day takes the room out today; a later one leaves today's status alone. */
async function planRooms(ctx: Ctx, property: Row, day: string) {
  const R = ctx.table('hospitality_core.Room')
  const base = from(R)
    .select(R.id, R.code, R.name, R.roomTypeId, R.floorId!, R.status)
    .where(eq(R.companyId!, ctx.scope.company), eq(R.propertyId, property.id), eq(R.active, true))
  const rooms: PlanRoom[] = []
  let after: unknown
  for (;;) {
    const batch = await ctx.db.all(
      (after ? base.where(gt(R.id, after)) : base).orderBy(asc(R.id)).limit(BATCH),
    )
    if (!batch.length) break
    const blocks = await currentRoomBlocks(
      ctx,
      property,
      batch.map((row) => row.id),
      day,
    )
    for (const row of batch) {
      if (rooms.length >= ROOM_PLAN_MAX_ROOMS) return { rooms, truncated: true }
      rooms.push({
        id: String(row.id),
        code: String(row.code ?? row.name ?? ''),
        name: String(row.name ?? row.code ?? ''),
        roomTypeId: String(row.roomTypeId),
        floorId: row.floorId ? String(row.floorId) : null,
        status: effectiveRoomStatus(row.status, blocks.get(row.id)?.kind),
      })
    }
    if (batch.length < BATCH) break
    after = batch.at(-1)!.id
  }
  return { rooms, truncated: false }
}

/**
 * Stays touching [start, end), read per state so each read stays on the property/state index: arrivals and
 * guests in house have no lower bound (they are current by definition); departed stays are those that left
 * after the window opened.
 */
async function* planStays(ctx: Ctx, property: Row, start: string, end: string) {
  const S = ctx.table('hospitality_core.Stay')
  const columns = [S.id, S.reservationId!, S.partnerId, S.roomTypeId, S.state, S.checkIn, S.checkOut] as const
  const scoped = (state: string) =>
    from(S)
      .select(...columns)
      .where(
        eq(S.companyId!, ctx.scope.company),
        eq(S.propertyId, property.id),
        eq(S.state, state),
        lt(S.checkIn, end),
        gt(S.checkOut, start),
      )
  for (const state of ['checked_in', 'draft', 'checked_out']) {
    const base = scoped(state)
    let after: unknown
    for (;;) {
      const batch = await ctx.db.all(
        (after ? base.where(gt(S.id, after)) : base).orderBy(asc(S.id)).limit(BATCH),
      )
      if (!batch.length) break
      yield batch
      if (batch.length < BATCH) break
      after = batch.at(-1)!.id
    }
  }
}

async function namesOf(ctx: Ctx, ids: unknown[]) {
  const P = ctx.table('partner.Partner')
  if (!ids.length) return new Map<unknown, string>()
  let query = from(P).select(P.id, P.name).where(inArray(P.id, ids))
  if (P.$columns.includes('companyId') && ctx.scope.company)
    query = query.where(eq(P.companyId!, ctx.scope.company))
  return new Map((await ctx.db.all(query.limit(BATCH))).map((row) => [row.id, String(row.name ?? '')]))
}

async function providersOf(ctx: Ctx, property: Row, ids: unknown[]) {
  const B = ctx.table('hospitality_core.Reservation')
  if (!ids.length) return new Map<unknown, string>()
  const rows = await ctx.db.all(
    from(B)
      .select(B.id, B.provider)
      .where(eq(B.companyId!, ctx.scope.company), eq(B.propertyId, property.id), inArray(B.id, ids))
      .limit(BATCH),
  )
  return new Map(rows.map((row) => [row.id, String(row.provider ?? 'direct')]))
}

async function assignmentsOf(ctx: Ctx, property: Row, stayIds: unknown[]) {
  const A = ctx.table('hospitality_core.RoomAssignment')
  const base = from(A)
    .select(A.id, A.stayId, A.roomId, A.roomTypeId, A.startAt, A.endAt!)
    .where(eq(A.companyId!, ctx.scope.company), eq(A.propertyId, property.id), inArray(A.stayId, stayIds))
  const rows: Row[] = []
  let after: unknown
  for (;;) {
    const batch = await ctx.db.all(
      (after ? base.where(gt(A.id, after)) : base).orderBy(asc(A.id)).limit(BATCH),
    )
    rows.push(...batch)
    if (batch.length < BATCH) break
    after = batch.at(-1)!.id
  }
  return rows
}

/**
 * One property's room plan for a bounded window: its active rooms with today's effective status (an active
 * block takes the room out of order or service), and one event per room assignment of every stay touching
 * the window, or one unroomed event for a stay without an assignment. Guest names only: no contact,
 * documents, rates or money.
 */
export const getRoomPlanHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return empty(args)
  const property = await readRecord(ctx, 'hospitality_core.Property', args.propertyId)
  if (!property || !hasPropertyScope(ctx, property)) return empty(args)
  const timezone = String(property.timezone || 'UTC')
  const start = instant(args.from),
    requested = instant(args.to)
  if (!start || !requested || requested <= start) return empty(args, timezone)
  // A wider window is cut to the plan's widest rather than read whole.
  const firstDay = dateKeyIn(start, timezone)
  const limit = zonedMidnight(addCalendarDays(firstDay, ROOM_PLAN_MAX_DAYS), timezone)
  const end = requested > limit ? limit : requested
  const window = { start: start.toISOString(), end: end.toISOString() }
  const businessDate = roomStatusDay(property)
  const { rooms, truncated: roomsCut } = await planRooms(ctx, property, businessDate)
  const events: PlanEvent[] = []
  let truncated = roomsCut
  reading: for await (const stays of planStays(ctx, property, window.start, window.end)) {
    const names = await namesOf(ctx, [...new Set(stays.map((stay) => stay.partnerId))])
    const providers = await providersOf(ctx, property, [
      ...new Set(stays.map((stay) => stay.reservationId).filter(Boolean)),
    ])
    const byStay = Map.groupBy(
      await assignmentsOf(
        ctx,
        property,
        stays.map((stay) => stay.id),
      ),
      (row) => row.stayId,
    )
    for (const stay of stays) {
      const base = {
        stayId: String(stay.id),
        reservationId: stay.reservationId ? String(stay.reservationId) : null,
        guest: names.get(stay.partnerId) ?? '',
        provider: stay.reservationId ? (providers.get(stay.reservationId) ?? 'direct') : 'direct',
        state: String(stay.state),
      }
      const assigned = byStay.get(stay.id) ?? []
      // A stay with rooms is drawn on each room it holds inside the window; one never given a room waits
      // in the unroomed count instead.
      const drawn: PlanEvent[] = assigned.length
        ? assigned
            .map((row) => ({
              ...base,
              id: String(row.id),
              roomId: String(row.roomId),
              roomTypeId: String(row.roomTypeId),
              start: iso(row.startAt),
              end: iso(row.endAt ?? stay.checkOut),
            }))
            .filter((event) => event.start < window.end && event.end > window.start)
        : [
            {
              ...base,
              id: `${String(stay.id)}:unassigned`,
              roomId: null,
              roomTypeId: String(stay.roomTypeId),
              start: iso(stay.checkIn),
              end: iso(stay.checkOut),
            },
          ]
      for (const event of drawn) {
        if (events.length >= ROOM_PLAN_MAX_EVENTS) {
          truncated = true
          break reading
        }
        events.push(event)
      }
    }
  }
  return {
    propertyId: String(property.id),
    timezone,
    businessDate,
    from: window.start,
    to: window.end,
    rooms,
    events,
    truncated,
  }
}

const nightsBetween = (checkIn: unknown, checkOut: unknown, timezone: string) => {
  const a = instant(checkIn),
    b = instant(checkOut)
  if (!a || !b) return 0
  const first = Date.parse(`${dateKeyIn(a, timezone)}T00:00:00Z`),
    last = Date.parse(`${dateKeyIn(b, timezone)}T00:00:00Z`)
  return Math.max(0, Math.round((last - first) / 86_400_000))
}

/**
 * The reservation one plan bar stands for, in the few facts the desk decides on without leaving the plan.
 * No contact, documents, rate lines or history; money is the booked total only (what is still owed comes
 * from billing, for a reader who may see it). Cancelled, not-shown or foreign reservations answer `null`.
 */
export const getRoomPlanPeekHandler: FnSpec['handler'] = async (ctx, args) => ({
  record: await roomPlanPeek(ctx, args),
})

async function roomPlanPeek(ctx: Ctx, args: Record<string, unknown>) {
  if (!ctx.scope.company) return null
  const booking = await readRecord(ctx, 'hospitality_core.Reservation', args.id)
  if (!booking || ['cancelled', 'no_show'].includes(String(booking.state))) return null
  const property = await readRecord(ctx, 'hospitality_core.Property', booking.propertyId)
  if (!property || !hasPropertyScope(ctx, property)) return null
  const owned = async (model: string, id: unknown) => {
    if (!id) return null
    const row = await readRecord(ctx, model, id)
    return row && row.propertyId === property.id ? row : null
  }
  const stay = await owned('hospitality_core.Stay', booking.stayId)
  const ownStay = stay && stay.reservationId === booking.id ? stay : null
  const roomType = await owned('hospitality_core.RoomType', booking.roomTypeId)
  const folio = await owned('hospitality_core.Folio', booking.folioId)
  let roomId = ownStay?.currentRoomId ?? null
  if (!roomId && ownStay) {
    // A booking names the first room held for it; a departed stay, the last room it slept in.
    const departed = ownStay.state === 'checked_out'
    const order = departed ? desc : asc
    const A = ctx.table('hospitality_core.RoomAssignment')
    const assigned = await ctx.db.one(
      from(A)
        .select(A.roomId)
        .where(
          eq(A.companyId!, ctx.scope.company),
          eq(A.propertyId, property.id),
          eq(A.stayId, ownStay.id),
          eq(A.state, departed ? 'closed' : 'held'),
        )
        .orderBy(order(A.startAt), order(A.id))
        .limit(1),
    )
    roomId = assigned?.roomId ?? null
  }
  const room = await owned('hospitality_core.Room', roomId)
  const guest = await readRecord(ctx, 'partner.Partner', booking.partnerId)
  const company = await readRecord(ctx, 'company.Company', ctx.scope.company)
  const timezone = String(property.timezone || 'UTC')
  const state =
    ownStay?.state === 'checked_in'
      ? 'checked_in'
      : ownStay?.state === 'checked_out'
        ? 'checked_out'
        : String(booking.state) === 'checked_in' || String(booking.state) === 'checked_out'
          ? String(booking.state)
          : 'confirmed'
  const checkIn = ownStay?.checkIn ?? booking.checkIn,
    checkOut = ownStay?.checkOut ?? booking.checkOut
  return {
    id: String(booking.id),
    code: String(booking.code ?? ''),
    propertyId: String(property.id),
    state,
    checkIn: iso(checkIn),
    checkOut: iso(checkOut),
    nights: nightsBetween(checkIn, checkOut, timezone),
    adults: Number(ownStay?.adults ?? booking.adults ?? 0),
    children: Number(ownStay?.children ?? booking.children ?? 0),
    guest: { name: String(guest?.name ?? '') },
    room: room ? { code: String(room.code ?? room.name ?? '') } : null,
    roomType: roomType ? { name: String(roomType.name ?? '') } : null,
    amountTotal: String(booking.amountTotal ?? '0'),
    currency: String(booking.currency ?? company?.currency ?? 'VND'),
    source: String(booking.provider ?? 'direct'),
    guarantee: { kind: String(booking.guaranteeKind ?? 'none') },
    arrival: {
      expectedTime: booking.expectedArrivalTime ? String(booking.expectedArrivalTime) : null,
      early: booking.earlyArrivalRequested === true,
      note: booking.arrivalNote ? String(booking.arrivalNote) : null,
    },
    benefits: {
      vip: booking.guestVip === true,
      tier: booking.guestLoyaltyTier ? String(booking.guestLoyaltyTier) : null,
      program: booking.guestLoyaltyProgram ? String(booking.guestLoyaltyProgram) : null,
    },
    folio: folio && folio.state !== 'cancelled' ? { id: String(folio.id) } : null,
  }
}

/**
 * What the plan's server render needs to draw its frame: the properties the reader may open, and the chosen
 * one's clock, business date, room types and floors in their building order. No rooms or stays: the browser
 * reads those with `getTapeChart`.
 */
export const getRoomPlanFrameHandler: FnSpec['handler'] = async (ctx, args) => {
  const none = {
    property: null,
    properties: [] as Array<{ id: string; name: string }>,
    types: [],
    floors: [],
  }
  if (!ctx.scope.company) return none
  const P = ctx.table('hospitality_core.Property')
  let properties = from(P)
    .select(P.id, P.name, P.branchId!)
    .where(eq(P.companyId!, ctx.scope.company), eq(P.active, true))
  if (ctx.scope.branches) properties = properties.where(inArray(P.branchId!, ctx.scope.branches))
  const listed = (await ctx.db.all(properties.orderBy(asc(P.name), asc(P.id)).limit(BATCH))).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
  }))
  const chosen = listed.find((row) => row.id === String(args.propertyId ?? '')) ?? listed[0]
  if (!chosen) return { ...none, properties: listed }
  const property = (await readRecord(ctx, 'hospitality_core.Property', chosen.id))!
  const T = ctx.table('hospitality_core.RoomType'),
    B = ctx.table('hospitality_core.Building'),
    F = ctx.table('hospitality_core.Floor')
  const scoped = { company: ctx.scope.company, property: property.id }
  const types = await ctx.db.all(
    from(T)
      .select(T.id, T.code, T.name)
      .where(eq(T.companyId!, scoped.company), eq(T.propertyId, scoped.property), eq(T.active, true))
      .orderBy(asc(T.name), asc(T.id))
      .limit(BATCH),
  )
  const buildings = await ctx.db.all(
    from(B)
      .select(B.id, B.name, B.sequence)
      .where(eq(B.companyId!, scoped.company), eq(B.propertyId, scoped.property), eq(B.active, true))
      .orderBy(asc(B.sequence), asc(B.name), asc(B.id))
      .limit(BATCH),
  )
  const floors = await ctx.db.all(
    from(F)
      .select(F.id, F.buildingId, F.name, F.sequence)
      .where(eq(F.companyId!, scoped.company), eq(F.propertyId, scoped.property), eq(F.active, true))
      .orderBy(asc(F.sequence), asc(F.name), asc(F.id))
      .limit(ROOM_PLAN_MAX_ROOMS),
  )
  const rank = new Map(buildings.map((row, index) => [row.id, index]))
  const named = new Map(buildings.map((row) => [row.id, String(row.name ?? '')]))
  return {
    property: {
      id: String(property.id),
      name: String(property.name ?? ''),
      timezone: String(property.timezone || 'UTC'),
      businessDate: roomStatusDay(property),
    },
    properties: listed,
    types: types.map((row) => ({
      id: String(row.id),
      code: String(row.code ?? ''),
      name: String(row.name ?? ''),
    })),
    // Floors read building by building; with more than one building a floor carries its building's name.
    floors: floors
      .toSorted((a, b) => (rank.get(a.buildingId) ?? rank.size) - (rank.get(b.buildingId) ?? rank.size))
      .map((row) => ({
        id: String(row.id),
        name:
          buildings.length > 1 && named.get(row.buildingId)
            ? `${named.get(row.buildingId)} · ${String(row.name ?? '')}`
            : String(row.name ?? ''),
      })),
  }
}

export const roomPlanFunctions = {
  getTapeChart: defineFn({
    input: { propertyId: 'id', from: 'datetime', to: 'datetime' },
    output: {
      propertyId: 'text',
      timezone: 'text',
      businessDate: 'text?',
      from: 'text',
      to: 'text',
      rooms: 'json',
      events: 'json',
      truncated: 'bool',
    },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomBlock',
      'read:hospitality_core.Stay',
      'read:hospitality_core.RoomAssignment',
      'read:hospitality_core.Reservation',
      'read:partner.Partner',
    ],
    agent: true,
    handler: getRoomPlanHandler,
  }),
  getRoomPlanFrame: defineFn({
    input: { propertyId: 'id?' },
    output: { property: 'json?', properties: 'json', types: 'json', floors: 'json' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
    ],
    handler: getRoomPlanFrameHandler,
  }),
  getRoomPlanPeek: defineFn({
    input: { id: 'id' },
    output: { record: 'json?' },
    effects: [
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Property',
      'read:hospitality_core.Stay',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomAssignment',
      'read:hospitality_core.Folio',
      'read:partner.Partner',
      'read:company.Company',
    ],
    handler: getRoomPlanPeekHandler,
  }),
}
