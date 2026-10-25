import { asc, defineFn, eq, from, inArray, isTimezone as isKetTimezone } from '@ketvietlab/ketjs'
import { claimVersion, hasPropertyScope, runCommand } from './command.ts'
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

export const followRoomCapacity = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
): Promise<{ date: string; committed: number; total: number }[]> => {
  const Property = ctx.table('hospitality_core.Property')
  const property = await ctx.db.one(from(Property).where(eq(Property.id, propertyId)))
  const today = dateKeyIn(new Date(), String(property?.timezone ?? 'UTC'))
  const synced = await syncLedgerCapacity(ctx, propertyId, roomTypeId, today)
  if (synced.changed)
    await recordInventoryChange(ctx, {
      propertyId,
      roomTypeId,
      kind: 'availability',
      dateFrom: today,
      dateTo: addCalendarDays(today, 365),
    })
  return synced.overcommitted
}

export type Issue = { field: string; code: string; messageKey: string; params?: Record<string, unknown> }

export const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  messageKey: `hospitality_core.validation.${code}`,
  ...(params ? { params } : {}),
})

export const success = (id: unknown) => ({ ok: true, id: String(id), errors: [] })

export const failure = (...errors: Issue[]) => ({ ok: false, errors })

export const cleanCode = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toUpperCase()

export const cleanText = (value: unknown): string => String(value ?? '').trim()

export const normalized = <T extends Record<string, unknown>>(
  raw: Record<string, unknown>,
  values: T,
): Record<string, unknown> & T => ({ ...raw, ...values })

export const isClock = (value: unknown): boolean => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))

export const isTimezone = (value: unknown): boolean => isKetTimezone(String(value))

export const countryCodeOf = (value: unknown): string => {
  const country = cleanText(value)
  if (/^vi(?:ệ|e)t\s*nam$/iu.test(country)) return 'VN'
  return country.toUpperCase()
}

export const propertyPresentation = async (ctx: Ctx, row: Row): Promise<Row> => {
  let oneLine = [row.street1, row.street2, row.divisionText, row.locality, row.postalCode, row.countryCode]
    .filter(Boolean)
    .join(', ')
  let divisions: Row[] = []
  if (row.countryId) {
    const resolved = await resolveAddress(ctx, {
      street1: row.street1,
      street2: row.street2,
      locality: row.locality,
      postalCode: row.postalCode,
      countryId: row.countryId,
      divisionId: row.divisionId,
    })
    if (resolved.value) {
      oneLine = resolved.value.oneLine
      divisions = resolved.value.divisions
    }
  }
  return {
    ...row,
    addressLine: oneLine,
    city: divisions.at(-1)?.officialName ?? row.locality ?? row.divisionText ?? null,
    country: row.countryCode ?? null,
  }
}

export const isOneOf = (values: readonly string[], value: unknown): boolean => values.includes(String(value))

export const record = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> => {
  const table = ctx.table(model)
  let query = from(table).where(eq(table.id, id))
  if (table.$columns.includes('companyId') && ctx.scope.company)
    query = query.where(eq(table.companyId!, ctx.scope.company))
  return ctx.db.one(query)
}

export class RoomStatusGuard extends Error {
  readonly problem: Issue

  constructor(problem: Issue) {
    super(problem.code)
    this.problem = problem
  }
}

export class LocationLifecycleGuard extends Error {
  readonly problem: Issue

  constructor(problem: Issue) {
    super(problem.code)
    this.problem = problem
  }
}

export class RoomLifecycleGuard extends Error {
  readonly problem: Issue

  constructor(problem: Issue) {
    super(problem.code)
    this.problem = problem
  }
}

export const lockActiveFlag = async (ctx: Ctx, model: string, row: Row): Promise<boolean> => {
  const active = row.active === true
  const locked = await ctx.db.compareAndSet(model, { id: row.id }, { active }, { active })
  return 'matched' in locked && locked.matched
}

export const duplicate = async (
  ctx: Ctx,
  model: string,
  field: string,
  value: unknown,
  exceptId: unknown,
  parent?: [string, unknown],
): Promise<boolean> => {
  const table = ctx.table(model)
  let query = from(table).where(eq(table[field]!, value))
  if (parent) query = query.where(eq(table[parent[0]]!, parent[1]))
  const rows = await ctx.db.all(query)
  return rows.some((row) => row.id !== exceptId)
}

