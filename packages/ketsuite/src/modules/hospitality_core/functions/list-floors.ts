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

export const listFloorsHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const F = ctx.table('hospitality_core.Floor')
  let query = from(F).where(eq(F.propertyId, args.propertyId))
  if (args.includeArchived !== true) query = query.where(eq(F.active, true))
  if (args.buildingId) query = query.where(eq(F.buildingId, args.buildingId))
  return ctx.db.all(query.orderBy(asc(F.sequence), asc(F.name)).preload('building', 'rooms'))
}

export const listFloorsFunction = defineFn({
  input: { propertyId: 'id', buildingId: 'id?', includeArchived: 'bool?' },
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
    building: 'json?',
    rooms: 'json?',
  },
  effects: ['read:hospitality_core.Floor', 'read:hospitality_core.Building', 'read:hospitality_core.Room'],
  agent: true,
  handler: listFloorsHandler,
})
