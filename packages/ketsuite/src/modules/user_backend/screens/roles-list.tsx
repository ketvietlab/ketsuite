import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { KetTableColumn, KetTableRow, SearchFilterConfig } from '@ketvietlab/design-system'
import { collectionActions, LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { rowListLabels } from '../../backend/row-list-islands.ts'
import type { RowListSearchOptions } from '../../backend/row-list-read.ts'
import type { RowListProps } from '../../../ui/client/row-list-island.tsx'
import { LIST_HELP_WORDS, listHelpDrawer, roleListHelp } from './list-help.tsx'
import type { RoleRow } from './types.ts'

export type RoleListRow = RoleRow

export type RolesListScreenOptions = {
  /** The list's three islands (`rowListIslands(roleListProps(...))`). */
  islands: { controls: JSXChild; body: JSXChild; footer: JSXChild }
  /**
   * Null while roles come only from role templates: a custom role cannot be
   * assigned, so the header offers no create action.
   */
  createHref: string | null
  lang: 'vi' | 'en'
}

export const roleGridColumns = (_: Translator): KetTableColumn[] => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    format: { kind: 'text', field: 'name' },
  },
  {
    key: 'description',
    label: _('user_backend.field.description'),
    wrap: true,
    format: { kind: 'text', field: 'description' },
  },
  {
    key: 'assignments',
    label: _('user_backend.access.assignments'),
    align: 'end',
    format: { kind: 'number', field: 'assignmentCount' },
  },
  {
    key: 'areas',
    label: _('user_backend.roles.permissionsTitle'),
    align: 'end',
    format: { kind: 'number', field: 'bundleCount' },
  },
  {
    key: 'health',
    label: _('user_backend.access.health'),
    format: {
      kind: 'status',
      field: 'health',
      tones: {
        healthy: { label: _('user_backend.roles.healthy'), tone: 'positive' },
        stale: { label: _('user_backend.roles.stale'), tone: 'warning' },
      },
    },
  },
]

/** The JSON row the island draws. A role no template owns has no area count. */
export const roleGridRow = (row: RoleRow): KetTableRow => ({
  id: row.id,
  name: row.name,
  description: row.description || '—',
  assignmentCount: row.assignmentCount ?? 0,
  bundleCount: row.bundleCount ?? null,
  health: row.healthIssues?.length ? 'stale' : 'healthy',
})

/** The roles list's bar: what it is called and the functions it applies and saves through. */
export const roleListBarOptions = (_: Translator): RowListSearchOptions => ({
  name: 'user-roles-filter',
  bodyId: 'user-roles-list',
  functions: {
    apply: 'user_backend.applySearchFilter',
    saveFavorite: 'user_backend.saveSearchFavorite',
    deleteFavorite: 'user_backend.deleteSearchFavorite',
    setDefaultFavorite: 'user_backend.setDefaultSearchFavorite',
  },
  labels: { searchPlaceholder: _('user_backend.search.roles') },
})

/** The roles list's islands: a role opens in its record modal over the list. */
export const roleListProps = (
  _: Translator,
  options: { href: string; read: string; bar: SearchFilterConfig; pin?: string[] },
): RowListProps => ({
  read: options.read,
  href: options.href,
  marker: 'user-roles-list',
  lang: _.locale === 'en' ? 'en' : 'vi',
  columns: roleGridColumns(_).map((column) => ({
    ...column,
    ...(column.key === 'name' ? { sortKey: 'name' } : {}),
    ...(column.key === 'assignments' ? { sortKey: 'assignmentCount' } : {}),
  })),
  labels: rowListLabels(_, {
    empty: _('user_backend.roles.empty'),
    emptyHint: _('user_backend.roles.emptyHint'),
    noMatch: _('user_backend.roles.noMatch'),
    announce: _('user_backend.roles.announce'),
    announceNone: _('user_backend.roles.announceNone'),
  }),
  controls: { kind: 'bar', config: options.bar },
  open: { kind: 'record', record: 'user.role' },
  chooseColumns: true,
  ...(options.pin ? { pin: options.pin } : {}),
})

/**
 * The roles collection: the title and its actions from the server, everything the
 * query changes from the three islands, and the page's guide beside it.
 */
export const rolesScreen = (_: Translator, frame: Frame, options: RolesListScreenOptions): TemplateResult =>
  shell(
    _,
    _('user_backend.roles.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        title={_('user_backend.roles.title')}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('user_backend.action.createRole')}
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
      {listHelpDrawer('user-roles-help', roleListHelp[options.lang], options.lang)}
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
