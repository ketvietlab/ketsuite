import type { Translator } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { SaleTeamHelp } from './help.tsx'
import { teamControls, teamResults, teamFooter } from './island.tsx'
import { TEAM_PATH, teamQuery } from './shared.ts'
import type { TeamProps } from './shared.ts'

const labels = (_: Translator): TeamProps['labels'] => ({
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
      'leaderName',
      'memberCount',
      'monthlyTarget',
      'empty',
      'emptyHint',
      'noMatches',
      'noMatchesHint',
      'retry',
      'denied',
      'offline',
      'loadError',
    ].map((key) => [key, _(`sale_backend.team.${key}`)]),
  ),
  region: _('sale_backend.team.title'),
  empty: _('sale_backend.team.empty'),
  emptyHint: _('sale_backend.team.emptyHint'),
  loadError: _('sale_backend.team.loadError'),
  retry: _('sale_backend.team.retry'),
  selectAll: _('backend.table.selectAll'),
  selectRow: _('backend.table.selectRow'),
  sortedAscending: _('backend.table.sortAscending'),
  sortedDescending: _('backend.table.sortDescending'),
  previousPage: _('backend.chrome.previous'),
  nextPage: _('backend.chrome.next'),
  loading: _('backend.relation.loading'),
})

export function saleTeamsScreen(_: Translator, frame: Frame, url: URL, create: boolean) {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const query = teamQuery(url)
  const source = new URL(`${TEAM_PATH}/read`, url)
  for (const key of ['company', 'branch', 'lang'])
    if (url.searchParams.has(key)) source.searchParams.set(key, url.searchParams.get(key)!)
  const props: TeamProps = {
    key: `sale-team:${query.href}`,
    query,
    source: `${source.pathname}${source.search}`,
    labels: labels(_),
  }
  const part = (name: string, controller: typeof teamControls) =>
    html`${trustedMarkup(renderIsland(`sale.team-${name}`, controller, props, { tag: 'div', key: ['key'] }))}`
  frame = {
    ...frame,
    chrome: create
      ? {
          create: {
            label: _('sale_backend.team.create'),
            path: recordModalCreateHref(url, { kind: 'sale.team' }),
          },
        }
      : {},
  }
  return shell(
    _,
    _('sale_backend.team.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        context={null}
        title={_('sale_backend.team.title')}
        controls={part('controls', teamControls)}
        body={part('results', teamResults)}
        footer={part('footer', teamFooter)}
      />
      <SaleTeamHelp lang={lang} />
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
