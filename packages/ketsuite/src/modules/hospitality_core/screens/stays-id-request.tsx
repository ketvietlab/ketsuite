import { operationErrors, randomUUID, readForm, renderStayDetail, seeOther, text } from './request-shared.tsx'
import type { OperationResult, Route, ServeContext, StayRow } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestStaysId: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'GET') {
      const stay = (await ctx.call('hospitality_core.getStay', { id: params.id }, url, req)) as StayRow | null
      if (!stay) return text('Not found', { status: 404 })
      if (stay.reservationId && (await ctx.allows('hospitality_core.getReservationWorkspace', url, req))) {
        const { record } = (await ctx.call(
          'hospitality_core.getReservationWorkspace',
          { id: stay.reservationId },
          url,
          req,
        )) as { record: Record<string, unknown> | null }
        if (record?.stayId === stay.id) {
          const next = new URL(url)
          next.pathname = `/admin/hospitality/reservations/${encodeURIComponent(String(stay.reservationId))}`
          next.searchParams.set(
            'returnTo',
            `/admin/hospitality/stays?property=${encodeURIComponent(String(stay.propertyId))}`,
          )
          return seeOther(next.pathname + next.search)
        }
      }
      return renderStayDetail(ctx, url, req, params.id)
    }
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const form = await readForm(req)
    const stay = (await ctx.call('hospitality_core.getStay', { id: params.id }, url, req)) as StayRow | null
    if (!stay) return text('Not found', { status: 404 })

    let result: OperationResult
    let status: 'guest-added' | 'room-moved' | 'document-saved'
    if (form.operation === 'add-guest') {
      result = (await ctx.call(
        'hospitality_core.addStayGuest',
        {
          id: randomUUID(),
          stayId: stay.id,
          partnerId: form.partnerId?.trim() || undefined,
          displayName: form.displayName?.trim() || '',
        },
        url,
        req,
      )) as OperationResult
      status = 'guest-added'
    } else if (form.operation === 'move-room') {
      if (!form.roomId?.trim() || !form.reason?.trim())
        return renderStayDetail(ctx, url, req, params.id, [
          ctx.translate(ctx.localeOf(url, req))('hospitality_core.stay.validation.moveRequired'),
        ])
      result = (await ctx.call(
        'hospitality_core.moveRoom',
        {
          stayId: stay.id,
          roomId: form.roomId,
          assignmentId: randomUUID(),
          reason: form.reason.trim(),
        },
        url,
        req,
      )) as OperationResult
      status = 'room-moved'
    } else if (form.operation === 'save-document') {
      result = (await ctx.call(
        'hospitality_core.saveGuestDocument',
        {
          id: form.documentId?.trim() || randomUUID(),
          stayId: stay.id,
          partnerId: form.partnerId?.trim() || '',
          type: form.type?.trim() || 'cccd',
          number: form.number?.trim() || undefined,
          fullName: form.fullName?.trim() || '',
          dateOfBirth: form.dateOfBirth?.trim() || undefined,
          gender: form.gender?.trim() || undefined,
          nationality: form.nationality?.trim() || undefined,
          permanentAddress: form.permanentAddress?.trim() || undefined,
          issueDate: form.issueDate?.trim() || undefined,
          issuePlace: form.issuePlace?.trim() || undefined,
          ocrState: 'pending',
        },
        url,
        req,
      )) as OperationResult
      status = 'document-saved'
    } else return text('unknown action', { status: 400 })

    if (!result.ok) return renderStayDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
    const query = new URLSearchParams()
    query.set('status', status)
    const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
    if (lang) query.set('lang', lang)
    return seeOther(`${url.pathname}?${query.toString()}`)
  }
