import { text, parseListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { EmptyState } from '@ketvietlab/design-system'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { adminPage } from '../../backend/screen.ts'
import { valuationListSearch } from '../search.ts'
import { valuationControls, valuationResults, valuationFooter } from '../valuation/island.tsx'
import { valuationSearch } from '../valuation/search.ts'
import { valuationQuery } from '../valuation/shared.ts'
import type { ValuationProps } from '../valuation/shared.ts'
import { ValuationHelp } from './valuation-help.tsx'

const labels = (_: Translator): ValuationProps['labels'] => ({
  ...Object.fromEntries(
    Object.entries({
      title: 'valuation.title',
      code: 'valuation.col.code',
      name: 'valuation.col.name',
      quantityText: 'valuation.col.quantity',
      uomName: 'valuation.col.uom',
      averageCostText: 'valuation.col.averageCost',
      valueText: 'valuation.col.value',
      warehouse: 'valuation.warehouse',
      allWarehouses: 'valuation.allWarehouses',
      total: 'valuation.total',
      noMatches: 'valuation.noMatches',
      noMatchesHint: 'valuation.noMatchesHint',
      denied: 'valuation.denied',
      offline: 'valuation.offline',
      loadError: 'valuation.loadError',
    }).map(([key, value]) => [key, _(`stock_backend.${value}`)]),
  ),
  emptyHint: _('stock_backend.valuation.emptyHint'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  region: _('stock_backend.valuation.title'),
  empty: _('stock_backend.valuation.empty'),
  loading: _('backend.relation.loading'),
  retry: _('backend.relation.retry'),
  loadError: _('stock_backend.valuation.loadError'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
})

const helpFrame = (_: Translator, frame: Frame) => ({
  ...frame,
  chrome: null,
  topbar: false,
  ...(frame.applications
    ? { applications: { ...frame.applications, helpLabel: _('stock_backend.valuation.help') } }
    : {}),
})

export function valuationScreen(_: Translator, frame: Frame, url: URL) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = valuationQuery(url)
  const source = new URL('/admin/stock/valuation/data', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: ValuationProps = {
    key: `valuation:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
    search: valuationSearch(_, parseListState(valuationListSearch, url).state, query.href),
  }
  const part = (name: string, controller: typeof valuationControls) =>
    html`${trustedMarkup(renderIsland(`stock.valuation-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  return shell(
    _,
    _('stock_backend.valuation.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.valuation.title')}
        controls={part('controls', valuationControls)}
        body={part('results', valuationResults)}
        footer={part('footer', valuationFooter)}
      />
      <ValuationHelp lang={lang} />
    </>,
    helpFrame(_, frame),
  )
}

/** A role that may not read stock value meets its own locked page rather than an empty list. */
function lockedScreen(_: Translator, frame: Frame) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  return shell(
    _,
    _('stock_backend.valuation.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.valuation.title')}
        body={
          <EmptyState
            visual="locked"
            title={_('stock_backend.valuation.locked')}
            message={_('stock_backend.valuation.lockedHint')}
          />
        }
      />
      <ValuationHelp lang={lang} />
    </>,
    helpFrame(_, frame),
  )
}

export const valuationRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const allowed = await ctx.allows('stock.listValuation', url, req)
    return adminPage(ctx, url, req, {
      title: 'stock_backend.valuation.title',
      ...(allowed ? {} : { status: 403 }),
      body: (_, frame) => (allowed ? valuationScreen(_, frame, url) : lockedScreen(_, frame)),
    })
  }
