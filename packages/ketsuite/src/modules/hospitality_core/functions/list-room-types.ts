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

export const listRoomTypesHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const T = ctx.table('hospitality_core.RoomType')
  let query = from(T).orderBy(asc(T.name)).preload('rooms', 'beds')
  if (args.propertyId) query = query.where(eq(T.propertyId, args.propertyId))
  if (args.includeArchived !== true) query = query.where(eq(T.active, true))
  return ctx.db.all(query)
}

export const listRoomTypesFunction = defineFn({
  input: { propertyId: 'id?', includeArchived: 'bool?' },
  output: {
    version: 'int?',
    id: 'id',
    propertyId: 'id',
    code: 'text',
    name: 'text',
    publicName: 'text?',
    description: 'text?',
    defaultCapacity: 'int',
    maxAdults: 'int',
    maxChildren: 'int',
    maxInfants: 'int',
    maxExtraBeds: 'int',
    sizeSqm: 'decimal?',
    viewType: 'text?',
    sharedBathroom: 'bool',
    allowHourly: 'bool',
    allowWeekly: 'bool',
    allowMonthly: 'bool',
    minHourlyHours: 'int',
    baseRate: 'decimal',
    published: 'bool',
    active: 'bool',
    rooms: 'json?',
    beds: 'json?',
  },
  effects: ['read:hospitality_core.RoomType', 'read:hospitality_core.Room', 'read:hospitality_core.Bed'],
  agent: true,
  handler: listRoomTypesHandler,
})
