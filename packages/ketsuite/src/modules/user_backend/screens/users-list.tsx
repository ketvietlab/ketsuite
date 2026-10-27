import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { KetTableColumn, KetTableRow, SearchFilterConfig } from '@ketvietlab/design-system'
import {
  collectionActions,
  collectionSelection,
  formatDateTime,
  LinkButton,
  ListPage,
  shell,
} from '../../../ui/index.ts'
import type { Frame, TableSelection } from '../../../ui/index.ts'
import { rowListLabels } from '../../backend/row-list-islands.ts'
import type { RowListSearchOptions } from '../../backend/row-list-read.ts'
import type { RowListProps } from '../../../ui/client/row-list-island.tsx'
import { LIST_HELP_WORDS, listHelpDrawer, userListHelp } from './list-help.tsx'
import type { UserRow } from './types.ts'

export type UserListRow = UserRow

export type UsersListScreenOptions = {
  /** The list's three islands (`rowListIslands(userListProps(...))`). */
  islands: { controls: JSXChild; body: JSXChild; footer: JSXChild }
  /** Null when the viewer may not create a user: the header then offers no create action. */
  createHref: string | null
  /** The bulk form rows are checked into; null when the viewer may not change people in bulk. */
  selection: TableSelection | null
  lang: 'vi' | 'en'
}

// Date before time, as the record modal writes it: "28/09/2026 08:42".
const signInTime = (locale: string, value: string): string => {
  const at = new Date(value)
  return `${formatDateTime(locale, at, { day: '2-digit', month: '2-digit', year: 'numeric' })} ${formatDateTime(locale, at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`
}

export const userGridColumns = (_: Translator): KetTableColumn[] => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    // Authority that answers to nothing else is said on the row that holds it.
    format: {
      kind: 'custom',
      field: 'name',
      renderer: 'flagged',
      options: { flag: 'superuser', label: _('user_backend.field.superuser'), tone: 'warning' },
    },
  },
  { key: 'login', label: _('user_backend.field.login'), format: { kind: 'identifier', field: 'login' } },
  {
    key: 'email',
    label: _('user_backend.field.email'),
    priority: 'secondary',
    format: { kind: 'text', field: 'email' },
  },
  {
    key: 'lastSignIn',
    label: _('user_backend.login.lastSignIn'),
    kind: 'date',
    priority: 'secondary',
    format: { kind: 'text', field: 'lastSignIn' },
  },
  {
    key: 'access',
    label: _('user_backend.field.accessKind'),
    // Each kind of access reads differently, so each carries its own tone rather
    // than three shades of the same one.
    format: {
      kind: 'status',
      field: 'accessKind',
      tones: {
        internal: { label: _('user_backend.access.internal'), tone: 'info' },
        portal: { label: _('user_backend.access.portal'), tone: 'neutral' },
        public: { label: _('user_backend.access.public'), tone: 'warning' },
      },
    },
  },
  {
    key: 'credential',
    label: _('user_backend.field.credential'),
    // What the reader wants to know is whether this person can sign in, not which
    // mechanism is pending behind it.
    format: {
      kind: 'status',
      field: 'credential',
      tones: {
        ready: { label: _('user_backend.login.ready'), tone: 'positive' },
        pending: { label: _('user_backend.login.preparing'), tone: 'warning' },
      },
    },
  },
  {
    key: 'state',
    label: _('user_backend.field.state'),
    format: {
      kind: 'status',
      field: 'state',
      tones: {
        active: { label: _('user_backend.state.active'), tone: 'positive' },
        archived: { label: _('user_backend.state.archived'), tone: 'neutral' },
      },
    },
  },
]

