import { collectionPages, renderHospitalityCollection } from './collection-page.tsx'
import {
  adminPage,
  integer,
  modalAction,
  modalErrors,
  modalHref,
  modalResultRedirect,
  modalValues,
  randomUUID,
  ratePlansScreen,
  readForm,
  text,
} from './request-shared.tsx'
import type { PropertyRow, RatePlanRow, RoomTypeRow, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestRatePlans: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (
      req.method === 'GET' &&
      !['create', 'edit', 'filter', 'group', 'groups', 'favorite', 'preview'].some((name) =>
        url.searchParams.has(name),
      )
    ) {
      return renderHospitalityCollection(ctx, url, req, collectionPages.find((page) => page.id === 'rates')!)
    }
    if (req.method === 'POST') {
      const form = await readForm(req)
      if (form.operation !== 'save-rate-plan') return text('unknown action', { status: 400 })
      const result = (await ctx.call(
        'hospitality_core.saveRatePlan',
        {
          id: randomUUID(),
          propertyId: form.propertyId ?? '',
          roomTypeId: form.roomTypeId ?? '',
          code: form.code ?? '',
          name: form.name ?? '',
          rateType: form.rateType ?? 'nightly',
          amount: form.amount ?? '',
          mealPlan: form.mealPlan || undefined,
          minStay: integer(form.minStay),
          maxStay: integer(form.maxStay),
          isDefault: form.isDefault === '1',
          active: form.active === '1',
        },
        url,
        req,
      )) as { ok?: boolean }
      const values = {
        property: form.propertyId,
        roomTypeId: form.roomTypeId,
        code: form.code,
        name: form.name,
        rateType: form.rateType,
        amount: form.amount,
        mealPlan: form.mealPlan,
        minStay: form.minStay,
        maxStay: form.maxStay,
        isDefault: form.isDefault,
        active: form.active,
      }
      return modalResultRedirect(
        url,
        Boolean(result.ok),
        'saved',
        values,
        Object.keys(values).filter((key) => key !== 'property'),
      )
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
    const requestedProperty = url.searchParams.get('property')?.trim()
    const propertyId = properties.some((row) => row.id === requestedProperty)
      ? requestedProperty
      : properties[0]?.id
    const [rows, roomTypes] = (await Promise.all([
      ctx.call('hospitality_core.listRatePlans', { propertyId }, url, req),
      ctx.call('hospitality_core.listRoomTypes', { propertyId }, url, req),
    ])) as [RatePlanRow[], RoomTypeRow[]]
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.ratePlans.title',
      body: (_, frame) =>
        ratePlansScreen(_, rows, properties, roomTypes, propertyId, frame, url.searchParams.get('status'), {
          open: url.searchParams.get('create') === '1',
          createHref: modalHref(url, true, [
            'roomTypeId',
            'code',
            'name',
            'rateType',
            'amount',
            'mealPlan',
            'minStay',
            'maxStay',
            'isDefault',
            'active',
          ]),
          closeHref: modalHref(url, false, [
            'roomTypeId',
            'code',
            'name',
            'rateType',
            'amount',
            'mealPlan',
            'minStay',
            'maxStay',
            'isDefault',
            'active',
          ]),
          action: modalAction(url),
          errors: modalErrors(url, _),
          values: modalValues(url, [
            'roomTypeId',
            'code',
            'name',
            'rateType',
            'amount',
            'mealPlan',
            'minStay',
            'maxStay',
            'isDefault',
            'active',
          ]),
        }),
    })
  }
