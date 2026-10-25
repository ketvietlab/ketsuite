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

export const saveCancellationPolicyHandler: FnSpec['handler'] = async (ctx: Ctx, raw) => {
  const args = normalized(raw, {
    code: cleanCode(raw.code),
    feeRule:
      raw.feeRule ??
      (raw.id ? (await record(ctx, 'hospitality_core.CancellationPolicy', raw.id))?.feeRule : null) ??
      'percentage',
    name: cleanText(raw.name),
    freeCancellationHours: Number(raw.freeCancellationHours ?? 0),
    penaltyPercent: String(raw.penaltyPercent ?? '0'),
  })
  const errors: Issue[] = []
  if (!['percentage', 'template'].includes(String(args.feeRule)))
    errors.push(issue('feeRule', 'cancellation_fee_rule'))
  if (!args.code) errors.push(issue('code', 'required'))
  if (!args.name) errors.push(issue('name', 'required'))
  if (!isOneOf(CANCELLATION_POLICY_TYPES, args.type)) errors.push(issue('type', 'cancellation_policy_type'))
  if (args.freeCancellationHours < 0) errors.push(issue('freeCancellationHours', 'non_negative'))
  if (Number(args.penaltyPercent) < 0 || Number(args.penaltyPercent) > 100)
    errors.push(issue('penaltyPercent', 'percentage'))
  if (await duplicate(ctx, 'hospitality_core.CancellationPolicy', 'code', args.code, args.id))
    errors.push(issue('code', 'unique'))
  if (errors.length) return failure(...errors)
  return catalogueTransaction(ctx, async (tx) => {
    const result = await save(
      tx,
      'hospitality_core.CancellationPolicy',
      args,
      ['id', 'code', 'name', 'type', 'feeRule', 'description', 'freeCancellationHours', 'penaltyPercent'],
      { active: true },
    )
    if (result.ok) await signalPolicyUsers(tx, args.id)
    return result
  })
}

export const saveCancellationPolicyFunction = defineFn({
  input: {
    requestKey: 'text?',
    expectedVersion: 'int?',
    id: 'id',
    code: 'text',
    name: 'text',
    type: 'text',
    feeRule: 'text?',
    description: 'text?',
    freeCancellationHours: 'int?',
    penaltyPercent: 'decimal?',
  },
  output: result,
  effects: [
    'read:hospitality_core.CommandReceipt',
    'write:hospitality_core.CommandReceipt',
    'read:hospitality_core.CancellationPolicy',
    'read:hospitality_core.Property',
    'read:hospitality_core.RoomType',
    'write:hospitality_core.CancellationPolicy',
    'write:hospitality_core.ContentChange',
  ],
  idempotent: true,
  agent: true,
  handler: catalogueCommand('saveCancellationPolicy', saveCancellationPolicyHandler),
})
