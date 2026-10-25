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

export const listAmenitiesHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const A = ctx.table('hospitality_core.Amenity')
  let query = from(A).where(eq(A.active, true)).orderBy(asc(A.sequence), asc(A.name))
  if (args.scope) query = query.where(eq(A.scope, args.scope))
  return ctx.db.all(query)
}

export const listAmenitiesFunction = defineFn({
  input: { scope: 'text?' },
  output: {
    version: 'int?',
    id: 'id',
    categoryId: 'id?',
    code: 'text',
    name: 'text',
    scope: 'text',
    sequence: 'int',
    active: 'bool',
  },
  effects: ['read:hospitality_core.Amenity'],
  agent: true,
  handler: listAmenitiesHandler,
})
