import { GUARANTEE_READS, reservationGuaranteeValid } from './guarantee-source.ts'
import { eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { dateKeyIn } from '../calendar.ts'
import { AUTHORIZATION_READ_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import {
  claimVersion,
  hasPropertyScope,
  propertyAccess,
  readRecord,
  recordChange,
  reject,
  runCommand,
} from './command.ts'

type Target = { model: string; key: string; financial?: boolean }
const targets: Record<string, Target> = {
  requestNightAudit: { model: 'Property', key: 'propertyId' },
  savePropertyCharge: { model: 'PropertyCharge', key: 'id' },
  createReservation: { model: 'Reservation', key: 'id', financial: true },
  setRoomStatus: { model: 'Room', key: 'id' },
  setInventoryRange: { model: 'Property', key: 'propertyId', financial: true },
  setRestrictionRange: { model: 'Property', key: 'propertyId', financial: true },
  amendReservation: { model: 'Reservation', key: 'id', financial: true },
  cancelReservation: { model: 'Reservation', key: 'id', financial: true },
  markNoShow: { model: 'Reservation', key: 'id', financial: true },
  checkOut: { model: 'Stay', key: 'stayId', financial: true },
  adjustStayDeparture: { model: 'Stay', key: 'stayId', financial: true },
  holdRoom: { model: 'Stay', key: 'stayId' },
  releaseRoomHold: { model: 'Stay', key: 'stayId' },
  moveRoom: { model: 'Stay', key: 'stayId', financial: true },
  addStayGuest: { model: 'Stay', key: 'stayId' },
  addCharge: { model: 'Folio', key: 'folioId', financial: true },
  voidCharge: { model: 'Folio', key: 'folioId', financial: true },
  createCleaningTask: { model: 'CleaningTask', key: 'id' },
  saveCleaningTask: { model: 'CleaningTask', key: 'id' },
  startCleaningTask: { model: 'CleaningTask', key: 'id' },
  completeCleaningTask: { model: 'CleaningTask', key: 'id' },
  declineCleaningTask: { model: 'CleaningTask', key: 'id' },
  cancelCleaningTask: { model: 'CleaningTask', key: 'id' },
  saveExtraLine: { model: 'ExtraLine', key: 'id', financial: true },
  materializeExtraLine: { model: 'ExtraLine', key: 'id', financial: true },
  recordStayNoticeSubmission: { model: 'StayNotice', key: 'id' },
  confirmStayNotice: { model: 'StayNotice', key: 'id' },
}

/** These guards also apply to native forms and trusted adapters, not just modal buttons. */
export function guardedOperationalFunctions(functions: Record<string, FnSpec>): Record<string, FnSpec> {
  return Object.fromEntries(
    Object.entries(functions).map(([name, spec]) => {
      const target = targets[name]
      if (!target) return [name, spec]
      const model = `hospitality_core.${target.model}`
      return [
        name,
        {
          ...spec,
          input: {
            ...spec.input,
            expectedVersion: spec.input?.expectedVersion ?? 'int?',
            requestKey: spec.input?.requestKey ?? 'text?',
          },
          effects: [
            ...new Set([
              ...(spec.effects ?? []),
              ...(name === 'checkIn' || name === 'requestNightAudit'
                ? [...GUARANTEE_READS, 'read:hospitality_core.Reservation']
                : []),
              `read:${model}`,
              `write:${model}`,
              'read:hospitality_core.Property',
              'write:hospitality_core.Property',
              'read:hospitality_core.CommandReceipt',
              'write:hospitality_core.CommandReceipt',
              'write:hospitality_core.OperationalChange',
              ...(name === 'setRoomStatus' ? ['read:hospitality_core.RoomBlock'] : []),
              ...(name === 'startCleaningTask' ||
              name === 'completeCleaningTask' ||
              name === 'declineCleaningTask'
                ? AUTHORIZATION_READ_EFFECTS
                : []),
              ...(name === 'createCleaningTask' || name === 'startCleaningTask'
                ? ['read:user.User', 'read:user.Membership', 'read:user.BranchMembership']
                : []),
            ]),
          ],
          handler: (ctx: Ctx, args: Record<string, unknown>) =>
            runCommand(ctx, args, name, async (tx) => {
              const row = await readRecord(tx, model, args[target.key])
              if (!row && Number(args.expectedVersion ?? 0) > 0)
                reject('expectedVersion', 'transition_conflict')
              if (
                !row &&
                ![
                  'savePropertyCharge',
                  'createReservation',
                  'createCleaningTask',
                  'saveCleaningTask',
                  'saveExtraLine',
                ].includes(name)
              )
                reject(target.key, 'record_missing')
              if (
                row &&
                ctx.actor &&
                ['startCleaningTask', 'completeCleaningTask', 'declineCleaningTask'].includes(name)
              ) {
                const held = await effectiveFunctionKeys(tx, ctx.actor)
                const supervisor = held === null || held.includes('hospitality_core.saveCleaningTask')
                if (
                  !supervisor &&
                  (row.assigneeId !== ctx.actor || (args.assigneeId && args.assigneeId !== ctx.actor))
                )
                  reject('assigneeId', 'cleaning_assignee_authority')
              }
              if (
                name === 'moveRoom' &&
                (!String(args.reason ?? '').trim() || String(args.reason).trim().length > 500)
              )
                reject('reason', 'move_reason_required')
              if (name === 'setRoomStatus' && row) {
                const B = tx.table('hospitality_core.RoomBlock')
                if (await tx.db.count(from(B).where(eq(B.roomId, row.id), eq(B.state, 'active'))))
                  reject('status', 'room_block_overlap')
              }
              let propertyId = row?.propertyId ?? args.propertyId
              if (!propertyId && args.roomId)
                propertyId = (await readRecord(tx, 'hospitality_core.Room', args.roomId))?.propertyId
              if (!propertyId && args.stayId)
                propertyId = (await readRecord(tx, 'hospitality_core.Stay', args.stayId))?.propertyId
              if (!propertyId && args.reservationId)
                propertyId = (await readRecord(tx, 'hospitality_core.Reservation', args.reservationId))
                  ?.propertyId
              const property = propertyId ? await propertyAccess(tx, propertyId) : null
              if (
                name === 'saveExtraLine' &&
                row &&
                ((args.reservationId && args.reservationId !== row.reservationId) ||
                  (args.stayId && args.stayId !== row.stayId) ||
                  (args.propertyId && args.propertyId !== row.propertyId))
              )
                reject('target', 'property_mismatch')
              if (name === 'saveExtraLine' || name === 'materializeExtraLine') {
                if (!property) reject('propertyId', 'property_missing')
                await claimVersion(tx, 'hospitality_core.Property', property, undefined)
              }
              if (
                property &&
                [
                  'createReservation',
                  'amendReservation',
                  'cancelReservation',
                  'markNoShow',
                  'checkIn',
                  'checkOut',
                  'holdRoom',
                  'releaseRoomHold',
                  'moveRoom',
                ].includes(name)
              )
                await claimVersion(tx, 'hospitality_core.Property', property, undefined)
              if (target.financial && property) {
                const range = ['setInventoryRange', 'setRestrictionRange'].includes(name)
                if (
                  property.closingDate &&
                  (!range ||
                    (String(args.from) <= String(property.closingDate) &&
                      String(args.to) >= String(property.closingDate)))
                )
                  reject('date', 'business_date_locked')
                const instant = new Date(
                  String(args.at ?? args.voidedAt ?? args.occurredAt ?? new Date().toISOString()),
                )
                if (!Number.isFinite(instant.getTime())) reject('date', 'date')
                const civil = dateKeyIn(instant, String(property.timezone))
                const today = dateKeyIn(new Date(), String(property.timezone))
                // A close at 23:00 opens tomorrow's business day while the civil date is still today.
                // New operations belong to that open day; explicit historical dates remain locked.
                if (
                  !range &&
                  !args.serviceDate &&
                  civil < today &&
                  property.businessDate &&
                  civil < String(property.businessDate)
                )
                  reject('date', 'business_date_locked')
                const date = range
                  ? String(args.from)
                  : args.serviceDate
                    ? String(args.serviceDate)
                    : [civil, String(property.businessDate ?? civil)].sort().at(-1)!
                if (
                  name === 'createReservation' &&
                  args.checkIn &&
                  property.businessDate &&
                  dateKeyIn(new Date(String(args.checkIn)), String(property.timezone)) <
                    String(property.businessDate)
                )
                  reject('checkIn', 'business_date_locked')
                if (property.businessDate && date < String(property.businessDate))
                  reject('date', 'business_date_locked')
                if (name === 'voidCharge') {
                  const charge = await readRecord(tx, 'hospitality_core.Charge', args.id)
                  const originalDay =
                    charge?.serviceDate ??
                    (charge?.occurredAt
                      ? dateKeyIn(new Date(String(charge.occurredAt)), String(property.timezone))
                      : null)
                  if (
                    originalDay &&
                    property.businessDate &&
                    String(originalDay) < String(property.businessDate)
                  )
                    reject('date', 'business_date_locked')
                }
                if (name === 'markNoShow' && ['prepaid', 'agent'].includes(String(row?.guaranteeKind)))
                  reject('id', 'audit_channel_hold')
              }
              if (name === 'createCleaningTask' || name === 'startCleaningTask')
                await validateCleaningAssignee(tx, args.assigneeId, property)
              if (name === 'createCleaningTask' && !row && args.roomId) {
                const T = tx.table('hospitality_core.CleaningTask')
                if (
                  await tx.db.count(
                    from(T).where(
                      eq(T.roomId, args.roomId),
                      eq(T.taskType, args.taskType),
                      inArray(T.state, ['todo', 'in_progress']),
                    ),
                  )
                )
                  reject('roomId', 'cleaning_task_duplicate')
                if (args.dueAt && new Date(String(args.dueAt)).getTime() <= Date.now())
                  reject('dueAt', 'cleaning_due_future')
              }
              if (row) await claimVersion(tx, model, row, args.expectedVersion)
              // The receipt transaction owns all writes, including legacy handlers' inner transaction.
              if (
                name === 'checkIn' &&
                row?.state !== 'checked_in' &&
                tx.manifest.models['hospitality_billing.GuaranteeAllocation']
              ) {
                const booking = row?.reservationId
                  ? await readRecord(tx, 'hospitality_core.Reservation', row.reservationId)
                  : null
                if (!booking || !(await reservationGuaranteeValid(tx, booking)))
                  reject('reservationId', 'guarantee_required')
                if (booking.auditHoldUntil && Date.parse(String(booking.auditHoldUntil)) <= Date.now())
                  reject('reservationId', 'arrival_hold_expired')
              }
              const nested: Ctx = { ...tx, tx: async (run) => run(nested) }
              const submitted =
                name === 'addCharge' && property?.businessDate && !args.serviceDate
                  ? { ...args, serviceDate: property.businessDate }
                  : args
              const value = (await spec.handler(nested, submitted)) as Record<string, unknown>
              if (value.ok === false) return value as { ok: false }
              if (!row && target.key === 'id' && value.id) {
                const created = await readRecord(tx, model, value.id)
                if (created)
                  await tx.db.update(
                    model,
                    { id: created.id },
                    {
                      version: 1,
                      ...(['createCleaningTask', 'saveCleaningTask'].includes(name) && args.dueAt
                        ? { dueAt: args.dueAt }
                        : {}),
                    },
                  )
              }
              if (property) {
                await recordChange(tx, property.id, row?.id ?? value.id ?? args[target.key], name, {
                  state: value.state ?? row?.state ?? null,
                  assigneeId: args.assigneeId ?? row?.assigneeId ?? null,
                })
                if (row?.roomId)
                  await recordChange(tx, property.id, row.roomId, name, {
                    taskId: row.id,
                    state: value.state ?? row.state,
                  })
              }
              return { ...value, ok: true }
            }),
        } satisfies FnSpec,
      ]
    }),
  )
}

const recordReads: Record<string, string> = {
  getProperty: 'Property',
  getBuilding: 'Building',
  getFloor: 'Floor',
  getRoomType: 'RoomType',
  getRoom: 'Room',
  getHousekeepingRoom: 'Room',
  getReservation: 'Reservation',
  getStay: 'Stay',
  getFolio: 'Folio',
  getCleaningTask: 'CleaningTask',
}
export function scopedHospitalityRecordReads(functions: Record<string, FnSpec>): Record<string, FnSpec> {
  return Object.fromEntries(
    Object.entries(functions).map(([name, spec]) => {
      const model = recordReads[name]
      if (!model) return [name, spec]
      return [
        name,
        {
          ...spec,
          effects: [...new Set([...(spec.effects ?? []), 'read:hospitality_core.Property'])],
          handler: async (ctx, args) => {
            const row = await readRecord(ctx, `hospitality_core.${model}`, args.id)
            if (!row) return null
            const property =
              model === 'Property'
                ? row
                : row.propertyId
                  ? await readRecord(ctx, 'hospitality_core.Property', row.propertyId)
                  : null
            if ((property && !hasPropertyScope(ctx, property)) || (row.propertyId && !property)) return null
            return spec.handler(ctx, args)
          },
        } satisfies FnSpec,
      ]
    }),
  )
}

export async function validateCleaningAssignee(ctx: Ctx, id: unknown, property: Row | null) {
  if (!id) return
  if (!property || !ctx.manifest.models['user.User']) reject('assigneeId', 'cleaning_assignee')
  const user = await readRecord(ctx, 'user.User', id)
  if (!user || user.active !== true || user.accessKind !== 'internal')
    reject('assigneeId', 'cleaning_assignee')
  const M = ctx.table('user.Membership')
  if (!(await ctx.db.count(from(M).where(eq(M.userId, id), eq(M.companyId, ctx.scope.company)))))
    reject('assigneeId', 'cleaning_assignee')
  if (property.branchId) {
    const B = ctx.table('user.BranchMembership')
    if (!(await ctx.db.count(from(B).where(eq(B.userId, id), eq(B.branchId, property.branchId)))))
      reject('assigneeId', 'cleaning_assignee')
  }
}