/** The JSON row the island draws: every value already in the reader's words. */
export const userGridRow =
  (_: Translator) =>
  (row: UserRow): KetTableRow => ({
    id: row.id,
    name: row.name,
    superuser: row.superuser,
    login: row.login,
    email: row.email || '—',
    lastSignIn: row.lastLoginAt ? signInTime(_.locale, row.lastLoginAt) : _('user_backend.login.never'),
    accessKind: row.accessKind,
    credential: row.passwordReady ? 'ready' : 'pending',
    state: row.active ? 'active' : 'archived',
  })

/** An access kind, a role source, or a boolean column, in the reader's language. */
export const userGroupLabel = (_: Translator, key: string, value: unknown): string => {
  const raw = value == null ? '' : String(value)
  if (key === 'active') return _(`user_backend.state.${raw === 'false' ? 'archived' : 'active'}`)
  if (key === 'passwordReady')
    return _(`user_backend.state.${raw === 'false' ? 'invitationPending' : 'passwordReady'}`)
  if (!raw) return _('backend.chrome.groupEmpty')
  if (key === 'accessKind' && _.resolves(`user_backend.access.${raw}`)) return _(`user_backend.access.${raw}`)
  if (key === 'mode' && _.resolves(`user_backend.role.${raw}`)) return _(`user_backend.role.${raw}`)
  return raw
}

/** The people list's bar: what it is called and the functions it applies and saves through. */
export const userListBarOptions = (_: Translator): RowListSearchOptions => ({
  name: 'user-people-filter',
  bodyId: 'user-people-list',
  functions: {
    apply: 'user_backend.applySearchFilter',
    saveFavorite: 'user_backend.saveSearchFavorite',
    deleteFavorite: 'user_backend.deleteSearchFavorite',
    setDefaultFavorite: 'user_backend.setDefaultSearchFavorite',
  },
  labels: { searchPlaceholder: _('user_backend.search.users') },
})

/**
 * The people list's islands: a person opens on their own page (`/admin/users/{id}`), whose way back is
 * this list at that row; rows are checked into the bulk form when the viewer may change people.
 */
export const userListProps = (
  _: Translator,
  options: {
    href: string
    read: string
    bar: SearchFilterConfig
    lang?: string | null
    selection?: TableSelection | null
    pin?: string[]
  },
): RowListProps => ({
  read: options.read,
  href: options.href,
  marker: 'user-people-list',
  lang: _.locale === 'en' ? 'en' : 'vi',
  columns: userGridColumns(_).map((column) =>
    column.key === 'name' || column.key === 'login' ? { ...column, sortKey: column.key } : column,
  ),
  labels: rowListLabels(_, {
    empty: _('user_backend.users.empty'),
    emptyHint: _('user_backend.users.emptyHint'),
    noMatch: _('user_backend.users.noMatch'),
    announce: _('user_backend.users.announce'),
    announceNone: _('user_backend.users.announceNone'),
  }),
  controls: { kind: 'bar', config: options.bar },
  open: {
    kind: 'page',
    path: `/admin/users/{id}${options.lang ? `?lang=${encodeURIComponent(options.lang)}` : ''}`,
    returnPath: '/admin/users',
  },
  chooseColumns: true,
  ...(options.selection ? { selection: { formId: options.selection.formId } } : {}),
  ...(options.pin ? { pin: options.pin } : {}),
})

/**
 * The people collection: the title, its create action and the bulk form from the server, everything
 * the query changes from the three islands, and the page's guide beside it.
 */
export const usersScreen = (_: Translator, frame: Frame, options: UsersListScreenOptions): TemplateResult =>
  shell(
    _,
    _('user_backend.users.title'),
    <>
      <ListPage
        variant="operational"
        frame={frame}
        title={_('user_backend.users.title')}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('user_backend.action.createUser')}
              href={options.createHref}
              variant="primary"
            />
          ) : undefined
        }
        actions={collectionActions(_, frame)}
        controls={options.islands.controls}
        selection={collectionSelection(_, frame, options.selection)}
        body={options.islands.body}
        footer={options.islands.footer}
      />
      {listHelpDrawer('user-people-help', userListHelp[options.lang], options.lang)}
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
