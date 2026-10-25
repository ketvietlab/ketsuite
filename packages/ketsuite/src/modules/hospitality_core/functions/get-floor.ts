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

export const getFloorHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const F = ctx.table('hospitality_core.Floor')
  const floor = await ctx.db.one(from(F).where(eq(F.id, args.id)).preload('property', 'building'))
  if (!floor) return null
  const R = ctx.table('hospitality_core.Room')
  const rooms = await ctx.db.all(
    from(R).where(eq(R.floorId, floor.id)).orderBy(asc(R.name)).preload('roomType', 'building', 'floor'),
  )
  return { ...floor, rooms }
}

export const getFloorFunction = defineFn({
  input: { id: 'id' },
  output: {
    version: 'int?',
    id: 'id',
    propertyId: 'id',
    buildingId: 'id',
    code: 'text',
    name: 'text',
    sequence: 'int',
    level: 'int?',
    active: 'bool',
    property: 'json?',
    building: 'json?',
    rooms: 'json?',
  },
  effects: [
    'read:hospitality_core.Floor',
    'read:hospitality_core.Property',
    'read:hospitality_core.Building',
    'read:hospitality_core.Room',
    'read:hospitality_core.RoomType',
  ],
  agent: true,
  handler: getFloorHandler,
})