export const save = async (
  ctx: Ctx,
  model: string,
  args: Record<string, unknown>,
  fields: string[],
  defaults: Record<string, unknown> = {},
) => {
  const existing = await record(ctx, model, args.id)
  if (!existing && Number(args.expectedVersion ?? 0) > 0)
    return failure(issue('expectedVersion', 'transition_conflict'))
  if (model === 'hospitality_core.Property') {
    if (existing && !hasPropertyScope(ctx, existing)) return failure(issue('propertyId', 'property_scope'))
  } else if (args.propertyId || existing?.propertyId) {
    const property = await record(ctx, 'hospitality_core.Property', args.propertyId ?? existing?.propertyId)
    if (!property || !hasPropertyScope(ctx, property)) return failure(issue('propertyId', 'property_scope'))
  }
  // An optional field that was not supplied is absent, not invalid. Casting an
  // explicit `undefined` failed the whole write, so leaving one blank in an
  // admin form rejected the record instead of leaving the column alone.
  // `null` still means "clear it".
  const supplied = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined))
  let changes = ctx.change(model, supplied, existing).cast(fields)
  if (!existing)
    for (const [key, value] of Object.entries(defaults))
      if (!(key in args) || args[key] == null) changes = changes.put(key, value)
  if (!changes.valid) return { ok: false, errors: changes.errors }
  const versioned = [
    'Property',
    'RoomType',
    'Room',
    'Building',
    'Floor',
    'Amenity',
    'CancellationPolicy',
  ].includes(model.split('.').at(-1)!)
  if (versioned && existing) await claimVersion(ctx, model, existing, args.expectedVersion)
  await ctx.db.commit(changes, existing ? { id: args.id } : undefined)
  if (versioned && !existing) await ctx.db.update(model, { id: args.id }, { version: 1 })
  return success(args.id)
}

export const signalAmenityUsers = async (ctx: Ctx, amenityId: unknown): Promise<void> => {
  const PropertyAmenity = ctx.table('hospitality_core.PropertyAmenity')
  const RoomTypeAmenity = ctx.table('hospitality_core.RoomTypeAmenity')
  const propertyAssignments = await ctx.db.all(
    from(PropertyAmenity).where(eq(PropertyAmenity.amenityId, amenityId)),
  )
  const roomAssignments = await ctx.db.all(
    from(RoomTypeAmenity).where(eq(RoomTypeAmenity.amenityId, amenityId)),
  )
  for (const assignment of propertyAssignments)
    await appendContentChange(ctx, {
      propertyId: assignment.propertyId,
      resourceType: 'property',
      resourceId: assignment.propertyId,
    })
  for (const assignment of roomAssignments) {
    const roomType = await record(ctx, 'hospitality_core.RoomType', assignment.roomTypeId)
    if (roomType)
      await appendContentChange(ctx, {
        propertyId: roomType.propertyId,
        resourceType: 'room_type',
        resourceId: roomType.id,
      })
  }
}

export const signalPolicyUsers = async (ctx: Ctx, policyId: unknown): Promise<void> => {
  const Property = ctx.table('hospitality_core.Property')
  const RoomType = ctx.table('hospitality_core.RoomType')
  const properties = await ctx.db.all(
    from(Property).where(eq(Property.defaultCancellationPolicyId, policyId)),
  )
  const roomTypes = await ctx.db.all(from(RoomType).where(eq(RoomType.cancellationPolicyId, policyId)))
  for (const property of properties)
    await appendContentChange(ctx, {
      propertyId: property.id,
      resourceType: 'property',
      resourceId: property.id,
    })
  for (const roomType of roomTypes)
    await appendContentChange(ctx, {
      propertyId: roomType.propertyId,
      resourceType: 'room_type',
      resourceId: roomType.id,
    })
}

export const writable = (name: string): string[] =>
  ({
    Property: [
      'id',
      'branchId',
      'code',
      'name',
      'publicName',
      'accommodationType',
      'timezone',
      'defaultCheckIn',
      'defaultCheckOut',
      'enforceTimes',
      'allowHourly',
      'allowWeekly',
      'allowMonthly',
      'longStayBillOnCheckIn',
      'starRating',
      'street1',
      'street2',
      'locality',
      'postalCode',
      'countryCode',
      'countryId',
      'divisionId',
      'divisionText',
      'latitude',
      'longitude',
      'description',
      'houseRules',
      'childrenStayFree',
      'minimumGuestAge',
      'defaultCancellationPolicyId',
    ],
    Building: ['id', 'propertyId', 'code', 'name', 'sequence'],
    Floor: ['id', 'propertyId', 'buildingId', 'code', 'name', 'sequence', 'level'],
    RoomType: [
      'id',
      'propertyId',
      'code',
      'name',
      'nameKey',
      'publicName',
      'description',
      'defaultCapacity',
      'maxAdults',
      'maxChildren',
      'maxInfants',
      'maxExtraBeds',
      'sizeSqm',
      'viewType',
      'sharedBathroom',
      'allowHourly',
      'allowWeekly',
      'allowMonthly',
      'minHourlyHours',
      'baseRate',
      'color',
      'cancellationPolicyId',
      'published',
    ],
    Room: ['id', 'propertyId', 'roomTypeId', 'buildingId', 'floorId', 'code', 'name', 'capacity'],
  })[name] ?? []

export const result = { ok: 'bool', id: 'id?', errors: 'json?' }

export const catalogueCommand =
  (action: string, handler: FnSpec['handler']): FnSpec['handler'] =>
  (ctx, args) =>
    runCommand(ctx, args, action, async (tx) => {
      const value = (await handler(tx, args)) as Record<string, unknown>
      return { ...value, ok: value.ok === undefined ? true : value.ok === true }
    })

/** Named catalogue handlers already run inside the receipt owner's transaction. */
export const catalogueTransaction = <T>(ctx: Ctx, run: (tx: Ctx) => Promise<T>): Promise<T> => run(ctx)
