/** Carry the selected tenant, branch and language through native links and post redirects. */
export function hospitalityScopedHref(current: URL, destination: string) {
  const next = new URL(destination, current)
  if (next.origin !== current.origin) return destination
  for (const key of ['company', 'companies', 'branch', 'branches', 'lang']) {
    if (next.searchParams.has(key)) continue
    for (const value of current.searchParams.getAll(key)) next.searchParams.append(key, value)
  }
  return next.pathname + next.search + next.hash
}

/** A record may return only to a known Hospitality workspace in the current scope. */
export function hospitalityRecordBack(currentHref: string | undefined, fallback: string): string {
  const current = new URL(currentHref ?? fallback, 'http://hospitality.local')
  const requested = current.searchParams.get('returnTo')
  let target = new URL(fallback, current)
  if (requested) {
    try {
      const candidate = new URL(requested, current)
      if (
        candidate.origin === current.origin &&
        [
          '/admin/hospitality/front-desk',
          '/admin/hospitality/tape-chart',
          '/admin/hospitality/reservations',
          '/admin/hospitality/stays',
          '/admin/hospitality/folios',
          '/admin/hospitality/billing',
          '/admin/hospitality/housekeeping/rooms',
          '/admin/hospitality/product-fulfillments',
        ].includes(candidate.pathname)
      )
        target = candidate
    } catch {
      /* Malformed links fall back to the record's collection. */
    }
  }
  for (const key of ['company', 'companies', 'branch', 'branches', 'lang']) {
    target.searchParams.delete(key)
    for (const value of current.searchParams.getAll(key)) target.searchParams.append(key, value)
  }
  return target.pathname + target.search + target.hash
}
