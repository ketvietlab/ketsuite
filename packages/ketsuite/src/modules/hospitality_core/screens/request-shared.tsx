import { hospitalityRecordBack, hospitalityScopedHref } from './scoped-href.ts'
import { relationControl, relationLabels } from '../../backend/relation-select.ts'
import { loadReservationGuaranteeWorkspace } from '../../hospitality_billing/screens/guarantee-workspace.tsx'
import { loadFolioFinancialWorkspace } from '../../hospitality_billing/screens/folio-workspace.tsx'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { propertyWorkbenchScreen } from './property-workbench.tsx'
import type { PropertyWorkbench, Readiness } from './property-workbench.tsx'
import { roomOperationsWorkbench } from './room-operations-workbench.tsx'
import type { RoomOperationsRecord } from './room-operations-workbench.tsx'
import { loadCollectionRows } from '../../backend/collection-search.ts'

import { rowListSearch } from '../../backend/row-list.ts'

import {
  amenityListSearch,
  folioListSearch,
  policyListSearch,
  propertyListSearch,
  stayListSearch,
} from '../search.ts'

import { randomUUID } from 'node:crypto'

import { dateTimeFormatter, text } from '@ketvietlab/ketjs'

import type { Route, RouteEntry, ServeContext, Translator } from '@ketvietlab/ketjs'

import { readForm, seeOther } from '../../backend/forms.ts'

import { receiveAttachment } from '../../storage/routes.ts'

import {
  amenitiesScreen,
  buildingDetailScreen,
  cleaningTaskDetailScreen,
  cleaningTasksScreen,
  folioDetailScreen,
  foliosScreen,
  floorDetailScreen,
  frontDeskScreen,
  housekeepingRoomDetailScreen,
  housekeepingRoomsScreen,
  newPropertyScreen,
  newRoomScreen,
  newRoomTypeScreen,
  policiesScreen,
  propertiesScreen,
  propertyDetailScreen,
  ratePlansScreen,
  type CheckOutReadiness,
  checkOutPrepScreen,
  reservationDetailScreen,
  reservationsScreen,
  inventoryScreen,
  roomsScreen,
  roomDetailScreen,
  roomTypeDetailScreen,
  roomTypesScreen,
  stayDetailScreen,
  staysScreen,
  contentScreen,
  servicesScreen,
  nightAuditScreen,
  stayNoticesScreen,
} from './index.ts'

import type {
  AmenityRow,
  BuildingDetail,
  BuildingFormValues,
  BuildingRow,
  BranchChoice,
  CleaningTaskSummary,
  CleaningTaskRow,
  FolioRow,
  GuestDocumentRow,
  FloorRow,
  FloorDetail,
  FloorFormValues,
  PolicyRow,
  PropertyDetail,
  PropertyFormValues,
  PropertyRow,
  RatePlanRow,
  InventoryRow,
  ReservationRow,
  ReservationDetail,
  ReservationQuote,
  ReservationIntakeValues,
  ReservationAmendmentValues,
  RoomRow,
  RoomDetail,
  RoomFormValues,
  RoomStatusSummary,
  RoomTypeDetail,
  RoomTypeFormValues,
  RoomTypeRow,
  StayRow,
  TapeChart,
  ContentImageRow,
  ExtraLineRow,
  PropertyChargeRow,
  ServiceChargeRow,
  ServiceProductRow,
  NightAuditPreview,
  NightAuditRow,
  StayNoticeRow,
} from './index.ts'

import { addCalendarDays, calendarRange, dateKeyIn, zonedDateTime } from '../calendar.ts'

import { CLEANING_TASK_STATES, ROOM_STATUSES, STAY_NOTICE_STATES } from '../types.ts'

import { hospitalityAdminPage as adminPage } from './hospitality-admin-page.tsx'

export const GROUP_MESSAGES: Record<string, string> = {
  state: 'stayState',
  accommodationType: 'accommodation',
  scope: 'amenityScope',
  type: 'policy',
}

export const hospitalityGroupLabel = (
  _: Translator,
  key: string,
  value: unknown,
  states = 'stayState',
): string => {
  const raw = value == null ? '' : String(value)
  if (!raw) return _('backend.chrome.groupEmpty')
  const family = key === 'state' ? states : (GROUP_MESSAGES[key] ?? key)
  const message = `hospitality_core.${family}.${raw}`
  return _.resolves(message) ? _(message) : raw
}

export const hospitalitySearchFunctions = {
  apply: 'hospitality_core.applySearchFilter',
  saveFavorite: 'hospitality_core.saveSearchFavorite',
  deleteFavorite: 'hospitality_core.deleteSearchFavorite',
  setDefaultFavorite: 'hospitality_core.setDefaultSearchFavorite',
}

export type OperationResult = {
  ok?: boolean
  inventoryReleased?: number
  errors?: Array<{ messageKey?: string; params?: Record<string, unknown> }>
}

