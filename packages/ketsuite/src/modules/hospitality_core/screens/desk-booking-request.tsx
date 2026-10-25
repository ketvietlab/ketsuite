import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { shell } from '../../../ui/index.ts'
import { messages } from '../messages.ts'
import { messages as billingMessages } from '../../hospitality_billing/messages.ts'
import { HOSPITALITY_RECORD_LABELS } from '../records/config.ts'
import type { DeskBookingData } from '../records/desk-booking-page.tsx'
import { hospitalityAdminPage } from './hospitality-admin-page.tsx'
import { hospitalityScopedHref } from './scoped-href.ts'

type Row = Record<string, unknown>
export const deskBookingRequest =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('hospitality_core.getDeskBookingContext', url, req)))
      return text('Forbidden', { status: 403 })
    const { record } = (await ctx.call(
      'hospitality_core.getDeskBookingContext',
      { propertyId: url.searchParams.get('propertyId') ?? undefined },
      url,
      req,
    )) as { record: Row | null }
    const locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi',
      _ = ctx.translate(locale)
    const property = (record?.property ?? {}) as Row
    const query: Row = {
      propertyId: url.searchParams.get('propertyId') ?? property.id,
      arrival: url.searchParams.get('arrival') ?? record?.today,
      departure: url.searchParams.get('departure') ?? record?.departure,
      adults: url.searchParams.get('adults') ?? '2',
      children: url.searchParams.get('children') ?? '0',
    }
    const integer = (value: unknown) => (Number.isSafeInteger(Number(value)) ? Number(value) : -1)
    query.walkIn = url.searchParams.get('walkIn') === '1'
    const input = { ...query, adults: integer(query.adults), children: integer(query.children) }
    const ratePlanId = url.searchParams.get('ratePlanId')
    let results: Row | null = null,
      quote: Row | null = null,
      quoteErrors: Row[] = []
    if (record && ratePlanId) {
      query.ratePlanId = ratePlanId
      if (!(await ctx.allows('hospitality_core.getDeskBookingQuote', url, req)))
        return text('Forbidden', { status: 403 })
      const result = (await ctx.call(
        'hospitality_core.getDeskBookingQuote',
        { ...input, ratePlanId },
        url,
        req,
      )) as Row
      quote = result.ok ? (result.quote as Row) : null
      quoteErrors = (result.errors ?? []) as Row[]
    } else if (record && url.searchParams.get('search') === '1') {
      if (!(await ctx.allows('hospitality_core.searchDeskOffers', url, req)))
        return text('Forbidden', { status: 403 })
      results = (await ctx.call(
        'hospitality_core.searchDeskOffers',
        { ...input, page: Number(url.searchParams.get('page')) || 1 },
        url,
        req,
      )) as Row
    }
    const can: Record<string, boolean> = {}
    for (const [key, fn] of Object.entries({
      confirm: 'hospitality_billing.confirmDeskBooking',
      card: 'hospitality_billing.setReservationGuarantee',
      collect: 'hospitality_billing.takeReservationGuarantee',
      checkIn: 'hospitality_core.checkIn',
      declareGuests: 'hospitality_core.declareArrivalGuests',
    }))
      can[key] = await ctx.allows(fn, url, req)
    if (query.walkIn)
      can.confirm = can.confirm && can.checkIn && can.declareGuests && (can.card || can.collect)
    const translated: Record<string, string> = { ...HOSPITALITY_RECORD_LABELS[locale] }
    for (const key of Object.keys(messages[locale]).filter((key) =>
      /^(form\.|deskBooking\.|collection\.lookup\.|record\.option\.|reservation\.|stay\.document\.|document\.|gender\.|validation\.)/.test(
        key,
      ),
    ))
      translated[`hospitality_core.${key}`] = _(`hospitality_core.${key}`)
    for (const key of Object.keys(billingMessages[locale]).filter((key) => key.startsWith('validation.')))
      translated[`hospitality_billing.${key}`] = _(`hospitality_billing.${key}`)
    const data: DeskBookingData = {
      record,
      query,
      results,
      quote,
      quoteErrors,
      can,
      locale,
      scope: new URLSearchParams(
        [...url.searchParams].filter(([key]) =>
          ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
        ),
      ).toString(),
      commandKey: randomUUID(),
      backHref: hospitalityScopedHref(url, '/admin/hospitality/reservations'),
    }
    const envelope = { data, messages: translated }
    if (url.pathname.endsWith('/context')) return json(envelope)
    const title = _(`hospitality_core.deskBooking.${query.walkIn ? 'walkInTitle' : 'title'}`)
    const island = await ctx.joint(url, req, 'hospitality_core:deskBooking.page', {
      id: 'new',
      title,
      loading: translated['recordModal.loading'],
      back: data.backHref,
      width: 'wide',
      envelope,
    })
    return hospitalityAdminPage(ctx, url, req, {
      title,
      translate: false,
      body: (_, frame) => shell(_, title, <>{island}</>, { ...frame, topbar: false, titled: false }),
    })
  }
