import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { DELIVERY_PATHS, scopeQuery, statementHref, transferHref } from '../delivery/shared.ts'

/** What a delivery record's page reads of the module's words. */
export async function deliveryMessages(ctx: ServeContext, req: Parameters<Route>[1], lang: 'vi' | 'en') {
  const manifest = await ctx.live(req)
  return {
    manifest,
    messages: {
      ...Object.fromEntries(
        Object.entries(manifest.messages?.[lang] ?? {}).filter(
          ([key]) =>
            key.startsWith('stock_backend.') ||
            key.startsWith('stock.error.') ||
            key.startsWith('backend.relation.') ||
            key.startsWith('backend.validation.'),
        ),
      ),
      ...USER_RECORD_MODAL_LABELS[lang],
    },
  }
}

/** A civil day, `YYYY-MM-DD`, in the reader's language. */
export const civilDayText = (lang: 'vi' | 'en', value: unknown) =>
  /^\d{4}-\d{2}-\d{2}/.test(String(value ?? ''))
    ? new Intl.DateTimeFormat(lang, { timeZone: 'UTC' }).format(
        new Date(`${String(value).slice(0, 10)}T00:00:00Z`),
      )
    : ''

/** An entry the reader may open in Accounting, or none. */
export async function entryLink(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  manifest: Awaited<ReturnType<ServeContext['live']>>,
  entry: unknown,
) {
  const row = entry as Row | null
  if (!row?.id) return null
  const readable =
    Boolean(manifest.functions?.['account.getMove']) && (await ctx.allows('account.getMove', url, req))
  return {
    name: String(row.name),
    href: readable
      ? `/admin/accounting/entries/${encodeURIComponent(String(row.id))}?${scopeQuery(url)}`
      : null,
  }
}

/**
 * K46: a shipment's page — the parcel, what it costs, its journey, the delivery, order, return, statement and
 * entry it leads to (each only for a reader who may open it), and the steps the reader may take now.
 */
export const shipmentContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('stock.getShipment', url, req))) return text('Forbidden', { status: 403 })
    const record = (await ctx.call('stock.getShipment', { id: params.id }, url, req)) as Row | null
    if (!record) return text('Not found', { status: 404 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const _ = ctx.translate(lang)
    const may = (fn: string) => ctx.allows(`stock.${fn}`, url, req)
    const [save, book, handOver, deliver, fail, retry, back, cancel, statements, orders] = await Promise.all([
      may('saveShipment'),
      may('bookShipment'),
      may('handOverShipment'),
      may('deliverShipment'),
      may('failShipment'),
      may('retryShipment'),
      may('returnShipment'),
      may('cancelShipment'),
      may('getDeliveryStatement'),
      ctx.allows('sale.getOrder', url, req),
    ])
    const { manifest, messages } = await deliveryMessages(ctx, req, lang)
    const money = (value: unknown) => formatMoney(_, value ?? '0', record.currency)
    const picking = record.picking as Row | null
    const returned = record.returnPicking as Row | null
    const order = record.saleOrder as Row | null
    const statement = record.statement as Row | null
    const fees = (record.fees as Row) ?? {}
    const dates = Object.fromEntries(
      ['bookedDate', 'handedDate', 'deliveredDate', 'failedDate', 'returnedDate', 'cancelledDate'].map(
        (key) => [key, civilDayText(lang, record[key])],
      ),
    )
    return json({
      data: {
        record,
        lang,
        permissions: { save, book, handOver, deliver, fail, retry, return: back, cancel },
        texts: {
          weight: new Intl.NumberFormat(lang, { maximumFractionDigits: 3 }).format(
            Number(record.weight ?? 0),
          ),
          cod: money(record.cod),
          codLimit: money(record.codLimit),
          shippingFee: money(fees.shipping),
          codFee: money(fees.cod),
          total: money(fees.total),
          ...dates,
        },
        links: {
          picking: picking ? { name: String(picking.name), href: transferHref(url, picking.id) } : null,
          returnPicking: returned
            ? { name: String(returned.name), href: transferHref(url, returned.id) }
            : null,
          order: order
            ? {
                name: String(order.name),
                href:
                  orders && manifest.functions?.['sale.getOrder']
                    ? `/admin/sales/orders/${encodeURIComponent(String(order.id))}?${scopeQuery(url)}`
                    : null,
              }
            : null,
          statement:
            statement && statements
              ? { name: String(statement.name), href: statementHref(url, statement.id) }
              : null,
          codEntry: await entryLink(ctx, url, req, manifest, record.codEntry),
          list: `${DELIVERY_PATHS.shipments}?${scopeQuery(url)}`,
        },
        carriers: ((record.carriers as Row[]) ?? []).map((row) => ({
          id: String(row.id),
          name: String(row.name),
        })),
      },
      messages,
    })
  }
