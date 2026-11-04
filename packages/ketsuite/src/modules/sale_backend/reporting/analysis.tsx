import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { ColumnChart, FilterBar, Select } from '@ketvietlab/design-system'
import {
  BarChart,
  CardGrid,
  dataTable,
  emptyState,
  formatMoney,
  icon,
  Metric,
  Section,
  shell,
  stack,
  Surface,
  WorkspacePage,
} from '../../../ui/index.ts'
import type { ChartBar, Frame } from '../../../ui/index.ts'
import { ANALYSIS_GROUPS } from '../../sale/analysis.ts'
import type { AnalysisGroup } from '../../sale/analysis.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { monthShort, percentText, periodLabel, trendOf } from './overview.tsx'
import { SalesReportHelp } from './help.tsx'

export const ANALYSIS_MEASURES = ['revenue', 'orders', 'margin'] as const
export type AnalysisMeasure = (typeof ANALYSIS_MEASURES)[number]

/** `sale.analyzeSales`, with each group's profit when the reader may see costs. */
export type SalesAnalysis = {
  period: string
  previous: string
  groupBy: AnalysisGroup
  currency: string
  totals: { revenue: string; orders: number }
  previousTotals: { revenue: string; orders: number }
  groups: Array<{ key: string; label: string; revenue: string; orders: number; margin?: string | null }>
  margin: { margin: string; unknownLines: number; previous: string } | null
}

const n = (value: unknown): number => Number(value ?? 0)

/** The months of a period, so a chart of a year shows its quiet months too. */
export function monthsOf(period: string): string[] {
  const [year, part] = period.split('-')
  const first = !part ? 1 : part.startsWith('Q') ? (Number(part.slice(1)) - 1) * 3 + 1 : Number(part)
  const count = !part ? 12 : part.startsWith('Q') ? 3 : 1
  return Array.from({ length: count }, (_, i) => `${year}-${String(first + i).padStart(2, '0')}`)
}

