/**
 * The billing list's query in one shape for its URL, its islands and `hospitality_billing.searchBilling`
 * (HOS-DEC-033). Pure, so the browser and the function apply the same defaults. The names follow the accepted
 * mock's URL (`sort=title` orders by folio code, `period` is the days back a closed folio is counted).
 */
export const BILLING_BOOK_VIEWS = [
  'all',
  'missing-rule',
  'uninvoiced',
  'owing',
  'paid',
  'unverified',
] as const
export const BILLING_BOOK_SORTS = [
  'attention',
  '-balance',
  'balance',
  'title',
  '-title',
  '-total',
  'total',
] as const
export const BILLING_BOOK_PERIODS = [7, 30, 90] as const
export const BILLING_BOOK_PERIOD = 7
export const BILLING_BOOK_MAX_QUERY = 100
export const BILLING_BOOK_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export type BillingBookView = (typeof BILLING_BOOK_VIEWS)[number]
export type BillingBookSort = (typeof BILLING_BOOK_SORTS)[number]
export type BillingBookPeriod = (typeof BILLING_BOOK_PERIODS)[number]
export type BillingBookQuery = {
  propertyId: string | null
  period: BillingBookPeriod
  view: BillingBookView
  q: string
  sort: BillingBookSort
  page: number
  pageSize: number
}
// The names the list writes on its URL; anything else there (company, branch, lang, record) is left alone.
const NAMES = ['property', 'period', 'view', 'q', 'sort', 'page', 'pageSize']

const oneOf = <T extends string | number>(list: readonly T[], value: unknown): T | null =>
  (list as readonly unknown[]).includes(value) ? (value as T) : null
const whole = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback

/** The input as the list applies it: unknown values fall back to their defaults, a period to the last 7 days. */
export function billingBookQuery(
  args: Record<string, unknown>,
  properties: readonly { id: string }[],
): BillingBookQuery {
  return {
    propertyId: properties.some((row) => row.id === args.propertyId) ? String(args.propertyId) : null,
    period: oneOf(BILLING_BOOK_PERIODS, args.period) ?? BILLING_BOOK_PERIOD,
    view: oneOf(BILLING_BOOK_VIEWS, args.view) ?? 'all',
    q: typeof args.q === 'string' ? args.q.trim().slice(0, BILLING_BOOK_MAX_QUERY) : '',
    sort: oneOf(BILLING_BOOK_SORTS, args.sort) ?? 'attention',
    page: whole(args.page, 1),
    pageSize: Math.min(MAX_PAGE_SIZE, whole(args.pageSize, BILLING_BOOK_PAGE_SIZE)),
  }
}

export function billingBookQueryFromUrl(url: URL, properties: readonly { id: string }[]): BillingBookQuery {
  const params = url.searchParams
  const text = (name: string) => params.get(name) ?? undefined
  const number = (name: string) => {
    const value = params.get(name)
    return value && /^\d+$/.test(value) ? Number(value) : undefined
  }
  return billingBookQuery(
    {
      propertyId: text('property'),
      period: number('period'),
      view: text('view'),
      q: text('q'),
      sort: text('sort'),
      page: number('page'),
      pageSize: number('pageSize'),
    },
    properties,
  )
}

/** Defaults stay off the URL, so the plain list is the plain menu link. */
export function billingBookHref(path: string, query: BillingBookQuery) {
  const url = new URL(path, 'http://billing.local')
  for (const name of NAMES) url.searchParams.delete(name)
  for (const [key, value] of Object.entries({
    property: query.propertyId ?? '',
    period: query.period === BILLING_BOOK_PERIOD ? '' : String(query.period),
    view: query.view === 'all' ? '' : query.view,
    q: query.q.trim(),
    sort: query.sort === 'attention' ? '' : query.sort,
    page: query.page > 1 ? String(query.page) : '',
    pageSize: query.pageSize === BILLING_BOOK_PAGE_SIZE ? '' : String(query.pageSize),
  }))
    if (value) url.searchParams.set(key, value)
  return url.pathname + url.search
}
