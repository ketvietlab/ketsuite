import {
  AMENITY_SCOPES,
  CANCELLATION_POLICY_TYPES,
  CHARGE_TYPES,
  CLEANING_TASK_PRIORITIES,
  CLEANING_TASK_TYPES,
} from '../types.ts'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { HospitalityCollectionDefinition } from '../functions/collection-search.ts'
import type { HospitalityCollectionProps } from '../collections/view.tsx'
import { catalogueRecords } from '../records/config.ts'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import {
  collectionQueryFromUrl,
  hospitalityCollectionControls,
  hospitalityCollectionResults,
} from '../collections/view.tsx'
import { hospitalityCollections } from '../functions/collection-search.ts'
import { hospitalityAdminPage as adminPage } from './hospitality-admin-page.tsx'
import { LinkButton } from '@ketvietlab/design-system'
import { ListScreenFrame } from './page-frame.tsx'

export type HospitalityCollectionPageDefinition = {
  namespace?: string
  collection?: HospitalityCollectionDefinition
  statePrefix?: string
  recordParam?: string
  recordPath?: string
  recordIdField?: string
  recordQuery?: Record<string, string>
  recordKind?: string
  id: string
  path: string
  fn: string
  title: string
  searchLabel?: string
  sorts?: {
    label: string
    choices: { id: string; field: string; direction: 'asc' | 'desc'; label: string }[]
  }
  create?: { fn: string; path: string; label?: string }
  columns: Array<{
    key: string
    field: string
    label: string
    kind?: 'text' | 'money' | 'date' | 'number' | 'state'
    /** Raw enum value to a translated message key; DTO values remain unchanged. */
    values?: Record<string, string>
    sortable?: boolean
    hrefField?: string
    linkPermissions?: Record<string, string>
    /** A state's badge tone by its raw value. */
    tones?: Record<string, 'neutral' | 'info' | 'positive' | 'warning' | 'danger'>
    /** The message an empty cell shows, or one per value of another field of the row. */
    empty?: string | { field: string; values: Record<string, string> }
  }>
}
const code = { key: 'code', field: 'code', label: 'code', sortable: true } as const
const name = { key: 'name', field: 'name', label: 'name', sortable: true } as const
const state = (field = 'state') => ({ key: 'state', field, label: 'state', kind: 'state' as const })
const enumLabels = (values: readonly string[]) =>
  Object.fromEntries(values.map((value) => [value, `record.option.${value}`]))
