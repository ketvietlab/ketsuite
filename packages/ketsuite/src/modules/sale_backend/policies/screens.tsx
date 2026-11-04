import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { SalePolicyHelp } from './help.tsx'
import { policyControls, policyResults, policyFooter } from './island.tsx'
import { POLICY_PATH, policyQuery } from './shared.ts'
import type { PolicyProps } from './shared.ts'

const labels = (_: Translator): PolicyProps['labels'] => ({
  ...Object.fromEntries(
    [
      'title',
      'search',
      'searchSubmit',
      'setting',
      'setting.all',
      'setting.default',
      'setting.own',
      'setting.service',
      'defaultCode',
      'name',
      'categoryName',
      'type',
      'type.goods',
      'type.service',
      'policy',
      'policy.order',
      'policy.delivery',
      'empty',
      'emptyHint',
      'noMatches',
      'noMatchesHint',
      'retry',
      'denied',
      'offline',
      'loadError',
    ].map((key) => [key, _(`sale_backend.policy.${key}`)]),
  ),
  region: _('sale_backend.policy.title'),
  empty: _('sale_backend.policy.empty'),
  emptyHint: _('sale_backend.policy.emptyHint'),
  loadError: _('sale_backend.policy.loadError'),
  retry: _('sale_backend.policy.retry'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('backend.table.sortAscending'),
  sortedDescending: _('backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
})

export function salePoliciesScreen(_: Translator, frame: Frame, url: URL) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = policyQuery(url)
  const source = new URL(`${POLICY_PATH}/read`, url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: PolicyProps = {
    key: `sale-policy:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
  }
  const part = (name: string, controller: typeof policyControls) =>
    html`${trustedMarkup(renderIsland(`sale.policy-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  frame = { ...frame, chrome: {} }
  return shell(
    _,
    _('sale_backend.policy.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('sale_backend.policy.title')}
        controls={part('controls', policyControls)}
        body={part('results', policyResults)}
        footer={part('footer', policyFooter)}
      />
      <SalePolicyHelp lang={lang} />
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
