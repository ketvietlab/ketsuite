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

export const listPropertiesHandler: FnSpec['handler'] = async (ctx: Ctx, args) => {
  const P = ctx.table('hospitality_core.Property')
  let query = from(P).orderBy(asc(P.name))
  if (args.includeArchived !== true) query = query.where(eq(P.active, true))
  const properties = await ctx.db.all(query)
  const R = ctx.table('hospitality_core.Room')
  const rooms = await ctx.db.all(from(R).where(eq(R.active, true)))
  const attention = new Set(['dirty', 'cleaning', 'maintenance', 'out_of_order'])
  const counts = new Map<string, { rooms: number; availableRooms: number; attentionRooms: number }>()
  for (const room of rooms) {
    const key = String(room.propertyId)
    const count = counts.get(key) ?? { rooms: 0, availableRooms: 0, attentionRooms: 0 }
    count.rooms++
    if (room.status === 'available') count.availableRooms++
    if (attention.has(String(room.status))) count.attentionRooms++
    counts.set(key, count)
  }
  return Promise.all(
    properties.map(async (property) => {
      const count = counts.get(String(property.id)) ?? {
        rooms: 0,
        availableRooms: 0,
        attentionRooms: 0,
      }
      return {
        ...(await propertyPresentation(ctx, property)),
        ...count,
      }
    }),
  )
}

export const listPropertiesFunction = defineFn({
  input: { includeArchived: 'bool?' },
  output: {
    version: 'int?',
    id: 'id',
    companyId: 'id',
    branchId: 'id?',
    code: 'text',
    name: 'text',
    publicName: 'text?',
    accommodationType: 'text',
    timezone: 'text',
    starRating: 'int',
    city: 'text?',
    country: 'text?',
    addressLine: 'text?',
    active: 'bool',
    rooms: 'int',
    availableRooms: 'int',
    attentionRooms: 'int',
  },
  effects: [
    'read:hospitality_core.Property',
    'read:hospitality_core.Room',
    'read:address.Country',
    'read:address.CurrentCatalog',
    'read:address.Division',
  ],
  agent: true,
  handler: listPropertiesHandler,
})
