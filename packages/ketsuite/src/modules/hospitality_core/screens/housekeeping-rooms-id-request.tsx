import { operationErrors, readForm, renderHousekeepingRoomDetail, seeOther, text } from './request-shared.tsx'
import type { OperationResult, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { addCalendarDays } from '../calendar.ts'

export const hospitalityRequestHousekeepingRoomsId: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'GET') return renderHousekeepingRoomDetail(ctx, url, req, params.id)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const form = await readForm(req)
    const roomCommands: Record<string, string> = {
      'block-room': 'blockRoom',
      'reopen-room': 'reopenRoom',
      'inspect-room': 'inspectRoom',
      'complete-room-cleaning': 'completeRoomCleaning',
    }
    const command = roomCommands[form.operation ?? '']
    if (command) {
      if (
        command === 'blockRoom' &&
        form.kind === 'ooo' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(form.until ?? '') ||
          !Number.isFinite(Date.parse(`${form.until}T00:00:00Z`)) ||
          new Date(`${form.until}T00:00:00Z`).toISOString().slice(0, 10) !== form.until)
      )
        return renderHousekeepingRoomDetail(
          ctx,
          url,
          req,
          params.id,
          [ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.date')],
          form,
        )
      const input = {
        roomId: params.id,
        expectedVersion: Number(form.expectedVersion),
        requestKey: form.requestKey,
        ...(command === 'blockRoom'
          ? {
              kind: form.kind,
              dateFrom: form.dateFrom,
              dateTo: form.kind === 'ooo' && form.until ? addCalendarDays(form.until, 1) : form.dateTo,
              backLocal: form.backLocal || undefined,
              reason: form.reason,
            }
          : {}),
        ...(command === 'reopenRoom' ? { id: form.id } : {}),
        ...(command === 'inspectRoom'
          ? { passed: form.passed === '1', reason: form.reason || undefined }
          : {}),
      }
      const result = (await ctx.call(`hospitality_core.${command}`, input, url, req)) as OperationResult
      if (!result.ok)
        return renderHousekeepingRoomDetail(
          ctx,
          url,
          req,
          params.id,
          operationErrors(ctx, url, req, result),
          form,
        )
      const next = new URL(url)
      next.searchParams.delete('dialog')
      next.searchParams.delete('kind')
      next.searchParams.set('status', 'updated')
      return seeOther(next.pathname + next.search)
    }
    if (form.operation !== 'set-status') return text('unknown action', { status: 400 })
    const result = (await ctx.call(
      'hospitality_core.setRoomStatus',
      {
        id: params.id,
        expectedStatus: form.expectedStatus?.trim() || undefined,
        status: form.status?.trim() || '',
        note: form.note?.trim() || undefined,
      },
      url,
      req,
    )) as OperationResult
    if (!result.ok)
      return renderHousekeepingRoomDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
    const query = new URLSearchParams({ status: 'updated' })
    const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
    if (lang) query.set('lang', lang)
    return seeOther(`${url.pathname}?${query.toString()}`)
  }
