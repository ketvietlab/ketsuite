import { text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { DescriptionList, Link } from '@ketvietlab/design-system'
import { badge, dataTable, emptyState, Notice, RecordPage, Section, shell, stack } from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'
import { adminPage, inLocale } from '../../backend/screen.ts'
import type { ForecastEvent, ForecastLine } from '../../stock/forecast-outlook.ts'
import { dayText, quantityText } from '../forecast/format.ts'
import { ForecastHelp } from './forecast-help.tsx'

const t = (_: Translator, key: string, values?: Record<string, string>) =>
  _(`stock_backend.forecast.${key}`, values)
const STATUS_TONE = { short: 'danger', belowMin: 'warning', ok: 'positive' } as const

const eventColumns = (
  _: Translator,
  lang: string,
  url: URL,
  uom: string,
  withBalance: boolean,
): Array<Column<ForecastEvent>> => [
  {
    key: 'date',
    label: t(_, 'col.date'),
    cell: (event) => (
      <>
        {dayText(lang, event.date)}
        {event.late ? <> {badge(t(_, 'late'), 'warning')}</> : null}
      </>
    ),
    kind: 'date',
  },
  {
    key: 'picking',
    label: t(_, 'col.operation'),
    cell: (event) =>
      event.href ? (
        <Link label={String(event.pickingName)} href={inLocale(url, event.href)} />
      ) : event.pickingId ? (
        <Link
          label={String(event.pickingName)}
          href={inLocale(url, `/admin/stock/transfers/${encodeURIComponent(event.pickingId)}`)}
        />
      ) : (
        '—'
      ),
    kind: 'identifier',
    priority: 'primary',
  },
  { key: 'kind', label: t(_, 'col.kind'), cell: (event) => t(_, `kind.${event.kind}`) },
  { key: 'party', label: t(_, 'col.party'), cell: (event) => event.party || '—' },
  {
    key: 'quantity',
    label: t(_, 'col.quantity'),
    cell: (event) => `${event.quantity > 0 ? '+' : ''}${quantityText(lang, event.quantity)} ${uom}`.trim(),
    kind: 'number',
  },
  ...(withBalance
    ? [
        {
          key: 'balance',
          label: t(_, 'col.balance'),
          cell: (event: ForecastEvent) =>
            badge(
              `${quantityText(lang, event.balance ?? 0)} ${uom}`.trim(),
              (event.balance ?? 0) < 0 ? 'danger' : 'neutral',
            ),
          kind: 'number' as const,
        },
      ]
    : []),
]

/** K40: a product's forecast in a warehouse, operation by operation, with its totals and rule beside it. */
export function forecastDetailScreen(
  _: Translator,
  frame: Frame,
  url: URL,
  line: ForecastLine,
  readsRules: boolean,
): TemplateResult {
  const lang = _.locale === 'en' ? 'en' : 'vi'
  const uom = line.uom
  const amount = (value: number) => `${quantityText(lang, value)} ${uom}`.trim()
  const product = line.productCode ? `${line.productName} · ${line.productCode}` : line.productName
  const title = `${product} · ${line.warehouse}`
  const status = readsRules || line.status !== 'belowMin' ? line.status : 'ok'
  const short = line.shortDate ? (
    <Notice
      tone="danger"
      title={t(_, 'shortNotice', { date: dayText(lang, line.shortDate) })}
      message={line.shortPicking?.name ? t(_, 'shortCause', { name: line.shortPicking.name }) : ''}
    />
  ) : null
  const totals = [
    { id: 'usable', label: t(_, 'usable'), value: amount(line.usable) },
    { id: 'blocked', label: t(_, 'blocked'), value: amount(line.blocked) },
    { id: 'incoming', label: t(_, 'incoming'), value: amount(line.incoming) },
    { id: 'outgoing', label: t(_, 'outgoing'), value: amount(line.outgoing) },
    { id: 'forecast', label: t(_, 'value'), value: amount(line.forecast) },
    { id: 'onOrder', label: t(_, 'onOrder'), value: amount(line.onOrder) },
  ]
  const rule = readsRules && line.rule
  const aside = stack([
    <Section title={t(_, 'totals')} body={<DescriptionList items={totals} columns={1} />} />,
    ...(readsRules
      ? [
          <Section
            title={t(_, 'rule')}
            body={
              rule ? (
                <DescriptionList
                  columns={1}
                  items={[
                    { id: 'location', label: _('stock_backend.field.location'), value: rule.location || '—' },
                    {
                      id: 'min',
                      label: _('stock_backend.field.minQuantity'),
                      value: amount(rule.minQuantity),
                    },
                    {
                      id: 'max',
                      label: _('stock_backend.field.maxQuantity'),
                      value: amount(rule.maxQuantity),
                    },
                  ]}
                />
              ) : (
                t(_, 'noRule')
              )
            }
            actions={
              rule ? (
                <Link
                  label={t(_, 'openRule')}
                  href={inLocale(url, `/admin/stock/replenishment/${encodeURIComponent(rule.id)}`)}
                />
              ) : null
            }
          />,
        ]
      : []),
  ])
  const body = stack(
    [
      short,
      <Section
        title={t(_, 'upcoming')}
        body={
          line.events.length
            ? dataTable(_, {
                columns: eventColumns(_, lang, url, uom, true),
                rows: line.events,
                id: (event) => event.moveId,
                // On a phone each operation reads as a card, as the list's rows do.
                responsive: 'stack',
              })
            : emptyState(t(_, 'noUpcoming'), t(_, 'noUpcomingHint'))
        }
      />,
      ...(line.drafts.length
        ? [
            <Section
              title={t(_, 'drafts')}
              body={dataTable(_, {
                columns: eventColumns(_, lang, url, uom, false),
                rows: line.drafts,
                id: (event) => event.moveId,
                // On a phone each operation reads as a card, as the list's rows do.
                responsive: 'stack',
              })}
            />,
          ]
        : []),
    ].filter(Boolean) as TemplateResult[],
  )
  return shell(
    _,
    title,
    <>
      <RecordPage
        variant="operational"
        frame={frame}
        title={title}
        status={badge(t(_, `status.${status}`), STATUS_TONE[status])}
        body={body}
        aside={aside}
        asideLabel={t(_, 'totals')}
      />
      <ForecastHelp lang={lang} />
    </>,
    {
      ...frame,
      chrome: null,
      topbar: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: _('stock_backend.forecast.help') } }
        : {}),
    },
  )
}

export const forecastDetailRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('stock.getForecastDetail', url, req))) return text('Forbidden', { status: 403 })
    const answer = (await ctx.call(
      'stock.getForecastDetail',
      { warehouseId: params.warehouseId, productId: params.productId },
      url,
      req,
    )) as Row
    const line = answer?.line as ForecastLine | null
    if (!line) return text('Not found', { status: 404 })
    const readsRules = await ctx.allows('stock.getOrderpointCollection', url, req)
    return adminPage(ctx, url, req, {
      title: 'stock_backend.forecast',
      body: (_, frame) => forecastDetailScreen(_, frame, url, line, readsRules),
    })
  }
