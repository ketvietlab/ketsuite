import { collectionPages, renderHospitalityCollection } from './collection-page.tsx'
import {
  adminPage,
  hospitalityGroupLabel,
  hospitalitySearchFunctions,
  propertiesScreen,
  propertyListSearch,
  rowListSearch,
  text,
} from './request-shared.tsx'
import type { PropertyRow, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestProperties: RouteEntry =
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
        collectionPages.find((page) => page.id === 'properties')!,
      )
    }
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.properties.title',
      body: async (_, frame) => {
        const search = await rowListSearch(ctx, url, req, {
          spec: propertyListSearch,
          rows: properties,
          frame,
          name: 'hospitality-property-filter',
          bodyId: 'hospitality-property-list',
          functions: hospitalitySearchFunctions,
          labels: { searchPlaceholder: _('hospitality_core.screen.properties.title') },
          groupLabel: (key, value) => hospitalityGroupLabel(_, key, value),
        })
        return propertiesScreen(
          _,
          search.rows,
          // The totals are about the estate, not about what the bar kept.
          {
            rooms: properties.reduce((sum, property) => sum + property.rooms, 0),
            available: properties.reduce((sum, property) => sum + property.availableRooms, 0),
            attention: properties.reduce((sum, property) => sum + property.attentionRooms, 0),
          },
          lang,
          search.frame,
          search.groups ? { groups: search.groups } : undefined,
        )
      },
    })
  }
