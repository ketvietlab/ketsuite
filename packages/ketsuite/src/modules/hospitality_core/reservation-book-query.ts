import { BOOKING_PROVIDERS } from './types.ts'

/**
 * The reservation book's query in one shape for its URL, its islands and `hospitality_core.searchReservations`
 * (HOS-DEC-030). Pure, so the browser and the function apply the same defaults.
 */
export const RESERVATION_BOOK_STATUSES = [
  'all',
  'arriving',
  'in_house',
  'departing',
  'confirmed',
  'checked_out',
  'cancelled',
] as const
export const RESERVATION_BOOK_VIEWS = ['all', 'unguaranteed'] as const
export const RESERVATION_BOOK_SORTS = ['relevance', 'arrival', '-arrival', 'total', '-total'] as const
export const RESERVATION_BOOK_WINDOWS = [7, 14, 30] as const
export const RESERVATION_BOOK_MAX_QUERY = 100
export const RESERVATION_BOOK_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export type ReservationBookStatus = (typeof RESERVATION_BOOK_STATUSES)[number]
export type ReservationBookQuery = {
  propertyId: string | null
  /** The first civil date of the stay window; `null` with `days: null`, every date. */
  from: string | null
  days: number | null
  status: ReservationBookStatus
  source: string | null
  view: (typeof RESERVATION_BOOK_VIEWS)[number]
  q: string
  sort: (typeof RESERVATION_BOOK_SORTS)[number]
  page: number
  pageSize: number
}
type BookDay = { id: string; businessDate: string }

// Links written before the statuses took these ids still land on their filter.
const formerStatuses: Record<string, ReservationBookStatus> = {
  'in-house': 'in_house',
  departed: 'checked_out',
}
// The names the book writes on its URL; anything else there (company, branch, lang) is left alone.
const NAMES = ['from', 'days', 'property', 'status', 'source', 'view', 'q', 'sort', 'page', 'pageSize']

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  (list as readonly unknown[]).includes(value) ? (value as T) : null
const whole = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
const civilDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

/** "Hôm nay" of the properties shown: the newest business date among them. */
export const reservationBookToday = (
  query: Pick<ReservationBookQuery, 'propertyId'>,
  properties: readonly BookDay[],
): string | null =>
  (query.propertyId ? properties.filter((row) => row.id === query.propertyId) : properties)
    .map((row) => row.businessDate)
    .toSorted()
    .at(-1) ?? null

/**
 * The input as the book applies it: unknown values fall back to their defaults, `days: null` is every date and a
 * missing `from` is today of the properties shown.
 */
export function reservationBookQuery(
  args: Record<string, unknown>,
  properties: readonly BookDay[],
): ReservationBookQuery {
  const days =
    args.days === null ? null : (RESERVATION_BOOK_WINDOWS.find((value) => value === args.days) ?? 14)
  const propertyId = properties.some((row) => row.id === args.propertyId) ? String(args.propertyId) : null
  return {
    propertyId,
    from: days === null ? null : (civilDate(args.from) ?? reservationBookToday({ propertyId }, properties)),
    days,
    status: oneOf(RESERVATION_BOOK_STATUSES, formerStatuses[String(args.status)] ?? args.status) ?? 'all',
    source: oneOf(BOOKING_PROVIDERS, args.source),
    view: oneOf(RESERVATION_BOOK_VIEWS, args.view) ?? 'all',
    q: typeof args.q === 'string' ? args.q.trim().slice(0, RESERVATION_BOOK_MAX_QUERY) : '',
    sort: oneOf(RESERVATION_BOOK_SORTS, args.sort) ?? 'relevance',
    page: whole(args.page, 1),
    pageSize: Math.min(MAX_PAGE_SIZE, whole(args.pageSize, RESERVATION_BOOK_PAGE_SIZE)),
  }
}

export function reservationBookQueryFromUrl(url: URL, properties: readonly BookDay[]): ReservationBookQuery {
  const params = url.searchParams
  const text = (name: string) => params.get(name) ?? undefined
  const number = (name: string) => {
    const value = params.get(name)
    return value && /^\d+$/.test(value) ? Number(value) : undefined
  }
  return reservationBookQuery(
    {
      propertyId: text('property'),
      from: text('from'),
      days: params.get('days') === 'all' ? null : number('days'),
      status: text('status'),
      source: text('source'),
      view: text('view'),
      q: text('q'),
      sort: text('sort'),
      page: number('page'),
      pageSize: number('pageSize'),
    },
    properties,
  )
}

/** Defaults stay off the URL, so the plain book is the plain menu link and a shared link keeps its dates. */
export function reservationBookHref(
  path: string,
  query: ReservationBookQuery,
  properties: readonly BookDay[],
) {
  const url = new URL(path, 'http://book.local')
  for (const name of NAMES) url.searchParams.delete(name)
  const today = reservationBookToday(query, properties)
  for (const [key, value] of Object.entries({
    from: query.from && query.from !== today ? query.from : '',
    days: query.days === null ? 'all' : query.days === 14 ? '' : String(query.days),
    property: query.propertyId ?? '',
    status: query.status === 'all' ? '' : query.status,
    source: query.source ?? '',
    view: query.view === 'all' ? '' : query.view,
    q: query.q.trim(),
    sort: query.sort === 'relevance' ? '' : query.sort,
    page: query.page > 1 ? String(query.page) : '',
    pageSize: query.pageSize === RESERVATION_BOOK_PAGE_SIZE ? '' : String(query.pageSize),
  }))
    if (value) url.searchParams.set(key, value)
  return url.pathname + url.search
}