export const operationErrors = (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  result: OperationResult,
): string[] => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const errors = result.errors ?? []
  return errors.length
    ? errors.map((error) =>
        error.messageKey ? _(error.messageKey, error.params) : _('hospitality_core.feedback.invalidHint'),
      )
    : [_('hospitality_core.feedback.invalidHint')]
}

export const propertyTimezone = async (
  ctx: ServeContext,
  propertyId: string | undefined,
  url: URL,
  req: Parameters<Route>[1],
): Promise<string> => {
  if (!propertyId) return 'UTC'
  const property = (await ctx.call('hospitality_core.getProperty', { id: propertyId }, url, req)) as {
    timezone?: string
  } | null
  return property?.timezone || 'UTC'
}

export const renderReservationDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: Partial<ReservationAmendmentValues>,
  attemptedDeparture?: string,
  guaranteeDraft: Record<string, string | undefined> = {},
) => {
  const reservation = (await ctx.call(
    'hospitality_core.getReservation',
    { id },
    url,
    req,
  )) as ReservationDetail | null
  if (!reservation) return text('Not found', { status: 404 })
  if (url.searchParams.get('action') === 'check-out' && reservation.stayId)
    return renderCheckOutPrep(ctx, url, req, reservation, errors)
  const guarantee = await loadReservationGuaranteeWorkspace(ctx, url, req, id, errors, guaranteeDraft)
  const permissions = {
    amend: await ctx.allows('hospitality_core.amendReservation', url, req),
    checkIn: await ctx.allows('hospitality_core.checkIn', url, req),
    holdRoom: await ctx.allows('hospitality_core.holdRoom', url, req),
    adjustDeparture: await ctx.allows('hospitality_core.adjustStayDeparture', url, req),
    checkOut: await ctx.allows('hospitality_core.checkOut', url, req),
    cancel: await ctx.allows('hospitality_core.cancelReservation', url, req),
    noShow: await ctx.allows('hospitality_core.markNoShow', url, req),
    readStay: await ctx.allows('hospitality_core.getStay', url, req),
  }
  if (reservation.stayId && permissions.readStay) {
    reservation.stay = (await ctx.call(
      'hospitality_core.getStay',
      { id: reservation.stayId },
      url,
      req,
    )) as StayRow | null
  }
  const timezone = await propertyTimezone(ctx, reservation.propertyId, url, req)
  const [roomTypes, partners] = (await Promise.all([
    ctx.call('hospitality_core.listRoomTypes', { propertyId: reservation.propertyId }, url, req),
    ctx.call('partner.listPartners', { kind: 'person', limit: 500 }, url, req),
  ])) as [Array<{ id: string; code: string; name: string }>, Array<{ id: string; name: string }>]
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const roomPicker = async (readyOnly: boolean) => {
    const held = reservation.stay?.assignments?.find((row) => row.state === 'held')
    const selected = held
      ? ((await ctx.call(
          'hospitality_core.lookupReservationRooms',
          { reservationId: id, id: held.roomId, readyOnly, limit: 1 },
          url,
          req,
        )) as Array<{ id: string; name: string }>)
      : []
    return relationControl(ctx, url, req, readyOnly ? 'reservation-check-in-room' : 'reservation-held-room', {
      name: 'roomId',
      ariaLabel: _('hospitality_core.reservation.field.room'),
      required: true,
      value: selected[0]?.id ?? '',
      options: selected.map((row) => ({ value: row.id, label: row.name })),
      labels: relationLabels(_, _('hospitality_core.reservation.field.room')),
      manager: {
        listFunction: 'hospitality_core.lookupReservationRooms',
        listInput: { reservationId: id, readyOnly },
        searchInDropdown: true,
        requestQuery: new URLSearchParams(
          [...url.searchParams].filter(([key]) =>
            ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
          ),
        ).toString(),
        limit: 20,
        resolveParam: 'id',
        idField: 'id',
        labelField: 'name',
      },
    })
  }
  const pickers =
    reservation.state === 'confirmed'
      ? {
          hold: permissions.holdRoom ? await roomPicker(false) : undefined,
          checkIn: permissions.checkIn ? await roomPicker(true) : undefined,
        }
      : {}
  const amendment: ReservationAmendmentValues = {
    partnerId: attempted?.partnerId ?? reservation.partnerId,
    roomTypeId: attempted?.roomTypeId ?? reservation.roomTypeId,
    checkIn: attempted?.checkIn ?? localDateTime(new Date(reservation.checkIn), timezone),
    checkOut: attempted?.checkOut ?? localDateTime(new Date(reservation.checkOut), timezone),
    adults: attempted?.adults ?? reservation.adults,
    children: attempted?.children ?? reservation.children,
    rate: attempted?.rate ?? String(reservation.rate),
  }
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.reservation.detail.title', { code: reservation.code }),
    translate: false,
    body: (_, frame) =>
      reservationDetailScreen(
        _,
        reservation,
        [],
        roomTypes,
        partners,
        amendment,
        attemptedDeparture ?? localDateTime(new Date(reservation.checkOut), timezone),
        lang,
        timezone,
        frame,
        url.searchParams.get('status'),
        errors,
        permissions,
        guarantee,
        url.pathname + url.search,
        pickers,
      ),
  })
}

