import {
  operationErrors,
  readForm,
  renderRoomDetail,
  roomFormValues,
  seeOther,
  text,
} from './request-shared.tsx'
import type { OperationResult, RoomDetail, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestRoomsId: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'GET') return renderRoomDetail(ctx, url, req, params.id)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const current = (await ctx.call(
      'hospitality_core.getRoom',
      { id: params.id },
      url,
      req,
    )) as RoomDetail | null
    if (!current) return text('Not found', { status: 404 })
    const form = await readForm(req)
    const values = roomFormValues(params.id, form, current)
    const result = (await ctx.call('hospitality_core.saveRoom', values, url, req)) as OperationResult
    if (!result.ok)
      return renderRoomDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), values)
    const query = new URLSearchParams({ status: 'saved', lang: ctx.localeOf(url, req) })
    return seeOther(`${url.pathname}?${query.toString()}`)
  }
