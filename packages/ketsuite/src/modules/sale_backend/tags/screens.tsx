import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { SaleTagHelp } from './help.tsx'
import { tagControls, tagResults, tagFooter } from './island.tsx'
import { TAG_PATH, tagQuery } from './shared.ts'
import type { TagProps } from './shared.ts'

const labels = (_: Translator): TagProps['labels'] => ({
  ...Object.fromEntries(
    [
      'title',
      'search',
      'searchSubmit',
      'status',
      'active',
      'archived',
      'all',
      'name',
      'orderCount',
      'empty',
      'emptyHint',
      'noMatches',
      'noMatchesHint',
      'retry',
      'denied',
      'offline',
      'loadError',
    ].map((key) => [key, _(`sale_backend.tag.${key}`)]),
  ),
  region: _('sale_backend.tag.title'),
  empty: _('sale_backend.tag.empty'),
  emptyHint: _('sale_backend.tag.emptyHint'),
  loadError: _('sale_backend.tag.loadError'),
  retry: _('sale_backend.tag.retry'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('backend.table.sortAscending'),
  sortedDescending: _('backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
})

export function saleTagsScreen(_: Translator, frame: Frame, url: URL, create: boolean) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = tagQuery(url)
  const source = new URL(`${TAG_PATH}/read`, url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: TagProps = {
    key: `sale-tag:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
  }
  const part = (name: string, controller: typeof tagControls) =>
    html`${trustedMarkup(renderIsland(`sale.tag-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  frame = {
    ...frame,
    chrome: create
      ? {
          create: {
            label: _('sale_backend.tag.create'),
            path: recordModalCreateHref(url, { kind: 'sale.tag' }),
          },
        }
      : {},
  }
  return shell(
    _,
    _('sale_backend.tag.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('sale_backend.tag.title')}
        controls={part('controls', tagControls)}
        body={part('results', tagResults)}
        footer={part('footer', tagFooter)}
      />
      <SaleTagHelp lang={lang} />
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
