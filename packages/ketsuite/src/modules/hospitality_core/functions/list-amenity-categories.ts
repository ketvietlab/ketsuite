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

export const listAmenityCategoriesHandler: FnSpec['handler'] = async (ctx: Ctx) => {
  const C = ctx.table('hospitality_core.AmenityCategory')
  return ctx.db.all(from(C).where(eq(C.active, true)).orderBy(asc(C.sequence)))
}

export const listAmenityCategoriesFunction = defineFn({
  output: { id: 'id', name: 'text', sequence: 'int', active: 'bool' },
  effects: ['read:hospitality_core.AmenityCategory'],
  agent: true,
  handler: listAmenityCategoriesHandler,
})
