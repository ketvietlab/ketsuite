import { catalogueCommand } from './catalogue-shared.ts'
import { asc, defineFn, eq, from, inArray, isTimezone as isKetTimezone } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { claimVersion, propertyAccess } from './command.ts'
import { propertyReadiness } from './property-operations.ts'
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
  catalogueTransaction,
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

export const archivePropertyHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const property = await propertyAccess(ctx, args.id)
  const readiness = await propertyReadiness(ctx, property.id)
  if (args.active === false && (readiness.staying || readiness.upcoming))
    return failure(issue('active', 'property_stop_blocked'))
  if (args.active === true && (!readiness.types || !readiness.rooms || !readiness.rates))
    return failure(issue('active', 'property_open_blocked'))
  await catalogueTransaction(ctx, async (tx) => {
    await claimVersion(tx, 'hospitality_core.Property', property, args.expectedVersion)
    await tx.db.update('hospitality_core.Property', { id: args.id }, {
      active: args.active,
      lifecycle: args.active ? 'active' : 'stopped',
    } as Row)
    await appendContentChange(tx, {
      propertyId: args.id,
      resourceType: 'property',
      resourceId: args.id,
      kind: args.active ? 'upsert' : 'archive',
    })
  })
  return args
}

export const archivePropertyFunction = defineFn({
  input: { requestKey: 'text?', expectedVersion: 'int?', id: 'id', active: 'bool' },
  output: { ok: 'bool', id: 'id?', active: 'bool?', errors: 'json?' },
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Property',
    'read:hospitality_core.RoomType',
    'read:hospitality_core.Room',
    'read:hospitality_core.RatePlan',
    'read:hospitality_core.Reservation',
    'read:hospitality_core.Stay',
    'write:hospitality_core.Property',
    'write:hospitality_core.ContentChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('archiveProperty', archivePropertyHandler),
})
