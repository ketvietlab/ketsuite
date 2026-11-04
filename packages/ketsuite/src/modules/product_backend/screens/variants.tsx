import { marked } from 'marked'
import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { adminPage } from '../../backend/screen.ts'
import { VARIANT_LIST_KEY, variantList } from '../variants/island.tsx'
import type { VariantListLabels } from '../variants/island.tsx'
import { VARIANT_PAGE_SIZE } from '../variants/read.ts'
import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { HELP } from './help-words.ts'
import { variantsHelp } from '../variants/help.ts'

/**
 * The Variants screen. `ListPage` owns the title; the
 * `product.variant-list` island in its body owns the query, the rows and the pager, and the
 * server renders it loading only (./island.tsx). The guide sits beside it in the content
 * slot, opened from the rail's Help.
 */
export const variantsScreen = (
  _: Translator,
  frame: Frame,
  island: JSXChild,
  lang: 'vi' | 'en',
): TemplateResult => {
  const words = HELP[lang]
  const guide = variantsHelp[lang]
  return shell(
    _,
    _('product_backend.variantList.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('product_backend.variantList.title')}
        body={island}
      />
      <HelpDrawer
        id="product-variants-help"
        label={words.label}
        title={guide.title}
        closeLabel={words.close}
        body={
          <MarkdownContent
            source={guide.source}
            lexer={marked.lexer}
            headingOffset={1}
            labels={{
              diagram: words.diagram,
              table: words.table,
              source: words.source,
              loading: words.loading,
              error: words.error,
            }}
          />
        }
      />
    </>,
    {
      ...frame,
      chrome: null,
      topbar: false,
      ...(frame.applications ? { applications: { ...frame.applications, helpLabel: words.trigger } } : {}),
    },
  )
}

const WORDS = [
  'search',
  'searchPlaceholder',
  'searchSubmit',
  'status',
  'active',
  'archived',
  'all',
  'type',
  'typeAll',
  'goods',
  'service',
  'combo',
  'tag',
  'tagAll',
  'category',
  'categoryAll',
  'code',
  'name',
  'barcode',
  'price',
  'cost',
  'onHand',
  'available',
  'exportCsv',
  'use',
  'useAll',
  'useSale',
  'usePurchase',
  'useNotSold',
  'useTracked',
  'sortAsc',
  'sortDesc',
  'noMatch',
  'noMatchHint',
  'goTemplates',
  'pager',
  'clearFilters',
  'offline',
  'retryHint',
  'deniedTitle',
  'deniedMessage',
  'missingRow',
  'announce',
  'announceNone',
] as const

const listLabels = (_: Translator): VariantListLabels =>
  ({
    ...Object.fromEntries(WORDS.map((key) => [key, _(`product_backend.variantList.${key}`)])),
    region: _('product_backend.variantList.title'),
    selectAll: _('backend.table.selectAll'),
    selectRow: _('backend.table.selectRow'),
    sortedAscending: _('product_backend.table.sortAscending'),
    sortedDescending: _('product_backend.table.sortDescending'),
    previousPage: _('backend.chrome.previous'),
    nextPage: _('backend.chrome.next'),
    loading: _('backend.relation.loading'),
    loadError: _('product_backend.variantList.loadError'),
    retry: _('backend.relation.retry'),
    empty: _('product_backend.variantList.empty'),
    emptyHint: _('product_backend.variantList.emptyHint'),
  }) as VariantListLabels

export async function variantCollectionScreen(ctx: ServeContext, url: URL, req: Parameters<Route>[1]) {
  if (req.method !== 'GET') return text('GET', { status: 405 })
  const live = (await ctx.live(req)).functions
  // `live` is the same for every viewer; what this one may do is their allow-list.
  const may = async (name: string) => Boolean(live[name]) && (await ctx.allows(name, url, req))
  const read = (await may('stock_backend.searchProductVariants'))
    ? 'stock_backend.searchProductVariants'
    : 'product_backend.searchVariants'
  const listUrl = new URL(url)
  for (const key of ['record', 'modal', 'favoriteError', 'bulkProduct']) listUrl.searchParams.delete(key)
  const href = `${listUrl.pathname}${listUrl.search}`
  return adminPage(ctx, url, req, {
    title: 'product_backend.variantList.title',
    body: (_, frame) => {
      const lang = _.locale === 'en' ? 'en' : 'vi'
      const island = html`${trustedMarkup(
        renderIsland(
          'product.variant-list',
          variantList,
          { href, lang, pageSize: VARIANT_PAGE_SIZE, read, labels: listLabels(_) },
          { tag: 'div', key: VARIANT_LIST_KEY },
        ),
      )}`
      return variantsScreen(_, { ...frame, chrome: {} }, island, lang)
    },
  })
}
