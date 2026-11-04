import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { ReplenishmentHelp } from './replenishment-help.tsx'
import { inLocale } from '../../backend/screen.ts'
import { parseListState } from '@ketvietlab/ketjs'
import { replenishmentSearch } from '../replenishment/search.ts'
import { replenishmentListSearch } from '../search.ts'
import { replenishmentControls, replenishmentResults, replenishmentFooter } from '../replenishment/island.tsx'
import { replenishmentQuery } from '../replenishment/shared.ts'
import type { ReplenishmentProps } from '../replenishment/shared.ts'
const labels = (_: Translator): ReplenishmentProps['labels'] => ({
  ...Object.fromEntries(
    Object.entries({
      title: 'replenishment.title',
      product: 'replenishment.col.product',
      location: 'field.location',
      sourceName: 'replenishment.source',
      leadDays: 'replenishment.leadDays',
      forecasted: 'replenishment.col.forecasted',
      onOrder: 'replenishment.onOrder',
      minQuantity: 'field.minQuantity',
      maxQuantity: 'field.maxQuantity',
      toOrder: 'replenishment.col.toOrder',
      replenishmentUom: 'field.replenishmentUom',
      triggerLabel: 'field.trigger',
      empty: 'replenishment.empty',
      emptyHint: 'replenishment.emptyHint',
      noMatches: 'replenishment.noMatches',
      noMatchesHint: 'replenishment.noMatchesHint',
      denied: 'replenishment.denied',
      offline: 'replenishment.offline',
      loadError: 'replenishment.loadError',
    }).map(([key, value]) => [key, _(`stock_backend.${value}`)]),
  ),
  emptyHint: _('stock_backend.replenishment.emptyHint'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  region: _('stock_backend.replenishment.title'),
  empty: _('stock_backend.replenishment.empty'),
  loading: _('backend.relation.loading'),
  retry: _('backend.relation.retry'),
  loadError: _('stock_backend.replenishment.loadError'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
})
export function replenishmentCollectionScreen(_: Translator, frame: Frame, url: URL, create: boolean) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = replenishmentQuery(url)
  const source = new URL('/admin/stock/replenishment/data', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: ReplenishmentProps = {
    key: `replenishment:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
    search: replenishmentSearch(_, parseListState(replenishmentListSearch, url).state, query.href),
  }
  const part = (name: string, controller: typeof replenishmentControls) =>
    html`${trustedMarkup(renderIsland(`stock.replenishment-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  const parts = {
    controls: part('controls', replenishmentControls),
    body: part('results', replenishmentResults),
    footer: part('footer', replenishmentFooter),
  }
  frame = {
    ...frame,
    chrome: create
      ? {
          create: {
            label: _('stock_backend.action.create'),
            path: inLocale(url, '/admin/stock/replenishment/new'),
          },
        }
      : {},
  }
  return shell(
    _,
    _('stock_backend.replenishment.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('stock_backend.replenishment.title')}
        controls={parts.controls}
        body={parts.body}
        footer={parts.footer}
      />
      <ReplenishmentHelp lang={lang} />
    </>,
    {
      ...frame,
      chrome: null,
      topbar: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: _('stock_backend.replenishment.help') } }
        : {}),
    },
  )
}
