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

export const assignAmenityHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const amenity = await record(ctx, 'hospitality_core.Amenity', args.amenityId)
  if (!amenity) return failure(issue('amenityId', 'amenity_missing'))
  const property = args.target === 'property'
  const roomType = args.target === 'room_type'
  if (!property && !roomType) return failure(issue('target', 'amenity_target'))
  if (property && amenity.scope !== 'property') return failure(issue('amenityId', 'amenity_scope_mismatch'))
  if (roomType && amenity.scope !== 'room') return failure(issue('amenityId', 'amenity_scope_mismatch'))
  const targetModel = property ? 'hospitality_core.Property' : 'hospitality_core.RoomType'
  const targetRecord = await record(ctx, targetModel, args.targetId)
  if (!targetRecord) return failure(issue('targetId', 'target_missing'))
  const model = property ? 'hospitality_core.PropertyAmenity' : 'hospitality_core.RoomTypeAmenity'
  const targetField = property ? 'propertyId' : 'roomTypeId'
  const table = ctx.table(model)
  const existing = await ctx.db.one(
    from(table).where(eq(table[targetField]!, args.targetId), eq(table.amenityId, args.amenityId)),
  )
  if (existing) return success(existing.id)
  return catalogueTransaction(ctx, async (tx) => {
    await tx.db.insert(model, {
      id: args.id,
      [targetField]: args.targetId,
      amenityId: args.amenityId,
    })
    await appendContentChange(tx, {
      propertyId: property ? args.targetId : targetRecord.propertyId,
      resourceType: property ? 'property' : 'room_type',
      resourceId: args.targetId,
    })
    return success(args.id)
  })
}

export const assignAmenityFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    target: 'text',
    targetId: 'id',
    amenityId: 'id',
  },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Amenity',
    'read:hospitality_core.Property',
    'read:hospitality_core.RoomType',
    'read:hospitality_core.PropertyAmenity',
    'read:hospitality_core.RoomTypeAmenity',
    'write:hospitality_core.PropertyAmenity',
    'write:hospitality_core.RoomTypeAmenity',
    'write:hospitality_core.ContentChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('assignAmenity', assignAmenityHandler),
})
