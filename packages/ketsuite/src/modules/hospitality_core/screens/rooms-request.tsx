import { collectionPages, renderHospitalityCollection } from './collection-page.tsx'
import {
  integer,
  operationErrors,
  randomUUID,
  readForm,
  renderRooms,
  seeOther,
  text,
} from './request-shared.tsx'
import type { OperationResult, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestRooms: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (
      req.method === 'GET' &&
      !['create', 'edit', 'filter', 'group', 'groups', 'favorite', 'preview'].some((name) =>
        url.searchParams.has(name),
      )
    ) {
      return renderHospitalityCollection(ctx, url, req, collectionPages.find((page) => page.id === 'rooms')!)
    }
    if (req.method === 'GET') return renderRooms(ctx, url, req)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const form = await readForm(req)
    const operation = form.operation?.trim()
    const propertyId = form.propertyId?.trim() || ''
    let result: OperationResult
    let status: string
    if (operation === 'save-building') {
      result = (await ctx.call(
        'hospitality_core.saveBuilding',
        {
          id: randomUUID(),
          propertyId,
          code: form.code?.trim() || '',
          name: form.name?.trim() || '',
          sequence: integer(form.sequence, 10),
        },
        url,
        req,
      )) as OperationResult
      status = 'building-created'
    } else if (operation === 'save-floor') {
      result = (await ctx.call(
        'hospitality_core.saveFloor',
        {
          id: randomUUID(),
          propertyId,
          buildingId: form.buildingId?.trim() || '',
          code: form.code?.trim() || '',
          name: form.name?.trim() || '',
          sequence: integer(form.sequence, 10),
        },
        url,
        req,
      )) as OperationResult
      status = 'floor-created'
    } else return text('unknown action', { status: 400 })
    if (!result.ok) return renderRooms(ctx, url, req, operationErrors(ctx, url, req, result))
    const query = new URLSearchParams({ property: propertyId, status, lang: ctx.localeOf(url, req) })
    return seeOther(`/admin/hospitality/rooms?${query.toString()}`)
  }
