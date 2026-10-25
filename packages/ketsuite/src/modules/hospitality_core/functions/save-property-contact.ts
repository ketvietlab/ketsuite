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

export const savePropertyContactHandler: FnSpec['handler'] = async (ctx: Ctx, raw) => {
  const args = normalized(raw, { name: cleanText(raw.name) })
  const errors: Issue[] = []
  if (!(await record(ctx, 'hospitality_core.Property', args.propertyId)))
    errors.push(issue('propertyId', 'property_missing'))
  if (!args.name) errors.push(issue('name', 'required'))
  if (!isOneOf(CONTACT_TYPES, args.type)) errors.push(issue('type', 'contact_type'))
  if (
    await duplicate(ctx, 'hospitality_core.PropertyContact', 'type', args.type, args.id, [
      'propertyId',
      args.propertyId,
    ])
  )
    errors.push(issue('type', 'unique'))
  if (errors.length) return failure(...errors)
  return catalogueTransaction(ctx, async (tx) => {
    const result = await save(tx, 'hospitality_core.PropertyContact', args, [
      'id',
      'propertyId',
      'type',
      'name',
      'email',
      'phone',
    ])
    if (result.ok)
      await appendContentChange(tx, {
        propertyId: args.propertyId,
        resourceType: 'property',
        resourceId: args.propertyId,
      })
    return result
  })
}

export const savePropertyContactFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    propertyId: 'id',
    type: 'text',
    name: 'text',
    email: 'text?',
    phone: 'text?',
  },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Property',
    'read:hospitality_core.PropertyContact',
    'write:hospitality_core.PropertyContact',
    'write:hospitality_core.ContentChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('savePropertyContact', savePropertyContactHandler),
})
