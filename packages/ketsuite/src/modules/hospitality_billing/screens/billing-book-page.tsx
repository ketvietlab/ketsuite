import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import { renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Frame } from '../../../ui/index.ts'
import { hospitalityAdminPage as adminPage } from '../../hospitality_core/screens/hospitality-admin-page.tsx'
import { ListScreenFrame } from '../../hospitality_core/screens/page-frame.tsx'
import {
  BILLING_BOOK_PERIODS,
  BILLING_BOOK_SORTS,
  BILLING_BOOK_VIEWS,
  billingBookQueryFromUrl,
} from '../billing-book-query.ts'
import type { BillingBookProps } from '../collections/billing-book.tsx'
import { billingBookControls, billingBookFooter, billingBookResults } from '../collections/billing-book.tsx'

const SCOPE = ['company', 'companies', 'branch', 'branches', 'lang']
const scoped = (url: URL, path: string) => {
  const target = new URL(path, url)
  for (const [name, value] of url.searchParams)
    if (SCOPE.includes(name)) target.searchParams.append(name, value)
  return `${target.pathname}${target.search}`
}
const STATES = ['unverified', 'missing-rule', 'uninvoiced', 'owing', 'paid']
const WORDS = [
  'search',
  'searchPlaceholder',
  'searchSubmit',
  'filters',
  'filtersToggle',
  'property',
  'allProperties',
  'period',
  ...BILLING_BOOK_PERIODS.map((days) => `period.${days}`),
  ...BILLING_BOOK_VIEWS.map((id) => `view.${id}`),
  ...BILLING_BOOK_SORTS.map((id) => `sort.${id}`),
  'sortedBy',
  ...['folio', 'state', 'total', 'invoice', 'balance', 'next'].map((id) => `column.${id}`),
  ...STATES.map((id) => `billing.${id}`),
  ...['rule', 'invoice', 'payment', 'view'].map((id) => `next.${id}`),
  'dueUnknown',
  'invoiceNone',
  'invoiceDraft',
  'invoiceVoid',
  'describe',
  'noResults',
  'lost',
  'pager',
  'region',
  'loading',
  'retry',
  'error',
  'errorHint',
  'errorHintStale',
  'offline',
  'offlineHint',
  'offlineHintStale',
  'denied',
  'deniedHint',
  'selectAll',
  'selectRow',
  'ascending',
  'descending',
  'previousPage',
  'nextPage',
  'emptyBook',
  'emptyBookHint',
  'folios',
  'emptySearch',
  'filteredMessage',
  'clear',
  'partial',
  'partialHint',
]
const PLACEHOLDERS = Object.fromEntries(
  ['first', 'last', 'total', 'label', 'order', 'q'].map((name) => [name, `{${name}}`]),
)

export type BillingBookScreenInput = {
  url: URL
  locale: 'vi' | 'en'
  allowed: boolean
  properties: BillingBookProps['properties']
  may: BillingBookProps['may'] & { folios: boolean }
}

/** The islands' props from the URL: the frame only; rows, counts and pages are read in the browser. */
export const billingBookProps = (
  { url, locale, allowed, properties, may }: BillingBookScreenInput,
  _: Translator,
): BillingBookProps => ({
  key: `billing:${locale}:${JSON.stringify(SCOPE.map((name) => url.searchParams.getAll(name)))}`,
  id: 'hospitality-billing',
  source: scoped(url, '/_ket/fn/hospitality_billing.searchBilling'),
  path: scoped(url, '/admin/hospitality/billing'),
  recordPath: '/admin/hospitality/folios',
  // An empty book points at the folio register, where settled folios of any age are found.
  foliosHref: may.folios ? scoped(url, '/admin/hospitality/folios') : null,
  lang: locale,
  allowed,
  may: { rule: may.rule, invoice: may.invoice, payment: may.payment },
  properties,
  query: billingBookQueryFromUrl(url, properties),
  words: Object.fromEntries(
    WORDS.map((key) => [key, _(`hospitality_billing.billingBook.${key}`, PLACEHOLDERS)]),
  ),
})

/**
 * The billing list (HOS-UI-020): a list page whose controls, rows and pager are islands on one read,
 * `hospitality_billing.searchBilling`, over billing's work of a period (HOS-DEC-033).
 */
export const billingBookScreen = (
  _: Translator,
  input: BillingBookScreenInput,
  frame: Frame,
): TemplateResult => {
  const props = billingBookProps(input, _)
  const island = (name: string, factory: (props: BillingBookProps) => { view: () => unknown }) =>
    trustedMarkup(renderIsland(name, factory as never, props, { tag: 'div' }))
  return (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_billing.screen.title')}
      frame={{ ...frame, chrome: null }}
      controlsMode="islands"
      controls={island('hospitality.billing-controls', billingBookControls)}
      body={island('hospitality.billing-results', billingBookResults)}
      footer={island('hospitality.billing-footer', billingBookFooter)}
    />
  )
}

/** The list's request: who may read the book and take each next step, and the properties it shows. */
export async function renderBillingBook(ctx: ServeContext, url: URL, req: Parameters<Route>[1]) {
  const locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const allows = (fn: string) => ctx.allows(fn, url, req)
  const allowed = await allows('hospitality_billing.searchBilling')
  const properties = allowed
    ? (
        (await ctx.call('hospitality_billing.getBillingBookFrame', {}, url, req)) as {
          properties: Array<BillingBookProps['properties'][number] & { businessDate?: string }>
        }
      ).properties.map(({ id, name }) => ({ id, name }))
    : []
  const may = {
    rule: await allows('hospitality_billing.saveChargeRule'),
    invoice: await allows('hospitality_billing.invoiceFolio'),
    payment: await allows('hospitality_billing.recordFolioPayment'),
    folios: await allows('hospitality_core.searchFolios'),
  }
  return adminPage(ctx, url, req, {
    title: 'hospitality_billing.screen.title',
    body: (_, frame) => billingBookScreen(_, { url, locale, allowed, properties, may }, frame),
  })
}