export const renderCheckOutPrep = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  reservation: ReservationDetail,
  errors: readonly string[] = [],
) => {
  const readiness = (await ctx.call(
    'hospitality_core.checkOutReadiness',
    { stayId: reservation.stayId },
    url,
    req,
  )) as CheckOutReadiness | null
  if (!readiness) return text('Not found', { status: 404 })
  const timezone = await propertyTimezone(ctx, reservation.propertyId, url, req)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const permitted = await ctx.allows('hospitality_core.checkOut', url, req)
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.checkOutPrep.title', { code: reservation.code }),
    translate: false,
    body: (_, frame) =>
      checkOutPrepScreen(
        _,
        readiness,
        { id: reservation.id, code: reservation.code },
        lang,
        timezone,
        frame,
        permitted,
        errors,
        url.pathname + url.search,
      ),
  })
}

export const renderStayDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
) => {
  const stay = (await ctx.call('hospitality_core.getStay', { id }, url, req)) as StayRow | null
  if (!stay) return text('Not found', { status: 404 })
  const [rooms, partners, documents] = (await Promise.all([
    ctx.call('hospitality_core.listRooms', { propertyId: stay.propertyId, includeArchived: true }, url, req),
    ctx.call('partner.listPartners', { kind: 'person', limit: 500 }, url, req),
    ctx.call('hospitality_core.listGuestDocuments', { stayId: stay.id }, url, req),
  ])) as [RoomRow[], Array<{ id: string; name: string; ref?: string }>, GuestDocumentRow[]]
  const timezone = await propertyTimezone(ctx, stay.propertyId, url, req)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.stay.detail.title', { code: stay.code }),
    translate: false,
    body: (_, frame) =>
      stayDetailScreen(
        _,
        stay,
        rooms,
        partners,
        documents,
        randomUUID(),
        lang,
        timezone,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

export const renderFolioDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  draft: Record<string, string | undefined> = {},
) => {
  const folio = (await ctx.call('hospitality_core.getFolio', { id }, url, req)) as FolioRow | null
  if (!folio) return text('Not found', { status: 404 })
  const timezone = await propertyTimezone(ctx, folio.propertyId, url, req)
  const canAdjust = await ctx.allows('hospitality_core.adjustCharge', url, req)
  const profile = (await ctx.allows('hospitality_core.getPropertyProfile', url, req))
    ? ((await ctx.call('hospitality_core.getPropertyProfile', { id: folio.propertyId }, url, req)) as {
        property: { businessDate?: string } | null
      })
    : null
  const correction = { allowed: canAdjust, businessDate: profile?.property?.businessDate ?? '', draft }
  const financial = await loadFolioFinancialWorkspace(ctx, url, req, folio, errors, draft)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.folio.detail.title', { code: folio.code }),
    translate: false,
    body: (_, frame) =>
      folioDetailScreen(
        _,
        folio,
        lang,
        timezone,
        frame,
        randomUUID(),
        url.searchParams.get('status'),
        errors,
        financial,
        url.pathname + url.search,
        correction,
      ),
  })
}

export const renderCleaningTaskDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
) => {
  const task = (await ctx.call(
    'hospitality_core.getCleaningTask',
    { id },
    url,
    req,
  )) as CleaningTaskRow | null
  if (!task) return text('Not found', { status: 404 })
  const timezone = await propertyTimezone(ctx, task.propertyId, url, req)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const permissions = {
    start: await ctx.allows('hospitality_core.startCleaningTask', url, req),
    complete: await ctx.allows('hospitality_core.completeCleaningTask', url, req),
    cancel: await ctx.allows('hospitality_core.cancelCleaningTask', url, req),
  }
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.housekeeping.detail.title', { code: task.code }),
    translate: false,
    body: (_, frame) =>
      cleaningTaskDetailScreen(
        _,
        task,
        lang,
        timezone,
        frame,
        url.searchParams.get('status'),
        errors,
        permissions,
      ),
  })
}

