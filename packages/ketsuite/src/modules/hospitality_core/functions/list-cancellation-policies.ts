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

export const listCancellationPoliciesHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const P = ctx.table('hospitality_core.CancellationPolicy')
  let query = from(P).orderBy(asc(P.name))
  if (args.includeArchived !== true) query = query.where(eq(P.active, true))
  return ctx.db.all(query)
}

export const listCancellationPoliciesFunction = defineFn({
  input: { includeArchived: 'bool?' },
  output: {
    version: 'int?',
    id: 'id',
    code: 'text',
    name: 'text',
    type: 'text',
    feeRule: 'text?',
    description: 'text?',
    freeCancellationHours: 'int',
    penaltyPercent: 'decimal',
    active: 'bool',
  },
  effects: ['read:hospitality_core.CancellationPolicy'],
  agent: true,
  handler: listCancellationPoliciesHandler,
})
