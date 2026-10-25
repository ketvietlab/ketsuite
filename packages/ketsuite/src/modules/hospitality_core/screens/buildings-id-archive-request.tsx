import { operationErrors, readForm, renderBuildingDetail, seeOther, text } from './request-shared.tsx'
import type { OperationResult, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestBuildingsIdArchive: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    const form = await readForm(req)
    const active = form.action === 'restore'
    const result = (await ctx.call(
      'hospitality_core.archiveBuilding',
      {
        id: params.id,
        active,
        propertyId: form.propertyId,
        expectedVersion: Number(form.expectedVersion),
        expectedPropertyVersion: Number(form.expectedPropertyVersion),
        requestKey: form.requestKey,
      },
      url,
      req,
    )) as OperationResult
    if (!result.ok)
      return renderBuildingDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
    const query = new URLSearchParams({
      status: active ? 'restored' : 'archived',
      lang: ctx.localeOf(url, req),
    })
    return seeOther(`/admin/hospitality/buildings/${encodeURIComponent(params.id)}?${query.toString()}`)
  }
