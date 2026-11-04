import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { CategoryHelp } from '../categories/help.tsx'
import { HELP } from './help-words.ts'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { categoryControls, categoryResults, categoryFooter } from '../categories/island.tsx'
import { categoryQuery } from '../categories/shared.ts'
import type { CategoryProps } from '../categories/shared.ts'
const labels = (_: Translator): CategoryProps['labels'] => ({
  ...Object.fromEntries(
    [
      'title',
      'search',
      'searchSubmit',
      'status',
      'active',
      'archived',
      'all',
      'path',
      'income',
      'expense',
      'productCount',
      'companyDefault',
      'empty',
      'emptyHint',
      'noMatches',
      'noMatchesHint',
      'retry',
      'denied',
      'offline',
      'loadError',
    ].map((key) => [key, _(`product_backend.category.${key}`)]),
  ),
  region: _('product_backend.category.title'),
  empty: _('product_backend.category.empty'),
  emptyHint: _('product_backend.category.emptyHint'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
  loadError: _('product_backend.category.loadError'),
  retry: _('product_backend.category.retry'),
})
export function categoriesScreen(_: Translator, frame: Frame, url: URL, create: boolean) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = categoryQuery(url)
  const source = new URL('/_ket/fn/product_backend.searchCategories', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: CategoryProps = {
    key: `category:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
  }
  const part = (name: string, controller: typeof categoryControls) =>
    html`${trustedMarkup(renderIsland(`product.category-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  const parts = {
    controls: part('controls', categoryControls),
    body: part('results', categoryResults),
    footer: part('footer', categoryFooter),
  }
  frame = {
    ...frame,
    chrome: create
      ? {
          create: {
            label: _('product_backend.category.create'),
            path: recordModalCreateHref(url, { kind: 'product.category' }),
          },
        }
      : {},
  }
  return shell(
    _,
    _('product_backend.category.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('product_backend.category.title')}
        controls={parts.controls}
        body={parts.body}
        footer={parts.footer}
      />
      <CategoryHelp lang={lang} />
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
