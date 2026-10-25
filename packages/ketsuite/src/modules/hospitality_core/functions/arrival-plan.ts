import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { dateKeyIn } from '../calendar.ts'
import { claimVersion, propertyAccess, readRecord, recordChange, reject, runCommand } from './command.ts'

export const setReservationArrivalPlanHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'setReservationArrivalPlan', async (tx) => {
    if (!tx.scope.company) reject('id', 'reservation_missing')
    const booking = await readRecord(tx, 'hospitality_core.Reservation', args.id)
    if (!booking) reject('id', 'reservation_missing')
    const property = await propertyAccess(tx, booking.propertyId)
    const stay = await readRecord(tx, 'hospitality_core.Stay', booking.stayId)
    if (
      booking.state !== 'confirmed' ||
      !stay ||
      stay.state !== 'draft' ||
      stay.reservationId !== booking.id ||
      stay.propertyId !== property.id
    )
      reject('id', 'arrival_plan_state')
    const day = dateKeyIn(new Date(String(stay.checkIn)), String(property.timezone))
    if (property.closingDate || (property.businessDate && day < String(property.businessDate)))
      reject('id', 'business_date_locked')
    const time = String(args.expectedArrivalTime ?? '').trim()
    const note = String(args.arrivalNote ?? '').trim()
    const early = args.earlyArrivalRequested === true
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) reject('expectedArrivalTime', 'arrival_plan_time')
    if (early && (stay.bookingType !== 'nightly' || !time || time >= String(property.defaultCheckIn)))
      reject('expectedArrivalTime', 'arrival_plan_early')
    if (note.length > 500) reject('arrivalNote', 'arrival_plan_note')
    await claimVersion(tx, 'hospitality_core.Property', property, property.version)
    await claimVersion(tx, 'hospitality_core.Reservation', booking, args.expectedVersion)
    await tx.db.update(
      'hospitality_core.Reservation',
      { id: booking.id },
      {
        expectedArrivalTime: time || null,
        earlyArrivalRequested: early,
        arrivalNote: note || null,
      },
    )
    await recordChange(tx, property.id, booking.id, 'planArrival', { time: time || null, early })
    return { ok: true, id: booking.id }
  })

export const arrivalPlanFunctions = {
  setReservationArrivalPlan: defineFn({
    input: {
      id: 'id',
      expectedArrivalTime: 'text?',
      earlyArrivalRequested: 'bool',
      arrivalNote: 'text?',
      expectedVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Reservation',
      'write:hospitality_core.Reservation',
      'read:hospitality_core.Stay',
      'read:hospitality_core.Property',
      'write:hospitality_core.Property',
      'read:hospitality_core.CommandReceipt',
      'write:hospitality_core.CommandReceipt',
      'write:hospitality_core.OperationalChange',
    ],
    idempotent: true,
    handler: setReservationArrivalPlanHandler,
  }),
}
