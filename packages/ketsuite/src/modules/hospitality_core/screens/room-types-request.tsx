import { collectionPages, renderHospitalityCollection } from './collection-page.tsx'
import { adminPage, roomTypesScreen, text } from './request-shared.tsx'
import type { PropertyRow, RoomTypeRow, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestRoomTypes: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (
      req.method === 'GET' &&
      !['create', 'edit', 'filter', 'group', 'groups', 'favorite', 'preview'].some((name) =>
        url.searchParams.has(name),
      )
    ) {
      return renderHospitalityCollection(
        ctx,
        url,
        req,
        collectionPages.find((page) => page.id === 'room-types')!,
      )
    }
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
    const requestedProperty = url.searchParams.get('property')?.trim()
    const propertyId = properties.some((row) => row.id === requestedProperty)
      ? requestedProperty
      : properties[0]?.id
    const rows = (await ctx.call('hospitality_core.listRoomTypes', { propertyId }, url, req)) as RoomTypeRow[]
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.roomTypes.title',
      body: (_, frame) => roomTypesScreen(_, rows, properties, propertyId, lang, frame),
    })
  }
