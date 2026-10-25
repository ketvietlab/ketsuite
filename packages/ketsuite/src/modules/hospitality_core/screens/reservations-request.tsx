import { seeOther } from '../../backend/forms.ts'
import { hospitalityScopedHref } from './scoped-href.ts'
import { renderReservationBook } from './reservation-book-page.tsx'
import {
  addCalendarDays,
  adminPage,
  dateKeyIn,
  instantFromLocal,
  integer,
  localDateTime,
  modalAction,
  modalHref,
  modalResultRedirect,
  randomUUID,
  readForm,
  redirected,
  reservationsScreen,
  text,
  zonedDateTime,
} from './request-shared.tsx'
import type {
  PropertyRow,
  ReservationIntakeValues,
  ReservationProperty,
  ReservationQuote,
  ReservationRow,
  RoomTypeRow,
  Route,
  ServeContext,
} from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestReservations: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method === 'GET' && url.searchParams.get('create') === '1') {
      const target = new URL(hospitalityScopedHref(url, '/admin/hospitality/reservations/new'), url)
      if (url.searchParams.get('property'))
        target.searchParams.set('propertyId', url.searchParams.get('property')!)
      return seeOther(target.pathname + target.search)
    }
    if (
      req.method === 'GET' &&
      !['create', 'edit', 'filter', 'group', 'groups', 'favorite', 'preview'].some((name) =>
        url.searchParams.has(name),
      )
    ) {
      return renderReservationBook(ctx, url, req)
    }
    if (req.method === 'POST') {
      const form = await readForm(req)
      if (form.operation !== 'quote' && form.operation !== 'create')
        return text('unknown action', { status: 400 })
      const propertyId = form.property?.trim() || ''
      const property = propertyId
        ? ((await ctx.call(
            'hospitality_core.getProperty',
            { id: propertyId },
            url,
            req,
          )) as ReservationProperty | null)
        : null
      const timezone = property?.timezone || 'UTC'
      const checkIn = instantFromLocal(form.checkIn, timezone)
      const checkOut = instantFromLocal(form.checkOut, timezone)
      const values = {
        lang: form.lang,
        create: '1',
        property: propertyId,
        preview: '1',
        id: form.id,
        code: form.code,
        partnerId: form.partnerId,
        roomTypeId: form.roomTypeId,
        bookingType: form.bookingType,
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        adults: form.adults,
        children: form.children,
        rate: form.rate,
      }
      if (!property || !checkIn || !checkOut || !form.partnerId) return redirected(url, 'invalid', values)

      if (form.operation === 'quote') {
        const result = (await ctx.call(
          'hospitality_core.quoteReservation',
          {
            propertyId,
            roomTypeId: form.roomTypeId ?? '',
            bookingType: form.bookingType ?? 'nightly',
            checkIn,
            checkOut,
            adults: integer(form.adults, 1),
            children: integer(form.children),
            rate: form.rate || undefined,
          },
          url,
          req,
        )) as ReservationQuote
        return redirected(url, result.ok ? 'quoted' : 'invalid', values)
      }

      const result = (await ctx.call(
        'hospitality_core.createReservation',
        {
          id: form.id ?? '',
          code: form.code || undefined,
          propertyId,
          partnerId: form.partnerId,
          roomTypeId: form.roomTypeId ?? '',
          provider: 'direct',
          bookingType: form.bookingType ?? 'nightly',
          checkIn,
          checkOut,
          adults: integer(form.adults, 1),
          children: integer(form.children),
          rate: form.rate || undefined,
        },
        url,
        req,
      )) as { ok?: boolean }
      return modalResultRedirect(
        url,
        Boolean(result.ok),
        'saved',
        result.ok ? { lang: form.lang, property: propertyId, preview: undefined } : values,
        [
          'id',
          'code',
          'partnerId',
          'roomTypeId',
          'bookingType',
          'checkIn',
          'checkOut',
          'adults',
          'children',
          'rate',
        ],
      )
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
    const requestedProperty = url.searchParams.get('property')?.trim()
    const propertyId = properties.find((row) => row.id === requestedProperty)?.id ?? properties[0]?.id ?? ''
    const property = propertyId
      ? ((await ctx.call(
          'hospitality_core.getProperty',
          { id: propertyId },
          url,
          req,
        )) as ReservationProperty | null)
      : null
    const timezone = property?.timezone || 'UTC'
    const today = dateKeyIn(new Date(), timezone)
    const checkInClock = /^(\d{2}):(\d{2})$/.exec(property?.defaultCheckIn ?? '')
    const checkOutClock = /^(\d{2}):(\d{2})$/.exec(property?.defaultCheckOut ?? '')
    const defaultCheckIn = zonedDateTime(
      today,
      Number(checkInClock?.[1] ?? 14),
      Number(checkInClock?.[2] ?? 0),
      timezone,
    )
    const defaultCheckOut = zonedDateTime(
      addCalendarDays(today, 1),
      Number(checkOutClock?.[1] ?? 12),
      Number(checkOutClock?.[2] ?? 0),
      timezone,
    )
    const [rows, roomTypes, partners] = (await Promise.all([
      ctx.call(
        'hospitality_core.listReservations',
        { propertyId: propertyId || undefined, state: url.searchParams.get('state') || undefined },
        url,
        req,
      ),
      propertyId ? ctx.call('hospitality_core.listRoomTypes', { propertyId }, url, req) : Promise.resolve([]),
      ctx.call('partner.listPartners', { kind: 'person', limit: 500 }, url, req),
    ])) as [ReservationRow[], RoomTypeRow[], Array<{ id: string; name: string; ref?: string }>]
    const reservationId = url.searchParams.get('id')?.trim() || randomUUID()
    const values: ReservationIntakeValues = {
      id: reservationId,
      code: url.searchParams.get('code')?.trim() || `R-${reservationId.slice(0, 8).toUpperCase()}`,
      propertyId,
      roomTypeId:
        roomTypes.find((row) => row.id === url.searchParams.get('roomTypeId'))?.id ?? roomTypes[0]?.id ?? '',
      partnerId:
        partners.find((row) => row.id === url.searchParams.get('partnerId'))?.id ?? partners[0]?.id ?? '',
      bookingType: ['nightly', 'weekly', 'monthly'].includes(url.searchParams.get('bookingType') ?? '')
        ? url.searchParams.get('bookingType')!
        : 'nightly',
      checkIn: url.searchParams.get('checkIn') || localDateTime(defaultCheckIn, timezone),
      checkOut: url.searchParams.get('checkOut') || localDateTime(defaultCheckOut, timezone),
      adults: Math.max(1, integer(url.searchParams.get('adults') ?? undefined, 1)),
      children: Math.max(0, integer(url.searchParams.get('children') ?? undefined)),
      rate: url.searchParams.get('rate')?.trim() || '',
    }
    let quote: ReservationQuote | null = null
    if (url.searchParams.get('preview') === '1') {
      const checkIn = instantFromLocal(values.checkIn, timezone)
      const checkOut = instantFromLocal(values.checkOut, timezone)
      quote =
        checkIn && checkOut
          ? ((await ctx.call(
              'hospitality_core.quoteReservation',
              {
                propertyId,
                roomTypeId: values.roomTypeId,
                bookingType: values.bookingType,
                checkIn,
                checkOut,
                adults: values.adults,
                children: values.children,
                rate: values.rate || undefined,
              },
              url,
              req,
            )) as ReservationQuote)
          : {
              ok: false,
              errors: [{ messageKey: 'hospitality_core.validation.datetime' }],
            }
    }
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.reservations.title',
      body: (_, frame) =>
        reservationsScreen(
          _,
          { rows, properties, roomTypes, partners, values, quote },
          lang,
          timezone,
          frame,
          url.searchParams.get('status'),
          {
            open: url.searchParams.get('create') === '1',
            createHref: modalHref(url, true, [
              'preview',
              'id',
              'code',
              'partnerId',
              'roomTypeId',
              'bookingType',
              'checkIn',
              'checkOut',
              'adults',
              'children',
              'rate',
            ]),
            closeHref: modalHref(url, false, [
              'id',
              'code',
              'partnerId',
              'roomTypeId',
              'bookingType',
              'checkIn',
              'checkOut',
              'adults',
              'children',
              'rate',
            ]),
            action: modalAction(url),
          },
        ),
    })
  }
