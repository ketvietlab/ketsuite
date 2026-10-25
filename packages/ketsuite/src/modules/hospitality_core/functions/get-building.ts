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

export const getBuildingHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const B = ctx.table('hospitality_core.Building')
  const building = await ctx.db.one(from(B).where(eq(B.id, args.id)).preload('property', 'rooms'))
  if (!building) return null
  const F = ctx.table('hospitality_core.Floor')
  const floors = await ctx.db.all(
    from(F)
      .where(eq(F.buildingId, building.id))
      .orderBy(asc(F.sequence), asc(F.name))
      .preload('building', 'rooms'),
  )
  return { ...building, floors }
}

export const getBuildingFunction = defineFn({
  input: { id: 'id' },
  output: {
    version: 'int?',
    id: 'id',
    companyId: 'id',
    propertyId: 'id',
    code: 'text',
    name: 'text',
    sequence: 'int',
    active: 'bool',
    property: 'json?',
    floors: 'json?',
    rooms: 'json?',
  },
  effects: [
    'read:hospitality_core.Building',
    'read:hospitality_core.Property',
    'read:hospitality_core.Floor',
    'read:hospitality_core.Room',
  ],
  agent: true,
  handler: getBuildingHandler,
})
