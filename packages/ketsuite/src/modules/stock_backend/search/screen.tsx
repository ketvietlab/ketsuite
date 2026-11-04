import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { StockSearchHelp } from './help.tsx'
import { searchControls, searchResults, searchFooter } from './island.tsx'
import { SEARCH_KINDS, searchQuery } from './shared.ts'
import type { SearchProps } from './shared.ts'

/** Every status a result can carry, keyed as the rows name them. */
const STATES = [
  ...['draft', 'waiting', 'confirmed', 'partially_available', 'reserved', 'assigned', 'done', 'cancel'].map(
    (state) => `state.${state}`,
  ),
  ...['archived', 'quarantined', 'depleted', 'expired', 'expiring', 'valid', 'noExpiry'].map(
    (condition) => `lot.condition.${condition}`,
  ),
  ...['counting', 'review', 'done', 'cancel'].map((state) => `count.state.${state}`),
  ...['draft', 'posted', 'cancel'].map((state) => `landedCost.state.${state}`),
  'search.state.active',
  'search.state.archived',
]
const labels = (_: Translator): SearchProps['labels'] => ({
  ...Object.fromEntries(
    [
      'title',
      'search',
      'searchSubmit',
      'name',
      'kind',
      'subject',
      'origin',
      'state',
      'start',
      'startHint',
      'empty',
      'emptyHint',
      'retry',
      'denied',
      'offline',
      'loadError',
    ].map((key) => [key, _(`stock_backend.search.${key}`)]),
  ),
  ...Object.fromEntries(
    SEARCH_KINDS.map((kind) => [
      `kind.${kind}`,
      _(
        ['lot', 'count', 'rule', 'landedCost'].includes(kind)
          ? `stock_backend.search.kind.${kind}`
          : `stock_backend.analysis.kind.${kind}`,
      ),
    ]),
  ),
  ...Object.fromEntries(STATES.map((key) => [key, _(`stock_backend.${key}`)])),
  locale: _.locale,
  region: _('stock_backend.search.title'),
  empty: _('stock_backend.search.empty'),
  emptyHint: _('stock_backend.search.emptyHint'),
  loadError: _('stock_backend.search.loadError'),
  retry: _('stock_backend.search.retry'),
  sortedAscending: _('backend.table.sortAscending'),
  sortedDescending: _('backend.table.sortDescending'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
})
/** K55: Search in Stock, the page the topbar search opens from any stock screen. */
export function stockSearchScreen(_: Translator, frame: Frame, url: URL) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = searchQuery(url)
  const source = new URL('/_ket/fn/stock_backend.searchStock', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: SearchProps = {
    key: `search:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
  }
  const part = (name: string, controller: typeof searchControls) =>
    html`${trustedMarkup(renderIsland(`stock.search-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  return shell(
    _,
    _('stock_backend.search.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.search.title')}
        controls={part('controls', searchControls)}
        body={part('results', searchResults)}
        footer={part('footer', searchFooter)}
      />
      <StockSearchHelp lang={lang} />
    </>,
    {
      ...frame,
      chrome: null,
      topbar: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: _('stock_backend.search.help') } }
        : {}),
    },
  )
}
