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

export const savePropertyHandler: FnSpec['handler'] = async (ctx: Ctx, raw) => {
  const current = await record(ctx, 'hospitality_core.Property', raw.id)
  const args = normalized(raw, {
    code: cleanCode(raw.code),
    name: cleanText(raw.name),
    timezone: cleanText(raw.timezone) || 'Asia/Ho_Chi_Minh',
    defaultCheckIn: cleanText(raw.defaultCheckIn) || '14:00',
    defaultCheckOut: cleanText(raw.defaultCheckOut) || '12:00',
    starRating: Number(raw.starRating ?? 0),
    street1: cleanText(raw.street1 ?? raw.street) || null,
    locality: cleanText(raw.locality ?? raw.city) || null,
    postalCode: cleanText(raw.postalCode ?? raw.zip) || null,
    divisionText: cleanText(raw.divisionText ?? raw.state) || null,
    countryCode: countryCodeOf(raw.countryId ?? raw.countryCode ?? raw.country) || null,
    countryId: null as string | null,
    divisionId: raw.divisionId ? String(raw.divisionId) : null,
  })
  const errors: Issue[] = []
  if (!args.branchId) {
    const B = ctx.table('company.Branch')
    const central = await ctx.db.one(from(B).where(eq(B.rootKey, ctx.scope.company), eq(B.active, true)))
    if (central) args.branchId = central.id
  }
  if (!args.branchId) errors.push(issue('branchId', 'required'))
  if (!current && !/^[A-Z0-9][A-Z0-9-]{1,15}$/.test(args.code))
    errors.push(issue('code', 'property_code_format'))
  if (current && current.code !== args.code) errors.push(issue('code', 'immutable_code'))
  if (current) args.active = current.active === true
  if (current && current.timezone !== args.timezone) {
    const R = ctx.table('hospitality_core.Reservation')
    if (await ctx.db.count(from(R).where(eq(R.propertyId, args.id))))
      errors.push(issue('timezone', 'immutable_timezone'))
  }
  if (!args.code) errors.push(issue('code', 'required'))
  if (!args.name) errors.push(issue('name', 'required'))
  if (!isOneOf(ACCOMMODATION_TYPES, args.accommodationType))
    errors.push(issue('accommodationType', 'accommodation_type'))
  if (!isClock(args.defaultCheckIn)) errors.push(issue('defaultCheckIn', 'clock'))
  if (!isClock(args.defaultCheckOut)) errors.push(issue('defaultCheckOut', 'clock'))
  if (!isTimezone(args.timezone)) errors.push(issue('timezone', 'timezone'))
  if (!Number.isInteger(args.starRating) || args.starRating < 0 || args.starRating > 5)
    errors.push(issue('starRating', 'star_rating'))
  if (raw.minimumGuestAge != null && Number(raw.minimumGuestAge) < 0)
    errors.push(issue('minimumGuestAge', 'non_negative'))
  if (await duplicate(ctx, 'hospitality_core.Property', 'code', args.code, args.id))
    errors.push(issue('code', 'unique'))
  if (
    args.defaultCancellationPolicyId &&
    !(await record(ctx, 'hospitality_core.CancellationPolicy', args.defaultCancellationPolicyId))
  )
    errors.push(issue('defaultCancellationPolicyId', 'policy_missing'))
  if (args.branchId && args.branchId !== current?.branchId) {
    const branch = await record(ctx, 'company.Branch', args.branchId)
    if (!branch || branch.companyId !== ctx.scope.company)
      errors.push(issue('branchId', 'branch_company_mismatch'))
    else if (ctx.scope.branches && !ctx.scope.branches.includes(String(branch.id)))
      errors.push(issue('branchId', 'property_scope'))
    else if (branch.active !== true) errors.push(issue('branchId', 'branch_archived'))
  }
  if (args.countryCode && !/^[A-Z]{2}$/.test(args.countryCode))
    errors.push(issue('countryId', 'address.error.countryCode'))
  if (args.countryCode) {
    const C = ctx.table('address.Country')
    const installed = await ctx.db.one(from(C).where(eq(C.id, args.countryCode)))
    if (installed) {
      const checked = await validateAddress(ctx, {
        street1: args.street1,
        street2: args.street2,
        locality: args.locality,
        postalCode: args.postalCode,
        countryId: args.countryCode,
        divisionId: args.divisionId,
      })
      if (checked.issues.length) return { ok: false, errors: checked.issues }
      args.countryId = args.countryCode
    } else if (args.divisionId) {
      return { ok: false, errors: [{ field: 'divisionId', code: 'address.error.catalogNotInstalled' }] }
    }
  }
  if (errors.length) return failure(...errors)
  return catalogueTransaction(ctx, async (tx) => {
    const result = await save(tx, 'hospitality_core.Property', args, writable('Property'), {
      enforceTimes: true,
      // Nightly and hourly are what a hotel sells by default. A weekly or
      // monthly stay is a different contract with its own billing cycle, so
      // the property opts into it rather than discovering it was on.
      allowHourly: true,
      allowWeekly: false,
      allowMonthly: false,
      longStayBillOnCheckIn: true,
      childrenStayFree: false,
      active: true,
      lifecycle: 'setup',
      businessDate: dateKeyIn(new Date(), args.timezone),
      inspectionRequired: false,
    })
    if (result.ok)
      await appendContentChange(tx, {
        propertyId: args.id,
        resourceType: 'property',
        resourceId: args.id,
      })
    return result
  })
}

export const savePropertyFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    branchId: 'id?',
    code: 'text',
    name: 'text',
    publicName: 'text?',
    accommodationType: 'text',
    timezone: 'text?',
    defaultCheckIn: 'text?',
    defaultCheckOut: 'text?',
    enforceTimes: 'bool?',
    allowHourly: 'bool?',
    allowWeekly: 'bool?',
    allowMonthly: 'bool?',
    longStayBillOnCheckIn: 'bool?',
    starRating: 'int?',
    street: 'text?',
    street1: 'text?',
    street2: 'text?',
    city: 'text?',
    locality: 'text?',
    zip: 'text?',
    postalCode: 'text?',
    state: 'text?',
    country: 'text?',
    countryCode: 'text?',
    countryId: 'id?',
    divisionId: 'id?',
    divisionText: 'text?',
    latitude: 'decimal?',
    longitude: 'decimal?',
    description: 'text?',
    houseRules: 'text?',
    childrenStayFree: 'bool?',
    minimumGuestAge: 'int?',
    defaultCancellationPolicyId: 'id?',
  },
  output: result,
  effects: [
    'read:hospitality_core.Reservation',
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.Property',
    'write:hospitality_core.Property',
    'write:hospitality_core.ContentChange',
    'read:hospitality_core.CancellationPolicy',
    'read:company.Branch',
    'read:address.Country',
    'read:address.CurrentCatalog',
    'read:address.Division',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('saveProperty', savePropertyHandler),
})
