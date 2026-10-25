import { contentSelection, seeOther, text } from './request-shared.tsx'
import { hospitalityScopedHref } from './scoped-href.ts'
import type { Route, ServeContext, RouteEntry } from '@ketvietlab/ketjs'

/** The property workbench owns content editing; preserve old saved links. */
export const hospitalityRequestContent: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const selection = await contentSelection(ctx, url, req)
    if (!selection.propertyId) return seeOther(hospitalityScopedHref(url, '/admin/hospitality/properties'))
    const next = new URL(
      hospitalityScopedHref(url, `/admin/hospitality/properties/${encodeURIComponent(selection.propertyId)}`),
      url,
    )
    next.searchParams.set('section', 'content')
    if (selection.roomTypeId) next.searchParams.set('photos', selection.roomTypeId)
    if (url.searchParams.has('status')) next.searchParams.set('status', url.searchParams.get('status')!)
    return seeOther(next.pathname + next.search)
  }