export const collectionPages: readonly HospitalityCollectionPageDefinition[] = [
  {
    id: 'properties',
    path: '/admin/hospitality/properties',
    fn: 'searchProperties',
    title: 'screen.properties.title',
    create: {
      fn: 'saveProperty',
      path: '/admin/hospitality/properties/new',
      label: 'property.action.create',
    },
    columns: [name, code, { key: 'place', field: 'locality', label: 'location' }, state('lifecycle')],
  },
  {
    id: 'rooms',
    path: '/admin/hospitality/rooms',
    fn: 'searchRooms',
    title: 'screen.rooms.title',
    create: { fn: 'saveRoom', path: '/admin/hospitality/rooms/new' },
    columns: [
      code,
      name,
      { key: 'roomType', field: 'roomType.name', label: 'roomType' },
      { key: 'floor', field: 'floor.name', label: 'floor' },
      { key: 'capacity', field: 'capacity', label: 'capacity', kind: 'number', sortable: true },
      state('status'),
    ],
  },
  {
    id: 'room-types',
    path: '/admin/hospitality/room-types',
    fn: 'searchRoomTypes',
    title: 'screen.roomTypes.title',
    create: { fn: 'saveRoomType', path: '/admin/hospitality/room-types/new' },
    columns: [
      name,
      code,
      { key: 'capacity', field: 'defaultCapacity', label: 'capacity', kind: 'number', sortable: true },
      { key: 'rate', field: 'baseRate', label: 'amount', kind: 'money', sortable: true },
      state('active'),
    ],
  },
  {
    id: 'amenities',
    path: '/admin/hospitality/amenities',
    fn: 'searchAmenities',
    title: 'screen.amenities.title',
    create: { fn: 'saveAmenity', path: '/admin/hospitality/amenities?create=1' },
    columns: [
      name,
      code,
      { key: 'scope', field: 'scope', label: 'scope', values: enumLabels(AMENITY_SCOPES) },
      state('active'),
    ],
  },
  {
    id: 'policies',
    path: '/admin/hospitality/policies',
    fn: 'searchPolicies',
    title: 'screen.policies.title',
    create: { fn: 'saveCancellationPolicy', path: '/admin/hospitality/policies?create=1' },
    columns: [
      name,
      code,
      { key: 'type', field: 'type', label: 'type', values: enumLabels(CANCELLATION_POLICY_TYPES) },
      state('active'),
    ],
  },
  {
    id: 'rates',
    path: '/admin/hospitality/rate-plans',
    fn: 'searchRates',
    title: 'screen.ratePlans.title',
    create: { fn: 'saveRatePlan', path: '/admin/hospitality/rate-plans?create=1' },
    columns: [
      name,
      code,
      { key: 'roomType', field: 'roomType.name', label: 'roomType' },
      { key: 'amount', field: 'amount', label: 'amount', kind: 'money', sortable: true },
      state('active'),
    ],
  },
  {
    id: 'housekeeping',
    path: '/admin/hospitality/housekeeping',
    fn: 'searchCleaningTasks',
    title: 'screen.cleaningTasks.title',
    create: {
      fn: 'saveCleaningTask',
      path: '/admin/hospitality/housekeeping?record=hospitality.cleaningTask:new',
    },
    columns: [
      code,
      { key: 'room', field: 'room.code', label: 'room' },
      { key: 'type', field: 'taskType', label: 'type', values: enumLabels(CLEANING_TASK_TYPES) },
      { key: 'priority', field: 'priority', label: 'priority', values: enumLabels(CLEANING_TASK_PRIORITIES) },
      state(),
    ],
  },
  {
    id: 'notices',
    path: '/admin/hospitality/stay-notices',
    fn: 'searchStayNotices',
    title: 'screen.stayNotices.title',
    columns: [
      { key: 'guest', field: 'guestName', label: 'guest' },
      { key: 'due', field: 'dueAt', label: 'due', kind: 'date', sortable: true },
      { key: 'document', field: 'documentLast4', label: 'document' },
      state(),
    ],
  },
  {
    id: 'services',
    path: '/admin/hospitality/services',
    fn: 'searchServices',
    title: 'screen.services.title',
    recordParam: 'line',
    create: { fn: 'saveExtraLine', path: '/admin/hospitality/services?create=1' },
    columns: [
      { key: 'name', field: 'description', label: 'name', sortable: true },
      { key: 'qty', field: 'quantity', label: 'quantity', kind: 'number', sortable: true },
      { key: 'amount', field: 'unitPrice', label: 'amount', kind: 'money', sortable: true },
      state('active'),
    ],
  },
]
const labels = [
  'results',
  'search',
  'filters',
  'property',
  'allProperties',
  'state',
  'clear',
  'ascending',
  'descending',
  'loading',
  'retry',
  'error',
  'errorHint',
  'noResults',
  'rows',
  'selectAll',
  'selectRow',
  'actions',
  'denied',
  'deniedHint',
  'offline',
  'offlineHint',
  'empty',
  'emptyHint',
  'filteredHint',
  'create',
  'pager',
  'first',
  'previous',
  'next',
  'last',
  'lost',
]

