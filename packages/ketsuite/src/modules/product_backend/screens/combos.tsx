import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { ComboHelp } from '../combos/help.tsx'
import { HELP } from './help-words.ts'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { comboControls, comboResults, comboFooter } from '../combos/island.tsx'
import { comboQuery } from '../combos/shared.ts'
import type { ComboProps } from '../combos/shared.ts'
const labels = (_: Translator): ComboProps['labels'] => ({
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
      'itemCount',
      'empty',
      'emptyHint',
      'noMatches',
      'noMatchesHint',
      'retry',
      'denied',
      'offline',
      'loadError',
    ].map((key) => [key, _(`product_backend.combo.${key}`)]),
  ),
  region: _('product_backend.combo.title'),
  empty: _('product_backend.combo.empty'),
  emptyHint: _('product_backend.combo.emptyHint'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
  loadError: _('product_backend.combo.loadError'),
  retry: _('product_backend.combo.retry'),
})
export function combosScreen(_: Translator, frame: Frame, url: URL, create: boolean) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = comboQuery(url)
  const source = new URL('/_ket/fn/product_backend.searchCombos', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: ComboProps = {
    key: `combo:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
  }
  const part = (name: string, controller: typeof comboControls) =>
    html`${trustedMarkup(renderIsland(`product.combo-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  const parts = {
    controls: part('controls', comboControls),
    body: part('results', comboResults),
    footer: part('footer', comboFooter),
  }
  frame = {
    ...frame,
    chrome: create
      ? {
          create: {
            label: _('product_backend.combo.create'),
            path: recordModalCreateHref(url, { kind: 'product.combo' }),
          },
        }
      : {},
  }
  return shell(
    _,
    _('product_backend.combo.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('product_backend.combo.title')}
        controls={parts.controls}
        body={parts.body}
        footer={parts.footer}
      />
      <ComboHelp lang={lang} />
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
