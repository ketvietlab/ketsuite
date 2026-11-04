import type { Translator, Row } from '@ketvietlab/ketjs'
import {
  WorkspacePage,
  CardGrid,
  Metric,
  Section,
  LinkButton,
  badge,
  collectionTable as dataTable,
  emptyState,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { Menu } from '@ketvietlab/design-system'
import { scheduledCell } from '../scheduled.ts'
import { OverviewHelp } from './overview-help.tsx'

/** A civil `YYYY-MM-DD` as a short local date, without a time-zone shift. */
const civilLabel = (_: Translator, value: unknown) =>
  value
    ? new Intl.DateTimeFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', {
        dateStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${String(value)}T00:00:00Z`))
    : _('stock_backend.overview.cycle.never')
export type OverviewTileView = { id: string; value: string; href: string | null; detail?: number }
export type OverviewWarehouseView = {
  id: string
  name: string
  products: number
  receipts: number
  deliveries: number
  late: number
  toOrder: number | null
  value: string | null
  href: string
}
export const stockOverviewScreen = (
  _: Translator,
  frame: Frame,
  options: {
    /** K51: confirmed transfers late or due within 7 days, the most overdue first. */
    rows: Row[]
    /** K51: the figures, each opening its list narrowed to what it counts; a zero opens nothing. */
    tiles: OverviewTileView[]
    warehouses: OverviewWarehouseView[]
    warehouseChoices: Array<{ id: string; name: string; href: string; active: boolean }>
    showValue: boolean
    at: (path: string) => string
    rowHref: (row: Row) => string
    createHref: string | null
    /** K62: `stock.listCountCycles`, empty for a role that may not read counts. */
    cycles?: Row[]
    cycleHref?: (row: Row) => string
  },
) => {
  const title = _('stock_backend.overview.title')
  const open = options.rows
  const cycles = (options.cycles ?? [])
    .filter((row) => Number(row.countFrequencyDays) > 0)
    .sort(
      (a, b) =>
        Number(Boolean(b.countDue)) - Number(Boolean(a.countDue)) ||
        String(a.nextCountDate).localeCompare(String(b.nextCountDate)) ||
        String(a.name).localeCompare(String(b.name)),
    )
  const lang = _.locale === 'en' ? 'en' : 'vi'
  // K62: warehouses due for a count, beside the figures, when any warehouse counts on a cycle.
  const due = cycles.filter((row) => row.countDue).length
  const tiles: OverviewTileView[] = cycles.length
    ? [
        ...options.tiles,
        { id: 'countDue', value: String(due), href: due ? options.at('/admin/stock/counts') : null },
      ]
    : options.tiles
  const chosen = options.warehouseChoices.find((choice) => choice.active)
  const detail = (tile: OverviewTileView) =>
    tile.detail ? _(`stock_backend.overview.tile.${tile.id}.detail`, { count: String(tile.detail) }) : null
  return shell(
    _,
    title,
    <>
      <WorkspacePage
        variant="operational"
        frame={frame}
        title={title}
        actions={
          <>
            {options.warehouseChoices.length > 2
              ? Menu({
                  id: 'stock-overview-warehouse',
                  label: `${_('stock_backend.field.warehouse')}: ${chosen?.name ?? ''}`,
                  size: 'compact',
                  selectionMode: 'single',
                  items: options.warehouseChoices.map((choice) => ({
                    id: choice.id || 'all',
                    label: choice.name,
                    href: choice.href,
                    checked: choice.active,
                  })),
                })
              : null}
            {options.createHref ? (
              <LinkButton
                label={_('stock_backend.action.create')}
                href={options.createHref}
                variant="primary"
              />
            ) : null}
          </>
        }
        body={stack([
          <CardGrid
            items={tiles}
            id={(item) => item.id}
            card={(item) => (
              <Metric
                label={
                  item.id === 'countDue'
                    ? _('stock_backend.overview.countDue')
                    : _(`stock_backend.overview.tile.${item.id}`)
                }
                value={item.value}
                detail={detail(item)}
                href={item.href}
                // An amount keeps to one line; the backend widens the row's cards for it.
                {...(item.id === 'value' ? { tone: 'money' } : {})}
              />
            )}
          />,
          <Section
            title={_('stock_backend.overview.byWarehouse')}
            body={dataTable(_, {
              rows: options.warehouses,
              id: (r) => r.id,
              rowHref: (r) => r.href,
              columns: [
                {
                  key: 'name',
                  label: _('stock_backend.field.warehouse'),
                  cell: (r) => r.name,
                  priority: 'primary',
                },
                {
                  key: 'products',
                  label: _('stock_backend.overview.col.products'),
                  cell: (r) => String(r.products),
                  kind: 'number',
                  align: 'end',
                },
                {
                  key: 'receipts',
                  label: _('stock_backend.overview.col.receipts'),
                  cell: (r) => String(r.receipts),
                  kind: 'number',
                  align: 'end',
                },
                {
                  key: 'deliveries',
                  label: _('stock_backend.overview.col.deliveries'),
                  cell: (r) => String(r.deliveries),
                  kind: 'number',
                  align: 'end',
                },
                {
                  key: 'late',
                  label: _('stock_backend.overview.col.late'),
                  cell: (r) => (r.late ? badge(String(r.late), 'warning') : '0'),
                  kind: 'number',
                  align: 'end',
                },
                ...(options.warehouses.some((r) => r.toOrder !== null)
                  ? [
                      {
                        key: 'toOrder',
                        label: _('stock_backend.overview.col.toOrder'),
                        cell: (r: OverviewWarehouseView) => String(r.toOrder ?? '—'),
                        kind: 'number' as const,
                        align: 'end' as const,
                      },
                    ]
                  : []),
                ...(options.showValue
                  ? [
                      {
                        key: 'value',
                        label: _('stock_backend.overview.col.value'),
                        cell: (r: OverviewWarehouseView) => r.value ?? '—',
                        kind: 'number' as const,
                        align: 'end' as const,
                      },
                    ]
                  : []),
              ],
            })}
          />,
          <Section
            title={_('stock_backend.overview.queue')}
            actions={
              <LinkButton label={_('stock_backend.transfers')} href={options.at('/admin/stock/transfers')} />
            }
            body={
              open.length
                ? dataTable(_, {
                    rows: open.slice(0, 20),
                    id: (r) => String(r.id),
                    rowHref: options.rowHref,
                    columns: [
                      {
                        key: 'name',
                        label: _('stock_backend.transfer.list.col.reference'),
                        cell: (r) => String(r.name),
                        priority: 'primary',
                      },
                      {
                        key: 'operationType',
                        label: _('stock_backend.transfer.list.col.operationType'),
                        cell: (r) => String(r.operationType ?? '—'),
                        wrap: true,
                      },
                      {
                        key: 'source',
                        label: _('stock_backend.transfer.list.col.source'),
                        cell: (r) => `${r.source ?? '—'} → ${r.destination ?? '—'}`,
                        wrap: true,
                      },
                      {
                        key: 'scheduledDate',
                        label: _('stock_backend.transfer.list.col.scheduledDate'),
                        cell: (r) =>
                          r.late
                            ? badge(
                                `${scheduledCell(_, r.kind, String(r.scheduledDate ?? ''))} · ${_('stock_backend.overview.late')}`,
                                'warning',
                              )
                            : scheduledCell(_, r.kind, String(r.scheduledDate ?? '')),
                        kind: 'date',
                      },
                      {
                        key: 'state',
                        label: _('stock_backend.transfer.list.col.state'),
                        cell: (r) => _(`stock_backend.state.${r.status ?? r.state}`),
                      },
                    ],
                  })
                : emptyState(_('stock_backend.overview.empty'), '')
            }
          />,
          ...(cycles.length
            ? [
                <Section
                  title={_('stock_backend.overview.cycle.title')}
                  actions={
                    <LinkButton
                      label={_('stock_backend.count.title')}
                      href={options.at('/admin/stock/counts')}
                    />
                  }
                  body={dataTable(_, {
                    rows: cycles,
                    id: (r) => String(r.warehouseId),
                    ...(options.cycleHref ? { rowHref: options.cycleHref } : {}),
                    columns: [
                      {
                        key: 'name',
                        label: _('stock_backend.overview.cycle.col.warehouse'),
                        cell: (r) => String(r.name),
                        priority: 'primary',
                      },
                      {
                        key: 'frequency',
                        label: _('stock_backend.overview.cycle.col.frequency'),
                        cell: (r) =>
                          _('stock_backend.overview.cycle.days', { days: String(r.countFrequencyDays) }),
                        kind: 'number',
                      },
                      {
                        key: 'last',
                        label: _('stock_backend.overview.cycle.col.last'),
                        cell: (r) => civilLabel(_, r.lastCountDate),
                        kind: 'date',
                      },
                      {
                        key: 'next',
                        label: _('stock_backend.overview.cycle.col.next'),
                        cell: (r) => civilLabel(_, r.nextCountDate),
                        kind: 'date',
                      },
                      {
                        key: 'state',
                        label: _('stock_backend.overview.cycle.col.state'),
                        cell: (r) =>
                          r.countingId
                            ? _('stock_backend.overview.cycle.counting', { name: String(r.countingName) })
                            : r.countDue
                              ? badge(_('stock_backend.overview.cycle.due'), 'warning')
                              : _('stock_backend.overview.cycle.notDue'),
                      },
                    ],
                  })}
                />,
              ]
            : []),
        ])}
      />
      <OverviewHelp lang={lang} />
    </>,
    {
      ...frame,
      topbar: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: _('stock_backend.overview.help') } }
        : {}),
    },
  )
}
