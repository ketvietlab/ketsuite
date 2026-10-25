import { operationErrors, readForm, renderRoomDetail, seeOther, text } from './request-shared.tsx'
import type { OperationResult, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestRoomsIdArchive: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    const form = await readForm(req)
    const active = form.action === 'restore'
    const result = (await ctx.call(
      'hospitality_core.archiveRoom',
      { id: params.id, active },
      url,
      req,
    )) as OperationResult
    if (!result.ok) return renderRoomDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
    const query = new URLSearchParams({
      status: active ? 'restored' : 'archived',
      lang: ctx.localeOf(url, req),
    })
    return seeOther(`/admin/hospitality/rooms/${encodeURIComponent(params.id)}?${query.toString()}`)
  }