export const renderHousekeepingRoomDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: Record<string, string>,
) => {
  const room = (await ctx.call('hospitality_core.getHousekeepingRoom', { id }, url, req)) as RoomRow | null
  if (room?.active !== true) return text('Not found', { status: 404 })
  const tasks = (await ctx.call(
    'hospitality_core.listCleaningTasks',
    { roomId: id, limit: 20 },
    url,
    req,
  )) as CleaningTaskRow[]
  const operational = (await ctx.allows('hospitality_core.getRoomOperationsRecord', url, req))
    ? ((await ctx.call('hospitality_core.getRoomOperationsRecord', { id }, url, req)) as RoomOperationsRecord)
    : null
  const names = ['blockRoom', 'reopenRoom', 'inspectRoom', 'completeRoomCleaning']
  const capabilities = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await ctx.allows(`hospitality_core.${name}`, url, req)]),
    ),
  )
  const timezone = await propertyTimezone(ctx, room.propertyId, url, req)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.housekeeping.rooms.detail.title', { code: room.code }),
    translate: false,
    body: (_, frame) =>
      housekeepingRoomDetailScreen(
        _,
        operational?.blocks.length
          ? { ...room, status: operational.blocks[0]!.kind === 'ooo' ? 'out_of_order' : 'maintenance' }
          : room,
        tasks,
        lang,
        timezone,
        frame,
        url.searchParams.get('status'),
        errors,
        operational?.room && operational.property
          ? roomOperationsWorkbench(_, operational, url, capabilities, errors, attempted)
          : undefined,
        hospitalityRecordBack(
          url.href,
          hospitalityScopedHref(
            url,
            `/admin/hospitality/housekeeping/rooms?property=${encodeURIComponent(room.propertyId)}`,
          ),
        ),
      ),
  })
}

export const selectedProperty = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
): Promise<string | undefined> => {
  const selected = url.searchParams.get('property')?.trim()
  if (selected) return selected
  const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
  return properties[0]?.id
}

export const redirected = (
  url: URL,
  state: 'saved' | 'quoted' | 'queued' | 'refreshed' | 'submitted' | 'confirmed' | 'created' | 'invalid',
  values: Record<string, string | undefined> = {},
) => {
  const params = new URLSearchParams(url.searchParams)
  params.set('status', state)
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  return seeOther(`${url.pathname}?${params.toString()}`)
}

export const modalHref = (url: URL, open: boolean, remove: readonly string[] = []): string => {
  const params = new URLSearchParams(url.searchParams)
  if (open) params.set('create', '1')
  else params.delete('create')
  params.delete('status')
  if (!open) params.delete('preview')
  for (const key of remove) params.delete(key)
  const query = params.toString()
  return `${url.pathname}${query ? `?${query}` : ''}`
}

export const modalAction = (url: URL): string => {
  const params = new URLSearchParams(url.searchParams)
  params.set('create', '1')
  return `${url.pathname}?${params.toString()}`
}

export const modalErrors = (url: URL, _: Translator): readonly string[] | undefined =>
  url.searchParams.get('status') === 'invalid' ? [_('hospitality_core.feedback.invalid')] : undefined

export const modalValues = (url: URL, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    keys.flatMap((key) => (url.searchParams.has(key) ? [[key, url.searchParams.get(key)!]] : [])),
  )

export const modalResultRedirect = (
  url: URL,
  ok: boolean,
  success: 'saved' | 'created',
  values: Record<string, string | undefined> = {},
  removeOnSuccess: readonly string[] = [],
) => {
  const params = new URLSearchParams(url.searchParams)
  if (ok) params.delete('create')
  else params.set('create', '1')
  params.set('status', ok ? success : 'invalid')
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  if (ok) for (const key of removeOnSuccess) params.delete(key)
  return seeOther(`${url.pathname}?${params.toString()}`)
}

export const integer = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) ? parsed : -1
}

export const optionalInteger = (value: string | undefined): number | undefined =>
  value ? integer(value) : undefined

