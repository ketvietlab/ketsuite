import { purchasedExtraBeds, supportedExtraBeds } from './room-capacity.ts'
import { cancellationFee, noShowFeePlan } from './cancellation-terms.ts'
import { arrivalFeePlan } from './arrival-fee.ts'
import {
  and,
  asc,
  defineFn,
  desc,
  eq,
  from,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  likeLiteral,
  lt,
  ne,
  not,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Query, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn } from '../calendar.ts'
import { OUT_OF_SERVICE_ROOM_STATUSES } from '../types.ts'
import { hasPropertyScope, readRecord } from './command.ts'
import { GUARANTEE_READS, reservationGuaranteeValid } from './guarantee-source.ts'

const project = (row: Row, fields: readonly string[]): Row =>
  Object.fromEntries(fields.filter((field) => field in row).map((field) => [field, row[field]]))
const bookingFields = [
  'guestVip',
  'guestLoyaltyTier',
  'guestLoyaltyProgram',
  'guestBenefitsReference',
  'guestBenefitsUpdatedAt',
  'expectedArrivalTime',
  'earlyArrivalRequested',
  'arrivalNote',
  'id',
  'code',
  'version',
  'propertyId',
  'roomTypeId',
  'ratePlanId',
  'folioId',
  'stayId',
  'partnerId',
  'provider',
  'bookingType',
  'billingMode',
  'checkIn',
  'checkOut',
  'adults',
  'children',
  'infants',
  'roomQuantity',
  'quantity',
  'rate',
  'amountTotal',
  'currency',
  'state',
  'guaranteeKind',
  'guaranteeAmount',
  'guaranteeVerifiedAt',
  'auditHoldUntil',
  'cancelReason',
  'noShowReason',
  'noShowAt',
  'createdAt',
  'updatedAt',
] as const
const stayFields = [
  'id',
  'code',
  'version',
  'state',
  'propertyId',
  'roomTypeId',
  'currentRoomId',
  'checkIn',
  'checkOut',
  'checkedInAt',
  'issuedKeys',
  'checkedOutAt',
  'departureChecklist',
  'departureNotes',
  'adults',
  'children',
  'infants',
  'roomQuantity',
] as const

async function page(ctx: Ctx, query: Query, requested: unknown) {
  const total = await ctx.db.count(query),
    pages = Math.max(1, Math.ceil(total / 25))
  const selected = Math.min(pages, Math.max(1, Math.trunc(Number(requested) || 1)))
  return { rows: await ctx.db.all(query.limit(25).offset((selected - 1) * 25)), total, page: selected, pages }
}

