import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { SearchHelp } from '../search/help.tsx'
import { HELP } from './help-words.ts'
import { searchControls, searchResults, searchFooter } from '../search/island.tsx'
import { searchQuery } from '../search/shared.ts'
import type { SearchProps } from '../search/shared.ts'
const labels = (_: Translator): SearchProps['labels'] => ({
  ...Object.fromEntries(
    [
      'title',
      'search',
      'searchSubmit',
      'name',
      'code',
      'kind',
      'start',
      'startHint',
      ...['template', 'variant', 'attribute', 'unit', 'category', 'tag', 'combo', 'import'].map(
        (kind) => `kind.${kind}`,
      ),
      'empty',
      'emptyHint',
      'retry',
      'denied',
      'offline',
      'loadError',
    ].map((key) => [key, _(`product_backend.search.${key}`)]),
  ),
  locale: _.locale,
  region: _('product_backend.search.title'),
  empty: _('product_backend.search.empty'),
  emptyHint: _('product_backend.search.emptyHint'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
  loadError: _('product_backend.search.loadError'),
  retry: _('product_backend.search.retry'),
})
export function catalogueSearchScreen(_: Translator, frame: Frame, url: URL) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = searchQuery(url)
  const source = new URL('/_ket/fn/product_backend.searchCatalogue', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: SearchProps = {
    key: `search:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
  }
  const part = (name: string, controller: typeof searchControls) =>
    html`${trustedMarkup(renderIsland(`product.search-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  const parts = {
    controls: part('controls', searchControls),
    body: part('results', searchResults),
    footer: part('footer', searchFooter),
  }
  frame = { ...frame, chrome: {} }
  return shell(
    _,
    _('product_backend.search.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('product_backend.search.title')}
        controls={parts.controls}
        body={parts.body}
        footer={parts.footer}
      />
      <SearchHelp lang={lang} />
    </>,
    {
      ...frame,
      chrome: null,
      topbar: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: HELP[lang].trigger } }
        : {}),
    },
  )
}
