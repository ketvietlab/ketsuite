import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { ImportHelp } from '../imports/help.tsx'
import { HELP } from './help-words.ts'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { importControls, importResults, importFooter } from '../imports/island.tsx'
import { importQuery } from '../imports/shared.ts'
import type { ImportProps } from '../imports/shared.ts'
const labels = (_: Translator): ImportProps['labels'] => ({
  ...Object.fromEntries(
    [
      'title',
      'search',
      'searchSubmit',
      'name',
      'occurredAt',
      'actorName',
      'rowCount',
      'createdCount',
      'changedCount',
      'variantCount',
      'empty',
      'emptyHint',
      'retry',
      'denied',
      'offline',
      'loadError',
    ].map((key) => [key, _(`product_backend.import.${key}`)]),
  ),
  locale: _.locale,
  region: _('product_backend.import.title'),
  empty: _('product_backend.import.empty'),
  emptyHint: _('product_backend.import.emptyHint'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('product_backend.table.sortAscending'),
  sortedDescending: _('product_backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
  loadError: _('product_backend.import.loadError'),
  retry: _('product_backend.import.retry'),
})
export function importsScreen(_: Translator, frame: Frame, url: URL, create: boolean) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = importQuery(url)
  const source = new URL('/_ket/fn/product_backend.searchImports', url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: ImportProps = {
    key: `import:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
  }
  const part = (name: string, controller: typeof importControls) =>
    html`${trustedMarkup(renderIsland(`product.import-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  const parts = {
    controls: part('controls', importControls),
    body: part('results', importResults),
    footer: part('footer', importFooter),
  }
  frame = {
    ...frame,
    chrome: create
      ? {
          create: {
            label: _('product_backend.import.create'),
            path: recordModalCreateHref(url, { kind: 'product.import' }),
          },
        }
      : {},
  }
  return shell(
    _,
    _('product_backend.import.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('product_backend.import.title')}
        controls={parts.controls}
        body={parts.body}
        footer={parts.footer}
      />
      <ImportHelp lang={lang} />
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
