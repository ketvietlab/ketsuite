import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { TagHelp } from '../tags/help.tsx'
import { HELP } from './help-words.ts'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { tagControls, tagResults, tagFooter } from '../tags/island.tsx'
import { tagQuery } from '../tags/shared.ts'
import type { TagProps } from '../tags/shared.ts'
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
      'productCount',
      'empty',
      'emptyHint',
      'noMatches',
      'noMatchesHint',
      'retry',
      'denied',
      'offline',
      'loadError',
    ].map((key) => [key, _(`product_backend.tag.${key}`)]),
  ),
  region: _('product_backend.tag.title'),
  empty: _('product_backend.tag.empty'),
  emptyHint: _('product_backend.tag.emptyHint'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
  loadError: _('product_backend.tag.loadError'),
  retry: _('product_backend.tag.retry'),
})
export function tagsScreen(_: Translator, frame: Frame, url: URL, create: boolean) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = tagQuery(url)
  const source = new URL('/_ket/fn/product_backend.searchTags', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: TagProps = {
    key: `tag:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
  }
  const part = (name: string, controller: typeof tagControls) =>
    html`${trustedMarkup(renderIsland(`product.tag-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  const parts = {
    controls: part('controls', tagControls),
    body: part('results', tagResults),
    footer: part('footer', tagFooter),
  }
  frame = {
    ...frame,
    chrome: create
      ? {
          create: {
            label: _('product_backend.tag.create'),
            path: recordModalCreateHref(url, { kind: 'product.tag' }),
          },
        }
      : {},
  }
  return shell(
    _,
    _('product_backend.tag.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('product_backend.tag.title')}
        controls={parts.controls}
        body={parts.body}
        footer={parts.footer}
      />
      <TagHelp lang={lang} />
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