/** Purpose-specific record DTO: booking work never receives source payloads or guest identity documents. */
export const getReservationWorkspaceHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return { record: null }
  const booking = await readRecord(ctx, 'hospitality_core.Reservation', args.id)
  if (!booking) return { record: null }
  const property = await readRecord(ctx, 'hospitality_core.Property', booking.propertyId)
  if (!property || !hasPropertyScope(ctx, property)) return { record: null }
  const related = async (model: string, id: unknown) => {
    if (!id) return null
    const row = await readRecord(ctx, model, id)
    return row && row.propertyId === property.id ? row : null
  }
  const stay = await related('hospitality_core.Stay', booking.stayId)
  const ownedStay = stay?.reservationId === booking.id ? stay : null
  const folio = await related('hospitality_core.Folio', booking.folioId)
  const roomType = await related('hospitality_core.RoomType', booking.roomTypeId)
  const room = await related('hospitality_core.Room', ownedStay?.currentRoomId)
  const partner = await readRecord(ctx, 'partner.Partner', booking.partnerId)
  const company = await readRecord(ctx, 'company.Company', ctx.scope.company)
  const A = ctx.table('hospitality_core.RoomAssignment'),
    E = ctx.table('hospitality_core.OperationalChange')
  const assignments = ownedStay
    ? await page(
        ctx,
        from(A)
          .where(
            eq(A.companyId!, ctx.scope.company),
            eq(A.propertyId, property.id),
            eq(A.stayId, ownedStay.id),
          )
          .orderBy(desc(A.startAt), desc(A.id)),
        args.assignmentPage,
      )
    : { rows: [], total: 0, page: 1, pages: 1 }
  const held = ownedStay
    ? await ctx.db.one(
        from(A)
          .where(
            eq(A.companyId!, ctx.scope.company),
            eq(A.propertyId, property.id),
            eq(A.stayId, ownedStay.id),
            eq(A.state, 'held'),
          )
          .orderBy(desc(A.startAt), desc(A.id)),
      )
    : null
  const roomIds = [...new Set([...assignments.rows.map((row) => row.roomId), ...(held ? [held.roomId] : [])])]
  const R = ctx.table('hospitality_core.Room')
  const rooms = roomIds.length
    ? await ctx.db.all(
        from(R)
          .select(R.id, R.code, R.name, R.status)
          .where(eq(R.companyId!, ctx.scope.company), eq(R.propertyId, property.id), inArray(R.id, roomIds)),
      )
    : []
  const byRoom = new Map(rooms.map((row) => [row.id, row]))
  assignments.rows = assignments.rows.map((row) => ({
    ...project(row, ['id', 'roomId', 'roomTypeId', 'startAt', 'endAt', 'state', 'reason']),
    room: byRoom.get(row.roomId) ?? null,
  }))
  const history = await page(
    ctx,
    from(E)
      .where(
        eq(E.companyId!, ctx.scope.company),
        eq(E.propertyId, property.id),
        inArray(E.entityId, [booking.id, ...(ownedStay ? [ownedStay.id] : [])]),
      )
      .orderBy(desc(E.occurredAt), desc(E.id)),
    args.historyPage,
  )
  history.rows = history.rows.map((row) => project(row, ['id', 'action', 'actorId', 'occurredAt']))
  const SG = ctx.table('hospitality_core.StayGuest')
  const arrivalGuests = ownedStay
    ? await ctx.db.all(
        from(SG)
          .select(SG.id, SG.partnerId, SG.displayName, SG.primary)
          .where(
            eq(SG.stayId, ownedStay.id),
            eq(SG.propertyId, property.id),
            eq(SG.companyId!, ctx.scope.company),
          )
          .orderBy(desc(SG.primary), asc(SG.id))
          .limit(50),
      )
    : []
  const cancellation = booking.state === 'confirmed' ? await cancellationFee(ctx, booking, new Date()) : null
  const noShow = cancellation ? await noShowFeePlan(ctx, booking, new Date()) : null
  return {
    record: {
      ...project(booking, bookingFields),
      stayId: ownedStay?.id ?? null,
      folioId: folio?.id ?? null,
      roomTypeId: roomType?.id ?? null,
      partnerId: partner?.id ?? null,
      version: Number(booking.version ?? 0),
      currency: booking.currency ?? company?.currency ?? null,
      property: project(property, [
        'id',
        'code',
        'name',
        'timezone',
        'businessDate',
        'closingDate',
        'lifecycle',
      ]),
      guest: partner ? project(partner, ['id', 'name']) : null,
      arrivalGuests,
      cancellationReview:
        cancellation && noShow
          ? {
              fee: cancellation.amount,
              noShowFee: noShow.amount,
              policy: cancellation.code === 'policy' ? null : cancellation.code,
              requiresAgreement: cancellation.requiresAgreement === true,
              noShowAgreement: noShow.requiresAgreement,
              retainedRoomAmount: noShow.retainedRoomAmount,
            }
          : null,
      arrivalFee: ownedStay ? await arrivalFeePlan(ctx, ownedStay, property) : null,
      roomType: roomType
        ? project(roomType, ['id', 'code', 'name', 'maxAdults', 'maxChildren', 'defaultCapacity'])
        : null,
      room: room ? project(room, ['id', 'code', 'name', 'status']) : null,
      stay: ownedStay ? { ...project(ownedStay, stayFields), version: Number(ownedStay.version ?? 0) } : null,
      folio: folio ? project(folio, ['id', 'code', 'state', 'version', 'amountTotal']) : null,
      heldAssignment: held
        ? {
            ...project(held, ['id', 'roomId', 'roomTypeId', 'startAt', 'endAt', 'state']),
            room: byRoom.get(held.roomId) ?? null,
          }
        : null,
      guaranteeValid:
        !ctx.manifest.models['hospitality_billing.GuaranteeAllocation'] ||
        (await reservationGuaranteeValid(ctx, booking)),
      assignments,
      history,
    },
  }
}

