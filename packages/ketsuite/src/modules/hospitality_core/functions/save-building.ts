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

export const saveBuildingHandler: FnSpec['handler'] = async (ctx: Ctx, raw) => {
  const current = await record(ctx, 'hospitality_core.Building', raw.id)
  const args = normalized(raw, {
    code: cleanCode(raw.code),
    name: cleanText(raw.name),
    sequence: Number(raw.sequence ?? 10),
  })
  const errors: Issue[] = []
  if (current && raw.active !== undefined && raw.active !== current.active)
    errors.push(issue('active', 'location_lifecycle_command'))
  if (!(await record(ctx, 'hospitality_core.Property', args.propertyId)))
    errors.push(issue('propertyId', 'property_missing'))
  if (current && current.propertyId !== args.propertyId) errors.push(issue('propertyId', 'property_mismatch'))
  if (!args.code) errors.push(issue('code', 'required'))
  if (!args.name) errors.push(issue('name', 'required'))
  if (!Number.isInteger(args.sequence) || args.sequence < 1 || args.sequence > 999)
    errors.push(issue('sequence', 'structure_sequence'))
  if (
    await duplicate(ctx, 'hospitality_core.Building', 'code', args.code, args.id, [
      'propertyId',
      args.propertyId,
    ])
  )
    errors.push(issue('code', 'unique'))
  if (errors.length) return failure(...errors)
  return save(ctx, 'hospitality_core.Building', args, writable('Building'), { active: true })
}

export const saveBuildingFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    propertyId: 'id',
    code: 'text',
    name: 'text',
    sequence: 'int?',
  },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Property',
    'read:hospitality_core.Building',
    'write:hospitality_core.Building',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('saveBuilding', saveBuildingHandler),
})
