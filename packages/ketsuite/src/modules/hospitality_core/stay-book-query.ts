/**
 * The in-house list's query in one shape for its URL, its islands and `hospitality_core.searchStays`
 * (HOS-DEC-031). Pure, so the browser and the function apply the same defaults.
 */
export const STAY_BOOK_VIEWS = ['all', 'departing', 'tomorrow', 'vip'] as const
export const STAY_BOOK_SORTS = ['room', '-room', 'departure', '-departure', 'guest'] as const
export const STAY_BOOK_MAX_QUERY = 100
export const STAY_BOOK_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export type StayBookView = (typeof STAY_BOOK_VIEWS)[number]
export type StayBookSort = (typeof STAY_BOOK_SORTS)[number]
export type StayBookQuery = {
  propertyId: string | null
  view: StayBookView
  q: string
  sort: StayBookSort
  page: number
  pageSize: number
}
// The names the list writes on its URL; anything else there (company, branch, lang) is left alone.
const NAMES = ['property', 'view', 'q', 'sort', 'page', 'pageSize']

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  (list as readonly unknown[]).includes(value) ? (value as T) : null
const whole = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback

/** Text as the list matches it: lower case, without accents, `đ` as `d`. */
export const foldText = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')

/**
 * The input as the list applies it: unknown values fall back to their defaults, so links to the facet and sorts
 * the list no longer has (`view=owing`, `sort=balance`) land on the whole house by room.
 */
export function stayBookQuery(
  args: Record<string, unknown>,
  properties: readonly { id: string }[],
): StayBookQuery {
  return {
    propertyId: properties.some((row) => row.id === args.propertyId) ? String(args.propertyId) : null,
    view: oneOf(STAY_BOOK_VIEWS, args.view) ?? 'all',
    q: typeof args.q === 'string' ? args.q.trim().slice(0, STAY_BOOK_MAX_QUERY) : '',
    sort: oneOf(STAY_BOOK_SORTS, args.sort) ?? 'room',
    page: whole(args.page, 1),
    pageSize: Math.min(MAX_PAGE_SIZE, whole(args.pageSize, STAY_BOOK_PAGE_SIZE)),
  }
}

export function stayBookQueryFromUrl(url: URL, properties: readonly { id: string }[]): StayBookQuery {
  const params = url.searchParams
  const text = (name: string) => params.get(name) ?? undefined
  const number = (name: string) => {
    const value = params.get(name)
    return value && /^\d+$/.test(value) ? Number(value) : undefined
  }
  return stayBookQuery(
    {
      propertyId: text('property'),
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
export function stayBookHref(path: string, query: StayBookQuery) {
  const url = new URL(path, 'http://stays.local')
  for (const name of NAMES) url.searchParams.delete(name)
  for (const [key, value] of Object.entries({
    property: query.propertyId ?? '',
    view: query.view === 'all' ? '' : query.view,
    q: query.q.trim(),
    sort: query.sort === 'room' ? '' : query.sort,
    page: query.page > 1 ? String(query.page) : '',
    pageSize: query.pageSize === STAY_BOOK_PAGE_SIZE ? '' : String(query.pageSize),
  }))
    if (value) url.searchParams.set(key, value)
  return url.pathname + url.search
}
