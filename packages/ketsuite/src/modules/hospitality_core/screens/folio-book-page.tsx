import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { FolioBookProps } from '../collections/folio-book.tsx'
import { folioBookControls, folioBookFooter, folioBookResults } from '../collections/folio-book.tsx'
import { FOLIO_BOOK_SORTS, FOLIO_BOOK_VIEWS, folioBookQueryFromUrl } from '../folio-book-query.ts'
import type { Frame } from '../../../ui/index.ts'
import { hospitalityAdminPage as adminPage } from './hospitality-admin-page.tsx'
import { ListScreenFrame } from './page-frame.tsx'

const SCOPE = ['company', 'companies', 'branch', 'branches', 'lang']
const scoped = (url: URL, path: string) => {
  const target = new URL(path, url)
  for (const [name, value] of url.searchParams)
    if (SCOPE.includes(name)) target.searchParams.append(name, value)
  return `${target.pathname}${target.search}`
}
const WORDS = [
  'search',
  'searchPlaceholder',
  'searchSubmit',
  'filters',
  'filtersToggle',
  'property',
  'allProperties',
  ...FOLIO_BOOK_VIEWS.map((id) => `view.${id}`),
  ...FOLIO_BOOK_SORTS.map((id) => `sort.${id}`),
  'sortedBy',
  ...['folio', 'state', 'room', 'total', 'balance', 'invoice'].map((id) => `column.${id}`),
  'state.open',
  'state.closed',
  'unroomed',
  'moreRooms',
  'paid',
  'dueUnknown',
  'dueFailed',
  'dueLoading',
  'invoiceLoading',
  'invoiceNone',
  'invoiceDraft',
  'invoiceVoid',
  'describe',
  'noResults',
  'lost',
  'pager',
  'region',
  'loading',
  'retry',
  'error',
  'errorHint',
  'errorHintStale',
  'offline',
  'offlineHint',
  'offlineHintStale',
  'denied',
  'deniedHint',
  'selectAll',
  'selectRow',
  'ascending',
  'descending',
  'previousPage',
  'nextPage',
  'emptyRegister',
  'emptyRegisterHint',
  'stays',
  'emptySearch',
  'filteredMessage',
  'clear',
  'partial',
  'partialHint',
]
const PLACEHOLDERS = Object.fromEntries(
  ['count', 'first', 'last', 'total', 'label', 'order', 'q'].map((name) => [name, `{${name}}`]),
)

export type FolioBookScreenInput = {
  url: URL
  locale: 'vi' | 'en'
  allowed: boolean
  properties: FolioBookProps['properties']
  may: { dues: boolean; stays: boolean }
}

/** The islands' props from the URL: the frame only; rows, counts, pages and dues are read in the browser. */
export const folioBookProps = (
  { url, locale, allowed, properties, may }: FolioBookScreenInput,
  _: Translator,
): FolioBookProps => ({
  key: `folios:${locale}:${JSON.stringify(SCOPE.map((name) => url.searchParams.getAll(name)))}`,
  id: 'hospitality-folios',
  source: scoped(url, '/_ket/fn/hospitality_core.searchFolios'),
  dueSource: may.dues ? scoped(url, '/_ket/fn/hospitality_billing.getFolioDues') : null,
  path: scoped(url, '/admin/hospitality/folios'),
  recordPath: '/admin/hospitality/folios',
  // An empty register points at the guests in house, whose folios open with their stay.
  staysHref: may.stays ? scoped(url, '/admin/hospitality/stays') : null,
  lang: locale,
  allowed,
  properties,
  query: folioBookQueryFromUrl(url, properties),
  words: Object.fromEntries(WORDS.map((key) => [key, _(`hospitality_core.folioBook.${key}`, PLACEHOLDERS)])),
})

/**
 * The folio register (HOS-UI-016): a list page whose controls, rows and pager are islands on one read,
 * `hospitality_core.searchFolios`, with what each folio owes and its invoice read from billing for the rows shown.
 */
export const folioBookScreen = (_: Translator, input: FolioBookScreenInput, frame: Frame): TemplateResult => {
  const props = folioBookProps(input, _)
  const island = (name: string, factory: (props: FolioBookProps) => { view: () => unknown }) =>
    trustedMarkup(renderIsland(name, factory as never, props, { tag: 'div' }))
  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.folios.title')}
      frame={{ ...frame, chrome: null }}
      controlsMode="islands"
      controls={island('hospitality.folios-controls', folioBookControls)}
      body={island('hospitality.folios-results', folioBookResults)}
      footer={island('hospitality.folios-footer', folioBookFooter)}
    />
  )
}

/** The list's request: who may read the register and its dues, and the properties it shows. */
export async function renderFolioBook(ctx: ServeContext, url: URL, req: Parameters<Route>[1]) {
  const locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const allows = (fn: string) => ctx.allows(fn, url, req)
  const allowed = await allows('hospitality_core.searchFolios')
  const properties = allowed
    ? (
        (await ctx.call('hospitality_core.getFolioBookFrame', {}, url, req)) as {
          properties: Array<FolioBookProps['properties'][number] & { businessDate?: string }>
        }
      ).properties.map(({ id, name }) => ({ id, name }))
    : []
  const may = {
    dues: allowed && (await allows('hospitality_billing.getFolioDues')),
    stays: await allows('hospitality_core.searchStays'),
  }
  return adminPage(ctx, url, req, {
    title: 'hospitality_core.screen.folios.title',
    body: (_, frame) => folioBookScreen(_, { url, locale, allowed, properties, may }, frame),
  })
}