export async function renderHospitalityCollection(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  definition: HospitalityCollectionPageDefinition,
) {
  const collectionUrl = new URL(url)
  for (const key of ['record', 'recordDialog', 'tab']) collectionUrl.searchParams.delete(key)
  // A record kept on its parent's page (a property's buildings and floors) is not what the list creates or opens.
  const modal = catalogueRecords.find((item) => item.list === definition.id && !item.parentPage)
  const locale = ctx.localeOf(url, req)
  const translate = ctx.translate(locale)
  const namespace = definition.namespace ?? 'hospitality_core'
  const qualified = (key: string) => `${namespace}.${key}`
  const base = definition.collection ?? hospitalityCollections.find((item) => item.name === definition.fn)!
  const allowed = await ctx.allows(qualified(definition.fn), url, req)
  const canCreate = definition.create && (await ctx.allows(qualified(definition.create.fn), url, req))
  const createUrl = canCreate ? new URL(definition.create!.path, url) : null
  if (createUrl) {
    for (const [name, value] of url.searchParams)
      if (['company', 'companies', 'branch', 'branches', 'lang', 'property'].includes(name))
        createUrl.searchParams.append(name, value)
  }
  const create = createUrl
    ? definition.recordKind || modal
      ? recordModalCreateHref(collectionUrl, { kind: definition.recordKind ?? `hospitality.${modal!.kind}` })
      : createUrl.pathname + createUrl.search
    : null
  const properties =
    base.property && (await ctx.allows('hospitality_core.searchProperties', url, req))
      ? ((await ctx.call('hospitality_core.searchProperties', { state: 'all', pageSize: 100 }, url, req)) as {
          rows: Array<{ id: string; name: string }>
        })
      : { rows: [] }
  const statePrefix =
    definition.statePrefix ??
    (definition.id === 'rooms'
      ? 'roomStatus'
      : definition.id === 'housekeeping'
        ? 'cleaningState'
        : definition.id === 'notices'
          ? 'stayNotice.state'
          : 'collection.state')
  const states = base.states.map((id) => ({
    id,
    label: translate(id === 'all' ? 'hospitality_core.collection.all' : `${namespace}.${statePrefix}.${id}`),
  }))
  const linkValues = new Map<string, string[]>()
  for (const column of definition.columns)
    if (column.linkPermissions) {
      const allowed = await Promise.all(
        Object.entries(column.linkPermissions).map(async ([value, fn]) =>
          (await ctx.allows(fn, url, req)) ? value : null,
        ),
      )
      linkValues.set(
        column.key,
        allowed.filter((value): value is string => value !== null),
      )
    }
  const props: HospitalityCollectionProps = {
    key: `${definition.id}:${JSON.stringify(['company', 'companies', 'branch', 'branches'].map((key) => [key, url.searchParams.getAll(key)]))}:${locale}`,
    id: `hospitality-${definition.id}`,
    source: `/_ket/fn/${namespace}.${definition.fn}?${new URLSearchParams([...url.searchParams].filter(([name]) => ['company', 'companies', 'branch', 'branches', 'lang'].includes(name)))}`,
    path: collectionUrl.pathname + collectionUrl.search,
    recordParam: definition.recordParam,
    recordIdField: definition.recordIdField,
    recordQuery: definition.recordQuery,
    recordKind: definition.recordKind ?? (modal ? `hospitality.${modal.kind}` : undefined),
    recordPath: definition.recordPath ?? definition.path,
    createHref: create,
    defaultSort: base.defaultSort,
    defaultDirection: base.defaultDirection ?? 'asc',
    lang: locale,
    allowed,
    sorts: definition.sorts
      ? {
          label: translate(qualified(definition.sorts.label)),
          choices: definition.sorts.choices.map((choice) => ({
            ...choice,
            label: translate(qualified(choice.label)),
          })),
        }
      : undefined,
    columns: definition.columns.map(
      ({ values: _values, linkPermissions: _permissions, empty, ...column }) => ({
        ...column,
        ...(linkValues.has(column.key) ? { linkValues: linkValues.get(column.key) } : {}),
        ...(typeof empty === 'object' ? { emptyField: empty.field } : {}),
        label: translate(
          column.label.includes('.') ? column.label : `hospitality_core.collection.${column.label}`,
        ),
      }),
    ),
    states,
    properties: properties.rows.map((row) => ({ id: String(row.id), name: String(row.name) })),
    query: {
      q: '',
      state: 'all',
      sort: base.defaultSort,
      direction: 'asc',
      propertyId: null,
      roomTypeId: null,
      floorId: null,
      from: null,
      to: null,
      page: 1,
      pageSize: 25,
    },
    words: Object.fromEntries(labels.map((key) => [key, translate(`hospitality_core.collection.${key}`)])),
  }
  if (definition.searchLabel) props.words.searchPlaceholder = translate(qualified(definition.searchLabel))
  if (definition.create?.label) props.words.create = translate(qualified(definition.create.label))
  if (modal) props.words.create = translate(`hospitality_core.${modal.title}.create`)
  if (namespace === 'hospitality_billing' && definition.id === 'billing-rules')
    for (const type of CHARGE_TYPES)
      props.words[`value.chargeType.${type}`] = translate(`${namespace}.chargeType.${type}`)
  for (const column of definition.columns) {
    for (const [value, key] of Object.entries(column.values ?? {}))
      props.words[`value.${column.field}.${value}`] = translate(qualified(key))
    if (typeof column.empty === 'string')
      props.words[`empty.${column.key}`] = translate(qualified(column.empty))
    else
      for (const [value, key] of Object.entries(column.empty?.values ?? {}))
        props.words[`empty.${column.key}.${value}`] = translate(qualified(key))
  }
  props.query = collectionQueryFromUrl(url, props)
  for (const state of states) props.words[`state.${state.id}`] = state.label
  props.words['state.true'] = translate(
    base.booleanState
      ? `${namespace}.${statePrefix}.${base.booleanState.true}`
      : 'hospitality_core.collection.state.active',
  )
  props.words['state.false'] = translate(
    base.booleanState
      ? `${namespace}.${statePrefix}.${base.booleanState.false}`
      : 'hospitality_core.collection.state.inactive',
  )
  return adminPage(ctx, url, req, {
    title: qualified(definition.title),
    body: (_, frame) => (
      <ListScreenFrame
        translator={_}
        title={translate(qualified(definition.title))}
        frame={{ ...frame, chrome: null }}
        controlsMode="islands"
        headerActions={
          create ? (
            <LinkButton
              id={`${props.id}-create`}
              href={create}
              label={props.words.create}
              variant="primary"
            />
          ) : undefined
        }
        controls={trustedMarkup(
          renderIsland('hospitality.collection-controls', hospitalityCollectionControls, props, {
            tag: 'div',
          }),
        )}
        body={trustedMarkup(
          renderIsland('hospitality.collection-results', hospitalityCollectionResults, props, { tag: 'div' }),
        )}
      />
    ),
  })
}
