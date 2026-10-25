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

export const saveRoomHandler: FnSpec['handler'] = (ctx: Ctx, raw) =>
  catalogueTransaction(ctx, async (tx) => {
    const current = await record(tx, 'hospitality_core.Room', raw.id)
    const type = await record(tx, 'hospitality_core.RoomType', raw.roomTypeId)
    const floor = raw.floorId ? await record(tx, 'hospitality_core.Floor', raw.floorId) : null
    const buildingId = raw.buildingId || floor?.buildingId || null
    const building = buildingId ? await record(tx, 'hospitality_core.Building', buildingId) : null
    const args = normalized(raw, {
      buildingId,
      floorId: raw.floorId || null,
      code: cleanCode(raw.code),
      name: cleanText(raw.name),
      capacity: Number(raw.capacity ?? type?.defaultCapacity ?? 1),
    })
    const errors: Issue[] = []
    if (
      current &&
      (current.roomTypeId !== args.roomTypeId || Number(args.capacity) < Number(current.capacity))
    ) {
      const A = tx.table('hospitality_core.RoomAssignment')
      if (
        current.status === 'occupied' ||
        (await tx.db.count(
          from(A).where(
            eq(A.companyId!, tx.scope.company),
            eq(A.roomId, current.id),
            inArray(A.state, ['held', 'active']),
          ),
        ))
      )
        errors.push(issue(current.roomTypeId !== args.roomTypeId ? 'roomTypeId' : 'capacity', 'room_held'))
      const B = tx.table('hospitality_core.RoomBlock')
      if (await tx.db.count(from(B).where(eq(B.roomId, current.id), eq(B.state, 'active'))))
        errors.push(issue('roomTypeId', 'room_block_overlap'))
    }
    if (!/^[A-Z0-9._-]{1,20}$/.test(args.code)) errors.push(issue('code', 'room_code_format'))
    if (current && current.code !== args.code) errors.push(issue('code', 'immutable_code'))
    if (type && type.active !== true) errors.push(issue('roomTypeId', 'room_type_archived'))
    const property = await record(tx, 'hospitality_core.Property', args.propertyId)
    if (!property || property.active !== true) errors.push(issue('propertyId', 'property_archived'))
    if (type && Number(args.capacity) > Number(type.maxAdults) + Number(type.maxChildren))
      errors.push(issue('capacity', 'capacity'))
    if (!type) errors.push(issue('roomTypeId', 'room_type_missing'))
    else if (type.propertyId !== args.propertyId) errors.push(issue('roomTypeId', 'property_mismatch'))
    if (!buildingId) errors.push(issue('buildingId', 'required'))
    else if (!building) errors.push(issue('buildingId', 'building_missing'))
    else if (building && building.propertyId !== args.propertyId)
      errors.push(issue('buildingId', 'property_mismatch'))
    else if (building && building.active !== true && current?.buildingId !== building.id)
      errors.push(issue('buildingId', 'location_archived'))
    if (!raw.floorId) errors.push(issue('floorId', 'required'))
    else if (!floor) errors.push(issue('floorId', 'floor_missing'))
    else if (floor && floor.propertyId !== args.propertyId) errors.push(issue('floorId', 'property_mismatch'))
    else if (floor && buildingId && floor.buildingId !== buildingId)
      errors.push(issue('floorId', 'building_mismatch'))
    else if (floor && floor.active !== true && current?.floorId !== floor.id)
      errors.push(issue('floorId', 'location_archived'))
    if (current && current.propertyId !== args.propertyId)
      errors.push(issue('propertyId', 'property_mismatch'))
    if (!args.code) errors.push(issue('code', 'required'))
    if (!args.name) errors.push(issue('name', 'required'))
    if (String(args.name).length > 120) errors.push(issue('name', 'room_name_length'))
    if (!Number.isSafeInteger(args.capacity) || args.capacity < 1) errors.push(issue('capacity', 'capacity'))
    if (raw.status != null) {
      const requestedStatus = String(raw.status)
      if (!isOneOf(ROOM_STATUSES, requestedStatus)) errors.push(issue('status', 'room_status'))
      else if (requestedStatus !== String(current?.status ?? 'dirty'))
        errors.push(issue('status', 'room_status_configuration_managed'))
    }
    if (
      await duplicate(tx, 'hospitality_core.Room', 'code', args.code, args.id, [
        'propertyId',
        args.propertyId,
      ])
    )
      errors.push(issue('code', 'unique'))
    if (errors.length) return failure(...errors)
    if (building && !(await lockActiveFlag(tx, 'hospitality_core.Building', building)))
      return failure(issue('buildingId', 'transition_conflict'))
    if (floor && !(await lockActiveFlag(tx, 'hospitality_core.Floor', floor)))
      return failure(issue('floorId', 'transition_conflict'))
    const configuration = { ...args }
    delete configuration.status
    delete configuration.note
    const saved = await save(tx, 'hospitality_core.Room', configuration, writable('Room'), {
      status: 'dirty',
      note: null,
      active: true,
    })
    if (saved.ok !== true) return saved
    // A new room, or one that moved between types, changes the sellable
    // count on both sides of the move.
    const affected = new Set([String(args.roomTypeId)])
    if (current?.roomTypeId) affected.add(String(current.roomTypeId))
    for (const roomTypeId of affected) {
      const overcommitted = await followRoomCapacity(tx, args.propertyId, roomTypeId)
      const first = overcommitted[0]
      if (first)
        return failure(
          issue('roomTypeId', 'room_type_change_would_oversell', {
            date: first.date,
            committed: first.committed,
            total: first.total,
          }),
        )
    }
    return saved
  })

export const saveRoomFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    propertyId: 'id',
    roomTypeId: 'id',
    buildingId: 'id?',
    floorId: 'id?',
    code: 'text',
    name: 'text',
    capacity: 'int?',
    status: 'text?',
    note: 'text?',
  },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Room',
    'read:hospitality_core.RoomBlock',
    'read:hospitality_core.RoomType',
    'read:hospitality_core.Building',
    'read:hospitality_core.Floor',
    'write:hospitality_core.Building',
    'write:hospitality_core.Floor',
    'write:hospitality_core.Room',
    'read:hospitality_core.Property',
    'read:hospitality_core.AvailabilityLedger',
    'write:hospitality_core.AvailabilityLedger',
    'write:hospitality_core.InventoryChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('saveRoom', saveRoomHandler),
})
