import { text, parseListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { EmptyState, LinkButton } from '@ketvietlab/design-system'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { adminPage } from '../../backend/screen.ts'
import { scrapListSearch } from '../search.ts'
import { scrapControls, scrapResults, scrapFooter } from '../scraps/island.tsx'
import { scrapSearch } from '../scraps/search.ts'
import { scrapQuery } from '../scraps/shared.ts'
import type { ScrapProps } from '../scraps/shared.ts'
import { ScrapHelp } from './scrap-help.tsx'

const labels = (_: Translator): ScrapProps['labels'] => ({
  ...Object.fromEntries(
    Object.entries({
      title: 'scrap.title',
      name: 'scrap.col.name',
      dateText: 'scrap.col.date',
      warehouse: 'scrap.col.warehouse',
      product: 'scrap.col.product',
      lot: 'scrap.col.lot',
      quantityText: 'scrap.col.quantity',
      reasonText: 'scrap.col.reason',
      stateText: 'scrap.col.state',
      allWarehouses: 'scrap.allWarehouses',
      noMatches: 'scrap.noMatches',
      noMatchesHint: 'scrap.noMatchesHint',
      denied: 'scrap.denied',
      offline: 'scrap.offline',
      loadError: 'scrap.loadError',
    }).map(([key, value]) => [key, _(`stock_backend.${value}`)]),
  ),
  emptyHint: _('stock_backend.scrap.emptyHint'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  region: _('stock_backend.scrap.title'),
  empty: _('stock_backend.scrap.empty'),
  loading: _('backend.relation.loading'),
  retry: _('backend.relation.retry'),
  loadError: _('stock_backend.scrap.loadError'),
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
    ? { applications: { ...frame.applications, helpLabel: _('stock_backend.scrap.help') } }
    : {}),
})

export function scrapsScreen(_: Translator, frame: Frame, url: URL, createHref: string | null = null) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = scrapQuery(url)
  const source = new URL('/admin/stock/scraps/data', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: ScrapProps = {
    key: `scraps:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
    search: scrapSearch(_, parseListState(scrapListSearch, url).state, query.href),
  }
  const part = (name: string, controller: typeof scrapControls) =>
    html`${trustedMarkup(renderIsland(`stock.scrap-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  return shell(
    _,
    _('stock_backend.scrap.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.scrap.title')}
        headerActions={
          createHref ? (
            <LinkButton label={_('stock_backend.action.create')} href={createHref} variant="primary" />
          ) : undefined
        }
        controls={part('controls', scrapControls)}
        body={part('results', scrapResults)}
        footer={part('footer', scrapFooter)}
      />
      <ScrapHelp lang={lang} />
    </>,
    helpFrame(_, frame),
  )
}

/** A role that may not read scrap orders meets its own locked page rather than an empty list. */
function lockedScreen(_: Translator, frame: Frame) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  return shell(
    _,
    _('stock_backend.scrap.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.scrap.title')}
        body={
          <EmptyState
            visual="locked"
            title={_('stock_backend.scrap.locked')}
            message={_('stock_backend.scrap.lockedHint')}
          />
        }
      />
      <ScrapHelp lang={lang} />
    </>,
    helpFrame(_, frame),
  )
}

export const scrapsRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const allowed = await ctx.allows('stock.listScraps', url, req)
    return adminPage(ctx, url, req, {
      title: 'stock_backend.scrap.title',
      ...(allowed ? {} : { status: 403 }),
      body: async (_, frame) =>
        allowed
          ? scrapsScreen(
              _,
              frame,
              url,
              (await ctx.allows('stock.saveScrap', url, req))
                ? recordModalCreateHref(url, { kind: 'stock.scrap' })
                : null,
            )
          : lockedScreen(_, frame),
    })
  }
