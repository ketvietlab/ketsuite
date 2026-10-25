import {
  asc,
  and,
  defineFn,
  desc,
  eq,
  isNull,
  from,
  gte,
  inArray,
  ilike,
  likeLiteral,
  lt,
  not,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { CLEANING_TASK_STATES, ROOM_STATUSES, STAY_NOTICE_STATES } from '../types.ts'

export type HospitalityCollectionDefinition = {
  fields?: readonly string[]
  enrich?: (ctx: Ctx, rows: Row[]) => Promise<Row[]>
  name: string
  model: string
  search: readonly string[]
  sort: readonly string[]
  defaultSort: string
  defaultDirection?: 'asc' | 'desc'
  state: string
  /** Public work queues may group several persisted recovery states. */
  stateGroups?: Readonly<Record<string, readonly string[]>>
  stateAliases?: Readonly<Record<string, string>>
  /** Disjoint priority buckets are paged in the DB, including an unknown-state tail. */
  prioritySort?: { name: string; groups: readonly (readonly string[])[]; within: string }
  searchText?: (value: string) => string
  booleanState?: { true: string; false: string }
  states: readonly string[]
  property?: string
  date?: string
  preloads?: readonly string[]
  reads?: readonly string[]
}

const active = ['all', 'active', 'inactive'] as const
const listFields: Readonly<Record<string, readonly string[]>> = {
  Property: [
    'id',
    'code',
    'name',
    'publicName',
    'accommodationType',
    'timezone',
    'active',
    'branchId',
    'locality',
    'version',
    'lifecycle',
  ],
  Room: [
    'id',
    'propertyId',
    'roomTypeId',
    'buildingId',
    'floorId',
    'code',
    'name',
    'capacity',
    'status',
    'active',
    'version',
  ],
  RoomType: [
    'id',
    'propertyId',
    'code',
    'name',
    'publicName',
    'defaultCapacity',
    'maxAdults',
    'maxChildren',
    'baseRate',
    'published',
    'active',
    'version',
  ],
  Reservation: [
    'id',
    'code',
    'propertyId',
    'roomTypeId',
    'ratePlanId',
    'folioId',
    'stayId',
    'partnerId',
    'provider',
    'bookingType',
    'checkIn',
    'checkOut',
    'adults',
    'children',
    'roomQuantity',
    'amountTotal',
    'currency',
    'state',
    'version',
  ],
  Stay: [
    'id',
    'code',
    'folioId',
    'reservationId',
    'partnerId',
    'propertyId',
    'roomTypeId',
    'currentRoomId',
    'bookingType',
    'checkIn',
    'checkOut',
    'adults',
    'children',
    'infants',
    'billingMode',
    'rate',
    'state',
    'version',
  ],
  Folio: ['id', 'code', 'propertyId', 'partnerId', 'state', 'amountTotal', 'version', 'openedAt', 'closedAt'],
  Amenity: ['id', 'categoryId', 'code', 'name', 'scope', 'sequence', 'active', 'version'],
  CancellationPolicy: [
    'id',
    'code',
    'name',
    'type',
    'freeCancellationHours',
    'penaltyPercent',
    'active',
    'version',
  ],
  RatePlan: [
    'id',
    'propertyId',
    'roomTypeId',
    'code',
    'name',
    'rateType',
    'amount',
    'mealPlan',
    'minStay',
    'maxStay',
    'isDefault',
    'active',
    'version',
  ],
  CleaningTask: [
    'id',
    'code',
    'propertyId',
    'roomId',
    'stayId',
    'taskType',
    'priority',
    'state',
    'assigneeId',
    'requestedAt',
    'startedAt',
    'doneAt',
    'version',
  ],
  StayNotice: [
    'id',
    'propertyId',
    'stayId',
    'state',
    'reason',
    'dueAt',
    'guestName',
    'documentType',
    'documentLast4',
    'receiptRef',
    'submittedAt',
    'confirmedAt',
    'version',
  ],
}
const relationFields = [
  'id',
  'name',
  'code',
  'publicName',
  'capacity',
  'defaultCapacity',
  'currentRoomId',
  'timezone',
  'state',
  'status',
  'active',
]
export function projectHospitalityCollectionRow(row: Row, definition: HospitalityCollectionDefinition): Row {
  const result: Row = Object.fromEntries(
    (definition.fields ?? listFields[definition.model] ?? [])
      .filter((field) => field in row)
      .map((field) => [field, row[field]]),
  )
  for (const name of definition.preloads ?? []) {
    const related = row[name]
    result[name] =
      related && typeof related === 'object' && !Array.isArray(related)
        ? Object.fromEntries(
            relationFields
              .filter((field) => field in related)
              .map((field) => [field, (related as Row)[field]]),
          )
        : null
  }
  return result
}
/**
 * A stay as a desk row shows it: its list fields and the names of the records it points at. The in-house list has
 * its own read and row (`functions/stay-book.ts`); the front desk queues project stays through this.
 */
export const stayRowProjection: HospitalityCollectionDefinition = {
  name: 'stayRow',
  model: 'Stay',
  search: [],
  sort: [],
  defaultSort: 'checkIn',
  state: 'state',
  states: [],
  preloads: ['partner', 'property', 'roomType', 'currentRoom'],
}
export const hospitalityCollections: readonly HospitalityCollectionDefinition[] = [
  {
    name: 'searchProperties',
    model: 'Property',
    search: ['code', 'name', 'publicName', 'locality'],
    sort: ['name', 'code'],
    defaultSort: 'name',
    state: 'lifecycle',
    states: ['all', 'setup', 'active', 'stopped'],
  },
  {
    name: 'searchRooms',
    model: 'Room',
    search: ['code', 'name'],
    sort: ['code', 'name', 'capacity'],
    defaultSort: 'code',
    state: 'status',
    states: ['all', ...ROOM_STATUSES],
    property: 'propertyId',
    preloads: ['property', 'roomType', 'building', 'floor'],
    reads: ['Property', 'RoomType', 'Building', 'Floor'],
  },
  {
    name: 'searchRoomTypes',
    model: 'RoomType',
    search: ['code', 'name', 'publicName'],
    sort: ['name', 'code', 'baseRate', 'defaultCapacity'],
    defaultSort: 'name',
    state: 'active',
    states: active,
    property: 'propertyId',
    preloads: ['property'],
    reads: ['Property'],
  },
  {
    name: 'searchAmenities',
    model: 'Amenity',
    search: ['code', 'name'],
    sort: ['name', 'code', 'sequence'],
    defaultSort: 'sequence',
    state: 'active',
    states: active,
  },
  {
    name: 'searchPolicies',
    model: 'CancellationPolicy',
    search: ['code', 'name', 'description'],
    sort: ['name', 'code'],
    defaultSort: 'name',
    state: 'active',
    states: active,
  },
  {
    name: 'searchRates',
    model: 'RatePlan',
    search: ['code', 'name'],
    sort: ['name', 'code', 'amount'],
    defaultSort: 'name',
    state: 'active',
    states: active,
    property: 'propertyId',
    preloads: ['property', 'roomType'],
    reads: ['Property', 'RoomType'],
  },
  {
    name: 'searchCleaningTasks',
    model: 'CleaningTask',
    search: ['code', 'notes'],
    sort: ['requestedAt', 'code', 'priority'],
    defaultSort: 'requestedAt',
    state: 'state',
    states: ['all', ...CLEANING_TASK_STATES],
    property: 'propertyId',
    preloads: ['room', 'property'],
    reads: ['Room', 'Property'],
  },
  {
    name: 'searchStayNotices',
    model: 'StayNotice',
    search: ['guestName', 'receiptRef'],
    sort: ['dueAt', 'createdAt'],
    defaultSort: 'dueAt',
    state: 'state',
    states: ['all', ...STAY_NOTICE_STATES],
    property: 'propertyId',
  },
  {
    name: 'searchServices',
    model: 'ExtraLine',
    search: ['description'],
    sort: ['description', 'createdAt', 'unitPrice', 'quantity'],
    defaultSort: 'createdAt',
    state: 'active',
    states: active,
    property: 'propertyId',
    date: 'createdAt',
    fields: [
      'id',
      'propertyId',
      'reservationId',
      'stayId',
      'folioId',
      'productId',
      'description',
      'chargeType',
      'quantity',
      'unitPrice',
      'recurrence',
      'active',
      'createdAt',
    ],
    preloads: ['reservation', 'stay', 'folio'],
    reads: ['Reservation', 'Stay', 'Folio'],
  },
]

const positiveInteger = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback

export function normalizeHospitalityCollectionQuery(
  input: Record<string, unknown>,
  definition: HospitalityCollectionDefinition,
) {
  const requestedState =
    typeof input.state === 'string' ? (definition.stateAliases?.[input.state] ?? input.state) : 'all'
  const state = definition.states.includes(requestedState) ? requestedState : 'all'
  const sort =
    typeof input.sort === 'string' && definition.sort.includes(input.sort)
      ? input.sort
      : definition.defaultSort
  return {
    q: typeof input.q === 'string' ? input.q.trim().slice(0, 200) : '',
    state,
    sort,
    direction:
      input.direction === 'asc' || input.direction === 'desc'
        ? input.direction
        : (definition.defaultDirection ?? 'asc'),
    propertyId:
      definition.property && typeof input.propertyId === 'string' ? input.propertyId.trim() || null : null,
    roomTypeId: typeof input.roomTypeId === 'string' ? input.roomTypeId.trim() || null : null,
    floorId: typeof input.floorId === 'string' ? input.floorId.trim() || null : null,
    from:
      definition.date && typeof input.from === 'string' && Number.isFinite(Date.parse(input.from))
        ? new Date(input.from).toISOString()
        : null,
    to:
      definition.date && typeof input.to === 'string' && Number.isFinite(Date.parse(input.to))
        ? new Date(input.to).toISOString()
        : null,
    page: positiveInteger(input.page, 1),
    pageSize: Math.min(100, positiveInteger(input.pageSize, 25)),
  }
}

/** One bounded page; predicates/counts run in the scoped database, never over a complete collection. */
export async function readHospitalityCollectionPage(
  ctx: Ctx,
  input: Record<string, unknown>,
  definition: HospitalityCollectionDefinition,
) {
  const query = normalizeHospitalityCollectionQuery(input, definition)
  const table = ctx.table(
    definition.model.includes('.') ? definition.model : `hospitality_core.${definition.model}`,
  )
  let scope = from(table)
  if (table.$columns.includes('companyId') && ctx.scope.company)
    scope = scope.where(eq(table.companyId!, ctx.scope.company))
  if (ctx.scope.branches) {
    if (definition.model === 'Property') scope = scope.where(inArray(table.branchId!, ctx.scope.branches))
    else if (definition.property) {
      const P = ctx.table('hospitality_core.Property')
      const allowed = await ctx.db.all(from(P).select(P.id).where(inArray(P.branchId!, ctx.scope.branches)))
      scope = scope.where(
        inArray(
          table[definition.property]!,
          allowed.map((row) => row.id),
        ),
      )
    }
  }
  if (query.propertyId && definition.property)
    scope = scope.where(eq(table[definition.property]!, query.propertyId))
  const isEmpty = (await ctx.db.count(scope)) === 0
  if (query.roomTypeId && table.$columns.includes('roomTypeId'))
    scope = scope.where(eq(table.roomTypeId!, query.roomTypeId))
  if (query.floorId && table.$columns.includes('floorId'))
    scope = scope.where(eq(table.floorId!, query.floorId))
  let base = scope
  if (query.q)
    base = base.where(
      or(
        ...definition.search.map((field) =>
          ilike(table[field]!, `%${likeLiteral(definition.searchText?.(query.q) ?? query.q)}%`, true),
        ),
      ),
    )
  if (query.from && definition.date)
    base = base.where(
      gte(
        table.$columns.includes('checkOut') ? table.checkOut! : table[definition.date]!,
        table[definition.date]!.base === 'date' ? query.from.slice(0, 10) : query.from,
      ),
    )
  if (query.to && definition.date)
    base = base.where(
      lt(table[definition.date]!, table[definition.date]!.base === 'date' ? query.to.slice(0, 10) : query.to),
    )
  const counts: Record<string, number> = { all: await ctx.db.count(base) }
  const stateCondition = (state: string) =>
    definition.stateGroups?.[state]
      ? inArray(table[definition.state]!, [...definition.stateGroups[state]!])
      : definition.model === 'Property'
        ? or(
            eq(table.lifecycle!, state),
            ...(state === 'active' || state === 'stopped'
              ? [and(isNull(table.lifecycle!), eq(table.active!, state === 'active'))]
              : []),
          )
        : eq(
            table[definition.state]!,
            definition.booleanState
              ? state === definition.booleanState.true
              : definition.state === 'active'
                ? state === 'active'
                : state,
          )
  // A finite state vocabulary bounds the facet work independently of row count.
  await Promise.all(
    definition.states
      .filter((state) => state !== 'all')
      .map(async (state) => {
        const value = definition.booleanState
          ? state === definition.booleanState.true
          : definition.state === 'active'
            ? state === 'active'
            : state
        counts[state] = await ctx.db.count(base.where(stateCondition(state)))
      }),
  )
  const selected = query.state === 'all' ? base : base.where(stateCondition(query.state))
  const total = query.state === 'all' ? counts.all! : counts[query.state]!
  const pages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(pages, query.page)
  const order = query.direction === 'desc' ? desc : asc
  const priority = definition.prioritySort
  const load = async (read: ReturnType<typeof from>) => {
    if (definition.preloads?.length) read = read.preload(...definition.preloads)
    return (await ctx.db.all(read)).map((row) => projectHospitalityCollectionRow(row, definition))
  }
  let rows: Row[] = []
  if (priority && query.sort === priority.name) {
    const covered = new Set<string>()
    const groups = priority.groups.flatMap((group) => {
      const unique = [...new Set(group)].filter((state) => !covered.has(state))
      for (const state of unique) covered.add(state)
      return unique.length ? [inArray(table[definition.state]!, unique)] : []
    })
    groups.push(not(inArray(table[definition.state]!, [...covered])))
    if (query.direction === 'desc') groups.reverse()
    let skip = (page - 1) * query.pageSize
    for (const condition of groups) {
      const bucket = selected.where(condition)
      const count = await ctx.db.count(bucket)
      if (skip >= count) {
        skip -= count
        continue
      }
      rows.push(
        ...(await load(
          bucket
            .orderBy(desc(table[priority.within]!), asc(table.id!))
            .limit(query.pageSize - rows.length)
            .offset(skip),
        )),
      )
      skip = 0
      if (rows.length === query.pageSize) break
    }
  } else {
    rows = await load(
      selected
        .orderBy(order(table[query.sort]!), asc(table.id!))
        .limit(query.pageSize)
        .offset((page - 1) * query.pageSize),
    )
  }
  if (definition.model === 'Property')
    rows = rows.map((row) => ({ ...row, lifecycle: row.lifecycle ?? (row.active ? 'active' : 'stopped') }))
  if (definition.enrich) rows = await definition.enrich(ctx, rows)
  return { query: { ...query, page }, total, page, pages, rows, counts: { state: counts }, isEmpty }
}

export function collectionSearchFunction(definition: HospitalityCollectionDefinition): FnSpec {
  async function searchHospitalityCollectionHandler(ctx: Ctx, args: Record<string, unknown>) {
    return readHospitalityCollectionPage(ctx, args, definition)
  }
  const model = (name: string) => (name.includes('.') ? name : `hospitality_core.${name}`)
  return defineFn({
    input: {
      q: 'text?',
      state: 'text?',
      sort: 'text?',
      direction: 'text?',
      propertyId: 'id?',
      roomTypeId: 'id?',
      floorId: 'id?',
      from: 'datetime?',
      to: 'datetime?',
      page: 'int?',
      pageSize: 'int?',
    },
    output: {
      query: 'json',
      total: 'int',
      page: 'int',
      pages: 'int',
      rows: 'json',
      counts: 'json',
      isEmpty: 'bool',
    },
    effects: [
      ...new Set([
        definition.model,
        ...(definition.property ? ['Property'] : []),
        ...(definition.reads ?? []),
      ]),
    ].map((name) => `read:${model(name)}`),
    handler: searchHospitalityCollectionHandler,
  })
}

export const collectionSearchFunctions: Record<string, FnSpec> = Object.fromEntries(
  hospitalityCollections.map((definition) => [definition.name, collectionSearchFunction(definition)]),
)
