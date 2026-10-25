import { collectionPages, renderHospitalityCollection } from './collection-page.tsx'
import {
  adminPage,
  amenitiesScreen,
  amenityListSearch,
  hospitalityGroupLabel,
  hospitalitySearchFunctions,
  integer,
  modalAction,
  modalErrors,
  modalHref,
  modalResultRedirect,
  modalValues,
  randomUUID,
  readForm,
  rowListSearch,
  text,
} from './request-shared.tsx'
import type { AmenityRow, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestAmenities: RouteEntry =
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
        collectionPages.find((page) => page.id === 'amenities')!,
      )
    }
    if (req.method === 'POST') {
      const form = await readForm(req)
      if (form.operation !== 'save-amenity') return text('unknown action', { status: 400 })
      const result = (await ctx.call(
        'hospitality_core.saveAmenity',
        {
          id: randomUUID(),
          code: form.code ?? '',
          name: form.name ?? '',
          scope: form.scope ?? 'property',
          categoryId: form.categoryId || undefined,
          sequence: integer(form.sequence),
        },
        url,
        req,
      )) as { ok?: boolean }
      const values = {
        code: form.code,
        name: form.name,
        scope: form.scope,
        categoryId: form.categoryId,
        sequence: form.sequence,
      }
      return modalResultRedirect(url, Boolean(result.ok), 'saved', values, Object.keys(values))
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    const [rows, categories] = (await Promise.all([
      ctx.call('hospitality_core.listAmenities', {}, url, req),
      ctx.call('hospitality_core.listAmenityCategories', {}, url, req),
    ])) as [AmenityRow[], Array<{ id: string; name: string }>]
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.amenities.title',
      body: async (_, frame) => {
        const search = await rowListSearch(ctx, url, req, {
          spec: amenityListSearch,
          rows,
          frame,
          name: 'hospitality-amenity-filter',
          bodyId: 'hospitality-amenity-list',
          functions: hospitalitySearchFunctions,
          labels: { searchPlaceholder: _('hospitality_core.screen.amenities.title') },
          groupLabel: (key, value) => hospitalityGroupLabel(_, key, value),
        })
        return amenitiesScreen(
          _,
          search.rows,
          categories,
          search.frame,
          url.searchParams.get('status'),
          {
            open: url.searchParams.get('create') === '1',
            createHref: modalHref(url, true, ['code', 'name', 'scope', 'categoryId', 'sequence']),
            closeHref: modalHref(url, false, ['code', 'name', 'scope', 'categoryId', 'sequence']),
            action: modalAction(url),
            errors: modalErrors(url, _),
            values: modalValues(url, ['code', 'name', 'scope', 'categoryId', 'sequence']),
          },
          search.groups ? { groups: search.groups } : undefined,
        )
      },
    })
  }
