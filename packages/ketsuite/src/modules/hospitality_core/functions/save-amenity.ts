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

export const saveAmenityHandler: FnSpec['handler'] = async (ctx: Ctx, raw) => {
  const args = normalized(raw, {
    code: cleanCode(raw.code),
    name: cleanText(raw.name),
    sequence: Number(raw.sequence ?? 10),
  })
  const errors: Issue[] = []
  if (args.categoryId && !(await record(ctx, 'hospitality_core.AmenityCategory', args.categoryId)))
    errors.push(issue('categoryId', 'amenity_category_missing'))
  if (!args.code) errors.push(issue('code', 'required'))
  if (!args.name) errors.push(issue('name', 'required'))
  if (!isOneOf(AMENITY_SCOPES, args.scope)) errors.push(issue('scope', 'amenity_scope'))
  if (await duplicate(ctx, 'hospitality_core.Amenity', 'code', args.code, args.id))
    errors.push(issue('code', 'unique'))
  if (errors.length) return failure(...errors)
  return catalogueTransaction(ctx, async (tx) => {
    const result = await save(
      tx,
      'hospitality_core.Amenity',
      args,
      ['id', 'categoryId', 'code', 'name', 'scope', 'sequence'],
      { active: true },
    )
    if (result.ok) await signalAmenityUsers(tx, args.id)
    return result
  })
}

export const saveAmenityFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    categoryId: 'id?',
    code: 'text',
    name: 'text',
    scope: 'text',
    sequence: 'int?',
  },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.AmenityCategory',
    'read:hospitality_core.Amenity',
    'read:hospitality_core.PropertyAmenity',
    'read:hospitality_core.RoomTypeAmenity',
    'read:hospitality_core.RoomType',
    'write:hospitality_core.Amenity',
    'write:hospitality_core.ContentChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('saveAmenity', saveAmenityHandler),
})
