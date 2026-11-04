import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  BarChart,
  CardGrid,
  changeOf,
  dataTable,
  Delta,
  emptyState,
  formatDateTime,
  formatMoney,
  icon,
  linkButton,
  Metric,
  Progress,
  Section,
  stack,
  Surface,
  Tabs,
} from '../../../ui/index.ts'
import type { ChartBar, Tab } from '../../../ui/index.ts'

type Row = Record<string, unknown>

/** `sale.getSalesOverview` for one month (D18). */
export type SalesOverviewReport = {
  period: string
  previous: string
  currency: string
  revenue: string
  previousRevenue: string
  orders: number
  invoiced: string
  previousInvoiced: string
  teams: Array<{ id: string; name: string; target: string; invoiced: string }>
  salespeople: Array<{ id: string; name: string; revenue: string }>
  expiring: Array<{
    id: string
    name: string
    partnerName: string
    validityDate: unknown
    amount: string
    expired: boolean
  }>
}

/** `sale.analyzeSalesMargin` totals, for readers who may see costs. */
export type SalesMargin = { margin: string; unknownLines: number; previous: string }

const n = (value: unknown): number => Number(value ?? 0)

/** A period's name: "Tháng 10 năm 2026", "Quý 4 năm 2026", "Năm 2026". */
export function periodLabel(_: Translator, key: string): string {
  const [year, part] = key.split('-')
  if (!part) return _('sale_backend.report.yearLabel', { year: year! })
  if (part.startsWith('Q'))
    return _('sale_backend.report.quarterLabel', { year: year!, quarter: part.slice(1) })
  const monthName = formatDateTime('en', Date.UTC(Number(year), Number(part) - 1, 1), {
    month: 'long',
    timeZone: 'UTC',
  })
  return _('sale_backend.report.monthLabel', { year: year!, month: String(Number(part)), monthName })
}

/** A month under a column: "T10", "Oct". */
export function monthShort(_: Translator, key: string): string {
  const [year, month] = key.split('-')
  const monthName = formatDateTime('en', Date.UTC(Number(year), Number(month) - 1, 1), {
    month: 'short',
    timeZone: 'UTC',
  })
  return _('sale_backend.report.monthShort', { month: String(Number(month)), monthName })
}

/** A share or change as the reader writes it, one decimal: 32,3% in Vietnamese, 32.3% in English. */
export const percentText = (_: Pick<Translator, 'locale'>, ratio: number, signed = false) =>
  new Intl.NumberFormat(['en', 'qps'].includes(_.locale) ? 'en-US' : 'vi-VN', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    ...(signed ? { signDisplay: 'exceptZero' as const } : {}),
  }).format(ratio)

/** "+12,5% so với kỳ trước", or that there is nothing to compare with. */
export const trendOf = (_: Translator, current: unknown, previous: unknown): JSXChild => {
  const change = changeOf(n(current), n(previous), 'higher')
  return (
    <Delta
      label={
        change.ratio === null
          ? _('sale_backend.report.noComparison')
          : `${percentText(_, change.ratio, true)} ${_('sale_backend.report.versus')}`
      }
      // Nothing to compare with is no rise: no arrow and no colour.
      direction={change.ratio === null ? 'flat' : change.direction}
      sentiment={change.ratio === null ? 'neutral' : change.sentiment}
    />
  )
}

/**
 * The month part of the sales overview (D18): its figures against the month before, the teams against
 * their targets, who sold what and the quotations about to lapse. Every figure opens the orders it counts.
 */
