import { recordModalClosedHref } from '../../ui/record-modal.tsx'
const collections = new Set(['/admin/product/templates', '/admin/product/variants', '/admin/product/search'])
const context = ['company', 'branch', 'lang'] as const
const scoped = (source: URL, target: URL) => {
  for (const key of context) {
    const value = source.searchParams.get(key)
    if (value) target.searchParams.set(key, value)
  }
  return target
}
/** Only local Product collections may be the return destination of a product page. */
export function productBackHref(url: URL): string {
  const raw = url.searchParams.get('returnTo')
  if (raw)
    try {
      const target = new URL(raw, 'http://ket.local')
      if (target.origin === 'http://ket.local' && collections.has(target.pathname)) {
        target.searchParams.delete('returnTo')
        return recordModalClosedHref(target) + target.hash
      }
    } catch {
      /* A malformed return target falls back to the scoped collection. */
    }
  const target = collections.has(url.pathname)
    ? new URL(url)
    : scoped(url, new URL('/admin/product/templates', url))
  target.searchParams.delete('returnTo')
  return recordModalClosedHref(target) + target.hash
}
/** Legacy modal bookmarks and native create links address the same real record. */
export function productRecordHref(url: URL, id: string, tab?: string | null): string {
  const target = scoped(url, new URL(`/admin/product/templates/${encodeURIComponent(id)}`, url))
  if (tab) target.searchParams.set('tab', tab)
  target.searchParams.set('returnTo', productBackHref(url))
  return target.pathname + target.search
}
