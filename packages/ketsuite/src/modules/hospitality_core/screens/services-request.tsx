import { collectionPages, renderHospitalityCollection } from './collection-page.tsx'
import {
  adminPage,
  propertyTimezone,
  randomUUID,
  readForm,
  redirected,
  servicesScreen,
  text,
} from './request-shared.tsx'
import type {
  ExtraLineRow,
  PropertyChargeRow,
  PropertyRow,
  ReservationRow,
  Route,
  ServeContext,
  ServiceChargeRow,
  ServiceProductRow,
  StayRow,
} from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestServices: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method === 'GET') {
      const record =
        url.searchParams.get('line') ||
        url.searchParams.get('edit') ||
        (url.searchParams.has('create') ? 'new' : null)
      if (record && !url.searchParams.has('record'))
        url.searchParams.set('record', `hospitality.service:${record}`)
      for (const key of ['create', 'line', 'edit']) url.searchParams.delete(key)
    }
    if (req.method === 'GET')
      return renderHospitalityCollection(
        ctx,
        url,
        req,
        collectionPages.find((item) => item.id === 'services')!,
      )
    if (req.method === 'POST') {
      const form = await readForm(req)
      let result: { ok?: boolean }
      if (form.operation === 'save-property-charge')
        result = (await ctx.call(
          'hospitality_core.savePropertyCharge',
          {
            id: form.id ?? '',
            propertyId: form.propertyId ?? '',
            chargeType: form.chargeType ?? '',
            name: form.name ?? '',
            amount: form.amount ?? '',
            description: form.description || undefined,
            active: form.active === '1',
          },
          url,
          req,
        )) as { ok?: boolean }
      else if (form.operation === 'save-extra-line') {
        const target = form.target ?? ''
        const separator = target.indexOf(':')
        const targetType = separator > 0 ? target.slice(0, separator) : ''
        const targetId = separator > 0 ? target.slice(separator + 1) : ''
        result = (await ctx.call(
          'hospitality_core.saveExtraLine',
          {
            id: form.id ?? '',
            ...(targetType === 'reservation' ? { reservationId: targetId } : {}),
            ...(targetType === 'stay' ? { stayId: targetId } : {}),
            productId: form.productId ?? '',
            description: form.description || undefined,
            quantity: form.quantity || undefined,
            unitPrice: form.unitPrice || undefined,
            recurrence: form.recurrence || undefined,
            active: form.active === '1',
          },
          url,
          req,
        )) as { ok?: boolean }
      } else if (form.operation === 'materialize-extra')
        result = (await ctx.call(
          'hospitality_core.materializeExtraLine',
          {
            id: form.id ?? '',
            serviceDate: form.serviceDate || undefined,
            quantity: form.quantity || undefined,
            requestKey: form.requestKey || undefined,
          },
          url,
          req,
        )) as { ok?: boolean }
      else return text('unknown action', { status: 400 })
      return redirected(url, result.ok ? 'saved' : 'invalid', {
        property: form.propertyId || url.searchParams.get('property') || undefined,
      })
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
    const requestedProperty = url.searchParams.get('property')?.trim()
    const propertyId = properties.some((row) => row.id === requestedProperty)
      ? requestedProperty
      : properties[0]?.id
    const [propertyCharges, extraLines, charges, products, reservations, stays] = (await Promise.all([
      ctx.call('hospitality_core.listPropertyCharges', { propertyId }, url, req),
      ctx.call('hospitality_core.listExtraLines', { propertyId }, url, req),
      ctx.call('hospitality_core.listServiceCharges', { propertyId }, url, req),
      ctx.call('hospitality_core.listServiceProducts', {}, url, req),
      ctx.call('hospitality_core.listReservations', { propertyId }, url, req),
      ctx.call('hospitality_core.listStays', { propertyId }, url, req),
    ])) as [
      PropertyChargeRow[],
      ExtraLineRow[],
      ServiceChargeRow[],
      ServiceProductRow[],
      ReservationRow[],
      StayRow[],
    ]
    const targets = [
      ...reservations
        .filter((row) => row.state === 'draft' || row.state === 'confirmed')
        .map((row) => ({
          id: row.id,
          code: row.code,
          name: row.partner?.name ?? row.partnerId,
          type: 'reservation' as const,
        })),
      ...stays
        .filter((row) => row.state === 'checked_in')
        .map((row) => ({
          id: row.id,
          code: row.code,
          name: row.partner?.name ?? row.partnerId,
          type: 'stay' as const,
        })),
    ]
    const timezone = await propertyTimezone(ctx, propertyId, url, req)
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.services.title',
      body: (_, frame) =>
        servicesScreen(
          _,
          {
            properties,
            propertyId,
            products,
            targets,
            propertyCharges,
            extraLines,
            charges,
            ids: { propertyCharge: randomUUID(), extraLine: randomUUID(), requestKey: randomUUID() },
          },
          lang,
          timezone,
          frame,
          url.searchParams.get('status'),
        ),
    })
  }