export function overviewReport(
  _: Translator,
  o: {
    lang: string
    report: SalesOverviewReport
    margin: SalesMargin | null
    /** The months offered, newest last. */
    months: readonly string[]
    monthHref: (period: string) => string
    ordersHref: (narrowing: { period: string; userId?: string; teamId?: string }) => string
    analysisHref: string
    quotationHref: (id: string) => string
  },
): TemplateResult {
  const r = o.report
  const money = (value: unknown) => formatMoney(_, value, r.currency)
  const tabs: Tab[] = o.months.map((period) => ({
    id: period,
    label: periodLabel(_, period),
    href: o.monthHref(period),
    active: period === r.period,
  }))
  const cards = [
    {
      id: 'revenue',
      label: _('sale_backend.report.revenue'),
      value: money(r.revenue),
      trend: trendOf(_, r.revenue, r.previousRevenue),
      detail: _('sale_backend.report.count', { count: String(r.orders) }),
      href: o.ordersHref({ period: r.period }),
    },
    {
      id: 'invoiced',
      label: _('sale_backend.report.invoiced'),
      value: money(r.invoiced),
      trend: trendOf(_, r.invoiced, r.previousInvoiced),
      detail: undefined,
      href: undefined,
    },
    ...(o.margin
      ? [
          {
            id: 'margin',
            label: _('sale_backend.report.margin'),
            value: money(o.margin.margin),
            trend: trendOf(_, o.margin.margin, o.margin.previous),
            detail: o.margin.unknownLines
              ? _('sale_backend.report.unknownCost', { count: String(o.margin.unknownLines) })
              : undefined,
            href: o.analysisHref,
          },
        ]
      : []),
  ]
  const bars: ChartBar[] = r.salespeople.map((row) => ({
    id: row.id,
    label: row.name,
    value: n(row.revenue),
    href: o.ordersHref({ period: r.period, userId: row.id }),
  }))
  const reached = (team: Row) => (n(team.target) > 0 ? (n(team.invoiced) / n(team.target)) * 100 : null)
  return stack(
    [
      <Section
        title={periodLabel(_, r.period)}
        actions={linkButton({
          label: _('sale_backend.report.openAnalysis'),
          href: o.analysisHref,
          variant: 'tertiary',
        })}
        body={stack([
          <Tabs label={_('sale_backend.report.period')} items={tabs} wrap />,
          <CardGrid
            items={cards}
            id={(card) => card.id}
            card={(card) => (
              <Metric
                label={card.label}
                value={card.value}
                trend={card.trend}
                detail={card.detail}
                href={card.href}
                tone="money"
              />
            )}
          />,
        ])}
      />,
      // Stacked rather than side by side: the target table needs its four columns.
      <Section
        title={_('sale_backend.report.teams')}
        body={
          <Surface
            padding="none"
            body={
              r.teams.length
                ? dataTable(_, {
                    responsive: 'stack',
                    rows: r.teams,
                    id: (row) => row.id,
                    rowHref: (row) => o.ordersHref({ period: r.period, teamId: row.id }),
                    columns: [
                      {
                        key: 'name',
                        label: _('sale_backend.report.team'),
                        priority: 'primary',
                        cell: (row) => row.name,
                      },
                      {
                        key: 'target',
                        label: _('sale_backend.report.target'),
                        align: 'end',
                        kind: 'currency',
                        cell: (row) =>
                          n(row.target) > 0 ? money(row.target) : _('sale_backend.report.noTarget'),
                      },
                      {
                        key: 'invoiced',
                        label: _('sale_backend.report.invoiced'),
                        align: 'end',
                        kind: 'currency',
                        cell: (row) => money(row.invoiced),
                      },
                      {
                        key: 'reached',
                        label: _('sale_backend.report.reached'),
                        cell: (row) => (
                          <Progress
                            value={reached(row)}
                            label={`${row.name}: ${_('sale_backend.report.reached')}`}
                          />
                        ),
                      },
                    ],
                  })
                : emptyState(_('sale_backend.report.noTeams'), _('sale_backend.report.noTeamsHint'), {
                    icon: icon('users'),
                  })
            }
          />
        }
      />,
      <Section
        title={_('sale_backend.report.bySalesperson')}
        body={
          <Surface
            body={
              <BarChart
                label={_('sale_backend.report.bySalesperson')}
                bars={bars}
                value={(bar) => money(r.salespeople.find((row) => row.id === bar.id)?.revenue ?? bar.value)}
                empty={_('sale_backend.report.noSales')}
              />
            }
          />
        }
      />,
      <Section
        title={_('sale_backend.report.todo')}
        body={
          <Surface
            padding="none"
            body={
              r.expiring.length
                ? dataTable(_, {
                    responsive: 'stack',
                    rows: r.expiring,
                    id: (row) => row.id,
                    rowHref: (row) => o.quotationHref(row.id),
                    columns: [
                      {
                        key: 'name',
                        label: _('sale_backend.field.name'),
                        priority: 'primary',
                        cell: (row) => row.name,
                      },
                      {
                        key: 'partner',
                        label: _('sale_backend.field.customer'),
                        cell: (row) => row.partnerName,
                      },
                      {
                        key: 'validity',
                        label: _('sale_backend.field.validityDate'),
                        cell: (row) =>
                          _(row.expired ? 'sale_backend.report.expired' : 'sale_backend.report.expires', {
                            date: formatDateTime(o.lang, Date.parse(String(row.validityDate)), {
                              dateStyle: 'short',
                            }),
                          }),
                      },
                      {
                        key: 'amount',
                        label: _('sale_backend.field.amountUntaxed'),
                        align: 'end',
                        kind: 'currency',
                        cell: (row) => money(row.amount),
                      },
                    ],
                  })
                : emptyState(_('sale_backend.report.todoEmpty'), '', { icon: icon('calendar') })
            }
          />
        }
      />,
    ],
    'loose',
  )
}
