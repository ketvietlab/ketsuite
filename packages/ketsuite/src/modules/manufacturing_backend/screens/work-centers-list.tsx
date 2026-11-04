import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  RecordForm,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import { WorkCenterHelp } from './work-center-help.tsx'

const lang = (_: Translator) => (_.locale === 'en' ? 'en' : 'vi')

export type WorkCenterListRow = {
  id: string
  code: string
  name: string
  skill?: string
  capacity: string
  timeEfficiency: string
  costPerHour: string
  active: boolean
  editHref: string
}

export type WorkCentersListScreenOptions = {
  /** Grouped rows the search-filter bar decided on, when the reader grouped. */
  table?: Partial<DataTable<WorkCenterListRow>>
  rows: WorkCenterListRow[]
  /** Locale-aware URL that opens the create modal; null when the reader cannot configure. */
  createHref: string | null
  /** Locale-aware collection endpoint for archive and restore; null hides them. */
  action: string | null
}

export const workCenterListColumns = (
  _: Translator,
  action: string | null,
): Array<Column<WorkCenterListRow>> => [
  {
    key: 'code',
    label: _('manufacturing_backend.field.code'),
    cell: (row) => code(row.code, 'identifier'),
    kind: 'identifier',
    priority: 'primary',
  },
  {
    key: 'name',
    label: _('manufacturing_backend.field.name'),
    cell: (row) => row.name,
    priority: 'secondary',
    width: 'wide',
  },
  {
    key: 'skill',
    label: _('manufacturing_backend.field.skill'),
    cell: (row) => (row.skill ? _(`manufacturing_backend.skill.${row.skill}`) : '—'),
  },
  {
    key: 'capacity',
    label: _('manufacturing_backend.field.capacity'),
    cell: (row) => row.capacity,
    align: 'end',
  },
  {
    key: 'timeEfficiency',
    label: _('manufacturing_backend.field.efficiency'),
    cell: (row) => row.timeEfficiency,
    align: 'end',
  },
  {
    key: 'costPerHour',
    label: _('manufacturing_backend.field.cost'),
    cell: (row) => row.costPerHour,
    align: 'end',
  },
  {
    key: 'active',
    label: _('manufacturing_backend.field.state'),
    cell: (row) =>
      row.active
        ? badge(_('manufacturing_backend.state.active'), 'positive', 'active')
        : badge(_('manufacturing_backend.state.archived'), 'neutral', 'archived'),
    kind: 'status',
  },
  ...(action === null
    ? []
    : [
        {
          key: 'actions',
          label: _('manufacturing_backend.field.actions'),
          cell: (row: WorkCenterListRow) => (
            <RecordForm
              action={action}
              layout="inline"
              hidden={{ id: row.id, action: row.active ? 'archive' : 'restore' }}
              fields={[]}
              submit={
                row.active
                  ? _('manufacturing_backend.action.archive')
                  : _('manufacturing_backend.action.restore')
              }
              submitVariant={row.active ? 'tertiary' : 'secondary'}
              submitSize="compact"
            />
          ),
        },
      ]),
]

export const workCentersListScreen = (
  _: Translator,
  options: WorkCentersListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.editHref,
      columns: workCenterListColumns(_, options.action),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  return shell(
    _,
    _('manufacturing_backend.workCenters.title'),
    <>
      <ListPage
        variant="operational"
        frame={collection.frame}
        title={_('manufacturing_backend.workCenters.title')}
        controls={collectionControls(_, _('manufacturing_backend.workCenters.title'), collection.frame)}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('manufacturing_backend.workCenters.create')}
              href={options.createHref}
              variant="primary"
            />
          ) : undefined
        }
        actions={collectionActions(_, collection.frame)}
        footer={`${_('manufacturing_backend.workCenters.title')}: ${String(collection.total)}`}
        body={
          options.rows.length || options.table?.groups?.length
            ? collectionTable(_, collection.table)
            : emptyState(
                _('manufacturing_backend.empty.workCenters'),
                _('manufacturing_backend.empty.workCentersHint'),
              )
        }
      />
      <WorkCenterHelp lang={lang(_)} />
    </>,
    { ...collection.frame, chrome: null, topbar: false },
  )
}

/** What a reader without the work-center read grant sees in place of the list. */
export const workCentersLockedScreen = (_: Translator, frame: Frame = {}): TemplateResult =>
  shell(
    _,
    _('manufacturing_backend.workCenters.title'),
    <>
      <ListPage
        variant="operational"
        frame={{ ...frame, chrome: {} }}
        context={null}
        title={_('manufacturing_backend.workCenters.title')}
        body={emptyState(
          _('manufacturing_backend.workCenters.locked'),
          _('manufacturing_backend.workCenters.lockedHint'),
          { visual: 'locked' },
        )}
      />
      <WorkCenterHelp lang={lang(_)} />
    </>,
    { ...frame, chrome: null, topbar: false },
  )
