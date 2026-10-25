import { reservationWorkspaceRequest } from './reservation-workspace-request.tsx'
import {
  instantFromLocal,
  integer,
  operationErrors,
  propertyTimezone,
  readForm,
  renderReservationDetail,
  seeOther,
  text,
} from './request-shared.tsx'
import type {
  OperationResult,
  ReservationAmendmentValues,
  ReservationDetail,
  Route,
  ServeContext,
} from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestReservationsId: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'GET' && url.searchParams.get('action') === 'check-out') {
      const next = new URL(url)
      next.searchParams.delete('action')
      next.searchParams.set('dialog', 'checkout')
      return seeOther(next.pathname + next.search)
    }
    if (req.method === 'GET')
      return url.searchParams.has('action') || url.searchParams.has('finance')
        ? renderReservationDetail(ctx, url, req, params.id)
        : reservationWorkspaceRequest(ctx)(url, req, params)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const form = await readForm(req)
    if (
      !/^[a-zA-Z0-9:_-]{8,160}$/.test(form.requestKey ?? '') ||
      !/^\d+$/.test(form.expectedVersion ?? '') ||
      !Number.isSafeInteger(Number(form.expectedVersion))
    )
      return text('Invalid request identity', { status: 400 })
    const identity = { expectedVersion: Number(form.expectedVersion), requestKey: form.requestKey! }
    const reservation = (await ctx.call(
      'hospitality_core.getReservation',
      { id: params.id },
      url,
      req,
    )) as ReservationDetail | null
    if (!reservation) return text('Not found', { status: 404 })

    let result: OperationResult
    let status:
      | 'checked-in'
      | 'checked-out'
      | 'checked-out-early'
      | 'cancelled'
      | 'amended'
      | 'no-show'
      | 'departure-adjusted'
      | 'guaranteed'
      | 'room-held'
      | 'room-hold-released'
    if (form.operation === 'take-deposit' || form.operation === 'set-guarantee') {
      if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(form.requestKey ?? '') || !/^\d+$/.test(form.expectedVersion ?? ''))
        return text('Invalid request identity', { status: 400 })
      const common = {
        reservationId: params.id,
        amount: form.amount ?? '0',
        expectedVersion: Number(form.expectedVersion),
        requestKey: form.requestKey!,
      }
      const input =
        form.operation === 'take-deposit'
          ? {
              ...common,
              journalId: form.journalId ?? '',
              reference: form.reference ?? '',
              memo: form.memo ?? '',
            }
          : {
              ...common,
              kind: form.kind ?? 'none',
              paymentId: form.paymentId || undefined,
              reference: form.reference || undefined,
            }
      result = (await ctx.call(
        form.operation === 'take-deposit'
          ? 'hospitality_billing.takeReservationGuarantee'
          : 'hospitality_billing.setReservationGuarantee',
        input,
        url,
        req,
      )) as OperationResult
      status = 'guaranteed'
    } else if (form.operation === 'amend') {
      const timezone = await propertyTimezone(ctx, reservation.propertyId, url, req)
      const checkIn = instantFromLocal(form.checkIn, timezone)
      const checkOut = instantFromLocal(form.checkOut, timezone)
      const attempted: ReservationAmendmentValues = {
        partnerId: form.partnerId?.trim() || '',
        roomTypeId: form.roomTypeId?.trim() || '',
        checkIn: form.checkIn?.trim() || '',
        checkOut: form.checkOut?.trim() || '',
        adults: integer(form.adults, 1),
        children: integer(form.children),
        rate: form.rate?.trim() || '',
      }
      if (!checkIn || !checkOut)
        return renderReservationDetail(
          ctx,
          url,
          req,
          params.id,
          [ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.datetime')],
          attempted,
        )
      result = (await ctx.call(
        'hospitality_core.amendReservation',
        {
          ...identity,
          id: reservation.id,
          partnerId: attempted.partnerId,
          roomTypeId: attempted.roomTypeId,
          checkIn,
          checkOut,
          adults: attempted.adults,
          children: attempted.children,
          rate: attempted.rate,
        },
        url,
        req,
      )) as OperationResult
      if (!result.ok)
        return renderReservationDetail(
          ctx,
          url,
          req,
          params.id,
          operationErrors(ctx, url, req, result),
          attempted,
        )
      status = 'amended'
    } else if (form.operation === 'check-in') {
      if (!reservation.stayId || !form.roomId)
        return renderReservationDetail(ctx, url, req, params.id, [
          ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.no_available_room'),
        ])
      result = (await ctx.call(
        'hospitality_core.checkIn',
        { ...identity, stayId: reservation.stayId, roomId: form.roomId },
        url,
        req,
      )) as OperationResult
      status = 'checked-in'
    } else if (form.operation === 'hold-room') {
      if (!reservation.stayId || !form.roomId)
        return renderReservationDetail(ctx, url, req, params.id, [
          ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.no_available_room'),
        ])
      result = (await ctx.call(
        'hospitality_core.holdRoom',
        { ...identity, stayId: reservation.stayId, roomId: form.roomId },
        url,
        req,
      )) as OperationResult
      status = 'room-held'
    } else if (form.operation === 'release-room-hold') {
      if (!reservation.stayId)
        return renderReservationDetail(ctx, url, req, params.id, [
          ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.stay_missing'),
        ])
      result = (await ctx.call(
        'hospitality_core.releaseRoomHold',
        { ...identity, stayId: reservation.stayId },
        url,
        req,
      )) as OperationResult
      status = 'room-hold-released'
    } else if (form.operation === 'adjust-departure') {
      if (!reservation.stayId)
        return renderReservationDetail(ctx, url, req, params.id, [
          ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.stay_missing'),
        ])
      const timezone = await propertyTimezone(ctx, reservation.propertyId, url, req)
      const attemptedDeparture = form.checkOut?.trim() || ''
      const checkOut = instantFromLocal(attemptedDeparture, timezone)
      if (!checkOut)
        return renderReservationDetail(
          ctx,
          url,
          req,
          params.id,
          [ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.datetime')],
          undefined,
          attemptedDeparture,
        )
      result = (await ctx.call(
        'hospitality_core.adjustStayDeparture',
        { ...identity, stayId: reservation.stayId, checkOut },
        url,
        req,
      )) as OperationResult
      if (!result.ok)
        return renderReservationDetail(
          ctx,
          url,
          req,
          params.id,
          operationErrors(ctx, url, req, result),
          undefined,
          attemptedDeparture,
        )
      status = 'departure-adjusted'
    } else if (form.operation === 'check-out') {
      if (!reservation.stayId)
        return renderReservationDetail(ctx, url, req, params.id, [
          ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.stay_missing'),
        ])
      result = (await ctx.call(
        'hospitality_core.checkOut',
        {
          ...identity,
          stayId: reservation.stayId,
          lateReason: form.lateReason?.trim() || undefined,
          handover: ['keys', 'charges'].filter((key) => form[`handover-${key}`] === 'yes'),
          departureNotes: form.departureNotes || '',
        },
        url,
        req,
      )) as OperationResult
      status = Number(result.inventoryReleased ?? 0) > 0 ? 'checked-out-early' : 'checked-out'
    } else if (form.operation === 'cancel') {
      result = (await ctx.call(
        'hospitality_core.cancelReservation',
        { ...identity, id: reservation.id, reason: form.reason?.trim() || undefined },
        url,
        req,
      )) as OperationResult
      status = 'cancelled'
    } else if (form.operation === 'no-show') {
      result = (await ctx.call(
        'hospitality_core.markNoShow',
        { ...identity, id: reservation.id, reason: form.reason?.trim() || '' },
        url,
        req,
      )) as OperationResult
      status = 'no-show'
    } else return text('unknown action', { status: 400 })

    if (!result.ok)
      return renderReservationDetail(
        ctx,
        url,
        req,
        params.id,
        operationErrors(ctx, url, req, result),
        undefined,
        undefined,
        {
          ...form,
          _invalid: Array.isArray(result.errors)
            ? result.errors.map((issue) => String((issue as { field?: string }).field ?? '')).join(',')
            : '',
        },
      )
    const query = new URLSearchParams(url.searchParams)
    query.delete('finance')
    query.delete('action')
    query.set('status', status)
    const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
    if (lang) query.set('lang', lang)
    return seeOther(`${url.pathname}?${query.toString()}`)
  }
