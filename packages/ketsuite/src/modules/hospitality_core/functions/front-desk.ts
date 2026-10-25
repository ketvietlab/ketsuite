import { frontDeskAttention } from './front-desk-attention.ts'
import { asc, defineFn, eq, from, gt, gte, inArray, isNull, lt, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Query, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn, zonedMidnight } from '../calendar.ts'
import { propertyAccess, readRecord, reject } from './command.ts'
import { projectHospitalityCollectionRow, stayRowProjection as stayDefinition } from './collection-search.ts'
import { frontDeskActivity } from './front-desk-activity.ts'
import { GUARANTEE_READS, reservationGuarantees } from './guarantee-source.ts'

const pageNumber = (value: unknown) => Math.max(1, Math.min(1000000, Math.trunc(Number(value) || 1)))
const pageSize = 10

/** Each queue has its own bounded page. Counts are over the complete scoped query. */
export const getFrontDeskHandler: FnSpec['handler'] = async (ctx, args) => {
  const P = ctx.table('hospitality_core.Property')
  let properties = from(P).where(eq(P.companyId!, ctx.scope.company))
  if (ctx.scope.branches) properties = properties.where(inArray(P.branchId, ctx.scope.branches))
  const selected = args.propertyId
    ? await propertyAccess(ctx, args.propertyId)
    : await ctx.db.one(properties.orderBy(asc(P.code), asc(P.id)).limit(1))
  const empty = { rows: [], total: 0, guests: 0, page: 1, pages: 1 }
  if (!selected)
    return {
      configured: false,
      propertyId: null,
      timezone: 'UTC',
      day: dateKeyIn(new Date(), 'UTC'),
      arrivals: empty,
      departures: empty,
      overdue: empty,
      inHouse: empty,
    }
  const timezone = String(selected.timezone),
    day = String(args.day ?? dateKeyIn(new Date(), timezone))
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) ||
    new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day
  )
    reject('day', 'date_locked')
  const start = zonedMidnight(day, timezone).toISOString(),
    end = zonedMidnight(addCalendarDays(day, 1), timezone).toISOString()
  const now = new Date().toISOString(),
    S = ctx.table('hospitality_core.Stay')
  const base = from(S).where(eq(S.companyId!, ctx.scope.company), eq(S.propertyId, selected.id))
  const queue = async (query: Query, key: 'checkIn' | 'checkOut', requested: unknown, includeRows = true) => {
    const total = await ctx.db.count(query),
      pages = Math.max(1, Math.ceil(total / pageSize)),
      page = Math.min(pageNumber(requested), pages)
    const sums = await ctx.db.group(
      query
        .groupBy({ col: S.propertyId })
        .aggregate(
          { fn: 'sum', col: S.adults, as: 'adults' },
          { fn: 'sum', col: S.children, as: 'children' },
        ),
    )
    const raw = includeRows
      ? await ctx.db.all(
          query
            .orderBy(asc(S[key]), asc(S.id))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
        )
      : []
    return {
      rows: await enrich(ctx, raw, selected.id),
      total,
      guests: Number(sums[0]?.aggregates.adults ?? 0) + Number(sums[0]?.aggregates.children ?? 0),
      page,
      pages,
    }
  }
  const inHouse = base.where(eq(S.state, 'checked_in'))
  const arrivalQuery = base.where(eq(S.state, 'draft'), gte(S.checkIn, start), lt(S.checkIn, end))
  return {
    currency: (await readRecord(ctx, 'company.Company', ctx.scope.company))?.currency ?? null,
    attention: await frontDeskAttention(ctx, selected.id, start, end),
    activity: await frontDeskActivity(ctx, selected.id, start, end),
    summary: await deskSummary(ctx, selected.id, day, start, end, arrivalQuery),
    propertyName: selected.name,
    configured: true,
    propertyId: selected.id,
    timezone,
    day,
    arrivals: await queue(arrivalQuery, 'checkIn', args.arrivalsPage),
    departures: await queue(
      inHouse.where(gte(S.checkOut, start), lt(S.checkOut, end), gte(S.checkOut, now)),
      'checkOut',
      args.departuresPage,
    ),
    overdue: await queue(inHouse.where(lt(S.checkOut, now)), 'checkOut', args.overduePage),
    inHouse: await queue(inHouse, 'checkOut', 1, false),
  }
}

