import { GUARANTEE_READS, reservationGuaranteeValid } from './guarantee-source.ts'
import { defineFn, eq, from, lte } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn, zonedMidnight } from '../calendar.ts'
import { claimVersion, propertyAccess, readRecord, recordChange, reject, runCommand } from './command.ts'

export async function lateArrivalPlan(
  ctx: Ctx,
  property: Row,
  auditDate: string,
): Promise<Array<Row & { guaranteeKind: string; decision: Row | null; guaranteeValid: boolean }>> {
  const R = ctx.table('hospitality_core.Reservation'),
    D = ctx.table('hospitality_core.AuditArrivalDecision')
  const rows = await ctx.db.all(
    from(R).where(
      eq(R.propertyId, property.id),
      eq(R.state, 'confirmed'),
      lte(R.checkIn, zonedMidnight(addCalendarDays(auditDate, 1), String(property.timezone)).toISOString()),
    ),
  )
  const decisions = await ctx.db.all(from(D).where(eq(D.propertyId, property.id), eq(D.auditDate, auditDate)))
  const byReservation = new Map(decisions.map((d) => [String(d.reservationId), d]))
  return Promise.all(
    rows
      .filter((row) => dateKeyIn(new Date(String(row.checkIn)), String(property.timezone)) <= auditDate)
      .map(async (row) => ({
        ...row,
        guaranteeKind: String(row.guaranteeKind ?? 'none'),
        decision: byReservation.get(String(row.id)) ?? null,
        guaranteeValid:
          String(row.guaranteeKind ?? 'none') === 'none' ||
          !ctx.manifest.models['hospitality_billing.GuaranteeAllocation'] ||
          !ctx.effects.includes('read:hospitality_billing.GuaranteeAllocation') ||
          (await reservationGuaranteeValid(ctx, row)),
      })),
  )
}
export const decideAuditArrivalHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'decideAuditArrival', async (tx) => {
    const reservation = await readRecord(tx, 'hospitality_core.Reservation', args.reservationId)
    if (!reservation || reservation.state !== 'confirmed') reject('reservationId', 'reservation_transition')
    const property = await propertyAccess(tx, reservation.propertyId)
    if (property.closingDate) reject('auditDate', 'date_locked')
    const day = String(args.auditDate)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      day !== (property.businessDate ?? dateKeyIn(new Date(), String(property.timezone)))
    )
      reject('auditDate', 'date_locked')
    if (!['hold', 'no_show'].includes(String(args.choice))) reject('choice', 'audit_choice')
    if (
      tx.manifest.models['hospitality_billing.GuaranteeAllocation'] &&
      !(await reservationGuaranteeValid(tx, reservation))
    )
      reject('choice', 'guarantee_payment')
    if (args.choice === 'no_show' && reservation.cancellationPolicyType === 'contract')
      reject('choice', 'contract_no_show_first')
    const guarantee = String(reservation.guaranteeKind ?? 'none')
    if (guarantee === 'none') reject('choice', 'audit_not_guaranteed')
    if (['prepaid', 'agent'].includes(guarantee) && args.choice !== 'hold')
      reject('choice', 'audit_channel_hold')
    const run = await readRecord(tx, 'hospitality_core.NightAuditRun', `${property.id}:${day}`)
    if (run && ['queued', 'running', 'completed'].includes(String(run.state)))
      reject('auditDate', 'date_locked')
    const propertyClaim = await tx.db.compareAndSet(
      'hospitality_core.Property',
      { id: property.id },
      { closingDate: null, version: property.version ?? null, businessDate: property.businessDate ?? null },
      { version: Number(property.version ?? 0) + 1 },
    )
    if (!('matched' in propertyClaim) || !propertyClaim.matched) reject('auditDate', 'date_locked')
    await claimVersion(tx, 'hospitality_core.Reservation', reservation, args.expectedVersion)
    const id = `${reservation.id}:${day}`,
      prior = await readRecord(tx, 'hospitality_core.AuditArrivalDecision', id)
    const values = {
      propertyId: property.id,
      reservationId: reservation.id,
      auditDate: day,
      choice: args.choice,
      version: Number(prior?.version ?? 0) + 1,
      actorId: tx.actor,
      decidedAt: new Date().toISOString(),
    }
    if (prior) await tx.db.update('hospitality_core.AuditArrivalDecision', { id }, values)
    else await tx.db.insert('hospitality_core.AuditArrivalDecision', { id, ...values })
    await recordChange(tx, property.id, reservation.id, 'audit-arrival-decision', {
      auditDate: day,
      choice: args.choice,
    })
    return { ok: true, id: reservation.id, errors: [] }
  })
