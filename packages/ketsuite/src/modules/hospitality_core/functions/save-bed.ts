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

export const saveBedHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const errors: Issue[] = []
  const roomType = await record(ctx, 'hospitality_core.RoomType', args.roomTypeId)
  if (!roomType) errors.push(issue('roomTypeId', 'room_type_missing'))
  if (!isOneOf(BED_TYPES, args.type)) errors.push(issue('type', 'bed_type'))
  if (!Number.isInteger(Number(args.quantity)) || Number(args.quantity) < 1)
    errors.push(issue('quantity', 'positive'))
  if (errors.length) return failure(...errors)
  return catalogueTransaction(ctx, async (tx) => {
    const result = await save(tx, 'hospitality_core.Bed', args, [
      'id',
      'roomTypeId',
      'type',
      'quantity',
      'roomName',
    ])
    if (result.ok && roomType)
      await appendContentChange(tx, {
        propertyId: roomType.propertyId,
        resourceType: 'room_type',
        resourceId: args.roomTypeId,
      })
    return result
  })
}

export const saveBedFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    roomTypeId: 'id',
    type: 'text',
    quantity: 'int',
    roomName: 'text?',
  },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.RoomType',
    'read:hospitality_core.Bed',
    'write:hospitality_core.Bed',
    'write:hospitality_core.ContentChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('saveBed', saveBedHandler),
})
