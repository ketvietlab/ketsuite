import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { checkInStay, operations } from '../../hospitality_core/operations.ts'
import { claimVersion, readRecord, reject, runCommand } from '../../hospitality_core/functions/command.ts'
import { AUTHORIZATION_READ_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { reservationFinancialContext } from './guarantee-lookups.ts'
import { guaranteeWorkbenchFunctions, takeReservationGuaranteeInTransaction } from './guarantee-workbench.ts'
import {
  reservationGuaranteeFunctions,
  setReservationGuaranteeInTransaction,
} from './reservation-guarantee.ts'

/** Money, guarantee, physical arrival and receipt commit together, or none do. */
export const arriveReservationHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'arriveReservation', async (tx) => {
    const kind = String(args.kind ?? 'existing')
    if (!['existing', 'collect', 'card', 'deposit', 'prepaid', 'agent'].includes(kind))
      reject('kind', 'guarantee_kind')
    if (ctx.actor) {
      const held = await effectiveFunctionKeys(tx, ctx.actor)
      const required = [
        'hospitality_core.checkIn',
        ...(kind === 'existing'
          ? []
          : [
              kind === 'collect'
                ? 'hospitality_billing.takeReservationGuarantee'
                : 'hospitality_billing.setReservationGuarantee',
            ]),
      ]
      if (held !== null && required.some((key) => !held.includes(key)))
        reject('reservationId', 'arrival_authority')
    }
    const { booking, property } = await reservationFinancialContext(tx, args.reservationId)
    if (booking.state !== 'confirmed') reject('reservationId', 'reservation_transition')
    if (Number(args.expectedVersion) !== Number(booking.version ?? 0))
      reject('expectedVersion', 'transition_conflict')
    const stay = await readRecord(tx, 'hospitality_core.Stay', booking.stayId)
    if (
      !stay ||
      stay.reservationId !== booking.id ||
      stay.propertyId !== property.id ||
      stay.folioId !== booking.folioId ||
      stay.state !== 'draft'
    )
      reject('reservationId', 'reservation_transition')
    if (Number(args.expectedStayVersion) !== Number(stay.version ?? 0))
      reject('expectedStayVersion', 'transition_conflict')
    if (kind === 'collect') {
      const result = await takeReservationGuaranteeInTransaction(tx, args)
      if (!result.ok) return result
    } else if (kind !== 'existing') {
      await setReservationGuaranteeInTransaction(tx, args)
    } else {
      await claimVersion(tx, 'hospitality_core.Reservation', booking, args.expectedVersion)
    }
    return checkInStay(tx, {
      stayId: stay.id,
      roomId: args.roomId,
      earlyReason: args.earlyReason,
      earlyFee: args.earlyFee,
      keys: args.keys,
      guests: args.guests,
      expectedVersion: args.expectedStayVersion,
    })
  })

export const reservationArrivalFunctions = {
  arriveReservation: defineFn({
    input: {
      reservationId: 'id',
      roomId: 'id',
      earlyReason: 'text?',
      earlyFee: 'text?',
      keys: 'int',
      guests: 'json?',
      kind: 'text?',
      amount: 'decimal?',
      journalId: 'id?',
      paymentId: 'id?',
      reference: 'text?',
      memo: 'text?',
      expectedVersion: 'int',
      expectedStayVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', roomId: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      ...new Set([
        ...AUTHORIZATION_READ_EFFECTS,
        ...(operations.checkIn!.effects ?? []),
        ...(guaranteeWorkbenchFunctions.takeReservationGuarantee!.effects ?? []),
        ...(reservationGuaranteeFunctions.setReservationGuarantee!.effects ?? []),
      ]),
    ],
    idempotent: true,
    handler: arriveReservationHandler,
  }),
}
