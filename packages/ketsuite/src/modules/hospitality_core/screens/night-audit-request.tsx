import {
  adminPage,
  dateKeyIn,
  nightAuditScreen,
  propertyTimezone,
  readForm,
  redirected,
  text,
} from './request-shared.tsx'
import type { NightAuditPreview, NightAuditRow, PropertyRow, Route, ServeContext } from './request-shared.tsx'
import { randomUUID } from 'node:crypto'
import { nightAuditWorkbench } from './night-audit-workbench.tsx'
import type { NightAuditWorkbench } from './night-audit-workbench.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestNightAudit: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    const manifest = await ctx.live(req)
    const requestAudit = manifest.functions['hospitality_billing.requestNightAudit']
      ? 'hospitality_billing.requestNightAudit'
      : 'hospitality_core.requestNightAudit'
    if (req.method === 'POST') {
      const form = await readForm(req)
      if (form.operation === 'decide-arrival') {
        const result = (await ctx.call(
          'hospitality_core.decideAuditArrival',
          {
            reservationId: form.reservationId,
            auditDate: form.auditDate,
            choice: form.choice,
            expectedVersion: Number(form.expectedVersion),
            requestKey: form.requestKey,
          },
          url,
          req,
        )) as { ok: boolean }
        return redirected(url, result.ok ? 'saved' : 'invalid', {
          property: form.propertyId,
          auditDate: form.auditDate,
        })
      }
      if (form.operation !== 'request-night-audit') return text('unknown action', { status: 400 })
      const result = (await ctx.call(
        requestAudit,
        {
          propertyId: form.propertyId ?? '',
          auditDate: form.auditDate ?? '',
          expectedVersion: form.expectedVersion ? Number(form.expectedVersion) : undefined,
          requestKey: form.requestKey,
        },
        url,
        req,
      )) as { ok?: boolean }
      return redirected(url, result.ok ? 'queued' : 'invalid', {
        property: form.propertyId,
        auditDate: form.auditDate,
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
    const timezone = await propertyTimezone(ctx, propertyId, url, req)
    const today = dateKeyIn(new Date(), timezone)
    const requestedDate = url.searchParams.get('auditDate')?.trim()
    const auditDate =
      /^\d{4}-\d{2}-\d{2}$/u.test(requestedDate ?? '') && requestedDate! <= today ? requestedDate! : today
    const [preview, runs, workbench] = propertyId
      ? ((await Promise.all([
          ctx.call('hospitality_core.previewNightAudit', { propertyId, auditDate }, url, req),
          ctx.call('hospitality_core.listNightAudits', { propertyId, limit: 30 }, url, req),
          ctx.call('hospitality_core.getNightAuditWorkbench', { propertyId, auditDate }, url, req),
        ])) as [NightAuditPreview, NightAuditRow[], NightAuditWorkbench])
      : [undefined, [], undefined]
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.nightAudit.title',
      body: async (_, frame) =>
        nightAuditScreen(
          _,
          {
            properties,
            propertyId,
            auditDate,
            today,
            preview,
            runs,
            workbench: workbench
              ? nightAuditWorkbench(_, {
                  data: workbench,
                  propertyId: propertyId!,
                  auditDate,
                  url,
                  requestKey: randomUUID(),
                  canDecide: await ctx.allows('hospitality_core.decideAuditArrival', url, req),
                  canClose: await ctx.allows(requestAudit, url, req),
                })
              : undefined,
          },
          lang,
          frame,
          url.searchParams.get('status'),
        ),
    })
  }