/** Bound every batch while keeping KPI totals independent of the displayed page. */
async function deskSummary(
  ctx: Ctx,
  propertyId: unknown,
  day: string,
  start: string,
  end: string,
  arrivals: Query,
) {
  const S = ctx.table('hospitality_core.Stay'),
    R = ctx.table('hospitality_core.Room'),
    A = ctx.table('hospitality_core.RoomAssignment'),
    B = ctx.table('hospitality_core.RoomBlock')
  let ready = 0,
    blocked = 0,
    unassigned = 0,
    totalRooms = 0,
    cleanVacant = 0,
    tonightRooms = 0
  let after: unknown = null
  while (true) {
    const query = after ? arrivals.where(gt(S.id, after)) : arrivals
    const batch = await ctx.db.all(query.orderBy(asc(S.id)).limit(100))
    for (const row of await enrich(ctx, batch, propertyId)) {
      if (row.arrivalIssue) blocked++
      else ready++
      if (row.arrivalIssue === 'unassigned') unassigned++
    }
    if (batch.length < 100) break
    after = batch.at(-1)!.id
  }
  const rooms = from(R).where(
    eq(R.companyId!, ctx.scope.company),
    eq(R.propertyId, propertyId),
    eq(R.active, true),
  )
  after = null
  while (true) {
    const query = after ? rooms.where(gt(R.id, after)) : rooms
    const batch = await ctx.db.all(query.select(R.id, R.status).orderBy(asc(R.id)).limit(100))
    totalRooms += batch.length
    const ids = batch.filter((room) => room.status === 'available').map((room) => room.id)
    if (ids.length) {
      const assignments = await ctx.db.group(
        from(A)
          .where(
            eq(A.companyId!, ctx.scope.company),
            eq(A.propertyId, propertyId),
            inArray(A.roomId, ids),
            inArray(A.state, ['held', 'active']),
            lt(A.startAt, end),
            or(isNull(A.endAt), gt(A.endAt, start)),
          )
          .groupBy({ col: A.roomId }),
      )
      const blocks = await ctx.db.group(
        from(B)
          .where(
            eq(B.companyId!, ctx.scope.company),
            eq(B.propertyId, propertyId),
            inArray(B.roomId, ids),
            eq(B.state, 'active'),
            lt(B.dateFrom, addCalendarDays(day, 1)),
            gt(B.dateTo, day),
          )
          .groupBy({ col: B.roomId }),
      )
      const unavailable = new Set([...assignments, ...blocks].map((item) => item.key[0]))
      cleanVacant += ids.filter((id) => !unavailable.has(id)).length
    }
    if (batch.length < 100) break
    after = batch.at(-1)!.id
  }
  const tonight = from(S).where(
    eq(S.companyId!, ctx.scope.company),
    eq(S.propertyId, propertyId),
    inArray(S.state, ['draft', 'checked_in']),
    lt(S.checkIn, end),
    gte(S.checkOut, end),
  )
  after = null
  while (true) {
    const query = after ? tonight.where(gt(S.id, after)) : tonight
    const batch = await ctx.db.all(query.select(S.id, S.roomQuantity).orderBy(asc(S.id)).limit(100))
    tonightRooms += batch.reduce((sum, stay) => sum + Math.max(1, Number(stay.roomQuantity ?? 1)), 0)
    if (batch.length < 100) break
    after = batch.at(-1)!.id
  }
  const departures = from(S).where(
    eq(S.companyId!, ctx.scope.company),
    eq(S.propertyId, propertyId),
    inArray(S.state, ['checked_in', 'checked_out']),
    gte(S.checkOut, start),
    lt(S.checkOut, end),
  )
  const departureTotal = await ctx.db.count(departures),
    departed = await ctx.db.count(departures.where(eq(S.state, 'checked_out')))
  return {
    departureTotal,
    departed,
    ready,
    blocked,
    unassigned,
    totalRooms,
    cleanVacant,
    tonightRooms,
    occupancyPercent: totalRooms ? Math.round((tonightRooms / totalRooms) * 100) : 0,
  }
}

