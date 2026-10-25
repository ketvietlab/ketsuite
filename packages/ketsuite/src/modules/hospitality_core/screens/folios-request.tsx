import { renderFolioBook } from './folio-book-page.tsx'
import {
  adminPage,
  folioListSearch,
  foliosScreen,
  hospitalityGroupLabel,
  hospitalitySearchFunctions,
  propertyTimezone,
  rowListSearch,
  selectedProperty,
} from './request-shared.tsx'
import type { FolioRow, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestFolios: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (
      req.method === 'GET' &&
      !['create', 'edit', 'filter', 'group', 'groups', 'favorite', 'preview'].some((name) =>
        url.searchParams.has(name),
      )
    ) {
      return renderFolioBook(ctx, url, req)
    }
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const propertyId = await selectedProperty(ctx, url, req)
    const timezone = await propertyTimezone(ctx, propertyId, url, req)
    const rows = (await ctx.call('hospitality_core.listFolios', { propertyId }, url, req)) as FolioRow[]
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.folios.title',
      body: async (_, frame) => {
        const search = await rowListSearch(ctx, url, req, {
          spec: folioListSearch,
          rows,
          frame,
          name: 'hospitality-folio-filter',
          bodyId: 'hospitality-folio-list',
          functions: hospitalitySearchFunctions,
          labels: { searchPlaceholder: _('hospitality_core.screen.folios.title') },
          groupLabel: (key, value) => hospitalityGroupLabel(_, key, value, 'folioState'),
        })
        return foliosScreen(
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
