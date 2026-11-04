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
import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import { LotHelp } from './lot-help.tsx'

/** K28: what a lot is fit for today, read when shown and never stored. */
export type LotCondition =
  | 'archived'
  | 'quarantined'
  | 'depleted'
  | 'expired'
  | 'expiring'
  | 'valid'
  | 'noExpiry'
const DAY = 86_400_000
/**
 * A lot's condition at `now`: archived, then quarantined, then depleted (nothing on hand), then by its
 * dates. Its alert date says when it is expiring; without one, 90 days before it expires.
 */
export const lotCondition = (
  lot: { active?: unknown; quarantined?: unknown; expirationDate?: unknown; alertDate?: unknown },
  onHand: number,
  now: number,
): LotCondition => {
  if (lot.active === false) return 'archived'
  if (lot.quarantined === true) return 'quarantined'
  if (onHand <= 0) return 'depleted'
  const expires = lot.expirationDate ? Date.parse(String(lot.expirationDate)) : Number.NaN
  if (Number.isNaN(expires)) return 'noExpiry'
  if (expires <= now) return 'expired'
  const alert = lot.alertDate ? Date.parse(String(lot.alertDate)) : expires - 90 * DAY
  return (Number.isNaN(alert) ? expires - 90 * DAY : alert) <= now ? 'expiring' : 'valid'
}
const CONDITION_TONES: Record<LotCondition, 'positive' | 'neutral' | 'warning' | 'danger'> = {
  archived: 'neutral',
  quarantined: 'danger',
  depleted: 'neutral',
  expired: 'danger',
  expiring: 'warning',
  valid: 'positive',
  noExpiry: 'positive',
}

export type LotListRow = {
  id: string
  name: string
  product: string
  reference: string
  onHand: string
  onHandValue: number
  active: boolean
  condition: LotCondition
  /** K51: the names of the warehouses holding some of the lot. */
  warehouses?: string
  /** The expiry date as the reader writes it, or empty. */
  expiry: string
  /** Localized detail URL supplied by the route. */
  href: string
}

export type LotsListScreenOptions = {
  rows: LotListRow[]
  /** Localized `/admin/stock/lots/new` URL supplied by the route. */
  createHref: string | null
  total?: number
  table?: Partial<DataTable<LotListRow>>
}

export const lotListColumns = (_: Translator): Array<Column<LotListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.lot.list.col.name'),
    cell: (row) => row.name,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'product',
    label: _('stock_backend.lot.list.col.product'),
    cell: (row) => row.product,
    priority: 'secondary',
  },
  {
    key: 'reference',
    label: _('stock_backend.lot.list.col.reference'),
    cell: (row) => row.reference || '—',
  },
  {
    key: 'onHand',
    label: _('stock_backend.lot.list.col.onHand'),
    cell: (row) => row.onHand,
    kind: 'number',
    align: 'end',
  },
  {
    key: 'expiry',
    label: _('stock_backend.lot.list.col.expiry'),
    cell: (row) => row.expiry || '—',
  },
  {
    key: 'condition',
    label: _('stock_backend.lot.list.col.status'),
    cell: (row) =>
      badge(_(`stock_backend.lot.condition.${row.condition}`), CONDITION_TONES[row.condition], row.condition),
    kind: 'status',
  },
]

/** List-only lot/serial surface. Creation belongs to the dedicated `/new` form. */
export const lotsListScreen = (
  _: Translator,
  options: LotsListScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    {
      columns: lotListColumns(_),
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.href,
      ...options.table,
    },
    { paginate: options.total === undefined && !options.table?.groups },
  )
  const total = options.total ?? options.rows.length

  return shell(
    _,
    _('stock_backend.lots'),
    <>
      <ListPage
        variant="operational"
        frame={collection.frame}
        title={_('stock_backend.lot.list.title')}
        controls={collectionControls(_, _('stock_backend.lot.list.title'), collection.frame)}
        headerActions={
          options.createHref ? (
            <LinkButton
              label={_('stock_backend.action.create')}
              href={options.createHref}
              variant="primary"
            />
          ) : null
        }
        actions={collectionActions(_, collection.frame)}
        footer={`${_('stock_backend.lot.list.summary.total')}: ${String(total)}`}
        body={
          options.rows.length || options.table?.groups?.length
            ? collectionTable(_, collection.table)
            : emptyState(_('stock_backend.lot.list.empty'), _('stock_backend.lot.list.emptyHint'), {
                icon: icon('package'),
              })
        }
      />
      <LotHelp lang={_.locale === 'en' ? 'en' : 'vi'} id="stock-lots-help" />
    </>,
    {
      ...collection.frame,
      chrome: null,
      topbar: false,
      ...(collection.frame.applications
        ? { applications: { ...collection.frame.applications, helpLabel: _('stock_backend.lot.help') } }
        : {}),
    },
  )
}
