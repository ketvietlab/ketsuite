import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { inLocale } from './screen.ts'

type Req = Parameters<Route>[1]

/**
 * Where a row's product opens (P24, P32): the product's own page, for a reader who may
 * read products in a deployment that composes that page. Anyone else keeps plain text,
 * so a link never leads to a refusal or a missing route.
 */
export const productPageLink = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
): Promise<(templateId: unknown) => string | null> => {
  const routed = Boolean((await ctx.live(req)).routes['/admin/product/templates/{id}'])
  const allowed = routed && (await ctx.allows('product.getTemplate', url, req))
  return (templateId) =>
    allowed && templateId != null && templateId !== ''
      ? inLocale(url, `/admin/product/templates/${encodeURIComponent(String(templateId))}`)
      : null
}
