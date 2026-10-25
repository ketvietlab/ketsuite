import { catalogueCommand } from './catalogue-shared.ts'
import { asc, defineFn, eq, from, inArray, isTimezone as isKetTimezone } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { resolveAddress, validateAddress } from '../../address/format.ts'
import { addCalendarDays, dateKeyIn } from '../calendar.ts'
import { appendContentChange } from '../content.ts'
import { recordInventoryChange, syncLedgerCapacity } from '../inventory.ts'
import {
  ACCOMMODATION_TYPES,
  AMENITY_SCOPES,
  BED_TYPES,
  CANCELLATION_POLICY_TYPES,
  CONTACT_TYPES,
  ROOM_STATUSES,
  ROOM_VIEW_TYPES,
} from '../types.ts'
import {
  catalogueTransaction,
  followRoomCapacity,
  type Issue,
  issue,
  success,
  failure,
  cleanCode,
  cleanText,
  normalized,
  isClock,
  isTimezone,
  countryCodeOf,
  propertyPresentation,
  isOneOf,
  record,
  RoomStatusGuard,
  LocationLifecycleGuard,
  RoomLifecycleGuard,
  lockActiveFlag,
  duplicate,
  save,
  signalAmenityUsers,
  signalPolicyUsers,
  writable,
  result,
} from './catalogue-shared.ts'

export const setRoomStatusHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  if (!isOneOf(ROOM_STATUSES, args.status)) return failure(issue('status', 'room_status'))
  if (args.expectedStatus && !isOneOf(ROOM_STATUSES, args.expectedStatus))
    return failure(issue('expectedStatus', 'room_status'))
  if (args.status === 'occupied' || args.status === 'cleaning')
    return failure(issue('status', 'room_status_managed'))
  if (args.status === 'available') return failure(issue('status', 'room_status_available_managed'))
  const note = args.note === undefined ? undefined : cleanText(args.note)

  try {
    return await catalogueTransaction(ctx, async (tx) => {
      const room = await record(tx, 'hospitality_core.Room', args.id)
      if (!room) return failure(issue('id', 'room_missing'))
      if (room.active !== true) return failure(issue('id', 'room_archived'))
      if (args.expectedStatus && room.status !== args.expectedStatus)
        return failure(issue('status', 'transition_conflict'))
      if (room.status === args.status) return { ok: true, id: args.id, status: args.status, errors: [] }
      if ((args.status === 'maintenance' || args.status === 'out_of_order') && !note)
        return failure(issue('note', 'room_status_note_required'))
      if (room.status === 'occupied') return failure(issue('status', 'room_occupied'))
      if (room.status === 'cleaning') return failure(issue('status', 'room_cleaning'))

      const S = tx.table('hospitality_core.Stay')
      const currentStay = await tx.db.one(
        from(S).where(eq(S.currentRoomId, args.id), eq(S.state, 'checked_in')).limit(1),
      )
      if (currentStay) return failure(issue('status', 'room_occupied'))

      const changed = await tx.db.compareAndSet(
        'hospitality_core.Room',
        { id: args.id },
        { status: room.status, active: true },
        {
          status: args.status,
          ...(note !== undefined ? { note: note || null } : {}),
        },
      )
      if (!('matched' in changed) || !changed.matched) return failure(issue('status', 'transition_conflict'))

      const T = tx.table('hospitality_core.CleaningTask')
      const activeTask = await tx.db.one(
        from(T)
          .where(eq(T.roomId, args.id), inArray(T.state, ['todo', 'in_progress']))
          .limit(1),
      )
      if (activeTask) throw new RoomStatusGuard(issue('status', 'room_task_open'))
      // A burst pipe does not wait for the booking calendar, so taking a room
      // out of service is never refused. It does shrink capacity, and any date
      // that is now oversold comes back for the front desk to resolve.
      const overcommitted = await followRoomCapacity(tx, room.propertyId, room.roomTypeId)
      return {
        ok: true,
        id: args.id,
        status: args.status,
        overcommitted: overcommitted.map((entry) => entry.date),
        errors: [],
      }
    })
  } catch (error) {
    if (error instanceof RoomStatusGuard) return failure(error.problem)
    throw error
  }
}

export const setRoomStatusFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    expectedStatus: 'text?',
    status: 'text',
    note: 'text?',
  },
  output: { ok: 'bool', id: 'id?', status: 'text?', overcommitted: 'json?', errors: 'json?' },
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Room',
    'read:hospitality_core.Stay',
    'read:hospitality_core.CleaningTask',
    'write:hospitality_core.Room',
    'read:hospitality_core.Property',
    'read:hospitality_core.AvailabilityLedger',
    'write:hospitality_core.AvailabilityLedger',
    'write:hospitality_core.InventoryChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('setRoomStatus', setRoomStatusHandler),
})
