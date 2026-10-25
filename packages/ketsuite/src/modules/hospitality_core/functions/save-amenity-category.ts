import { catalogueCommand } from './catalogue-shared.ts'
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

export const saveAmenityCategoryHandler: FnSpec['handler'] = async (ctx: Ctx, raw) => {
  const args = normalized(raw, { name: cleanText(raw.name), sequence: Number(raw.sequence ?? 10) })
  if (!args.name) return failure(issue('name', 'required'))
  return save(ctx, 'hospitality_core.AmenityCategory', args, ['id', 'name', 'sequence'], { active: true })
}

export const saveAmenityCategoryFunction = defineFn({
  input: { requestKey: 'text?', expectedVersion: 'int?', id: 'id', name: 'text', sequence: 'int?' },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.AmenityCategory',
    'write:hospitality_core.AmenityCategory',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('saveAmenityCategory', saveAmenityCategoryHandler),
})