/** Keyset batches keep both candidate and conflict reads bounded, including when early rooms are full. */
export const lookupReservationRoomsHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return []
  const booking = await readRecord(ctx, 'hospitality_core.Reservation', args.reservationId)
  if (!booking) return []
  const property = await readRecord(ctx, 'hospitality_core.Property', booking.propertyId)
  if (!property || !hasPropertyScope(ctx, property)) return []
  const stay = await readRecord(ctx, 'hospitality_core.Stay', booking.stayId)
  if (
    !stay ||
    stay.reservationId !== booking.id ||
    stay.propertyId !== property.id ||
    stay.state !== (args.moving ? 'checked_in' : 'draft')
  )
    return []
  const start = args.moving ? new Date().toISOString() : String(stay.checkIn),
    end = String(stay.checkOut)
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || start >= end) return []
  const type = await readRecord(ctx, 'hospitality_core.RoomType', stay.roomTypeId)
  if (!type || type.propertyId !== property.id || type.active !== true) return []
  const beds = args.moving ? Math.min(purchasedExtraBeds(stay), supportedExtraBeds(type)) : 0
  if (
    Number(stay.adults) > Number(type.maxAdults) + beds ||
    Number(stay.children ?? 0) > Number(type.maxChildren ?? 0)
  )
    return []
  return availableRoomsForPeriod(
    ctx,
    property,
    {
      roomTypeId: stay.roomTypeId,
      start,
      end,
      excludeStayId: stay.id,
      excludeRoomId: args.moving ? stay.currentRoomId : null,
      minimumCapacity: Number(stay.adults) + Number(stay.children ?? 0) - beds,
    },
    args,
  )
}

/** Shared candidate policy for booked arrivals, room moves and walk-in intake. */
export async function availableRoomsForPeriod(
  ctx: import('@ketvietlab/ketjs').Ctx,
  property: Row,
  period: {
    roomTypeId: unknown
    start: string
    end: string
    excludeStayId?: unknown
    excludeRoomId?: unknown
    minimumCapacity?: number
  },
  args: Record<string, unknown>,
) {
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(args.limit) || 20)))
  const result: Row[] = []
  for await (const batch of availableRoomBatches(ctx, property, period, args)) {
    result.push(...batch.slice(0, limit - result.length))
    if (result.length >= limit) break
  }
  return result
}

export async function countAvailableRoomsForPeriod(
  ctx: import('@ketvietlab/ketjs').Ctx,
  property: Row,
  period: {
    roomTypeId: unknown
    start: string
    end: string
    excludeStayId?: unknown
    excludeRoomId?: unknown
    minimumCapacity?: number
  },
  args: Record<string, unknown>,
) {
  let count = 0
  for await (const batch of availableRoomBatches(ctx, property, period, args)) count += batch.length
  return count
}

