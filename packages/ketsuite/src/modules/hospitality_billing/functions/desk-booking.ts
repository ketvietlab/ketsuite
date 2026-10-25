import { asc, defineFn, eq, from, ilike, inArray, isNull, likeLiteral, not, or } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { AUTHORIZATION_READ_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { DESK_SEARCH_INPUT } from '../../hospitality_core/functions/desk-booking.ts'
import {
  createDeskBookingInTransaction,
  DESK_INTAKE_EFFECTS,
} from '../../hospitality_core/functions/desk-intake.ts'
import { checkInStay, operations } from '../../hospitality_core/operations.ts'
import { zonedDateTime } from '../../hospitality_core/calendar.ts'
import { propertyAccess, reject, runCommand } from '../../hospitality_core/functions/command.ts'
import { compareDecimals } from '../../account/money.ts'
import { guaranteeWorkbenchFunctions, takeReservationGuaranteeInTransaction } from './guarantee-workbench.ts'
import {
  reservationGuaranteeFunctions,
  setReservationGuaranteeInTransaction,
} from './reservation-guarantee.ts'

export const confirmDeskBookingHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'confirmDeskBooking', async (tx) => {
    const kind = String(args.kind ?? 'none'),
      walkIn = args.walkIn === true
    if (walkIn && !args.roomId) reject('roomId', 'room_missing')
    if (walkIn && args.keys == null) reject('keys', 'arrival_keys')
    if (!['none', 'card', 'collect'].includes(kind) || (walkIn && kind === 'none'))
      reject('kind', 'guarantee_required')
    if (ctx.actor) {
      const held = await effectiveFunctionKeys(tx, ctx.actor)
      const required = [
        'hospitality_core.createReservation',
        ...(walkIn ? ['hospitality_core.checkIn'] : []),
        ...(kind === 'collect'
          ? ['hospitality_billing.takeReservationGuarantee']
          : kind === 'card'
            ? ['hospitality_billing.setReservationGuarantee']
            : []),
      ]
      if (held !== null && required.some((key) => !held.includes(key))) reject('kind', 'arrival_authority')
    }
    const created = await createDeskBookingInTransaction(tx, args)
    const total = created.offer.plan.schedule!.amountTotal
    if (
      created.offer.terms.cancellationPolicyType === 'non_refundable' &&
      (kind !== 'collect' || compareDecimals(String(args.amount ?? '0'), total) !== 0)
    )
      reject('kind', 'desk_booking_prepay')
    if (
      walkIn &&
      kind === 'collect' &&
      compareDecimals(String(args.amount ?? '0'), String(created.offer.plan.rate)) < 0
    )
      reject('amount', 'desk_walk_in_deposit')
    const guaranteed =
      kind === 'collect'
        ? await takeReservationGuaranteeInTransaction(tx, {
            ...args,
            reservationId: created.id,
            expectedVersion: 1,
          })
        : await setReservationGuaranteeInTransaction(tx, {
            ...args,
            reservationId: created.id,
            expectedVersion: 1,
            amount: kind === 'card' ? total : undefined,
          })
    if (!guaranteed.ok) return { ...guaranteed, ok: false }
    if (kind === 'none') {
      const deadline = zonedDateTime(created.offer.arrival, 18, 0, String(created.offer.property.timezone))
      if (deadline.getTime() <= Date.now()) reject('kind', 'desk_booking_guarantee_after_cutoff')
      await tx.db.update(
        'hospitality_core.Reservation',
        { id: created.id },
        { unsecuredHold: true, auditHoldUntil: deadline.toISOString() },
      )
    }
    if (walkIn) {
      const arrived = await checkInStay(tx, {
        stayId: created.stayId,
        roomId: args.roomId,
        expectedVersion: 0,
        keys: args.keys,
        guests: args.guests,
        earlyReason: args.earlyReason,
        earlyFee: args.earlyFee,
      })
      if (!arrived.ok) return { ...arrived, ok: false }
    }
    return { ok: true, id: created.id, folioId: created.folioId, stayId: created.stayId, errors: [] }
  })

export const lookupDeskJournalsHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return []
  await propertyAccess(ctx, args.propertyId)
  const J = ctx.table('account.Journal')
  let query = from(J).where(
    eq(J.companyId!, ctx.scope.company),
    eq(J.active, true),
    inArray(J.type, ['cash', 'bank']),
    not(isNull(J.defaultAccountId)),
  )
  if (args.id) query = query.where(eq(J.id, args.id))
  if (args.search) {
    const term = `%${likeLiteral(String(args.search).trim().slice(0, 100))}%`
    query = query.where(or(ilike(J.code, term, true), ilike(J.name, term, true)))
  }
  return (
    await ctx.db.all(
      query.orderBy(asc(J.code), asc(J.id)).limit(Math.min(20, Math.max(1, Number(args.limit) || 20))),
    )
  ).map((journal) => ({ id: journal.id, name: `${journal.code} · ${journal.name}` }))
}

export const deskBookingBillingFunctions = {
  confirmDeskBooking: defineFn({
    input: {
      ...DESK_SEARCH_INPUT,
      ratePlanId: 'id',
      quoteFingerprint: 'text',
      expectedAmountTotal: 'decimal',
      expectedRateVersion: 'int',
      requestKey: 'text',
      partnerId: 'id?',
      guestName: 'text?',
      phone: 'text?',
      email: 'text?',
      forceNewGuest: 'bool?',
      expectedArrivalTime: 'text?',
      arrivalNote: 'text?',
      kind: 'text',
      amount: 'decimal?',
      journalId: 'id?',
      reference: 'text?',
      roomId: 'id?',
      keys: 'int?',
      guests: 'json?',
      earlyReason: 'text?',
      earlyFee: 'text?',
    },
    output: { ok: 'bool', id: 'id?', folioId: 'id?', stayId: 'id?', errors: 'json?' },
    effects: [
      ...new Set([
        ...AUTHORIZATION_READ_EFFECTS,
        ...DESK_INTAKE_EFFECTS,
        ...(operations.checkIn!.effects ?? []),
        ...(guaranteeWorkbenchFunctions.takeReservationGuarantee!.effects ?? []),
        ...(reservationGuaranteeFunctions.setReservationGuarantee!.effects ?? []),
      ]),
    ],
    idempotent: true,
    handler: confirmDeskBookingHandler,
  }),
  lookupDeskJournals: defineFn({
    input: { propertyId: 'id', id: 'id?', search: 'text?', limit: 'int?' },
    effects: ['read:hospitality_core.Property', 'read:account.Journal'],
    handler: lookupDeskJournalsHandler,
  }),
}
