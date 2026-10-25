import { eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

/** Only persisted site domains may supply an emailed customer link. */
export async function sitePublicOrigin(ctx: Ctx, siteId: string): Promise<string | null> {
  const D = ctx.table('website.SiteDomain')
  const domain = await ctx.db.one(from(D).where(eq(D.siteId, siteId), eq(D.primary, true)))
  if (!domain) return null
  const host = String(domain.host).trim()
  if (!host || /[\s/@?#\\]/.test(host))
    throw new KetError({
      code: 'E_WEBSITE_PUBLIC_ORIGIN',
      module: 'website',
      message: 'the primary site domain is invalid',
    })
  const url = new URL(`https://${host}`)
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.protocol = 'http:'
  return url.origin
}
