import type { Translator } from '@ketvietlab/ketjs'
import { parseListState } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { ForecastHelp } from './forecast-help.tsx'
import { forecastSearch } from '../forecast/search.ts'
import { forecastListSearch } from '../search.ts'
import { forecastControls, forecastResults, forecastFooter } from '../forecast/island.tsx'
import { forecastQuery } from '../forecast/shared.ts'
import type { ForecastProps } from '../forecast/shared.ts'

const labels = (_: Translator): ForecastProps['labels'] => ({
  ...Object.fromEntries(
    Object.entries({
      title: 'forecast',
      product: 'forecast.col.product',
      warehouse: 'field.warehouse',
      usable: 'forecast.usable',
      incoming: 'forecast.incoming',
      outgoing: 'forecast.outgoing',
      forecast: 'forecast.value',
      onOrder: 'forecast.onOrder',
      minQuantity: 'field.minQuantity',
      shortDate: 'forecast.shortDate',
      statusLabel: 'forecast.col.status',
      empty: 'forecast.empty',
      emptyHint: 'forecast.emptyHint',
      noMatches: 'forecast.noMatches',
      noMatchesHint: 'forecast.noMatchesHint',
      denied: 'forecast.denied',
      offline: 'forecast.offline',
      loadError: 'forecast.loadError',
    }).map(([key, value]) => [key, _(`stock_backend.${value}`)]),
  ),
  empty: _('stock_backend.forecast.empty'),
  emptyHint: _('stock_backend.forecast.emptyHint'),
  loadError: _('stock_backend.forecast.loadError'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  region: _('stock_backend.forecast'),
  loading: _('backend.relation.loading'),
  retry: _('backend.relation.retry'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
})

/** K40: the forecast list. Its rows come from the data route; none enter the server-rendered page. */
export function forecastCollectionScreen(_: Translator, frame: Frame, url: URL) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = forecastQuery(url)
  const source = new URL('/admin/stock/forecast/data', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: ForecastProps = {
    key: `forecast:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
    search: forecastSearch(_, parseListState(forecastListSearch, url).state, query.href),
  }
  const part = (name: string, controller: typeof forecastControls) =>
    html`${trustedMarkup(renderIsland(`stock.forecast-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  return shell(
    _,
    _('stock_backend.forecast'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.forecast')}
        controls={part('controls', forecastControls)}
        body={part('results', forecastResults)}
        footer={part('footer', forecastFooter)}
      />
      <ForecastHelp lang={lang} />
    </>,
    {
      ...frame,
      chrome: null,
      topbar: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: _('stock_backend.forecast.help') } }
        : {}),
    },
  )
}
