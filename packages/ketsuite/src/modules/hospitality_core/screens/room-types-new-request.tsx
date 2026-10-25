import {
  adminPage,
  defaultRoomTypeValues,
  newRoomTypeScreen,
  operationErrors,
  randomUUID,
  readForm,
  roomTypeFormValues,
  roomTypeInputErrors,
  seeOther,
  text,
} from './request-shared.tsx'
import type { OperationResult, PolicyRow, PropertyRow, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestRoomTypesNew: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const [properties, policies] = (await Promise.all([
      ctx.call('hospitality_core.listProperties', {}, url, req),
      ctx.call('hospitality_core.listCancellationPolicies', {}, url, req),
    ])) as [PropertyRow[], PolicyRow[]]
    const requestedProperty = url.searchParams.get('property')?.trim()
    const propertyId = properties.find((row) => row.id === requestedProperty)?.id ?? properties[0]?.id ?? ''
    if (req.method === 'GET') {
      const values = defaultRoomTypeValues(randomUUID(), propertyId)
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.roomType.create.title',
        body: (_, frame) => newRoomTypeScreen(_, values, properties, policies, lang, frame),
      })
    }
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const form = await readForm(req)
    const values = roomTypeFormValues(randomUUID(), form)
    const inputErrors = roomTypeInputErrors(ctx, url, req, values)
    if (inputErrors.length)
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.roomType.create.title',
        body: (_, frame) => newRoomTypeScreen(_, values, properties, policies, lang, frame, inputErrors),
      })
    const result = (await ctx.call('hospitality_core.saveRoomType', values, url, req)) as OperationResult
    if (!result.ok)
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.roomType.create.title',
        body: (_, frame) =>
          newRoomTypeScreen(
            _,
            values,
            properties,
            policies,
            lang,
            frame,
            operationErrors(ctx, url, req, result),
          ),
      })
    const query = new URLSearchParams({ status: 'created', lang })
    return seeOther(`/admin/hospitality/room-types/${encodeURIComponent(values.id)}?${query.toString()}`)
  }
