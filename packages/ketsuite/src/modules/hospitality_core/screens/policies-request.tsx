import { collectionPages, renderHospitalityCollection } from './collection-page.tsx'
import {
  adminPage,
  hospitalityGroupLabel,
  hospitalitySearchFunctions,
  integer,
  modalAction,
  modalErrors,
  modalHref,
  modalResultRedirect,
  modalValues,
  policiesScreen,
  policyListSearch,
  randomUUID,
  readForm,
  rowListSearch,
  text,
} from './request-shared.tsx'
import type { PolicyRow, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestPolicies: RouteEntry =
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
        collectionPages.find((page) => page.id === 'policies')!,
      )
    }
    if (req.method === 'POST') {
      const form = await readForm(req)
      if (form.operation !== 'save-policy') return text('unknown action', { status: 400 })
      const result = (await ctx.call(
        'hospitality_core.saveCancellationPolicy',
        {
          id: randomUUID(),
          code: form.code ?? '',
          name: form.name ?? '',
          type: form.type ?? 'flexible',
          description: form.description || undefined,
          freeCancellationHours: integer(form.freeCancellationHours),
          penaltyPercent: form.penaltyPercent ?? '0',
        },
        url,
        req,
      )) as { ok?: boolean }
      const values = {
        code: form.code,
        name: form.name,
        type: form.type,
        description: form.description,
        freeCancellationHours: form.freeCancellationHours,
        penaltyPercent: form.penaltyPercent,
      }
      return modalResultRedirect(url, Boolean(result.ok), 'saved', values, Object.keys(values))
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    const rows = (await ctx.call('hospitality_core.listCancellationPolicies', {}, url, req)) as PolicyRow[]
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.policies.title',
      body: async (_, frame) => {
        const search = await rowListSearch(ctx, url, req, {
          spec: policyListSearch,
          rows,
          frame,
          name: 'hospitality-policy-filter',
          bodyId: 'hospitality-policy-list',
          functions: hospitalitySearchFunctions,
          labels: { searchPlaceholder: _('hospitality_core.screen.policies.title') },
          groupLabel: (key, value) => hospitalityGroupLabel(_, key, value),
        })
        return policiesScreen(
          _,
          search.rows,
          search.frame,
          url.searchParams.get('status'),
          {
            open: url.searchParams.get('create') === '1',
            createHref: modalHref(url, true, [
              'code',
              'name',
              'type',
              'description',
              'freeCancellationHours',
              'penaltyPercent',
            ]),
            closeHref: modalHref(url, false, [
              'code',
              'name',
              'type',
              'description',
              'freeCancellationHours',
              'penaltyPercent',
            ]),
            action: modalAction(url),
            errors: modalErrors(url, _),
            values: modalValues(url, [
              'code',
              'name',
              'type',
              'description',
              'freeCancellationHours',
              'penaltyPercent',
            ]),
          },
          search.groups ? { groups: search.groups } : undefined,
        )
      },
    })
  }
