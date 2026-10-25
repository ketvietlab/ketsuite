import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { GUEST_LOYALTY_TIERS } from '../types.ts'
import { claimVersion, propertyAccess, readRecord, recordChange, reject, runCommand } from './command.ts'

/** Benefits are an approved snapshot for this reservation, not a claim of provider verification. */
export function reservationEarlyBenefit(booking: Row | null): string | null {
  const tier = String(booking?.guestLoyaltyTier ?? 'none')
  if (['gold_elite', 'platinum_elite', 'diamond_elite'].includes(tier)) return tier
  return booking?.guestVip === true ? 'vip' : null
}

export const setReservationGuestBenefitsHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'setReservationGuestBenefits', async (tx) => {
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
      reject('id', 'guest_benefits_state')
    if (property.closingDate) reject('id', 'business_date_locked')
    const tier = String(args.tier ?? 'none'),
      program = String(args.program ?? '').trim(),
      reference = String(args.reference ?? '').trim()
    if (!(GUEST_LOYALTY_TIERS as readonly string[]).includes(tier)) reject('tier', 'guest_benefits_tier')
    if (tier !== 'none' && (!program || program.length > 80)) reject('program', 'guest_benefits_program')
    if (!reference || reference.length > 500) reject('reference', 'guest_benefits_reference')
    await claimVersion(tx, 'hospitality_core.Property', property, property.version)
    await claimVersion(tx, 'hospitality_core.Reservation', booking, args.expectedVersion)
    const changed = {
      guestVip: args.vip === true,
      guestLoyaltyTier: tier,
      guestLoyaltyProgram: tier === 'none' ? null : program,
      guestBenefitsReference: reference,
      guestBenefitsUpdatedAt: new Date().toISOString(),
    }
    await tx.db.update('hospitality_core.Reservation', { id: booking.id }, changed)
    await recordChange(tx, property.id, booking.id, 'setGuestBenefits', {
      previous: {
        vip: booking.guestVip === true,
        tier: booking.guestLoyaltyTier ?? 'none',
        program: booking.guestLoyaltyProgram ?? null,
      },
      vip: changed.guestVip,
      tier,
      program: changed.guestLoyaltyProgram,
      reference,
    })
    return { ok: true, id: booking.id }
  })

export const guestBenefitFunctions = {
  setReservationGuestBenefits: defineFn({
    input: {
      id: 'id',
      vip: 'bool',
      tier: 'text',
      program: 'text?',
      reference: 'text',
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
    handler: setReservationGuestBenefitsHandler,
  }),
}
