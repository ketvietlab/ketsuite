import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  ListPage,
  prepareCollectionTable,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'

export type ConsumptionVarianceRow = {
  id: string
  order: string
  component: string
  unit: string
  expected: number
  used: number
  difference: number
  /** The difference over what the BOM asks, in percent; null when it asks for nothing. */
  percent: number | null
  /** `over`, `within` or `under`. */
  standing: string
  /** Position in the report: used past the BOM first, then by how far. */
  rank: number
  href: string
}

const number = (_: Translator, value: number) =>
  new Intl.NumberFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 6 }).format(value)

export const consumptionVarianceColumns = (_: Translator): Array<Column<ConsumptionVarianceRow>> => [
  {
    key: 'order',
    label: _('manufacturing_backend.variance.order'),
    cell: (row) => row.order,
    priority: 'primary',
  },
  {
    key: 'component',
    label: _('manufacturing_backend.field.component'),
    cell: (row) => row.component,
    width: 'wide',
  },
  {
    key: 'expected',
    label: _('manufacturing_backend.variance.expected'),
    cell: (row) => `${number(_, row.expected)} ${row.unit}`,
    align: 'end',
    priority: 'tertiary',
  },
  {
    key: 'used',
    label: _('manufacturing_backend.variance.used'),
    cell: (row) => `${number(_, row.used)} ${row.unit}`,
    align: 'end',
    priority: 'tertiary',
  },
  {
    key: 'difference',
    label: _('manufacturing_backend.variance.difference'),
    cell: (row) =>
      `${row.difference > 0 ? '+' : ''}${number(_, row.difference)} ${row.unit}${
        row.percent == null ? '' : ` (${row.percent > 0 ? '+' : ''}${number(_, row.percent)}%)`
      }`,
    align: 'end',
    priority: 'primary',
  },
  {
    key: 'standing',
    label: _('manufacturing_backend.variance.standing'),
    cell: (row) =>
      badge(
        _(`manufacturing_backend.variance.${row.standing}`),
        row.standing === 'over' ? 'danger' : row.standing === 'under' ? 'warning' : 'positive',
        row.standing,
      ),
    kind: 'status',
    priority: 'tertiary',
  },
]

/** Components used against the BOM on orders running or done, those used past it first. */
export const consumptionVarianceScreen = (
  _: Translator,
  options: { rows: ConsumptionVarianceRow[]; table?: Partial<DataTable<ConsumptionVarianceRow>> },
  frame: Frame = {},
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.href,
      columns: consumptionVarianceColumns(_),
      // A phone reads each row as a card: order, component and difference.
      responsive: 'stack',
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  return shell(
    _,
    _('manufacturing_backend.variance.title'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('manufacturing_backend.variance.title')}
      controls={collectionControls(_, _('manufacturing_backend.variance.title'), collection.frame)}
      actions={collectionActions(_, collection.frame)}
      footer={`${_('manufacturing_backend.variance.title')}: ${String(collection.total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? collectionTable(_, collection.table)
          : emptyState(
              _('manufacturing_backend.variance.empty'),
              _('manufacturing_backend.variance.emptyHint'),
            )
      }
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}
