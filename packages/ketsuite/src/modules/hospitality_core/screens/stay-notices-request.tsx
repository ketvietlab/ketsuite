import { collectionPages, renderHospitalityCollection } from './collection-page.tsx'
import {
  STAY_NOTICE_STATES,
  adminPage,
  propertyTimezone,
  readForm,
  redirected,
  stayNoticesScreen,
  text,
} from './request-shared.tsx'
import type { PropertyRow, Route, ServeContext, StayNoticeRow } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestStayNotices: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method === 'GET') {
      const selected = url.searchParams.get('notice') || url.searchParams.get('edit')
      if (selected && !url.searchParams.has('record'))
        url.searchParams.set('record', `hospitality.notice:${selected}`)
      url.searchParams.delete('notice')
      url.searchParams.delete('edit')
      return renderHospitalityCollection(
        ctx,
        url,
        req,
        collectionPages.find((page) => page.id === 'notices')!,
      )
    }
    if (req.method === 'POST') {
      const form = await readForm(req)
      let result: { ok?: boolean } = { ok: false }
      let state: 'refreshed' | 'submitted' | 'confirmed' = 'refreshed'
      if (form.operation === 'refresh') {
        result = (await ctx.call(
          'hospitality_core.requestStayNoticeRefresh',
          { stayId: form.stayId ?? '' },
          url,
          req,
        )) as { ok?: boolean }
      } else if (form.operation === 'record-submission') {
        state = 'submitted'
        result = (await ctx.call(
          'hospitality_core.recordStayNoticeSubmission',
          {
            id: form.id ?? '',
            reason: form.reason ?? '',
            channel: form.channel ?? '',
            evidenceRef: form.evidenceRef ?? '',
          },
          url,
          req,
        )) as { ok?: boolean }
      } else if (form.operation === 'confirm') {
        state = 'confirmed'
        result = (await ctx.call(
          'hospitality_core.confirmStayNotice',
          { id: form.id ?? '', receiptRef: form.receiptRef ?? '' },
          url,
          req,
        )) as { ok?: boolean }
      } else return text('unknown action', { status: 400 })
      return redirected(url, result.ok ? state : 'invalid', {
        property: form.property,
        state: form.state === 'all' ? undefined : form.state,
        notice: form.id,
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
    const requestedState = url.searchParams.get('state')?.trim()
    const state = STAY_NOTICE_STATES.includes(requestedState as (typeof STAY_NOTICE_STATES)[number])
      ? requestedState!
      : 'all'
    const rows = propertyId
      ? ((await ctx.call(
          'hospitality_core.listStayNotices',
          { propertyId, limit: 500 },
          url,
          req,
        )) as StayNoticeRow[])
      : []
    const selectedId = url.searchParams.get('notice')?.trim()
    const selected = rows.find((row) => row.id === selectedId)
    const timezone = await propertyTimezone(ctx, propertyId, url, req)
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.stayNotices.title',
      body: (_, frame) =>
        stayNoticesScreen(
          _,
          { properties, propertyId, state, rows, selected },
          lang,
          timezone,
          frame,
          url.searchParams.get('status'),
        ),
    })
  }
