import { inLocale } from '../../backend/screen.ts'

/**
 * Where a quotation or order page's Back goes: the list it was opened from (`returnTo`, only a
 * sales list of this origin), or else its own collection with the page's company and branch.
 */
export const saleRecordBack = (url: URL, collection: string) => {
  const fallback = new URL(inLocale(url, collection), url)
  for (const key of ['company', 'branch'])
    if (url.searchParams.has(key)) fallback.searchParams.set(key, url.searchParams.get(key)!)
  const raw = url.searchParams.get('returnTo')
  if (raw) {
    try {
      const target = new URL(raw, url)
      if (
        target.origin === url.origin &&
        ['/admin/sales', '/admin/sales/quotations', '/admin/sales/orders'].includes(target.pathname)
      ) {
        if (!target.searchParams.has('lang'))
          target.searchParams.set('lang', url.searchParams.get('lang') ?? 'vi')
        return `${target.pathname}${target.search}`
      }
    } catch {
      /* Invalid return targets use the scoped collection. */
    }
  }
  return `${fallback.pathname}${fallback.search}`
}
