import { catalogueCommand } from './catalogue-shared.ts'
import {
  asc,
  defineFn,
  deleteFrom,
  eq,
  from,
  gt,
  ilike,
  likeLiteral,
  or,
  inArray,
  isTimezone as isKetTimezone,
} from '@ketvietlab/ketjs'
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

export const saveRoomTypeHandler: FnSpec['handler'] = async (ctx: Ctx, raw) => {
  const current = await record(ctx, 'hospitality_core.RoomType', raw.id)
  const args = normalized(raw, {
    code: cleanCode(raw.code),
    name: cleanText(raw.name).normalize('NFC'),
    nameKey: cleanText(raw.name).normalize('NFC').toLocaleLowerCase('vi'),
    defaultCapacity: Number(raw.defaultCapacity ?? 2),
    maxAdults: Number(raw.maxAdults ?? raw.defaultCapacity ?? 2),
    maxChildren: Number(raw.maxChildren ?? 0),
    maxInfants: Number(raw.maxInfants ?? 0),
    maxExtraBeds: Number(raw.maxExtraBeds ?? 0),
    minHourlyHours: Number(raw.minHourlyHours ?? current?.minHourlyHours ?? 2),
    baseRate: String(raw.baseRate ?? '0'),
  })
  const errors: Issue[] = []
  const bedType = raw.bedType == null ? null : String(raw.bedType)
  const bedQuantity = Number(raw.bedQuantity)
  if (
    bedType &&
    bedType !== 'keep' &&
    (!isOneOf(BED_TYPES, bedType) ||
      !Number.isSafeInteger(bedQuantity) ||
      bedQuantity < 1 ||
      bedQuantity > 50)
  )
    errors.push(issue('bedType', 'room_type_beds'))
  if (bedType === 'keep' && !current) errors.push(issue('bedType', 'room_type_beds'))
  const amenityIds = raw.amenityIds
  if (
    amenityIds !== undefined &&
    (!Array.isArray(amenityIds) ||
      amenityIds.length > 100 ||
      amenityIds.some((id) => typeof id !== 'string' || !id) ||
      new Set(amenityIds).size !== amenityIds.length)
  )
    errors.push(issue('amenityIds', 'room_type_amenities'))
  if (Array.isArray(amenityIds) && !errors.length) {
    const A = ctx.table('hospitality_core.Amenity'),
      L = ctx.table('hospitality_core.RoomTypeAmenity')
    const selected = amenityIds.length ? await ctx.db.all(from(A).where(inArray(A.id, amenityIds))) : []
    const assigned = current
      ? await ctx.db.all(from(L).select(L.amenityId).where(eq(L.roomTypeId, current.id)).limit(101))
      : []
    if (
      selected.length !== amenityIds.length ||
      selected.some(
        (row) =>
          row.scope !== 'room' ||
          (row.active !== true && !assigned.some((link) => link.amenityId === row.id)),
      )
    )
      errors.push(issue('amenityIds', 'room_type_amenities'))
  }

  if (!(await record(ctx, 'hospitality_core.Property', args.propertyId)))
    errors.push(issue('propertyId', 'property_missing'))
  if (current && current.propertyId !== args.propertyId) errors.push(issue('propertyId', 'property_mismatch'))
  if (
    args.cancellationPolicyId &&
    !(await record(ctx, 'hospitality_core.CancellationPolicy', args.cancellationPolicyId))
  )
    errors.push(issue('cancellationPolicyId', 'policy_missing'))
  if (current && current.code !== args.code) errors.push(issue('code', 'immutable_code'))
  const R = ctx.table('hospitality_core.Room')
  const larger = await ctx.db.count(
    from(R).where(
      eq(R.roomTypeId, args.id),
      eq(R.active, true),
      gt(R.capacity, args.maxAdults + args.maxChildren),
    ),
  )
  if (larger) errors.push(issue('defaultCapacity', 'type_capacity'))
  if (!args.code) errors.push(issue('code', 'required'))
  if (String(args.name).length > 120 || String(args.publicName ?? '').length > 120)
    errors.push(issue('name', 'room_type_name_length'))
  if (String(args.description ?? '').length > 2000)
    errors.push(issue('description', 'room_type_description_length'))
  const Names = ctx.table('hospitality_core.RoomType')
  const sameNames = await ctx.db.all(
    from(Names)
      .select(Names.id)
      .where(
        eq(Names.companyId!, ctx.scope.company),
        eq(Names.propertyId, args.propertyId),
        or(eq(Names.nameKey!, args.nameKey), ilike(Names.name, likeLiteral(String(args.name)), true)),
      )
      .limit(2),
  )
  if (sameNames.some((row) => row.id !== args.id)) errors.push(issue('name', 'room_type_name_unique'))
  if (
    args.sizeSqm != null &&
    (!/^\d+(?:\.\d{1,2})?$/.test(String(args.sizeSqm)) || Number(args.sizeSqm) <= 0)
  )
    errors.push(issue('sizeSqm', 'room_type_area'))
  if (!/^\d+(?:\.0+)?$/.test(String(args.baseRate))) errors.push(issue('baseRate', 'room_type_whole_rate'))
  if (!args.name) errors.push(issue('name', 'required'))
  for (const field of ['defaultCapacity', 'maxAdults', 'maxChildren', 'maxInfants', 'maxExtraBeds'] as const)
    if (!Number.isSafeInteger(args[field]) || args[field] < 0) errors.push(issue(field, 'non_negative'))
  if (args.defaultCapacity < 1) errors.push(issue('defaultCapacity', 'capacity'))
  if (args.maxAdults < 1) errors.push(issue('maxAdults', 'capacity'))
  if (args.defaultCapacity > args.maxAdults + args.maxChildren)
    errors.push(issue('defaultCapacity', 'capacity_total'))
  if (Number(args.baseRate) < 0) errors.push(issue('baseRate', 'non_negative'))
  if (args.sizeSqm != null && Number(args.sizeSqm) <= 0) errors.push(issue('sizeSqm', 'positive'))
  if (args.viewType && !isOneOf(ROOM_VIEW_TYPES, args.viewType)) errors.push(issue('viewType', 'view_type'))
  if (args.color && !/^#[0-9a-f]{6}$/i.test(String(args.color))) errors.push(issue('color', 'color'))
  if (!Number.isInteger(args.minHourlyHours) || args.minHourlyHours < 1)
    errors.push(issue('minHourlyHours', 'positive'))
  if (
    await duplicate(ctx, 'hospitality_core.RoomType', 'code', args.code, args.id, [
      'propertyId',
      args.propertyId,
    ])
  )
    errors.push(issue('code', 'unique'))
  if (errors.length) return failure(...errors)
  return catalogueTransaction(ctx, async (tx) => {
    const result = await save(tx, 'hospitality_core.RoomType', args, writable('RoomType'), {
      sharedBathroom: false,
      allowHourly: true,
      allowWeekly: false,
      allowMonthly: false,
      minHourlyHours: 2,
      published: false,
      active: true,
    })
    if (result.ok && bedType && bedType !== 'keep') {
      const B = tx.table('hospitality_core.Bed')
      // Explicit replacement is atomic with the type, version, receipt and content revision.
      await tx.db.del(deleteFrom(B).where(eq(B.roomTypeId, args.id)))
      await tx.db.insert('hospitality_core.Bed', {
        id: `${String(args.id)}:catalogue-bed`,
        roomTypeId: args.id,
        type: bedType,
        quantity: bedQuantity,
        roomName: null,
      })
    }
    if (result.ok && Array.isArray(amenityIds)) {
      const L = tx.table('hospitality_core.RoomTypeAmenity')
      await tx.db.del(deleteFrom(L).where(eq(L.roomTypeId, args.id)))
      for (const id of amenityIds)
        await tx.db.insert('hospitality_core.RoomTypeAmenity', {
          id: `${String(args.id)}:amenity:${id}`,
          roomTypeId: args.id,
          amenityId: id,
        })
    }
    if (result.ok)
      await appendContentChange(tx, {
        propertyId: args.propertyId,
        resourceType: 'room_type',
        resourceId: args.id,
      })
    return result
  })
}

export const saveRoomTypeFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    propertyId: 'id',
    code: 'text',
    name: 'text',
    publicName: 'text?',
    bedType: 'text?',
    bedQuantity: 'int?',
    amenityIds: 'json?',
    description: 'text?',
    defaultCapacity: 'int?',
    maxAdults: 'int?',
    maxChildren: 'int?',
    maxInfants: 'int?',
    maxExtraBeds: 'int?',
    sizeSqm: 'decimal?',
    viewType: 'text?',
    sharedBathroom: 'bool?',
    allowHourly: 'bool?',
    allowWeekly: 'bool?',
    allowMonthly: 'bool?',
    minHourlyHours: 'int?',
    baseRate: 'decimal?',
    color: 'text?',
    cancellationPolicyId: 'id?',
    published: 'bool?',
  },
  output: result,
  effects: [
    'read:hospitality_core.Room',
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Property',
    'read:hospitality_core.Bed',
    'write:hospitality_core.Bed',
    'read:hospitality_core.Amenity',
    'read:hospitality_core.RoomTypeAmenity',
    'write:hospitality_core.RoomTypeAmenity',
    'read:hospitality_core.RoomType',
    'read:hospitality_core.CancellationPolicy',
    'write:hospitality_core.RoomType',
    'write:hospitality_core.ContentChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('saveRoomType', saveRoomTypeHandler),
})
