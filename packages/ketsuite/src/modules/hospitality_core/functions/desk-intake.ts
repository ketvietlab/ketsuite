import { createHash } from 'node:crypto'
import { eq, from } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { normalizePhone } from '../../../phone.ts'
import { savePartnerRecord } from '../../partner/functions/partners.ts'
import { createReservationBooking, bookingEffects } from '../operations.ts'
import { deskBookingOffer } from './desk-booking.ts'
import { compareDecimals } from '../../account/money.ts'
import { claimVersion, CommandRejected, propertyAccess, readRecord, recordChange, reject } from './command.ts'

export const DESK_INTAKE_EFFECTS = [
  ...bookingEffects,
  'read:partner.Partner',
  'write:partner.Partner',
  'write:hospitality_core.Property',
  'write:hospitality_core.OperationalChange',
]

/** Guest and booking aggregate share the caller's transaction with guarantee/payment/arrival. */
export async function createDeskBookingInTransaction(tx: Ctx, args: Record<string, unknown>) {
  if (!tx.scope.company) reject('propertyId', 'property_missing')
  const property = await propertyAccess(tx, args.propertyId)
  if (property.closingDate) reject('propertyId', 'business_date_locked')
  await claimVersion(tx, 'hospitality_core.Property', property, property.version)
  const offer = await deskBookingOffer(tx, args)
  if (String(args.quoteFingerprint ?? '') !== offer.fingerprint) reject('quote', 'booking_quote_changed')
  if (
    args.expectedAmountTotal == null ||
    compareDecimals(String(args.expectedAmountTotal), offer.plan.schedule!.amountTotal) !== 0 ||
    Number(args.expectedRateVersion) !== Number(offer.rate.version ?? 0)
  )
    reject('quote', 'booking_quote_changed')
  const existing = args.partnerId ? await readRecord(tx, 'partner.Partner', args.partnerId) : null
  if (args.partnerId && (!existing || existing.active !== true || existing.kind !== 'person'))
    reject('partnerId', 'partner_missing')
  const name = String(existing?.name ?? args.guestName ?? '').trim()
  if (name.length < 2 || name.length > 200) reject('guestName', 'desk_guest_name')
  const rawPhone = String(args.phone ?? existing?.phone ?? '').trim()
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  const email = String(args.email ?? existing?.email ?? '')
    .trim()
    .toLowerCase()
  if (rawPhone && !phone) reject('phone', 'desk_guest_phone')
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email)))
    reject('email', 'desk_guest_email')
  if (!args.walkIn && !phone && !email) reject('phone', 'desk_guest_contact')
  const P = tx.table('partner.Partner')
  if (
    !existing &&
    phone &&
    args.forceNewGuest !== true &&
    (await tx.db.count(from(P).where(eq(P.phone!, phone), eq(P.active, true))))
  )
    reject('phone', 'desk_guest_duplicate')
  const eta = String(args.expectedArrivalTime ?? '').trim(),
    note = String(args.arrivalNote ?? '').trim()
  if (eta && !/^([01]\d|2[0-3]):[0-5]\d$/.test(eta)) reject('expectedArrivalTime', 'arrival_plan_time')
  if (note.length > 500) reject('arrivalNote', 'arrival_plan_note')
  const digest = createHash('sha256')
    .update(JSON.stringify([tx.scope.company, args.requestKey]))
    .digest('hex')
  const id = `desk:${digest}`,
    partnerId = existing?.id ?? `${id}:guest`
  if (!existing) {
    const saved = await savePartnerRecord(tx, {
      id: partnerId,
      kind: 'person',
      name,
      phone,
      email: email || null,
      contactConsent: !!phone || !!email,
    })
    if (!saved.ok) reject('guestName', 'desk_guest_name')
  }
  const result = await createReservationBooking(
    tx,
    {
      id,
      code: `R-${digest.slice(0, 12).toUpperCase()}`,
      propertyId: property.id,
      roomTypeId: offer.type.id,
      ratePlanId: offer.rate.id,
      partnerId,
      provider: args.walkIn ? 'walk_in' : 'direct',
      bookingType: 'nightly',
      checkIn: offer.checkIn,
      checkOut: offer.checkOut,
      adults: offer.adults,
      children: offer.children,
      expectedAmountTotal: args.expectedAmountTotal,
      expectedRateVersion: args.expectedRateVersion,
    },
    true,
  )
  if (!result.ok) throw new CommandRejected({ ...result, ok: false })
  await tx.db.update(
    'hospitality_core.Reservation',
    { id },
    {
      expectedArrivalTime: eta || null,
      arrivalNote: note || null,
      contactPhone: phone,
      contactEmail: email || null,
    },
  )
  await recordChange(tx, property.id, id, 'createReservation', {
    state: 'confirmed',
    roomTypeId: offer.type.id,
    ratePlanId: offer.rate.id,
    walkIn: args.walkIn === true,
  })
  return { id, partnerId, folioId: `${id}:folio`, stayId: `${id}:stay`, offer }
}
