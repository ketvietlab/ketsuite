import { dateBucket, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { ANALYSIS_GROUPS, periodKind, previousPeriod } from '../../sale/analysis.ts'
import type { AnalysisGroup } from '../../sale/analysis.ts'
import { adminPage, timezoneOf } from '../../backend/screen.ts'
import { ANALYSIS_MEASURES, salesAnalysisReport } from './analysis.tsx'
import type { AnalysisMeasure, SalesAnalysis } from './analysis.tsx'
import { ANALYSIS_PATH, ordersHref, OVERVIEW_PATH, scopeOf, withScope } from './links.ts'
import type { OrderNarrowing } from './links.ts'
import { overviewReport } from './overview.tsx'
import type { SalesOverviewReport } from './overview.tsx'

type Row = Record<string, unknown>
type Req = Parameters<Route>[1]
type Margin = {
  totals: { margin: string; unknownLines: number }
  previousTotals: { margin: string }
  groups: Row[]
}

/** The period kept in the address when it is one, else none: the functions then take the current one. */
const periodParam = (url: URL) => {
  const period = url.searchParams.get('period') ?? ''
  return periodKind(period) ? period : ''
}

/** The `count` periods up to the one holding today, oldest first. */
async function recent(ctx: ServeContext, url: URL, req: Req, kind: 'month' | 'year', count: number) {
  const periods = [String(dateBucket(new Date().toISOString(), kind, await timezoneOf(ctx, url, req)))]
  while (periods.length < count) periods.unshift(previousPeriod(periods[0]!)!)
  return periods
}

/**
 * The month part of the sales overview (D18), or null for a reader who cannot read sales figures. Margin
 * is added for readers who may read costs.
 */
export async function overviewPart(
  ctx: ServeContext,
  url: URL,
  req: Req,
  quotationHref: (id: string) => string,
): Promise<((_: Translator) => TemplateResult) | null> {
  if (!(await ctx.allows('sale.getSalesOverview', url, req))) return null
  const period = periodParam(url)
  const report = (await ctx.call('sale.getSalesOverview', period ? { period } : {}, url, req)) as unknown as
    | (SalesOverviewReport & { ok: boolean })
    | null
  if (!report?.ok) return null
  const margin = (await ctx.allows('sale.analyzeSalesMargin', url, req))
    ? ((await ctx.call('sale.analyzeSalesMargin', { period: report.period }, url, req)) as unknown as Margin)
    : null
  const months = await recent(ctx, url, req, 'month', 6)
  if (!months.includes(report.period)) months.push(report.period)
  const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  return (_) =>
    overviewReport(_, {
      lang,
      report,
      margin: margin?.totals ? { ...margin.totals, previous: margin.previousTotals.margin } : null,
      months,
      monthHref: (month) => withScope(url, OVERVIEW_PATH, { period: month }),
      ordersHref: (narrowing) => ordersHref(url, narrowing),
      analysisHref: withScope(url, ANALYSIS_PATH, {
        period: report.period.slice(0, 4),
        groupBy: 'month',
        ...(margin ? { measure: 'margin' } : {}),
      }),
      quotationHref,
    })
}

/** The orders a group of the analysis counts; lines without a product open the period's orders. */
const narrowingOf = (group: AnalysisGroup, period: string, key: string): OrderNarrowing =>
  group === 'month'
    ? { period: key }
    : group === 'user'
      ? { period, userId: key }
      : group === 'team'
        ? { period, teamId: key }
        : !key
          ? { period }
          : group === 'partner'
            ? { period, partnerId: key }
            : { period, templateId: key }

/** Sales of a period grouped as the reader chooses (D19). */
export async function analysisPage(
  ctx: ServeContext,
  url: URL,
  req: Req,
): Promise<Awaited<ReturnType<Route>>> {
  if (!(await ctx.allows('sale.analyzeSales', url, req))) return text('Forbidden', { status: 403 })
  const period = periodParam(url)
  const groupParam = url.searchParams.get('groupBy') ?? ''
  const groupBy: AnalysisGroup = ANALYSIS_GROUPS.includes(groupParam as AnalysisGroup)
    ? (groupParam as AnalysisGroup)
    : 'month'
  const measureParam = url.searchParams.get('measure') ?? ''
  const measure: AnalysisMeasure = ANALYSIS_MEASURES.includes(measureParam as AnalysisMeasure)
    ? (measureParam as AnalysisMeasure)
    : 'revenue'
  const args = { ...(period ? { period } : {}), groupBy }
  const sales = (await ctx.call('sale.analyzeSales', args, url, req)) as unknown as Omit<
    SalesAnalysis,
    'margin'
  >
  const margin = (await ctx.allows('sale.analyzeSalesMargin', url, req))
    ? ((await ctx.call('sale.analyzeSalesMargin', args, url, req)) as unknown as Margin)
    : null
  const profit = new Map((margin?.groups ?? []).map((row) => [String(row.key), String(row.margin)]))
  const analysis: SalesAnalysis = {
    ...sales,
    groups: sales.groups.map((group) => ({
      ...group,
      margin: margin ? (profit.get(group.key) ?? null) : undefined,
    })),
    margin: margin ? { ...margin.totals, previous: margin.previousTotals.margin } : null,
  }
  const years = (await recent(ctx, url, req, 'year', 3)).reverse()
  if (!years.includes(analysis.period.slice(0, 4))) years.push(analysis.period.slice(0, 4))
  const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  return adminPage(ctx, url, req, {
    title: 'sale_backend.report.analysis',
    active: ANALYSIS_PATH,
    body: (_, frame) =>
      salesAnalysisReport(_, {
        frame,
        lang,
        analysis,
        measure,
        years,
        choices: { action: ANALYSIS_PATH, hidden: scopeOf(url) },
        groupHref: (key) => ordersHref(url, narrowingOf(groupBy, analysis.period, key)),
      }),
  })
}
