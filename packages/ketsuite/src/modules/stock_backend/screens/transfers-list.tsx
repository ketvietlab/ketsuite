import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  icon,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import { scheduledCell } from '../scheduled.ts'
import { TransferHelp } from './transfer-help.tsx'

export type TransferListRow = {
  id: string
  name: string
  operationType: string
  /** The operation's kind: `incoming`, `outgoing` or `internal` (K21). */
  kind?: string
  source: string
  destination: string
  scheduledDate: string
  /** K18: the work order the list opens on: ready, waiting, draft by date, then closed newest first. */
  queue?: number
  state: string
  /** K60: a priority transfer takes goods first. */
  priority?: boolean
  /** Localized detail URL supplied by the route. */
  href: string
}

export type TransfersListScreenOptions = {
  rows: TransferListRow[]
  /** The queue's own heading when the list is filtered to one kind of transfer (K21). */
  title?: string
  /** Localized `/admin/stock/transfers/new` URL supplied by the route. */
  createHref: string | null
  total?: number
  table?: Partial<DataTable<TransferListRow>>
}

const stateTone = (state: string): 'positive' | 'danger' | 'neutral' => {
  if (state === 'done') return 'positive'
  if (state === 'cancel') return 'danger'
  return 'neutral'
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

export const transferListColumns = (_: Translator): Array<Column<TransferListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.transfer.list.col.reference'),
    cell: (row) => row.name,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'priority',
    label: _('stock_backend.transfer.priority'),
    cell: (row) => (row.priority ? badge(_('stock_backend.transfer.priority'), 'warning') : ''),
    kind: 'status',
  },
  {
    key: 'source',
    label: _('stock_backend.transfer.list.col.source'),
    cell: (row) => row.source,
    priority: 'secondary',
  },
  {
    key: 'destination',
    label: _('stock_backend.transfer.list.col.destination'),
    cell: (row) => row.destination,
    priority: 'secondary',
  },
  {
    key: 'scheduledDate',
    label: _('stock_backend.transfer.list.col.scheduledDate'),
    // The list holds every kind, so the day says what is planned on it (receipt, delivery, transfer).
    cell: (row) => scheduledCell(_, row.kind, row.scheduledDate),
    kind: 'date',
  },
  {
    key: 'operationType',
    label: _('stock_backend.transfer.list.col.operationType'),
    cell: (row) => row.operationType,
    optional: true,
  },
  {
    key: 'state',
    label: _('stock_backend.transfer.list.col.state'),
    cell: (row) => badge(selectionLabel(_, 'state', row.state), stateTone(row.state), row.state),
    kind: 'status',
  },
]

/** List-only transfer surface. Creation belongs to the dedicated `/new` form. */
export const transfersListScreen = (
  _: Translator,
  options: TransfersListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    {
      columns: transferListColumns(_),
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.href,
      ...options.table,
    },
    { paginate: options.total === undefined && !options.table?.groups },
  )
  const total = options.total ?? options.rows.length
  const selection = options.table?.selection ?? collection.frame.chrome?.selection

  return shell(
    _,
    options.title ?? _('stock_backend.transfers'),
    <>
      <ListPage
        variant="operational"
        frame={collection.frame}
        title={options.title ?? _('stock_backend.transfer.list.title')}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('stock_backend.action.create')}
              href={options.createHref}
              variant="primary"
            />
          ) : undefined
        }
        actions={collectionActions(_, collection.frame, undefined, selection)}
        controls={collectionControls(
          _,
          options.title ?? _('stock_backend.transfer.list.title'),
          collection.frame,
        )}
        footer={`${_('stock_backend.transfer.list.records.title')}: ${String(total)}`}
        body={
          options.rows.length || options.table?.groups?.length
            ? collectionTable(_, collection.table)
            : emptyState(_('stock_backend.transfer.list.empty'), _('stock_backend.transfer.list.emptyHint'), {
                icon: icon('truck'),
              })
        }
      />
      <TransferHelp lang={_.locale === 'en' ? 'en' : 'vi'} id="stock-transfers-help" />
    </>,
    {
      ...collection.frame,
      chrome: null,
      topbar: false,
      ...(collection.frame.applications
        ? { applications: { ...collection.frame.applications, helpLabel: _('stock_backend.transfer.help') } }
        : {}),
    },
  )
}