export const localDateTime = (value: Date, timezone: string): string => {
  const parts = Object.fromEntries(
    dateTimeFormatter('en', {
      timeZone: timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${dateKeyIn(value, timezone)}T${parts.hour}:${parts.minute}`
}

export const instantFromLocal = (value: string | undefined, timezone: string): string | null => {
  const matched = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(value ?? ''))
  if (!matched) return null
  const hour = Number(matched[2])
  const minute = Number(matched[3])
  if (hour > 23 || minute > 59) return null
  const instant = zonedDateTime(matched[1]!, hour, minute, timezone)
  if (!Number.isFinite(instant.getTime()) || localDateTime(instant, timezone) !== value) return null
  return instant.toISOString()
}

export type ContentSelection = {
  properties: PropertyRow[]
  roomTypes: RoomTypeRow[]
  propertyId: string | undefined
  roomTypeId: string | null
  target: string
}

export type ReservationProperty = {
  id: string
  timezone: string
  defaultCheckIn: string
  defaultCheckOut: string
}

export const contentSelection = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
): Promise<ContentSelection> => {
  const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
  const requestedProperty = url.searchParams.get('property')?.trim()
  const propertyId = properties.some((row) => row.id === requestedProperty)
    ? requestedProperty
    : requestedProperty
      ? undefined
      : properties[0]?.id
  const roomTypes = propertyId
    ? ((await ctx.call('hospitality_core.listRoomTypes', { propertyId }, url, req)) as RoomTypeRow[])
    : []
  const requestedTarget = url.searchParams.get('target')?.trim() || 'property'
  const requestedRoomType = requestedTarget.startsWith('room_type:')
    ? requestedTarget.slice('room_type:'.length)
    : null
  const roomTypeId = roomTypes.some((row) => row.id === requestedRoomType) ? requestedRoomType : null
  return {
    properties,
    roomTypes,
    propertyId,
    roomTypeId,
    target: roomTypeId ? `room_type:${roomTypeId}` : 'property',
  }
}

export const contentQuery = (url: URL, selection: ContentSelection): string => {
  const query = new URLSearchParams()
  if (selection.propertyId) query.set('property', selection.propertyId)
  query.set('target', selection.target)
  const lang = url.searchParams.get('lang')?.trim()
  if (lang) query.set('lang', lang)
  return query.toString()
}

export const contentRedirect = (url: URL, selection: ContentSelection, status: 'saved' | 'invalid') => {
  const query = new URLSearchParams(contentQuery(url, selection))
  query.set('status', status)
  return seeOther(`/admin/hospitality/content?${query.toString()}`)
}

export const contentImages = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  selection: ContentSelection,
): Promise<ContentImageRow[]> => {
  if (!selection.propertyId) return []
  return (await ctx.call(
    'hospitality_core.listContentImages',
    selection.roomTypeId ? { roomTypeId: selection.roomTypeId } : { propertyId: selection.propertyId },
    url,
    req,
  )) as ContentImageRow[]
}

export const defaultPropertyValues = (id: string): PropertyFormValues => ({
  id,
  branchId: null,
  code: '',
  name: '',
  publicName: null,
  accommodationType: 'hotel',
  timezone: 'Asia/Ho_Chi_Minh',
  defaultCheckIn: '14:00',
  defaultCheckOut: '12:00',
  enforceTimes: true,
  allowHourly: true,
  allowWeekly: false,
  allowMonthly: false,
  longStayBillOnCheckIn: true,
  starRating: 0,
  description: null,
  houseRules: null,
  childrenStayFree: false,
  minimumGuestAge: null,
  defaultCancellationPolicyId: null,
})

export const propertyFormValues = (
  id: string,
  form: Record<string, string>,
  current: PropertyDetail | null = null,
): PropertyFormValues => ({
  id,
  editing: !!current,
  expectedVersion: Number(form.expectedVersion ?? 0),
  requestKey: form.requestKey,
  branchId: form.branchId?.trim() || current?.branchId || null,
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  publicName: form.publicName?.trim() || null,
  accommodationType: form.accommodationType?.trim() ?? current?.accommodationType ?? 'hotel',
  timezone: form.timezone?.trim() ?? current?.timezone ?? 'Asia/Ho_Chi_Minh',
  defaultCheckIn: form.defaultCheckIn?.trim() ?? current?.defaultCheckIn ?? '14:00',
  defaultCheckOut: form.defaultCheckOut?.trim() ?? current?.defaultCheckOut ?? '12:00',
  enforceTimes: form.enforceTimes === '1',
  allowHourly: form.allowHourly === '1',
  allowWeekly: form.allowWeekly === '1',
  allowMonthly: form.allowMonthly === '1',
  longStayBillOnCheckIn: form.longStayBillOnCheckIn === '1',
  starRating: integer(form.starRating, current?.starRating ?? 0),
  description: form.description?.trim() || null,
  houseRules: form.houseRules?.trim() || null,
  childrenStayFree: form.childrenStayFree === '1',
  minimumGuestAge: form.minimumGuestAge ? integer(form.minimumGuestAge) : null,
  defaultCancellationPolicyId: form.defaultCancellationPolicyId?.trim() || null,
})

export const propertySaveInput = (values: PropertyFormValues, current: PropertyDetail | null = null) => ({
  ...Object.fromEntries(
    Object.entries(values).filter(([key]) => !['editing', 'timezoneLocked'].includes(key)),
  ),
  street1: current?.street1 ?? null,
  street2: current?.street2 ?? null,
  locality: current?.locality ?? null,
  postalCode: current?.postalCode ?? null,
  countryCode: current?.countryCode ?? null,
  divisionId: current?.divisionId ?? null,
  divisionText: current?.divisionText ?? null,
  latitude: current?.latitude ?? null,
  longitude: current?.longitude ?? null,
})

export const renderPropertyDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: PropertyFormValues,
  draft?: Record<string, string>,
) => {
  const scope = await ctx.scopeOf(url, req)
  const [property, policies, branches] = (await Promise.all([
    ctx
      .call('hospitality_core.getPropertyProfile', { id }, url, req)
      .then((value) => (value as { property: PropertyDetail | null }).property),
    ctx
      .allows('hospitality_core.listCancellationPolicies', url, req)
      .then((allowed) =>
        allowed ? ctx.call('hospitality_core.listCancellationPolicies', {}, url, req) : [],
      ),
    scope.company && (await ctx.allows('company.listBranches', url, req))
      ? ctx.call('company.listBranches', { companyId: scope.company }, url, req)
      : Promise.resolve([]),
  ])) as [PropertyDetail | null, PolicyRow[], BranchChoice[]]
  if (!property) return text('Not found', { status: 404 })
  const [workbench, readiness] = (await Promise.all([
    ctx.call('hospitality_core.getPropertyWorkbench', { propertyId: id }, url, req),
    ctx.call('hospitality_core.propertyReadiness', { propertyId: id }, url, req),
  ])) as [PropertyWorkbench, Readiness]
  const legacyDialog = url.searchParams.get('dialog')
  if (
    req.method === 'GET' &&
    !errors.length &&
    ['building', 'floor', 'fee', 'locale'].includes(legacyDialog ?? '')
  ) {
    const next = new URL(url)
    next.searchParams.delete('dialog')
    next.searchParams.delete('item')
    next.searchParams.set('property', id)
    let recordId = url.searchParams.get('item') ?? 'new'
    if (legacyDialog === 'locale')
      recordId = String(
        workbench.locales.find((row) => !row.roomTypeId && row.locale === url.searchParams.get('locale'))
          ?.id ?? 'new',
      )
    return seeOther(
      recordModalHref(next.pathname + next.search, { kind: `hospitality.${legacyDialog}`, id: recordId }),
    )
  }
  const names = [
    'saveProperty',
    'setPropertyLifecycle',
    'setInspectionRequirement',
    'saveBuilding',
    'archiveBuilding',
    'saveFloor',
    'archiveFloor',
    'savePropertyCharge',
    'saveContentLocale',
    'removeContentLocale',
    'listContentImages',
    'attachContentImage',
    'updateContentImage',
    'setPrimaryContentImage',
    'reorderContentImages',
    'removeContentImage',
  ]
  const rights = await Promise.all(names.map((name) => ctx.allows(`hospitality_core.${name}`, url, req)))
  const capabilities = Object.fromEntries(names.map((name, index) => [name, rights[index]!]))
  const selectedRoomType = workbench.roomTypes.find((row) => row.id === url.searchParams.get('photos'))
  workbench.photoTarget = selectedRoomType ? String(selectedRoomType.id) : null
  workbench.images = capabilities.listContentImages
    ? ((await ctx.call(
        'hospitality_core.listContentImages',
        selectedRoomType ? { roomTypeId: selectedRoomType.id } : { propertyId: id },
        url,
        req,
      )) as Array<Record<string, unknown>>)
    : []
  const lang = ctx.localeOf(url, req)
  return adminPage(ctx, url, req, {
    title: property.name,
    translate: false,
    body: (_, frame) =>
      propertyWorkbenchScreen(
        ctx.translate(lang),
        property,
        policies,
        branches,
        workbench,
        readiness,
        url,
        frame,
        capabilities,
        errors,
        attempted,
        draft,
      ),
  })
}

export const defaultRoomTypeValues = (id: string, propertyId: string): RoomTypeFormValues => ({
  id,
  propertyId,
  code: '',
  name: '',
  publicName: null,
  description: null,
  defaultCapacity: 2,
  maxAdults: 2,
  maxChildren: 0,
  maxInfants: 0,
  maxExtraBeds: 0,
  sizeSqm: null,
  viewType: null,
  sharedBathroom: false,
  allowHourly: true,
  allowWeekly: false,
  allowMonthly: false,
  minHourlyHours: 2,
  baseRate: '0',
  color: '#2563eb',
  cancellationPolicyId: null,
  published: false,
})

export const roomTypeFormValues = (
  id: string,
  form: Record<string, string>,
  current: RoomTypeDetail | null = null,
): RoomTypeFormValues => ({
  id,
  propertyId: form.propertyId?.trim() ?? current?.propertyId ?? '',
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  publicName: form.publicName?.trim() || null,
  description: form.description?.trim() || null,
  defaultCapacity: integer(form.defaultCapacity, current?.defaultCapacity ?? 2),
  maxAdults: integer(form.maxAdults, current?.maxAdults ?? 2),
  maxChildren: integer(form.maxChildren, current?.maxChildren ?? 0),
  maxInfants: integer(form.maxInfants, current?.maxInfants ?? 0),
  maxExtraBeds: integer(form.maxExtraBeds, current?.maxExtraBeds ?? 0),
  sizeSqm: form.sizeSqm?.trim() || null,
  viewType: form.viewType?.trim() || null,
  sharedBathroom: form.sharedBathroom === '1',
  allowHourly: form.allowHourly === '1',
  allowWeekly: form.allowWeekly === '1',
  allowMonthly: form.allowMonthly === '1',
  minHourlyHours: integer(form.minHourlyHours, current?.minHourlyHours ?? 2),
  baseRate: form.baseRate?.trim() ?? String(current?.baseRate ?? '0'),
  color: form.color?.trim() || null,
  cancellationPolicyId: form.cancellationPolicyId?.trim() || null,
  published: form.published === '1',
})

export const roomTypeInputErrors = (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  values: RoomTypeFormValues,
): string[] => {
  const decimal = (value: unknown) =>
    /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value ?? '').trim()) && Number.isFinite(Number(value))
  if (decimal(values.baseRate) && (values.sizeSqm == null || decimal(values.sizeSqm))) return []
  return [ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.decimal')]
}

export const renderRoomTypeDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: RoomTypeFormValues,
) => {
  const [roomType, properties, policies] = (await Promise.all([
    ctx.call('hospitality_core.getRoomType', { id }, url, req),
    ctx.call('hospitality_core.listProperties', { includeArchived: true }, url, req),
    ctx.call('hospitality_core.listCancellationPolicies', { includeArchived: true }, url, req),
  ])) as [RoomTypeDetail | null, PropertyRow[], PolicyRow[]]
  if (!roomType) return text('Not found', { status: 404 })
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: roomType.name,
    translate: false,
    body: (_, frame) =>
      roomTypeDetailScreen(
        _,
        roomType,
        properties,
        policies,
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
        attempted,
      ),
  })
}

export const buildingFormValues = (
  id: string,
  form: Record<string, string>,
  current: BuildingDetail | null = null,
): BuildingFormValues => ({
  id,
  propertyId: form.propertyId?.trim() ?? current?.propertyId ?? '',
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  sequence: integer(form.sequence, current?.sequence ?? 10),
})

export const renderBuildingDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: BuildingFormValues,
) => {
  const building = (await ctx.call('hospitality_core.getBuilding', { id }, url, req)) as BuildingDetail | null
  if (!building) return text('Not found', { status: 404 })
  const lang = ctx.localeOf(url, req)
  return adminPage(ctx, url, req, {
    title: building.name,
    translate: false,
    body: (_, frame) =>
      buildingDetailScreen(
        ctx.translate(lang),
        building,
        attempted ?? building,
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

export const floorFormValues = (
  id: string,
  form: Record<string, string>,
  current: FloorDetail | null = null,
): FloorFormValues => ({
  id,
  propertyId: form.propertyId?.trim() ?? current?.propertyId ?? '',
  buildingId: form.buildingId?.trim() ?? current?.buildingId ?? '',
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  sequence: integer(form.sequence, current?.sequence ?? 10),
})

export const renderFloorDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: FloorFormValues,
) => {
  const floor = (await ctx.call('hospitality_core.getFloor', { id }, url, req)) as FloorDetail | null
  if (!floor) return text('Not found', { status: 404 })
  const lang = ctx.localeOf(url, req)
  return adminPage(ctx, url, req, {
    title: floor.name,
    translate: false,
    body: (_, frame) =>
      floorDetailScreen(
        ctx.translate(lang),
        floor,
        attempted ?? floor,
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

export const roomFormValues = (
  id: string,
  form: Record<string, string>,
  current: RoomDetail | null = null,
): RoomFormValues => ({
  id,
  propertyId: form.propertyId?.trim() ?? current?.propertyId ?? '',
  roomTypeId: form.roomTypeId?.trim() ?? current?.roomTypeId ?? '',
  buildingId: form.buildingId?.trim() || null,
  floorId: form.floorId?.trim() || null,
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  capacity: integer(form.capacity, current?.capacity ?? 1),
})

export const defaultRoomValues = (id: string, propertyId: string, roomTypeId: string): RoomFormValues => ({
  id,
  propertyId,
  roomTypeId,
  buildingId: null,
  floorId: null,
  code: '',
  name: '',
  capacity: 2,
})

export const roomOptions = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  propertyId: string | undefined,
  includeArchived = false,
): Promise<{
  properties: PropertyRow[]
  propertyId?: string
  roomTypes: RoomTypeRow[]
  buildings: BuildingRow[]
  floors: FloorRow[]
}> => {
  const properties = (await ctx.call(
    'hospitality_core.listProperties',
    includeArchived ? { includeArchived: true } : {},
    url,
    req,
  )) as PropertyRow[]
  const selected = properties.some((row) => row.id === propertyId) ? propertyId : properties[0]?.id
  if (!selected) return { properties, propertyId: undefined, roomTypes: [], buildings: [], floors: [] }
  const [roomTypes, buildings, floors] = (await Promise.all([
    ctx.call(
      'hospitality_core.listRoomTypes',
      { propertyId: selected, includeArchived: includeArchived || undefined },
      url,
      req,
    ),
    ctx.call(
      'hospitality_core.listBuildings',
      { propertyId: selected, includeArchived: includeArchived || undefined },
      url,
      req,
    ),
    ctx.call(
      'hospitality_core.listFloors',
      { propertyId: selected, includeArchived: includeArchived || undefined },
      url,
      req,
    ),
  ])) as [RoomTypeRow[], BuildingRow[], FloorRow[]]
  return { properties, propertyId: selected, roomTypes, buildings, floors }
}

export const renderRooms = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  errors: readonly string[] = [],
) => {
  const requestedProperty = url.searchParams.get('property')?.trim() || undefined
  const options = await roomOptions(ctx, url, req, requestedProperty)
  const [rows, buildings, floors] = options.propertyId
    ? ((await Promise.all([
        ctx.call('hospitality_core.listRooms', { propertyId: options.propertyId }, url, req),
        ctx.call(
          'hospitality_core.listBuildings',
          { propertyId: options.propertyId, includeArchived: true },
          url,
          req,
        ),
        ctx.call(
          'hospitality_core.listFloors',
          { propertyId: options.propertyId, includeArchived: true },
          url,
          req,
        ),
      ])) as [RoomRow[], BuildingRow[], FloorRow[]])
    : [[], [], []]
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: 'hospitality_core.screen.rooms.title',
    body: (_, frame) =>
      roomsScreen(
        _,
        { rows, ...options, buildings, floors },
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

export const renderRoomDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: RoomFormValues,
) => {
  const room = (await ctx.call('hospitality_core.getRoom', { id }, url, req)) as RoomDetail | null
  if (!room) return text('Not found', { status: 404 })
  const options = await roomOptions(ctx, url, req, room.propertyId, true)
  const lang = ctx.localeOf(url, req)
  return adminPage(ctx, url, req, {
    title: room.name,
    translate: false,
    body: (_, frame) =>
      roomDetailScreen(
        ctx.translate(lang),
        room,
        attempted ?? room,
        options.properties,
        options.roomTypes,
        options.buildings,
        options.floors,
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

export const moveContentImage = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  imageId: string,
  delta: number,
) => {
  if (req.method !== 'POST') return text('POST', { status: 405 })
  const form = await readForm(req)
  const selection = await contentSelection(ctx, url, req)
  const images = await contentImages(ctx, url, req, selection)
  const index = images.findIndex((image) => image.id === imageId)
  if (index < 0) return text('Image not found', { status: 404 })
  const destination = index + delta
  if (destination >= 0 && destination < images.length) {
    const ids = images.map((image) => image.id)
    ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
    const result = (await ctx.call(
      'hospitality_core.reorderContentImages',
      {
        ...(selection.roomTypeId
          ? { roomTypeId: selection.roomTypeId }
          : { propertyId: selection.propertyId }),
        ids,
        expectedPropertyVersion: Number(form.expectedPropertyVersion ?? -1),
        requestKey: form.requestKey,
      },
      url,
      req,
    )) as { ok: boolean }
    if (!result.ok) return contentRedirect(url, selection, 'invalid')
  }
  return contentRedirect(url, selection, 'saved')
}

export {
  loadCollectionRows,
  rowListSearch,
  amenityListSearch,
  folioListSearch,
  policyListSearch,
  propertyListSearch,
  stayListSearch,
  randomUUID,
  dateTimeFormatter,
  text,
  readForm,
  seeOther,
  receiveAttachment,
  amenitiesScreen,
  buildingDetailScreen,
  cleaningTaskDetailScreen,
  cleaningTasksScreen,
  folioDetailScreen,
  foliosScreen,
  floorDetailScreen,
  frontDeskScreen,
  housekeepingRoomDetailScreen,
  housekeepingRoomsScreen,
  newPropertyScreen,
  newRoomScreen,
  newRoomTypeScreen,
  policiesScreen,
  propertiesScreen,
  propertyDetailScreen,
  ratePlansScreen,
  checkOutPrepScreen,
  reservationDetailScreen,
  reservationsScreen,
  inventoryScreen,
  roomsScreen,
  roomDetailScreen,
  roomTypeDetailScreen,
  roomTypesScreen,
  stayDetailScreen,
  staysScreen,
  contentScreen,
  servicesScreen,
  nightAuditScreen,
  stayNoticesScreen,
  addCalendarDays,
  calendarRange,
  dateKeyIn,
  zonedDateTime,
  CLEANING_TASK_STATES,
  ROOM_STATUSES,
  STAY_NOTICE_STATES,
  adminPage,
}

export type {
  Route,
  RouteEntry,
  ServeContext,
  Translator,
  CheckOutReadiness,
  AmenityRow,
  BuildingDetail,
  BuildingFormValues,
  BuildingRow,
  BranchChoice,
  CleaningTaskSummary,
  CleaningTaskRow,
  FolioRow,
  GuestDocumentRow,
  FloorRow,
  FloorDetail,
  FloorFormValues,
  PolicyRow,
  PropertyDetail,
  PropertyFormValues,
  PropertyRow,
  RatePlanRow,
  InventoryRow,
  ReservationRow,
  ReservationDetail,
  ReservationQuote,
  ReservationIntakeValues,
  ReservationAmendmentValues,
  RoomRow,
  RoomDetail,
  RoomFormValues,
  RoomStatusSummary,
  RoomTypeDetail,
  RoomTypeFormValues,
  RoomTypeRow,
  StayRow,
  TapeChart,
  ContentImageRow,
  ExtraLineRow,
  PropertyChargeRow,
  ServiceChargeRow,
  ServiceProductRow,
  NightAuditPreview,
  NightAuditRow,
  StayNoticeRow,
}
