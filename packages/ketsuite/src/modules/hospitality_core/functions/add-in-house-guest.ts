import { createHash } from 'node:crypto'
import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { savePartnerRecord } from '../../partner/functions/partners.ts'
import { compareDecimals, multiplyDecimals } from '../../account/money.ts'
import { roomAdultCapacity, supportedExtraBeds, purchasedExtraBeds } from './room-capacity.ts'
import { dateKeyIn } from '../calendar.ts'
import { occupancyDates } from '../inventory.ts'
import { postChargeInTransaction } from '../services.ts'
import { ARRIVAL_GUEST_EFFECTS, validateArrivalPeople } from './arrival-guests.ts'
import {
  claimVersion,
  hasPropertyScope,
  propertyAccess,
  readRecord,
  recordChange,
  reject,
  runCommand,
} from './command.ts'

export async function inHouseGuestPlan(ctx: Ctx, stay: Row, property: Row) {
  const room = await readRecord(ctx, 'hospitality_core.Room', stay.currentRoomId)
  const type = room ? await readRecord(ctx, 'hospitality_core.RoomType', room.roomTypeId) : null
  if (!room || room.propertyId !== property.id || !type || type.propertyId !== property.id) return null
  const base = roomAdultCapacity(room, type, Number(stay.children ?? 0))
  const extra = supportedExtraBeds(type)
  const next = Number(stay.adults) + 1
  const today = dateKeyIn(new Date(), String(property.timezone))
  const nights = occupancyDates(stay.checkIn, stay.checkOut, String(property.timezone)).filter(
    (day) => day >= today,
  ).length
  const F = ctx.table('hospitality_core.PropertyCharge')
  const fees = await ctx.db.all(
    from(F)
      .where(
        eq(F.companyId!, ctx.scope.company),
        eq(F.propertyId, property.id),
        eq(F.chargeType!, 'extra_bed'),
        eq(F.active, true),
      )
      .limit(2),
  )
  const fee =
    fees.length === 1 &&
    fees[0]!.basis === 'per_night' &&
    fees[0]!.included !== true &&
    compareDecimals(String(fees[0]!.amount), '0') >= 0
      ? fees[0]!
      : null
  return {
    next,
    capacity: base,
    maximum: base + extra,
    needsBed: next > base && purchasedExtraBeds(stay) === 0,
    nights,
    rate: fee ? String(fee.amount) : null,
    amount: fee ? multiplyDecimals(String(fee.amount), String(nights)) : null,
    feeName: fee?.name ?? null,
    full: base < 0 || next > base + extra || !nights,
  }
}

