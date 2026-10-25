/**
 * The folio register's query in one shape for its URL, its islands and `hospitality_core.searchFolios`
 * (HOS-DEC-032). Pure, so the browser and the function apply the same defaults. The names follow the accepted
 * mock's URL (`sort=title` orders by folio code).
 */
export const FOLIO_BOOK_VIEWS = ['all', 'open', 'closed'] as const
export const FOLIO_BOOK_SORTS = ['-opened', 'title', '-title', '-total', 'total'] as const
export const FOLIO_BOOK_MAX_QUERY = 100
export const FOLIO_BOOK_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export type FolioBookView = (typeof FOLIO_BOOK_VIEWS)[number]
export type FolioBookSort = (typeof FOLIO_BOOK_SORTS)[number]
export type FolioBookQuery = {
  propertyId: string | null
  view: FolioBookView
  q: string
  sort: FolioBookSort
  page: number
  pageSize: number
}
// The names the list writes on its URL; anything else there (company, branch, lang) is left alone.
const NAMES = ['property', 'view', 'q', 'sort', 'page', 'pageSize']

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  (list as readonly unknown[]).includes(value) ? (value as T) : null
const whole = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback

/**
 * The input as the list applies it: unknown values fall back to their defaults, so links to the facet and sorts
 * the register no longer has (`view=owing`, `sort=balance`) land on every folio, opened last first.
 */
export function folioBookQuery(
  args: Record<string, unknown>,
  properties: readonly { id: string }[],
): FolioBookQuery {
  return {
    propertyId: properties.some((row) => row.id === args.propertyId) ? String(args.propertyId) : null,
    view: oneOf(FOLIO_BOOK_VIEWS, args.view) ?? 'all',
    q: typeof args.q === 'string' ? args.q.trim().slice(0, FOLIO_BOOK_MAX_QUERY) : '',
    sort: oneOf(FOLIO_BOOK_SORTS, args.sort) ?? '-opened',
    page: whole(args.page, 1),
    pageSize: Math.min(MAX_PAGE_SIZE, whole(args.pageSize, FOLIO_BOOK_PAGE_SIZE)),
  }
}

export function folioBookQueryFromUrl(url: URL, properties: readonly { id: string }[]): FolioBookQuery {
  const params = url.searchParams
  const text = (name: string) => params.get(name) ?? undefined
  const number = (name: string) => {
    const value = params.get(name)
    return value && /^\d+$/.test(value) ? Number(value) : undefined
  }
  return folioBookQuery(
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
export function folioBookHref(path: string, query: FolioBookQuery) {
  const url = new URL(path, 'http://folios.local')
  for (const name of NAMES) url.searchParams.delete(name)
  for (const [key, value] of Object.entries({
    property: query.propertyId ?? '',
    view: query.view === 'all' ? '' : query.view,
    q: query.q.trim(),
    sort: query.sort === '-opened' ? '' : query.sort,
    page: query.page > 1 ? String(query.page) : '',
    pageSize: query.pageSize === FOLIO_BOOK_PAGE_SIZE ? '' : String(query.pageSize),
  }))
    if (value) url.searchParams.set(key, value)
  return url.pathname + url.search
}
