import { json, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { bodyOf, sameOrigin } from '../../website_form/routes.ts'

type Req = Parameters<Route>[1]
type Result = { ok?: boolean; id?: string; errors?: Array<{ message?: string }> }

/** Where the visitor script reports to. Underscored so no page a site writes can take the path. */
export const VISIT_PATH = '/_website/visit'

const reply = (body: unknown, status: number) =>
  withHeaders(json(body, { status }), { 'cache-control': 'no-store' })

const statusOf = (result: Result): number => {
  if (result.ok) return 200
  const message = result.errors?.[0]?.message ?? ''
  if (message === 'website.error.visitRateLimit') return 429
  // 409: nothing is wrong with the request, the notice it agreed to moved. Ask again.
  if (message === 'website.error.visitConsentStale') return 409
  if (message === 'website.error.visitTrackingOff') return 404
  return 422
}

const siteIdOf = async (ctx: ServeContext, url: URL, req: Req): Promise<string | null> => {
  let host = ''
  try {
    host = new URL(`http://${String(req.headers.host ?? url.host).trim()}`).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return null
  }
  const site = (await ctx.call('website.resolveSite', { host }, url, req)) as {
    id?: string
    visitConsent?: boolean
  } | null
  return site?.id && site.id !== '__legacy__' && site.visitConsent === true ? site.id : null
}

const record =
  (operation: 'start' | 'event') =>
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'POST') return reply({ ok: false, code: 'method_not_allowed' }, 405)
    if (!sameOrigin(req)) return reply({ ok: false, code: 'origin_mismatch' }, 403)
    // Staff browsing their own site are not visitors; the page does not load the script for them.
    if (await ctx.requestIdentityOf(url, req)) return reply({ ok: false, code: 'staff' }, 403)
    const siteId = await siteIdOf(ctx, url, req)
    if (!siteId) return reply({ ok: false, code: 'not_found' }, 404)
    let body: Record<string, unknown>
    try {
      const raw = await bodyOf(req)
      body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_request'
      if (code === 'payload_too_large') return reply({ ok: false, code }, 413)
      if (code === 'unsupported_media_type') return reply({ ok: false, code }, 415)
      return reply({ ok: false, code: 'invalid_request' }, 400)
    }
    const rateKey = `${req.socket.remoteAddress ?? 'unknown'}:${String(req.headers['user-agent'] ?? '').slice(0, 200)}`
    const common = {
      siteId,
      visitorKey: String(body.visitorKey ?? ''),
      consentVersion: Number(body.consentVersion),
      path: String(body.path ?? ''),
      subjectType: body.subjectType == null ? null : String(body.subjectType),
      subjectId: body.subjectId == null ? null : String(body.subjectId),
      rateKey,
    }
    const result = (
      operation === 'start'
        ? await ctx.call(
            'website.recordVisit',
            {
              ...common,
              referrerHost: body.referrerHost == null ? null : String(body.referrerHost),
              params: body.params && typeof body.params === 'object' ? body.params : null,
            },
            url,
            req,
          )
        : await ctx.call(
            'website.recordVisitEvent',
            {
              ...common,
              visitId: params.id,
              kind: String(body.kind ?? ''),
              channel: body.channel == null ? null : String(body.channel),
              target: body.target == null ? null : String(body.target),
            },
            url,
            req,
          )
    ) as Result
    return reply(
      result.ok ? { ok: true, id: result.id } : { ok: false, errors: result.errors },
      statusOf(result),
    )
  }

export const visitRoutes: Record<string, RouteEntry> = {
  [VISIT_PATH]: { anonymous: true, handler: record('start') },
  [`${VISIT_PATH}/{id}/events`]: { anonymous: true, handler: record('event') },
}
