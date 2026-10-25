import { eq, from, gt, lte } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { addDecimals, canonicalDecimalText } from '../../account/money.ts'
import { addCalendarDays, dateKeyIn, zonedDateTime } from '../calendar.ts'
import { readRecord } from './command.ts'
import { lateArrivalPlan } from './audit-decisions.ts'

export const ROOM_NIGHT_READS = [
  'read:hospitality_core.RoomNightSnapshot',
  'read:hospitality_core.Reservation',
  'read:hospitality_core.Stay',
  'read:hospitality_core.Charge',
  'read:company.Company',
]
export async function roomNightPlan(ctx: Ctx, property: Row, day: string) {
  const R = ctx.table('hospitality_core.Reservation'),
    S = ctx.table('hospitality_core.Stay')
  const bookings = await ctx.db.all(
    from(R).where(
      eq(R.companyId!, ctx.scope.company),
      eq(R.propertyId, property.id),
      eq(R.bookingType, 'nightly'),
      gt(R.checkOut, zonedDateTime(day, 0, 0, String(property.timezone)).toISOString()),
      lte(R.checkIn, zonedDateTime(addCalendarDays(day, 1), 0, 0, String(property.timezone)).toISOString()),
    ),
  )
  const stays = await ctx.db.all(
    from(S).where(
      eq(S.companyId!, ctx.scope.company),
      eq(S.propertyId, property.id),
      eq(S.state, 'checked_in'),
    ),
  )
  const occupied = new Set(stays.map((stay) => stay.reservationId))
  const late = await lateArrivalPlan(ctx, property, day)
  const held = new Set(
    late
      .filter(
        (row) =>
          row.guaranteeValid &&
          (row.decision?.choice === 'hold' || ['prepaid', 'agent'].includes(row.guaranteeKind)),
      )
      .map((row) => row.id),
  )
  const company = await readRecord(ctx, 'company.Company', ctx.scope.company)
  const T = ctx.table('hospitality_core.RoomNightSnapshot')
  const existing = new Set(
    (
      await ctx.db.all(
        from(T).where(
          eq(T.companyId!, ctx.scope.company),
          eq(T.propertyId, property.id),
          eq(T.auditDate, day),
        ),
      )
    ).map((row) => row.reservationId),
  )
  return bookings
    .filter(
      (booking) =>
        (occupied.has(booking.id) || held.has(booking.id)) &&
        dateKeyIn(new Date(String(booking.checkIn)), String(property.timezone)) <= day &&
        dateKeyIn(new Date(String(booking.checkOut)), String(property.timezone)) > day,
    )
    .map((booking) => ({
      booking,
      id: `${booking.id}:room-night:${day}`,
      amount: canonicalDecimalText(String(booking.rate)),
      currency: String(booking.currency ?? company?.currency ?? 'VND'),
      held: held.has(booking.id) && !occupied.has(booking.id),
      existing: existing.has(booking.id),
    }))
}

/** Upfront folio charges are not posted again. The close records their nightly earned allocation immutably. */
export async function captureRoomNights(ctx: Ctx, property: Row, day: string, runId: string) {
  const plan = await roomNightPlan(ctx, property, day)
  for (const night of plan) {
    await ctx.db.insertIfAbsent('hospitality_core.RoomNightSnapshot', {
      id: night.id,
      propertyId: property.id,
      reservationId: night.booking.id,
      stayId: night.booking.stayId ?? null,
      auditDate: day,
      nightAuditRunId: runId,
      amount: night.amount,
      currency: night.currency,
      kind: night.held ? 'held' : 'occupied',
      capturedAt: new Date().toISOString(),
    })
    if (night.held) {
      const until = zonedDateTime(addCalendarDays(day, 1), 12, 0, String(property.timezone)).toISOString()
      const current = await readRecord(ctx, 'hospitality_core.Reservation', night.booking.id)
      if (current?.auditHoldDate !== day) {
        const claimed = await ctx.db.compareAndSet(
          'hospitality_core.Reservation',
          { id: night.booking.id },
          { state: 'confirmed', version: current?.version ?? null },
          { auditHoldDate: day, auditHoldUntil: until, version: Number(current?.version ?? 0) + 1 },
        )
        if (!('matched' in claimed) || !claimed.matched)
          throw new Error('Held arrival changed during night audit')
      }
    }
  }
  const T = ctx.table('hospitality_core.RoomNightSnapshot')
  const saved = await ctx.db.all(
    from(T).where(eq(T.companyId!, ctx.scope.company), eq(T.nightAuditRunId, runId)),
  )
  return {
    roomNightCount: saved.length,
    heldCount: saved.filter((row) => row.kind === 'held').length,
    roomNightAmount: saved.reduce((sum, row) => addDecimals(sum, String(row.amount)), '0'),
  }
}
