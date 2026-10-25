import { json, text } from '@ketvietlab/ketjs'
import { randomUUID } from 'node:crypto'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { catalogueRecords, HOSPITALITY_RECORD_LABELS } from '../records/config.ts'
import { messages } from '../messages.ts'

/** The route owns capabilities; each data read still checks its function permission. */
export const hospitalityRecordContextRequest: RouteEntry = (ctx) => async (url, req) => {
  if (req.method !== 'GET') return text('GET', { status: 405 })
  const parts = url.pathname.split('/'),
    definition = catalogueRecords.find((item) => url.pathname.startsWith(`/admin/hospitality/${item.path}/`))
  if (!definition) return text('Not found', { status: 404 })
  const id = decodeURIComponent(parts.at(-2)!),
    creating = id === 'new',
    locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const readAllowed = await ctx.allows(`hospitality_core.${definition.read}`, url, req)
  const canSave = await ctx.allows(`hospitality_core.${definition.save}`, url, req)
  if ((!creating && !readAllowed) || (creating && !canSave)) return text('Forbidden', { status: 403 })
  const value = creating
    ? { record: Object.fromEntries(definition.fields.map((field) => [field.name, field.default ?? ''])) }
    : ((await ctx.call(`hospitality_core.${definition.read}`, { id }, url, req)) as {
        record: Record<string, unknown> | null
      })
  if (!value.record) return text('Not found', { status: 404 })
  if (creating && definition.kind === 'notice') return text('Not found', { status: 404 })
  if (creating) {
    value.record.id = randomUUID()
    // New policies use the agreed templates. Legacy policies without a feeRule
    // still render the percentage fallback from the catalogue definition.
    if (definition.kind === 'policy') value.record.feeRule = 'template'
    if (definition.kind === 'cleaningTask')
      value.record.dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  }
  if (creating && url.searchParams.get('property')) value.record.propertyId = url.searchParams.get('property')
  if (creating && definition.kind === 'cleaningTask' && url.searchParams.get('room')) {
    const { record: room } = (await ctx.call(
      'hospitality_core.getRoomRecord',
      { id: url.searchParams.get('room') },
      url,
      req,
    )) as { record: Record<string, unknown> | null }
    if (!room || room.propertyId !== value.record.propertyId) return text('Not found', { status: 404 })
    value.record.roomId = room.id
    value.record.room = { id: room.id, code: room.code, name: room.name }
    value.record.taskType = room.status === 'occupied' ? 'daily_clean' : 'checkout_clean'
  }
  if (creating && definition.kind === 'floor' && url.searchParams.get('building'))
    value.record.buildingId = url.searchParams.get('building')
  if (creating && definition.kind === 'locale' && url.searchParams.get('locale'))
    value.record.locale = url.searchParams.get('locale')
  if (creating && definition.kind === 'locale' && url.searchParams.get('roomType')) {
    const result = (await ctx.call(
      'hospitality_core.getRoomTypeRecord',
      { id: url.searchParams.get('roomType') },
      url,
      req,
    )) as { record: Record<string, unknown> | null }
    if (!result.record || result.record.propertyId !== value.record.propertyId)
      return text('Not found', { status: 404 })
    value.record.roomTypeId = result.record.id
    value.record.title = result.record.publicName ?? result.record.name ?? ''
    if (value.record.locale === 'vi') value.record.description = result.record.description ?? ''
  }
  if (creating && definition.kind === 'service' && url.searchParams.get('target'))
    value.record.target = url.searchParams.get('target')
  const parentValue =
    value.record.propertyId && (await ctx.allows('hospitality_core.getCataloguePropertyContext', url, req))
      ? ((await ctx.call(
          'hospitality_core.getCataloguePropertyContext',
          { id: value.record.propertyId },
          url,
          req,
        )) as {
          property: { version?: number; name?: string; publicName?: string; description?: string } | null
        })
      : null
  const parent = parentValue?.property
  if (creating && definition.kind === 'locale' && parent && !value.record.roomTypeId) {
    value.record.title = parent.publicName ?? parent.name ?? ''
    if (value.record.locale === 'vi') value.record.description = parent.description ?? ''
  }
  const canLifecycle =
    !!definition.lifecycle && (await ctx.allows(`hospitality_core.${definition.lifecycle}`, url, req))
  const choices: Record<string, Array<Record<string, unknown>>> = {}
  const lookups = [...new Set(definition.fields.flatMap((field) => (field.lookup ? [field.lookup] : [])))]
  const functions = {
    policies: 'lookupPolicies',
    amenities: 'lookupRoomAmenities',
    properties: 'lookupProperties',
    roomTypes: 'lookupRoomTypes',
    buildings: 'lookupBuildings',
    floors: 'lookupFloors',
    categories: 'lookupAmenityCategories',
    rooms: 'lookupRooms',
    staff: 'lookupCleaningStaff',
    serviceTargets: 'lookupServiceTargets',
    serviceProducts: 'lookupServiceProducts',
  }
  for (const lookup of lookups) {
    const key = `hospitality_core.${functions[lookup]}`
    if (!(await ctx.allows(key, url, req))) {
      choices[lookup] =
        lookup === 'amenities' && Array.isArray(value.record.amenityOptions)
          ? (value.record.amenityOptions as Array<Record<string, unknown>>)
          : []
      continue
    }
    const args = {
      propertyId:
        lookup === 'properties' ? null : value.record.propertyId || url.searchParams.get('property') || null,
      limit: 20,
    }
    const response = (await ctx.call(key, args, url, req)) as
      | { rows?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>
    choices[lookup] = Array.isArray(response) ? response : (response.rows ?? [])
    if (lookup === 'amenities' && Array.isArray(value.record.amenityOptions)) {
      for (const option of value.record.amenityOptions as Array<Record<string, unknown>>)
        if (!choices[lookup]!.some((item) => item.id === option.id)) choices[lookup]!.push(option)
    }
    const field = definition.fields.find((field) => field.lookup === lookup)!
    const selectedValues = field.multiple
      ? ((value.record[field.name] as string[]) ?? [])
      : [value.record[field.name]]
    for (const selected of selectedValues)
      if (selected && !choices[lookup]!.some((option) => option.id === selected)) {
        const current = (await ctx.call(key, { ...args, id: selected, limit: 1 }, url, req)) as Array<
          Record<string, unknown>
        >
        choices[lookup]!.push(...current)
      }
  }
  const canConfirm =
    definition.kind === 'notice' &&
    value.record.state === 'submitted' &&
    (await ctx.allows('hospitality_core.confirmStayNotice', url, req))
  const canRefresh =
    definition.kind === 'notice' &&
    value.record.state === 'attention' &&
    (await ctx.allows('hospitality_core.requestStayNoticeRefresh', url, req))
  const canStart =
    definition.kind === 'cleaningTask' && (await ctx.allows('hospitality_core.startCleaningTask', url, req))
  const canComplete =
    definition.kind === 'cleaningTask' &&
    (await ctx.allows('hospitality_core.completeCleaningTask', url, req))
  const identity = definition.kind === 'cleaningTask' ? await ctx.requestIdentityOf(url, req) : null
  const ownTask = canSave || identity?.userId === value.record.assigneeId
  const translated = Object.fromEntries(
    Object.entries(messages[locale]).map(([key, value]) => [`hospitality_core.${key}`, value]),
  )
  return json({
    data: {
      record: value.record,
      choices,
      canSave:
        canSave &&
        value.record.locked !== true &&
        (definition.kind !== 'notice' || value.record.state === 'ready'),
      canLifecycle,
      canConfirm,
      canRefresh,
      now: new Date().toISOString(),
      propertyVersion: parent?.version ?? 0,
      propertyLocked: !!definition.parentPage && !!url.searchParams.get('property'),
      canStart: canStart && ownTask,
      canComplete: canComplete && ownTask,
      locale,
      commandKey: randomUUID(),
    },
    messages: { ...translated, ...HOSPITALITY_RECORD_LABELS[locale] },
  })
}
