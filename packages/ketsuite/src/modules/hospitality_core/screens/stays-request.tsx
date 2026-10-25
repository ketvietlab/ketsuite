import { renderStayBook } from './stay-book-page.tsx'
import {
  adminPage,
  hospitalityGroupLabel,
  hospitalitySearchFunctions,
  propertyTimezone,
  rowListSearch,
  selectedProperty,
  stayListSearch,
  staysScreen,
} from './request-shared.tsx'
import type { Route, ServeContext, StayRow } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestStays: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (
      req.method === 'GET' &&
      !['create', 'edit', 'filter', 'group', 'groups', 'favorite', 'preview'].some((name) =>
        url.searchParams.has(name),
      )
    ) {
      return renderStayBook(ctx, url, req)
    }
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const propertyId = await selectedProperty(ctx, url, req)
    const timezone = await propertyTimezone(ctx, propertyId, url, req)
    // The bar owns the state now, so the list is read whole and narrowed here.
    const rows = (await ctx.call('hospitality_core.listStays', { propertyId }, url, req)) as StayRow[]
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.stays.title',
      body: async (_, frame) => {
        const search = await rowListSearch(ctx, url, req, {
          spec: stayListSearch,
          rows,
          frame,
          name: 'hospitality-stay-filter',
          bodyId: 'hospitality-stay-list',
          functions: hospitalitySearchFunctions,
          labels: { searchPlaceholder: _('hospitality_core.screen.stays.title') },
          groupLabel: (key, value) => hospitalityGroupLabel(_, key, value),
        })
        return staysScreen(
          _,
          search.rows,
          lang,
          timezone,
          search.frame,
          search.groups ? { groups: search.groups } : undefined,
        )
      },
    })
  }
