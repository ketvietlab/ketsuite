import { json, text } from '@ketvietlab/ketjs'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { commandIssue } from '../functions/command.ts'
import { instantFromLocal } from './request-shared.tsx'

/** The route converts property-local input; named domain commands still own each write. */
export const reservationCommandRequest: RouteEntry = (ctx) => async (url, req) => {
  if (req.method !== 'POST') return text('POST', { status: 405 })
  const form = await readForm(req)
  if (
    !/^[a-zA-Z0-9:_-]{8,160}$/.test(form.requestKey ?? '') ||
    !/^\d+$/.test(form.expectedVersion ?? '') ||
    !Number.isSafeInteger(Number(form.expectedVersion))
  )
    return text('Invalid request identity', { status: 400 })
  if (form.operation !== 'amend' && form.operation !== 'departure' && form.operation !== 'move')
    return text('Invalid operation', { status: 400 })
  const fn =
    form.operation === 'amend'
      ? 'hospitality_core.amendReservation'
      : form.operation === 'move'
        ? 'hospitality_core.moveRoom'
        : 'hospitality_core.adjustStayDeparture'
  if (!(await ctx.allows(fn, url, req))) return text('Forbidden', { status: 403 })
  const { record } = (await ctx.call(
    'hospitality_core.getReservationWorkspace',
    { id: form.id },
    url,
    req,
  )) as { record: Record<string, unknown> | null }
  if (!record) return text('Not found', { status: 404 })
  const timezone = String((record.property as Record<string, unknown>).timezone)
  if (form.operation === 'move') {
    const stay = record.stay as Record<string, unknown> | null
    if (!stay) return text('Not found', { status: 404 })
    const at = instantFromLocal(form.at, timezone)
    if (!at) return json({ ok: true, value: { ok: false, errors: [commandIssue('at', 'datetime')] } })
    return json({
      ok: true,
      value: await ctx.call(
        'hospitality_core.moveRoom',
        {
          stayId: stay.id,
          roomId: form.roomId,
          reason: form.reason,
          at,
          assignmentId: `move:${stay.id}:${form.requestKey}`,
          expectedVersion: Number(form.expectedVersion),
          requestKey: form.requestKey,
        },
        url,
        req,
      ),
    })
  }
  const checkOut = instantFromLocal(form.checkOut, timezone)
  if (!checkOut)
    return json({ ok: true, value: { ok: false, errors: [commandIssue('checkOut', 'datetime')] } })
  const identity = { expectedVersion: Number(form.expectedVersion), requestKey: form.requestKey! }
  if (form.operation === 'departure') {
    const stay = record.stay as Record<string, unknown> | null
    if (!stay) return text('Not found', { status: 404 })
    return json({
      ok: true,
      value: await ctx.call(
        'hospitality_core.adjustStayDeparture',
        { ...identity, stayId: stay.id, checkOut },
        url,
        req,
      ),
    })
  }
  const checkIn = instantFromLocal(form.checkIn, timezone)
  if (!checkIn) return json({ ok: true, value: { ok: false, errors: [commandIssue('checkIn', 'datetime')] } })
  return json({
    ok: true,
    value: await ctx.call(
      'hospitality_core.amendReservation',
      {
        ...identity,
        id: record.id,
        partnerId: form.partnerId,
        roomTypeId: form.roomTypeId,
        checkIn,
        checkOut,
        adults: Number(form.adults),
        children: Number(form.children),
        rate: form.rate,
      },
      url,
      req,
    ),
  })
}