async function* availableRoomBatches(
  ctx: import('@ketvietlab/ketjs').Ctx,
  property: Row,
  period: {
    roomTypeId: unknown
    start: string
    end: string
    excludeStayId?: unknown
    excludeRoomId?: unknown
    minimumCapacity?: number
  },
  args: Record<string, unknown>,
) {
  const { start, end } = period
  const first = dateKeyIn(new Date(start), String(property.timezone)),
    last = dateKeyIn(new Date(end), String(property.timezone))
  const exclusive = first === last ? addCalendarDays(last, 1) : last
  const R = ctx.table('hospitality_core.Room'),
    A = ctx.table('hospitality_core.RoomAssignment'),
    B = ctx.table('hospitality_core.RoomBlock')
  let base = from(R)
    .select(R.id, R.code, R.name, R.status)
    .where(
      eq(R.companyId!, ctx.scope.company),
      eq(R.propertyId, property.id),
      eq(R.roomTypeId, period.roomTypeId),
      eq(R.active, true),
      not(inArray(R.status, [...OUT_OF_SERVICE_ROOM_STATUSES])),
    )
  if (period.minimumCapacity !== undefined) base = base.where(gte(R.capacity, period.minimumCapacity))
  if (args.readyOnly || args.moving) base = base.where(eq(R.status, 'available'))
  if (period.excludeRoomId) base = base.where(ne(R.id, period.excludeRoomId))
  if (args.id) base = base.where(eq(R.id, args.id))
  if (args.search) {
    const pattern = `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`
    base = base.where(or(ilike(R.code, pattern, true), ilike(R.name, pattern, true)))
  }
  let after: Row | null = null
  while (true) {
    const query = after
      ? base.where(or(gt(R.name, after.name), and(eq(R.name, after.name), gt(R.id, after.id))))
      : base
    const candidates = await ctx.db.all(query.orderBy(asc(R.name), asc(R.id)).limit(50))
    if (!candidates.length) break
    const ids = candidates.map((row) => row.id)
    const assignments = await ctx.db.group(
      from(A)
        .where(
          eq(A.companyId!, ctx.scope.company),
          eq(A.propertyId, property.id),
          inArray(A.roomId, ids),
          ne(A.state, 'closed'),
          ...(period.excludeStayId ? [ne(A.stayId, period.excludeStayId)] : []),
          lt(A.startAt, end),
          or(isNull(A.endAt), gt(A.endAt, start)),
        )
        .groupBy({ col: A.roomId }),
    )
    const blocks = await ctx.db.group(
      from(B)
        .where(
          eq(B.companyId!, ctx.scope.company),
          eq(B.propertyId, property.id),
          inArray(B.roomId, ids),
          eq(B.state, 'active'),
          lt(B.dateFrom, exclusive),
          gt(B.dateTo, first),
        )
        .groupBy({ col: B.roomId }),
    )
    const excluded = new Set([...assignments, ...blocks].map((row) => row.key[0]))
    yield candidates.filter((candidate) => !excluded.has(candidate.id))
    if (args.id || candidates.length < 50) break
    after = candidates.at(-1)!
  }
}

export const lookupReservationGuestsHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return []
  const booking = await readRecord(ctx, 'hospitality_core.Reservation', args.reservationId)
  const property = booking ? await readRecord(ctx, 'hospitality_core.Property', booking.propertyId) : null
  if (!property || !hasPropertyScope(ctx, property)) return []
  const P = ctx.table('partner.Partner')
  let query = from(P).select(P.id, P.name).where(eq(P.kind, 'person'))
  if (args.id) query = query.where(eq(P.id, args.id))
  if (args.search)
    query = query.where(ilike(P.name, `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`, true))
  return ctx.db.all(
    query
      .orderBy(asc(P.name), asc(P.id))
      .limit(Math.min(50, Math.max(1, Math.trunc(Number(args.limit) || 20)))),
  )
}

export const reservationWorkspaceFunctions = {
  lookupReservationGuests: defineFn({
    input: { reservationId: 'id', search: 'text?', limit: 'int?', id: 'id?' },
    effects: ['read:hospitality_core.Reservation', 'read:hospitality_core.Property', 'read:partner.Partner'],
    handler: lookupReservationGuestsHandler,
  }),
  lookupReservationRooms: defineFn({
    input: {
      reservationId: 'id',
      search: 'text?',
      limit: 'int?',
      id: 'id?',
      readyOnly: 'bool?',
      moving: 'bool?',
    },
    effects: ['Reservation', 'Property', 'Stay', 'Room', 'RoomType', 'RoomAssignment', 'RoomBlock'].map(
      (name) => `read:hospitality_core.${name}`,
    ),
    handler: lookupReservationRoomsHandler,
  }),
  getReservationWorkspace: defineFn({
    input: { id: 'id', assignmentPage: 'int?', historyPage: 'int?' },
    output: { record: 'json?' },
    effects: [
      ...GUARANTEE_READS,
      ...[
        'Property',
        'Stay',
        'StayGuest',
        'Folio',
        'RoomType',
        'Room',
        'RoomAssignment',
        'OperationalChange',
        'CancellationPolicy',
        'RoomNightSnapshot',
      ].map((name) => `read:hospitality_core.${name}`),
      'read:partner.Partner',
    ],
    handler: getReservationWorkspaceHandler,
  }),
}
