import {
  buildingFormValues,
  operationErrors,
  readForm,
  renderBuildingDetail,
  seeOther,
  text,
} from './request-shared.tsx'
import type { BuildingDetail, OperationResult, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestBuildingsId: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'GET') return renderBuildingDetail(ctx, url, req, params.id)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const current = (await ctx.call(
      'hospitality_core.getBuilding',
      { id: params.id },
      url,
      req,
    )) as BuildingDetail | null
    if (!current) return text('Not found', { status: 404 })
    const values = buildingFormValues(params.id, await readForm(req), current)
    const result = (await ctx.call('hospitality_core.saveBuilding', values, url, req)) as OperationResult
    if (!result.ok)
      return renderBuildingDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), values)
    const query = new URLSearchParams({ status: 'saved', lang: ctx.localeOf(url, req) })
    return seeOther(`${url.pathname}?${query.toString()}`)
  }
