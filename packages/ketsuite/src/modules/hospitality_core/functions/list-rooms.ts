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

export const listRoomsHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const R = ctx.table('hospitality_core.Room')
  let query = from(R).orderBy(asc(R.name)).preload('roomType', 'building', 'floor')
  if (args.propertyId) query = query.where(eq(R.propertyId, args.propertyId))
  if (args.status) query = query.where(eq(R.status, args.status))
  if (args.includeArchived !== true) query = query.where(eq(R.active, true))
  if (args.limit != null) query = query.limit(Math.max(1, Math.min(500, Number(args.limit))))
  return ctx.db.all(query)
}

export const listRoomsFunction = defineFn({
  input: { propertyId: 'id?', status: 'text?', includeArchived: 'bool?', limit: 'int?' },
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
    roomType: 'json?',
    building: 'json?',
    floor: 'json?',
  },
  effects: [
    'read:hospitality_core.Room',
    'read:hospitality_core.RoomType',
    'read:hospitality_core.Building',
    'read:hospitality_core.Floor',
  ],
  agent: true,
  handler: listRoomsHandler,
})
