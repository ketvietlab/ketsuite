import { text, parseListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { EmptyState, LinkButton } from '@ketvietlab/design-system'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { adminPage } from '../../backend/screen.ts'
import { countListSearch } from '../search.ts'
import { countControls, countResults, countFooter } from '../counts/island.tsx'
import { countSearch } from '../counts/search.ts'
import { countQuery } from '../counts/shared.ts'
import type { CountProps } from '../counts/shared.ts'
import { CountHelp } from './count-help.tsx'

const labels = (_: Translator): CountProps['labels'] => ({
  ...Object.fromEntries(
    Object.entries({
      title: 'count.title',
      name: 'count.col.name',
      warehouse: 'count.col.warehouse',
      scopeText: 'count.col.scope',
      dateText: 'count.col.date',
      linesText: 'count.col.lines',
      differingText: 'count.col.differing',
      stateText: 'count.col.state',
      allWarehouses: 'count.allWarehouses',
      noMatches: 'count.noMatches',
      noMatchesHint: 'count.noMatchesHint',
      denied: 'count.denied',
      offline: 'count.offline',
      loadError: 'count.loadError',
    }).map(([key, value]) => [key, _(`stock_backend.${value}`)]),
  ),
  emptyHint: _('stock_backend.count.emptyHint'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  region: _('stock_backend.count.title'),
  empty: _('stock_backend.count.empty'),
  loading: _('backend.relation.loading'),
  retry: _('backend.relation.retry'),
  loadError: _('stock_backend.count.loadError'),
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
    ? { applications: { ...frame.applications, helpLabel: _('stock_backend.count.help') } }
    : {}),
})

export function countsScreen(_: Translator, frame: Frame, url: URL, createHref: string | null = null) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = countQuery(url)
  const source = new URL('/admin/stock/counts/data', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: CountProps = {
    key: `counts:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
    search: countSearch(_, parseListState(countListSearch, url).state, query.href),
  }
  const part = (name: string, controller: typeof countControls) =>
    html`${trustedMarkup(renderIsland(`stock.count-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  return shell(
    _,
    _('stock_backend.count.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.count.title')}
        headerActions={
          createHref ? (
            <LinkButton label={_('stock_backend.count.start')} href={createHref} variant="primary" />
          ) : undefined
        }
        controls={part('controls', countControls)}
        body={part('results', countResults)}
        footer={part('footer', countFooter)}
      />
      <CountHelp lang={lang} id="stock-counts-help" />
    </>,
    helpFrame(_, frame),
  )
}

/** A role that may not read counts (sales, K38) meets its own locked page rather than an empty list. */
function lockedScreen(_: Translator, frame: Frame) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  return shell(
    _,
    _('stock_backend.count.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('stock_backend.count.title')}
        body={
          <EmptyState
            visual="locked"
            title={_('stock_backend.count.locked')}
            message={_('stock_backend.count.lockedHint')}
          />
        }
      />
      <CountHelp lang={lang} id="stock-counts-help" />
    </>,
    helpFrame(_, frame),
  )
}

export const countsRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const allowed = await ctx.allows('stock.listCountSessions', url, req)
    return adminPage(ctx, url, req, {
      title: 'stock_backend.count.title',
      ...(allowed ? {} : { status: 403 }),
      body: async (_, frame) =>
        allowed
          ? countsScreen(
              _,
              frame,
              url,
              (await ctx.allows('stock.startCountSession', url, req))
                ? recordModalCreateHref(url, { kind: 'stock.countSession' })
                : null,
            )
          : lockedScreen(_, frame),
    })
  }
