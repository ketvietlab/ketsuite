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

export const getPropertyHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const P = ctx.table('hospitality_core.Property')
  const row = await ctx.db.one(
    from(P)
      .where(eq(P.id, args.id))
      .preload('buildings', 'floors', 'roomTypes', 'rooms', 'contacts', 'cancellationPolicy'),
  )
  if (!row) return null
  return {
    ...(await propertyPresentation(ctx, row)),
    defaultCancellationPolicy: row.cancellationPolicy ?? null,
  }
}

export const getPropertyFunction = defineFn({
  input: { id: 'id' },
  output: {
    lifecycle: 'text?',
    businessDate: 'date?',
    inspectionRequired: 'bool?',
    version: 'int?',
    id: 'id',
    companyId: 'id',
    branchId: 'id?',
    code: 'text',
    name: 'text',
    publicName: 'text?',
    accommodationType: 'text',
    timezone: 'text',
    defaultCheckIn: 'text',
    defaultCheckOut: 'text',
    enforceTimes: 'bool',
    allowHourly: 'bool',
    allowWeekly: 'bool',
    allowMonthly: 'bool',
    longStayBillOnCheckIn: 'bool?',
    starRating: 'int',
    street1: 'text?',
    street2: 'text?',
    locality: 'text?',
    postalCode: 'text?',
    countryCode: 'text?',
    countryId: 'id?',
    divisionId: 'id?',
    divisionText: 'text?',
    street: 'text?',
    city: 'text?',
    state: 'text?',
    country: 'text?',
    addressLine: 'text?',
    latitude: 'decimal?',
    longitude: 'decimal?',
    description: 'text?',
    houseRules: 'text?',
    childrenStayFree: 'bool',
    minimumGuestAge: 'int?',
    defaultCancellationPolicyId: 'id?',
    defaultCancellationPolicy: 'json?',
    active: 'bool',
    buildings: 'json?',
    floors: 'json?',
    roomTypes: 'json?',
    rooms: 'json?',
    contacts: 'json?',
  },
  effects: [
    'read:hospitality_core.Property',
    'read:hospitality_core.Building',
    'read:hospitality_core.Floor',
    'read:hospitality_core.RoomType',
    'read:hospitality_core.Room',
    'read:hospitality_core.PropertyContact',
    'read:hospitality_core.CancellationPolicy',
    'read:address.Country',
    'read:address.CurrentCatalog',
    'read:address.Division',
  ],
  agent: true,
  handler: getPropertyHandler,
})
