import {
  adminPage,
  defaultRoomValues,
  newRoomScreen,
  operationErrors,
  randomUUID,
  readForm,
  roomFormValues,
  roomOptions,
  seeOther,
  text,
} from './request-shared.tsx'
import type { OperationResult, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestRoomsNew: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    const requestedProperty = url.searchParams.get('property')?.trim() || undefined
    const initial = await roomOptions(ctx, url, req, requestedProperty)
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    if (!initial.propertyId || !initial.roomTypes.length)
      return seeOther(`/admin/hospitality/rooms?lang=${encodeURIComponent(lang)}`)
    if (req.method === 'GET') {
      const values = defaultRoomValues(randomUUID(), initial.propertyId, initial.roomTypes[0]!.id)
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.room.create.title',
        body: (_, frame) =>
          newRoomScreen(
            _,
            values,
            initial.properties,
            initial.roomTypes,
            initial.buildings,
            initial.floors,
            lang,
            frame,
          ),
      })
    }
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const form = await readForm(req)
    const values = roomFormValues(randomUUID(), form)
    const options = await roomOptions(ctx, url, req, values.propertyId)
    const result = (await ctx.call('hospitality_core.saveRoom', values, url, req)) as OperationResult
    if (!result.ok)
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.room.create.title',
        body: (_, frame) =>
          newRoomScreen(
            _,
            values,
            options.properties,
            options.roomTypes,
            options.buildings,
            options.floors,
            lang,
            frame,
            operationErrors(ctx, url, req, result),
          ),
      })
    const query = new URLSearchParams({ status: 'created', lang })
    return seeOther(`/admin/hospitality/rooms/${encodeURIComponent(values.id)}?${query.toString()}`)
  }
