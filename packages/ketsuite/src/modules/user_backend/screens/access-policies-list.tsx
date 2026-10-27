// The access-rules collection: which roles a person gets from who they are.
//
// Assigning roles one person at a time is how people end up with half of what a
// screen needs. A rule says it once — everyone in this department, or with this
// job title, holds these roles here — and every matching person gets the
// same set, from their first sign-in. The collection lists the rules and how many
// people each one currently covers; a rule opens in its record modal.
//
// The production route reads persisted policies; Atlas supplies isolated fixtures.

import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { KetTableColumn, KetTableRow, SearchFilterConfig } from '@ketvietlab/design-system'
import { collectionActions, LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { rowListLabels } from '../../backend/row-list-islands.ts'
import type { RowListSearchOptions } from '../../backend/row-list-read.ts'
import type { RowListProps } from '../../../ui/client/row-list-island.tsx'
import { LIST_HELP_WORDS, accessPolicyListHelp, listHelpDrawer } from './list-help.tsx'

export type AccessPolicyMatchKind = 'idpGroup' | 'department' | 'jobTitle'

export type AccessPolicyRow = {
  id: string
  name: string
  match: { kind: AccessPolicyMatchKind; value: string }
  /** Each role the rule gives, with where it applies, as the reader reads it. */
  grants: Array<{ roleName: string; scope: string }>
  memberCount: number
  active: boolean
}

export type AccessPoliciesListScreenOptions = {
  /** The list's three islands (`rowListIslands(accessPolicyListProps(...))`). */
  islands: { controls: JSXChild; body: JSXChild; footer: JSXChild }
  /** Null when the viewer may not write rules: the header then offers no create action. */
  createHref: string | null
  lang: 'vi' | 'en'
}

export const accessPolicyGridColumns = (_: Translator): KetTableColumn[] => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    format: { kind: 'text', field: 'name' },
  },
  // What a person must be to fall under the rule, with the value as written in
  // the source it is read from.
  { key: 'match', label: _('user_backend.policy.matchColumn'), format: { kind: 'text', field: 'match' } },
  { key: 'grants', label: _('user_backend.policy.grantsColumn'), format: { kind: 'text', field: 'roles' } },
  // A rule gives every role at one place, so the place is said once.
  { key: 'scope', label: _('user_backend.field.scope'), format: { kind: 'text', field: 'scope' } },
  {
    key: 'members',
    label: _('user_backend.policy.membersColumn'),
    align: 'end',
    format: { kind: 'number', field: 'memberCount' },
  },
  {
    key: 'state',
    label: _('user_backend.field.state'),
    format: {
      kind: 'status',
      field: 'state',
      tones: {
        active: { label: _('user_backend.state.active'), tone: 'positive' },
        paused: { label: _('user_backend.policy.paused'), tone: 'neutral' },
      },
    },
  },
]

/** The JSON row the island draws: every value already in the reader's words. */
export const accessPolicyGridRow =
  (_: Translator) =>
  (row: AccessPolicyRow): KetTableRow => ({
    id: row.id,
    name: row.name,
    match: `${_(`user_backend.policy.match.${row.match.kind}`)}: ${row.match.value}`,
    roles: row.grants.map((grant) => grant.roleName).join(', ') || '—',
    scope: [...new Set(row.grants.map((grant) => grant.scope))].join(', ') || '—',
    memberCount: row.memberCount,
    state: row.active ? 'active' : 'paused',
  })

/** The access-rules list's bar: what it is called and the functions it applies and saves through. */
export const accessPolicyListBarOptions = (_: Translator): RowListSearchOptions => ({
  name: 'user-policy-filter',
  bodyId: 'user-policy-list',
  functions: {
    apply: 'user_backend.applySearchFilter',
    saveFavorite: 'user_backend.saveSearchFavorite',
    deleteFavorite: 'user_backend.deleteSearchFavorite',
    setDefaultFavorite: 'user_backend.setDefaultSearchFavorite',
  },
  labels: { searchPlaceholder: _('user_backend.search.policies') },
})

/** The access-rules list's islands: a rule opens in its record modal over the list, on its rule. */
export const accessPolicyListProps = (
  _: Translator,
  options: { href: string; read: string; bar: SearchFilterConfig; createHref: string | null; pin?: string[] },
): RowListProps => ({
  read: options.read,
  href: options.href,
  marker: 'user-policy-list',
  lang: _.locale === 'en' ? 'en' : 'vi',
  columns: accessPolicyGridColumns(_).map((column) => ({
    ...column,
    ...(column.key === 'name' ? { sortKey: 'name' } : {}),
    ...(column.key === 'members' ? { sortKey: 'memberCount' } : {}),
  })),
  labels: rowListLabels(_, {
    empty: _('user_backend.policy.empty'),
    emptyHint: _('user_backend.policy.emptyHint'),
    noMatch: _('user_backend.policy.noMatch'),
    announce: _('user_backend.policy.announce'),
    announceNone: _('user_backend.policy.announceNone'),
    ...(options.createHref ? { create: _('user_backend.action.createPolicy') } : {}),
  }),
  controls: { kind: 'bar', config: options.bar },
  open: { kind: 'record', record: 'user.accessPolicy', tab: 'rule' },
  createHref: options.createHref,
  chooseColumns: true,
  ...(options.pin ? { pin: options.pin } : {}),
})

/**
 * The access-rules collection: the title and its create action from the server,
 * everything the query changes from the three islands, and the page's guide beside it.
 */
export const accessPoliciesScreen = (
  _: Translator,
  frame: Frame,
  options: AccessPoliciesListScreenOptions,
): TemplateResult =>
  shell(
    _,
    _('user_backend.policy.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        title={_('user_backend.policy.title')}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('user_backend.action.createPolicy')}
              href={options.createHref}
              variant="primary"
            />
          ) : undefined
        }
        actions={collectionActions(_, frame)}
        controls={options.islands.controls}
        body={options.islands.body}
        footer={options.islands.footer}
      />
      {listHelpDrawer('user-policy-help', accessPolicyListHelp[options.lang], options.lang)}
    </>,
    {
      ...frame,
      chrome: null,
      topbar: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: LIST_HELP_WORDS[options.lang].trigger } }
        : {}),
    },
  )