export function salesAnalysisReport(
  _: Translator,
  o: {
    frame: Frame
    lang: 'vi' | 'en'
    analysis: SalesAnalysis
    measure: AnalysisMeasure
    /** The years offered, newest first. */
    years: readonly string[]
    /** Where the choices apply, with the query values they carry along (the company scope). */
    choices: { action: string; hidden: Record<string, string> }
    /** The orders a group counts. */
    groupHref: (key: string) => string
  },
): TemplateResult {
  const a = o.analysis
  const money = (value: unknown) => formatMoney(_, value, a.currency)
  const measures = ANALYSIS_MEASURES.filter((measure) => measure !== 'margin' || a.margin)
  const measure = measures.includes(o.measure) ? o.measure : 'revenue'
  const amountOf = (group: SalesAnalysis['groups'][number]) =>
    measure === 'orders' ? group.orders : n(measure === 'margin' ? group.margin : group.revenue)
  const shown = (group: SalesAnalysis['groups'][number]) =>
    measure === 'orders'
      ? _('sale_backend.report.count', { count: String(group.orders) })
      : measure === 'margin' && group.margin == null
        ? '—'
        : money(measure === 'margin' ? group.margin : group.revenue)
  const label = (group: SalesAnalysis['groups'][number]) =>
    a.groupBy === 'month'
      ? periodLabel(_, group.key)
      : group.key
        ? group.label
        : _(`sale_backend.report.none.${a.groupBy}`)
  // Each year, then its quarters from the latest; a period opened by address (a month) stays chosen.
  const periods = o.years.flatMap((y) => [y, ...[4, 3, 2, 1].map((q) => `${y}-Q${q}`)])
  if (!periods.includes(a.period)) periods.unshift(a.period)
  const total = a.totals.revenue
  const cards: Array<{ id: string; label: string; value: string; trend: JSXChild; detail?: string }> = [
    {
      id: 'revenue',
      label: _('sale_backend.report.revenue'),
      value: money(a.totals.revenue),
      trend: trendOf(_, a.totals.revenue, a.previousTotals.revenue),
    },
    {
      id: 'orders',
      label: _('sale_backend.report.orders'),
      value: String(a.totals.orders),
      trend: trendOf(_, a.totals.orders, a.previousTotals.orders),
    },
    ...(a.margin
      ? [
          {
            id: 'margin',
            label: _('sale_backend.report.margin'),
            value: money(a.margin.margin),
            trend: trendOf(_, a.margin.margin, a.margin.previous),
            detail: [
              n(total)
                ? `${_('sale_backend.report.marginRate')}: ${percentText(_, n(a.margin.margin) / n(total))}`
                : '',
              a.margin.unknownLines
                ? _('sale_backend.report.unknownCost', { count: String(a.margin.unknownLines) })
                : '',
            ]
              .filter(Boolean)
              .join(' · '),
          },
        ]
      : []),
  ]
  const months = a.groupBy === 'month' ? monthsOf(a.period) : []
  const byMonth = new Map(a.groups.map((group) => [group.key, group]))
  const chartLabel = _('sale_backend.report.chart', {
    measure: _(`sale_backend.report.${measure}`),
    group: _(`sale_backend.report.group.${a.groupBy}`).toLocaleLowerCase(o.lang),
  })
  const chart =
    a.groupBy === 'month' ? (
      <ColumnChart
        label={chartLabel}
        points={months.map((key) => {
          const group = byMonth.get(key) ?? { key, label: key, revenue: '0', orders: 0, margin: '0' }
          return { id: key, label: monthShort(_, key), value: Math.max(0, amountOf(group)) }
        })}
        value={(point) =>
          shown(byMonth.get(point.id) ?? { key: point.id, label: '', revenue: '0', orders: 0, margin: '0' })
        }
        tick={(value) =>
          measure === 'orders' ? String(value) : formatMoney(_, value, a.currency, { compact: true })
        }
        empty={_('sale_backend.report.empty')}
      />
    ) : (
      <BarChart
        label={chartLabel}
        bars={a.groups.map(
          (group): ChartBar => ({
            id: group.key || '-',
            label: label(group),
            value: Math.max(0, amountOf(group)),
            href: o.groupHref(group.key),
          }),
        )}
        value={(bar) => shown(a.groups.find((group) => (group.key || '-') === bar.id)!)}
        empty={_('sale_backend.report.empty')}
      />
    )
  const body = stack(
    [
      <Section
        // The period is the first choice above; what the trends compare with is the news here.
        title={_('sale_backend.report.comparedWith', { period: periodLabel(_, a.previous) })}
        body={
          <CardGrid
            items={cards}
            id={(card) => card.id}
            card={(card) => (
              <Metric
                label={card.label}
                value={card.value}
                trend={card.trend}
                detail={card.detail || undefined}
                tone="money"
              />
            )}
          />
        }
      />,
      ...(a.groups.length
        ? [
            <Section title={chartLabel} body={<Surface body={chart} />} />,
            <Section
              title={_('sale_backend.report.groups')}
              body={
                <Surface
                  padding="none"
                  body={dataTable(_, {
                    responsive: 'stack',
                    rows: a.groups,
                    id: (group) => group.key || '-',
                    rowHref: (group) => o.groupHref(group.key),
                    columns: [
                      {
                        key: 'label',
                        label: _(`sale_backend.report.group.${a.groupBy}`),
                        priority: 'primary',
                        cell: label,
                      },
                      {
                        key: 'revenue',
                        label: _('sale_backend.report.revenue'),
                        align: 'end',
                        kind: 'currency',
                        cell: (group) => money(group.revenue),
                      },
                      {
                        key: 'orders',
                        label: _('sale_backend.report.orders'),
                        align: 'end',
                        kind: 'number',
                        cell: (group) => String(group.orders),
                      },
                      ...(a.margin
                        ? [
                            {
                              key: 'margin',
                              label: _('sale_backend.report.margin'),
                              align: 'end' as const,
                              kind: 'currency' as const,
                              cell: (group: SalesAnalysis['groups'][number]) =>
                                group.margin == null ? '—' : money(group.margin),
                            },
                          ]
                        : []),
                      {
                        key: 'share',
                        label: _('sale_backend.report.share'),
                        align: 'end',
                        kind: 'number',
                        cell: (group) => (n(total) ? percentText(_, n(group.revenue) / n(total)) : '—'),
                      },
                    ],
                  })}
                />
              }
            />,
          ]
        : [
            emptyState(_('sale_backend.report.empty'), _('sale_backend.report.emptyHint'), {
              icon: icon('shopping-bag'),
            }),
          ]),
    ],
    'loose',
  )
  return shell(
    _,
    _('sale_backend.report.analysis'),
    <>
      <WorkspacePage
        variant="operational"
        frame={o.frame}
        title={_('sale_backend.report.analysis')}
        // The choices read as a phrase ("Năm 2026 · Doanh số · Theo tháng"), so their labels are for
        // assistive technology only.
        controls={
          <FilterBar
            label={_('sale_backend.report.choices')}
            action={o.choices.action}
            hidden={o.choices.hidden}
            submitLabel={_('sale_backend.report.apply')}
            filters={[
              <Select
                id="sale-analysis-period"
                name="period"
                label={_('sale_backend.report.period')}
                labelHidden
                value={a.period}
                options={periods.map((period) => ({ value: period, label: periodLabel(_, period) }))}
              />,
              <Select
                id="sale-analysis-measure"
                name="measure"
                label={_('sale_backend.report.measure')}
                labelHidden
                value={measure}
                options={measures.map((m) => ({ value: m, label: _(`sale_backend.report.${m}`) }))}
              />,
              <Select
                id="sale-analysis-group"
                name="groupBy"
                label={_('sale_backend.report.groupBy')}
                labelHidden
                value={a.groupBy}
                options={ANALYSIS_GROUPS.map((group) => ({
                  value: group,
                  label: _(`sale_backend.report.by.${group}`),
                }))}
              />,
            ]}
          />
        }
        body={body}
      />
      <SalesReportHelp lang={o.lang} screen="analysis" />
    </>,
    {
      ...o.frame,
      topbar: false,
      ...(o.frame.applications
        ? { applications: { ...o.frame.applications, helpLabel: HELP[o.lang].trigger } }
        : {}),
    },
  )
}
