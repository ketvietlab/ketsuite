import { catalogueCommand } from './catalogue-shared.ts'
import { asc, defineFn, eq, from, inArray, isTimezone as isKetTimezone } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { claimVersion, propertyAccess } from './command.ts'
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

export const archiveRoomHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  try {
    return await catalogueTransaction(ctx, async (tx) => {
      const room = await record(tx, 'hospitality_core.Room', args.id)
      if (!room) return failure(issue('id', 'room_missing'))
      if (room.active === args.active) return success(args.id)
      await propertyAccess(tx, room.propertyId)
      const B = tx.table('hospitality_core.RoomBlock')
      if (await tx.db.count(from(B).where(eq(B.roomId, room.id), eq(B.state, 'active'))))
        return failure(issue('id', 'room_block_overlap'))
      await claimVersion(tx, 'hospitality_core.Room', room, args.expectedVersion)

      if (args.active) {
        const property = await record(tx, 'hospitality_core.Property', room.propertyId)
        if (!property) return failure(issue('propertyId', 'property_missing'))
        if (property.active !== true) return failure(issue('propertyId', 'property_archived'))
        const roomType = await record(tx, 'hospitality_core.RoomType', room.roomTypeId)
        if (!roomType) return failure(issue('roomTypeId', 'room_type_missing'))
        if (roomType.active !== true) return failure(issue('roomTypeId', 'room_type_archived'))

        const building = room.buildingId
          ? await record(tx, 'hospitality_core.Building', room.buildingId)
          : null
        if (room.buildingId && !building) return failure(issue('buildingId', 'building_missing'))
        if (building && building.active !== true) return failure(issue('buildingId', 'location_archived'))
        if (building && !(await lockActiveFlag(tx, 'hospitality_core.Building', building)))
          return failure(issue('buildingId', 'transition_conflict'))

        const floor = room.floorId ? await record(tx, 'hospitality_core.Floor', room.floorId) : null
        if (room.floorId && !floor) return failure(issue('floorId', 'floor_missing'))
        if (floor && floor.active !== true) return failure(issue('floorId', 'location_archived'))
        if (floor && !(await lockActiveFlag(tx, 'hospitality_core.Floor', floor)))
          return failure(issue('floorId', 'transition_conflict'))

        const restored = await tx.db.compareAndSet(
          'hospitality_core.Room',
          { id: args.id },
          { active: false, status: room.status },
          { active: true, status: 'dirty', lastCleanedAt: null },
        )
        if (!('matched' in restored) || !restored.matched) return failure(issue('id', 'transition_conflict'))
        await followRoomCapacity(tx, room.propertyId, room.roomTypeId)
        return success(args.id)
      }

      const A = tx.table('hospitality_core.RoomAssignment')
      if (
        await tx.db.count(
          from(A).where(
            eq(A.companyId!, tx.scope.company),
            eq(A.roomId, room.id),
            inArray(A.state, ['held', 'active']),
          ),
        )
      )
        return failure(issue('id', 'room_held'))
      if (room.status === 'occupied') return failure(issue('id', 'room_archive_status'))
      const archived = await tx.db.compareAndSet(
        'hospitality_core.Room',
        { id: args.id },
        { active: true, status: room.status },
        { active: false },
      )
      if (!('matched' in archived) || !archived.matched) return failure(issue('id', 'transition_conflict'))

      const S = tx.table('hospitality_core.Stay')
      const activeStay = await tx.db.one(
        from(S).where(eq(S.currentRoomId, args.id), eq(S.state, 'checked_in')).limit(1),
      )
      if (activeStay) throw new RoomLifecycleGuard(issue('id', 'room_has_active_stay'))
      const T = tx.table('hospitality_core.CleaningTask')
      const activeTask = await tx.db.one(
        from(T)
          .where(eq(T.roomId, args.id), inArray(T.state, ['todo', 'in_progress']))
          .limit(1),
      )
      if (activeTask) throw new RoomLifecycleGuard(issue('id', 'room_has_open_task'))
      // Retiring a room shrinks what the room type can sell. Refusing is the
      // only honest answer while future nights are already committed against it.
      const overcommitted = await followRoomCapacity(tx, room.propertyId, room.roomTypeId)
      const first = overcommitted[0]
      if (first)
        throw new RoomLifecycleGuard(
          issue('id', 'room_archive_would_oversell', {
            date: first.date,
            committed: first.committed,
            total: first.total,
            count: overcommitted.length,
          }),
        )
      return success(args.id)
    })
  } catch (error) {
    if (error instanceof RoomLifecycleGuard) return failure(error.problem)
    throw error
  }
}

export const archiveRoomFunction = defineFn({
  input: { requestKey: 'text?', expectedVersion: 'int?', id: 'id', active: 'bool' },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Property',
    'read:hospitality_core.RoomType',
    'read:hospitality_core.Building',
    'read:hospitality_core.Floor',
    'read:hospitality_core.Room',
    'read:hospitality_core.RoomBlock',
    'read:hospitality_core.Stay',
    'read:hospitality_core.CleaningTask',
    'write:hospitality_core.Building',
    'write:hospitality_core.Floor',
    'write:hospitality_core.Room',
    'read:hospitality_core.AvailabilityLedger',
    'write:hospitality_core.AvailabilityLedger',
    'write:hospitality_core.InventoryChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('archiveRoom', archiveRoomHandler),
})
