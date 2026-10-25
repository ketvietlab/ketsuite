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

export const getRoomHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const R = ctx.table('hospitality_core.Room')
  return ctx.db.one(from(R).where(eq(R.id, args.id)).preload('property', 'roomType', 'building', 'floor'))
}

export const getRoomFunction = defineFn({
  input: { id: 'id' },
  output: {
    version: 'int?',
    id: 'id',
    propertyId: 'id',
    roomTypeId: 'id',
    buildingId: 'id?',
    floorId: 'id?',
    code: 'text',
    name: 'text',
    capacity: 'int',
    status: 'text',
    note: 'text?',
    active: 'bool',
    property: 'json?',
    roomType: 'json?',
    building: 'json?',
    floor: 'json?',
  },
  effects: [
    'read:hospitality_core.Room',
    'read:hospitality_core.Property',
    'read:hospitality_core.RoomType',
    'read:hospitality_core.Building',
    'read:hospitality_core.Floor',
  ],
  agent: true,
  handler: getRoomHandler,
})