async function enrich(ctx: Ctx, rows: Row[], propertyId: unknown): Promise<Row[]> {
  if (!rows.length) return []
  const load = async (name: string, ids: unknown[], property = false) => {
    const T = ctx.table(name)
    let query = from(T).where(inArray(T.id, ids.filter(Boolean)))
    if (T.$columns.includes('companyId')) query = query.where(eq(T.companyId!, ctx.scope.company))
    if (property) query = query.where(eq(T.propertyId, propertyId))
    return new Map((await ctx.db.all(query)).map((row) => [row.id, row]))
  }
  const partners = await load(
    'partner.Partner',
    rows.map((row) => row.partnerId),
  )
  const types = await load(
    'hospitality_core.RoomType',
    rows.map((row) => row.roomTypeId),
    true,
  )
  const A = ctx.table('hospitality_core.RoomAssignment')
  const assignments = await ctx.db.all(
    from(A).where(
      eq(A.companyId!, ctx.scope.company),
      eq(A.propertyId, propertyId),
      inArray(
        A.stayId,
        rows.map((row) => row.id),
      ),
      eq(A.state, 'held'),
    ),
  )
  const rooms = await load(
    'hospitality_core.Room',
    [...rows.map((row) => row.currentRoomId), ...assignments.map((row) => row.roomId)],
    true,
  )
  const bookings = await load(
    'hospitality_core.Reservation',
    rows.map((row) => row.reservationId),
    true,
  )
  const guarantees = await reservationGuarantees(ctx, [...bookings.values()])
  return rows.map((row) => {
    const booking = bookings.get(row.reservationId)
    const held = assignments.filter((item) => item.stayId === row.id)
    const result = projectHospitalityCollectionRow(
      {
        ...row,
        partner: partners.get(row.partnerId),
        roomType: types.get(row.roomTypeId),
        currentRoom: rooms.get(row.currentRoomId),
      },
      stayDefinition,
    )
    const guaranteeValid =
      !ctx.manifest.models['hospitality_billing.GuaranteeAllocation'] ||
      (!!booking && guarantees.get(booking.id) === true)
    const requiredRooms = Math.max(1, Number(row.roomQuantity ?? 1))
    const assigned = held.length >= requiredRooms
    const roomReady =
      assigned &&
      held.every(
        (item) => rooms.get(item.roomId)?.active !== false && rooms.get(item.roomId)?.status === 'available',
      )
    const arrivalIssue = !assigned
      ? 'unassigned'
      : !guaranteeValid
        ? 'guarantee'
        : !roomReady
          ? 'roomNotReady'
          : null
    return {
      ...result,
      arrivalIssue,
      expectedArrivalTime: booking?.expectedArrivalTime ?? null,
      earlyArrivalRequested: booking?.earlyArrivalRequested === true,
      assignments: held.map((item) => ({
        id: item.id,
        roomId: item.roomId,
        roomTypeId: item.roomTypeId,
        startAt: item.startAt,
        endAt: item.endAt,
        state: item.state,
        roomName: rooms.get(item.roomId)?.name,
      })),
      guaranteeValid,
    }
  })
}

export const frontDeskFunctions = {
  getFrontDesk: defineFn({
    input: {
      propertyId: 'id?',
      day: 'text?',
      arrivalsPage: 'int?',
      departuresPage: 'int?',
      overduePage: 'int?',
    },
    output: {
      summary: 'json?',
      activity: 'json?',
      attention: 'json?',
      propertyName: 'text?',
      currency: 'text?',
      configured: 'bool',
      propertyId: 'id?',
      timezone: 'text',
      day: 'date',
      arrivals: 'json',
      departures: 'json',
      overdue: 'json',
      inHouse: 'json',
    },
    effects: [
      ...GUARANTEE_READS,
      ...['Property', 'Stay', 'RoomType', 'Room', 'RoomAssignment', 'RoomBlock'].map(
        (name) => `read:hospitality_core.${name}`,
      ),
      'read:partner.Partner',
      'read:hospitality_core.OperationalChange',
      'read:hospitality_core.CleaningTask',
      'read:hospitality_core.Reservation',
      'read:user.User',
    ],
    handler: getFrontDeskHandler,
  }),
}