export const auditDecisionFunctions: Record<string, FnSpec> = {
  getNightAuditWorkbench: defineFn({
    input: { propertyId: 'id', auditDate: 'date' },
    output: {
      businessDate: 'date',
      propertyVersion: 'int',
      timezone: 'text',
      closing: 'bool',
      runState: 'text?',
      canClose: 'bool',
      pending: 'int',
      arrivals: 'json',
    },
    effects: [
      ...GUARANTEE_READS,
      'read:hospitality_core.Property',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.NightAuditRun',
      'read:hospitality_core.AuditArrivalDecision',
      'read:partner.Partner',
    ],
    handler: async (ctx, args) => {
      const property = await propertyAccess(ctx, args.propertyId),
        day = String(args.auditDate)
      const businessDate = String(property.businessDate ?? dateKeyIn(new Date(), String(property.timezone)))
      const late = await lateArrivalPlan(ctx, property, day)
      const arrivals = await Promise.all(
        late.map(async (row) => ({
          id: row.id,
          code: row.code,
          guest: (await readRecord(ctx, 'partner.Partner', row.partnerId))?.name ?? '',
          guaranteeKind: row.guaranteeKind,
          guaranteeValid: row.guaranteeValid,
          version: Number(row.version ?? 0),
          choice:
            row.decision?.choice ??
            (row.guaranteeKind === 'none'
              ? 'no_show'
              : ['prepaid', 'agent'].includes(row.guaranteeKind)
                ? 'hold'
                : null),
          editable: !['none', 'prepaid', 'agent'].includes(row.guaranteeKind),
        })),
      )
      const pending = arrivals.filter((row) => !row.guaranteeValid || (row.editable && !row.choice)).length
      const run = await readRecord(ctx, 'hospitality_core.NightAuditRun', `${property.id}:${day}`)
      const today = dateKeyIn(new Date(), String(property.timezone)),
        hour = Number(
          new Intl.DateTimeFormat('en', {
            timeZone: String(property.timezone),
            hour: '2-digit',
            hourCycle: 'h23',
          }).format(new Date()),
        )
      return {
        businessDate,
        propertyVersion: Number(property.version ?? 0),
        timezone: property.timezone,
        closing: !!property.closingDate,
        runState: run?.state ?? null,
        canClose:
          day === businessDate &&
          day <= today &&
          (day < today || hour >= 23) &&
          pending === 0 &&
          !['queued', 'running', 'completed'].includes(String(run?.state ?? '')),
        pending,
        arrivals,
      }
    },
  }),
  decideAuditArrival: defineFn({
    input: {
      reservationId: 'id',
      auditDate: 'date',
      choice: 'text',
      expectedVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...GUARANTEE_READS,
      'read:hospitality_core.Property',
      'write:hospitality_core.Property',
      'read:hospitality_core.Reservation',
      'write:hospitality_core.Reservation',
      'read:hospitality_core.NightAuditRun',
      'read:hospitality_core.AuditArrivalDecision',
      'write:hospitality_core.AuditArrivalDecision',
      'read:hospitality_core.CommandReceipt',
      'write:hospitality_core.CommandReceipt',
      'write:hospitality_core.OperationalChange',
    ],
    idempotent: true,
    handler: decideAuditArrivalHandler,
  }),
}