const planReads = [
  'read:hospitality_core.Room',
  'read:hospitality_core.RoomType',
  'read:hospitality_core.PropertyCharge',
]
export const addInHouseGuestHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'addInHouseGuest', async (tx) => {
    if (!tx.scope.company) reject('stayId', 'stay_missing')
    const stay = await readRecord(tx, 'hospitality_core.Stay', args.stayId)
    if (!stay || stay.state !== 'checked_in') reject('stayId', 'stay_cannot_move')
    const property = await propertyAccess(tx, stay.propertyId)
    const today = dateKeyIn(new Date(), String(property.timezone))
    if (property.closingDate || (property.businessDate && String(property.businessDate) > today))
      reject('stayId', 'business_date_locked')
    await claimVersion(tx, 'hospitality_core.Property', property, property.version)
    await claimVersion(tx, 'hospitality_core.Stay', stay, args.expectedVersion)
    const booking = await readRecord(tx, 'hospitality_core.Reservation', stay.reservationId)
    if (!booking || booking.stayId !== stay.id || booking.propertyId !== stay.propertyId)
      reject('stayId', 'stay_missing')
    await claimVersion(tx, 'hospitality_core.Reservation', booking, args.expectedReservationVersion)
    const plan = await inHouseGuestPlan(tx, stay, property)
    if (!plan || plan.full) reject('guest', 'additional_guest_capacity')
    if (plan.needsBed && (args.extraBed !== true || plan.rate === null))
      reject('extraBed', 'additional_guest_bed')
    if (
      plan.needsBed &&
      (args.expectedBedRate == null || compareDecimals(String(args.expectedBedRate), String(plan.rate)) !== 0)
    )
      reject('extraBed', 'additional_guest_price_changed')
    const person = validateArrivalPeople([args.guest], 1, today)[0]!
    const G = tx.table('hospitality_core.StayGuest'),
      D = tx.table('hospitality_core.GuestDocument')
    const guests = await tx.db.all(
      from(G)
        .where(eq(G.companyId!, tx.scope.company), eq(G.propertyId, property.id), eq(G.stayId, stay.id))
        .limit(51),
    )
    if (guests.length !== Number(stay.adults)) reject('guest', 'arrival_guest_count')
    if (
      await tx.db.count(
        from(D).where(
          eq(D.companyId!, tx.scope.company),
          eq(D.stayId, stay.id),
          eq(D.type, person.type),
          eq(D.nationality!, person.nationality),
          eq(D.number, person.number),
        ),
      )
    )
      reject('guest-0-number', 'arrival_guest_duplicate')
    const digest = createHash('sha256')
      .update(JSON.stringify([tx.scope.company, stay.id, args.requestKey]))
      .digest('hex')
    const id = `additional-guest:${digest}`
    const saved = await savePartnerRecord(tx, {
      id,
      name: person.fullName,
      kind: 'person',
      contactConsent: false,
    })
    if (!saved.ok) reject('guest-0-fullName', 'required')
    await tx.db.insert('hospitality_core.StayGuest', {
      id,
      stayId: stay.id,
      propertyId: property.id,
      partnerId: id,
      displayName: person.fullName,
      primary: false,
      primaryKey: null,
    })
    await tx.db.insert('hospitality_core.GuestDocument', {
      id: `${id}:arrival-document`,
      stayId: stay.id,
      partnerId: id,
      type: person.type,
      number: person.number,
      fullName: person.fullName,
      dateOfBirth: `${person.birth}T00:00:00.000Z`,
      gender: person.gender,
      nationality: person.nationality,
      ocrState: 'pending',
    })
    await tx.db.update(
      'hospitality_core.Stay',
      { id: stay.id },
      { adults: plan.next, extraBeds: plan.needsBed ? 1 : purchasedExtraBeds(stay) },
    )
    await tx.db.update('hospitality_core.Reservation', { id: booking.id }, { adults: plan.next })
    if (plan.needsBed) {
      const charged = await postChargeInTransaction(tx, {
        id: `${id}:bed`,
        sourceKey: `${id}:bed`,
        folioId: stay.folioId,
        stayId: stay.id,
        type: 'service',
        description: String(plan.feeName),
        quantity: String(plan.nights),
        unitPrice: plan.rate,
        occurredAt: new Date().toISOString(),
        serviceDate: today,
      })
      if (charged.ok !== true) reject('extraBed', 'arrival_fee_posting')
    }
    await tx.jobs.enqueue(
      'hospitality_core.prepareStayNotices',
      { stayId: stay.id },
      { uniqueKey: `stay-notices:${String(stay.id)}:guest:${digest}` },
    )
    await recordChange(tx, property.id, stay.id, 'addInHouseGuest', {
      adults: plan.next,
      extraBed: plan.needsBed,
    })
    return { ok: true, id, adults: plan.next }
  })

export const getInHouseGuestPlanHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return { plan: null }
  const stay = await readRecord(ctx, 'hospitality_core.Stay', args.stayId)
  const property = stay ? await readRecord(ctx, 'hospitality_core.Property', stay.propertyId) : null
  if (!stay || stay.state !== 'checked_in' || !property || !hasPropertyScope(ctx, property))
    return { plan: null }
  return { plan: await inHouseGuestPlan(ctx, stay, property) }
}

export const inHouseGuestFunctions = {
  getInHouseGuestPlan: defineFn({
    input: { stayId: 'id' },
    output: { plan: 'json?' },
    effects: ['read:hospitality_core.Stay', 'read:hospitality_core.Property', ...planReads],
    handler: getInHouseGuestPlanHandler,
  }),
  addInHouseGuest: defineFn({
    input: {
      stayId: 'id',
      guest: 'json',
      extraBed: 'bool?',
      expectedBedRate: 'decimal?',
      expectedVersion: 'int',
      expectedReservationVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', adults: 'int?', errors: 'json?' },
    effects: [
      ...ARRIVAL_GUEST_EFFECTS,
      ...planReads,
      'read:hospitality_core.Reservation',
      'write:hospitality_core.Reservation',
      'read:hospitality_core.Folio',
      'write:hospitality_core.Folio',
      'read:hospitality_core.Charge',
      'write:hospitality_core.Charge',
      'enqueue:hospitality_core.prepareStayNotices',
    ],
    idempotent: true,
    agent: true,
    handler: addInHouseGuestHandler,
  }),
}
