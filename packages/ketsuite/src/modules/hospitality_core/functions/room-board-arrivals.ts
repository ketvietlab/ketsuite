import { asc, eq, from, gt, gte, inArray, lt } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, zonedMidnight } from '../calendar.ts'

/** Return only preparation times, never guest identities, for at most one room batch. */
export async function roomBoardArrivals(ctx: Ctx, property: Row, roomIds: unknown[], today: string) {
  const result = new Map<unknown, string>()
  if (!roomIds.length) return result
  const timezone = String(property.timezone)
  const start = zonedMidnight(today, timezone).toISOString(),
    end = zonedMidnight(addCalendarDays(today, 1), timezone).toISOString()
  const A = ctx.table('hospitality_core.RoomAssignment'),
    S = ctx.table('hospitality_core.Stay'),
    B = ctx.table('hospitality_core.Reservation')
  const base = from(A)
    .select(A.id, A.roomId, A.stayId)
    .where(
      eq(A.companyId!, ctx.scope.company),
      eq(A.propertyId, property.id),
      eq(A.state, 'held'),
      inArray(A.roomId, roomIds),
    )
  let after: unknown
  for (;;) {
    const held = await ctx.db.all((after ? base.where(gt(A.id, after)) : base).orderBy(asc(A.id)).limit(100))
    if (!held.length) break
    const stays = await ctx.db.all(
      from(S)
        .select(S.id, S.reservationId!)
        .where(
          eq(S.companyId!, ctx.scope.company),
          eq(S.propertyId, property.id),
          eq(S.state, 'draft'),
          inArray(S.id, [...new Set(held.map((row) => row.stayId))]),
        )
        .limit(100),
    )
    const bookings = stays.length
      ? await ctx.db.all(
          from(B)
            .select(B.id, B.stayId, B.expectedArrivalTime!)
            .where(
              eq(B.companyId!, ctx.scope.company),
              eq(B.propertyId, property.id),
              eq(B.state, 'confirmed'),
              gte(B.checkIn, start),
              lt(B.checkIn, end),
              inArray(
                B.id,
                stays.map((row) => row.reservationId),
              ),
            )
            .limit(100),
        )
      : []
    const plans = new Map(
      stays.map((stay) => [
        stay.id,
        bookings.find((booking) => booking.id === stay.reservationId && booking.stayId === stay.id),
      ]),
    )
    for (const assignment of held) {
      const booking = plans.get(assignment.stayId)
      if (!booking) continue
      const candidate = String(booking.expectedArrivalTime ?? property.defaultCheckIn ?? '14:00')
      const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate) ? candidate : '23:59'
      const existing = result.get(assignment.roomId)
      if (!existing || time < existing) result.set(assignment.roomId, time)
    }
    if (held.length < 100) break
    after = held.at(-1)!.id
  }
  return result
}
