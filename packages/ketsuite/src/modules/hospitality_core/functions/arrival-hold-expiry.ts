import { asc, defineJob, eq, from, lte } from '@ketvietlab/ketjs'
import type { Ctx, JobSpec } from '@ketvietlab/ketjs'
import { applyNoShow } from '../operations.ts'
import { nightAuditJobs } from '../night-audit.ts'
import { claimVersion, propertyAccess, readRecord, recordChange } from './command.ts'

export async function expireArrivalHold(ctx: Ctx, id: unknown, until: unknown, now = new Date()) {
  return ctx.tx(async (tx) => {
    const booking = await readRecord(tx, 'hospitality_core.Reservation', id)
    if (
      !booking ||
      booking.state !== 'confirmed' ||
      !booking.auditHoldUntil ||
      booking.auditHoldUntil !== until ||
      Date.parse(String(until)) > now.getTime()
    )
      return { expired: false }
    if (booking.unsecuredHold === true && booking.guaranteeKind !== 'none') return { expired: false }
    const property = await propertyAccess(tx, booking.propertyId)
    if (property.closingDate) throw new Error('Hold expiration waits for the active business-day close')
    await claimVersion(tx, 'hospitality_core.Property', property, property.version)
    await claimVersion(tx, 'hospitality_core.Reservation', booking, booking.version)
    const nested: Ctx = { ...tx, tx: async (run) => run(nested) }
    const result = await applyNoShow(nested, booking, 'arrival_hold_expired', now)
    if (!result.ok) throw new Error('Expired arrival could not be settled')
    await recordChange(tx, property.id, booking.id, 'arrival-hold-expired', {
      heldUntil: until,
      noShowFee: result.noShowFee ?? null,
    })
    return { expired: true }
  })
}

export const arrivalHoldJobs: Record<string, JobSpec> = {
  expireArrivalHold: defineJob({
    input: { reservationId: 'id', holdUntil: 'datetime' },
    queue: 'maintenance',
    effects: [...(nightAuditJobs.nightAudit!.effects ?? []), 'write:hospitality_core.OperationalChange'],
    idempotent: true,
    maxAttempts: 5,
    handler: async (ctx, args) => {
      await expireArrivalHold(ctx, args.reservationId, args.holdUntil)
    },
  }),
  scanArrivalHolds: defineJob({
    input: {},
    crossCompany: true,
    schedule: { every: '1m' },
    queue: 'maintenance',
    effects: ['read:hospitality_core.Reservation', 'enqueue:hospitality_core.expireArrivalHold'],
    idempotent: true,
    handler: async (ctx) => {
      const R = ctx.table('hospitality_core.Reservation')
      const due = await ctx.db.all(
        from(R)
          .where(eq(R.state, 'confirmed'), lte(R.auditHoldUntil!, new Date().toISOString()))
          .orderBy(asc(R.auditHoldUntil!), asc(R.id))
          .limit(100),
      )
      for (const booking of due)
        await ctx.jobs.enqueue(
          'hospitality_core.expireArrivalHold',
          { reservationId: booking.id, holdUntil: booking.auditHoldUntil },
          {
            company: String(booking.companyId),
            uniqueKey: `arrival-hold:${booking.id}:${booking.auditHoldUntil}`,
          },
        )
    },
  }),
}
