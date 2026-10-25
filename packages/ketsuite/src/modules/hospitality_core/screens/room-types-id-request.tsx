import {
  operationErrors,
  readForm,
  renderRoomTypeDetail,
  roomTypeFormValues,
  roomTypeInputErrors,
  seeOther,
  text,
} from './request-shared.tsx'
import type { OperationResult, RoomTypeDetail, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestRoomTypesId: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'GET') return renderRoomTypeDetail(ctx, url, req, params.id)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const current = (await ctx.call(
      'hospitality_core.getRoomType',
      { id: params.id },
      url,
      req,
    )) as RoomTypeDetail | null
    if (!current) return text('Not found', { status: 404 })
    const form = await readForm(req)
    const values = roomTypeFormValues(params.id, form, current)
    const inputErrors = roomTypeInputErrors(ctx, url, req, values)
    if (inputErrors.length) return renderRoomTypeDetail(ctx, url, req, params.id, inputErrors, values)
    const result = (await ctx.call('hospitality_core.saveRoomType', values, url, req)) as OperationResult
    if (!result.ok)
      return renderRoomTypeDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), values)
    const query = new URLSearchParams({ status: 'saved', lang: ctx.localeOf(url, req) })
    return seeOther(`${url.pathname}?${query.toString()}`)
  }
