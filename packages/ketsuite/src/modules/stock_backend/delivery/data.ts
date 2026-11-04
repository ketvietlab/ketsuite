import { json, text, parseListState, encodeListState } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Row, Translator } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { applyRowListState } from '../../backend/row-list.ts'
import { loadListFavorites } from '../../backend/search-filter.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { DELIVERY_SPECS, deliverySearch, statusWord } from './search.ts'
import {
  CARRIER_TONES,
  DELIVERY_PATHS,
  DISPATCH_TONES,
  SHIPMENT_TONES,
  STATEMENT_TONES,
  deliveryHref,
  deliveryQuery,
  scoped,
  shipmentHref,
  statementHref,
  transferHref,
} from './shared.ts'
import type { DeliveryAnswer, DeliveryList, DeliveryRow } from './shared.ts'

/** What each list reads, and the function that lets a reader open it. */
export const DELIVERY_READS: Record<DeliveryList, string> = {
  dispatch: 'stock.listDispatchQueue',
  shipments: 'stock.listShipments',
  statements: 'stock.listDeliveryStatements',
  carriers: 'stock.listCarriers',
}
const SORTS: Record<DeliveryList, readonly string[]> = {
  dispatch: ['name', 'scheduled', 'partner'],
  shipments: ['name', 'partner', 'cod'],
  statements: ['name', 'date', 'net'],
  carriers: ['code', 'name'],
}

const dayText = (_: Translator, value: unknown) =>
  /^\d{4}-\d{2}-\d{2}/.test(String(value ?? ''))
    ? new Intl.DateTimeFormat(_.locale === 'en' ? 'en' : 'vi', { timeZone: 'UTC' }).format(
        new Date(`${String(value).slice(0, 10)}T00:00:00Z`),
      )
    : ''

/** One list's rows as its table reads them: what it shows, sorts and filters by, and where each opens. */
function rowsOf(list: DeliveryList, _: Translator, url: URL, read: Row[], currency: unknown): DeliveryRow[] {
  const money = (value: unknown) => formatMoney(_, value ?? '0', currency)
  const status = (value: unknown, tones: Record<string, DeliveryRow['tone']>) => ({
    status: String(value),
    statusText: _(statusWord(list, String(value))),
    tone: tones[String(value)] ?? 'neutral',
  })
  if (list === 'dispatch')
    return read.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      partner: String(row.partnerName ?? ''),
      order: String(row.saleOrderName ?? ''),
      warehouse: String(row.warehouseName ?? ''),
      scheduled: String(row.scheduledDate ?? ''),
      scheduledText: dayText(_, row.scheduledDate),
      shipment: String(row.shipmentName ?? ''),
      carrier: String(row.carrierName ?? ''),
      cod: Number(row.cod ?? 0),
      codText: money(row.cod),
      href: row.shipmentId ? shipmentHref(url, row.shipmentId) : transferHref(url, row.id),
      ...status(row.status, DISPATCH_TONES),
    }))
  if (list === 'shipments')
    return read.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      tracking: String(row.trackingCode ?? ''),
      partner: String(row.partnerName ?? ''),
      picking: String(row.pickingName ?? ''),
      warehouse: String(row.warehouseName ?? ''),
      carrier: String(row.carrierName ?? ''),
      cod: Number(row.cod ?? 0),
      codText: money(row.cod),
      feeText: money(row.totalFee),
      href: shipmentHref(url, row.id),
      ...status(row.state, SHIPMENT_TONES),
    }))
  if (list === 'statements')
    return read.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      carrier: String(row.carrierName ?? ''),
      date: String(row.date ?? ''),
      dateText: dayText(_, row.date),
      count: String(row.shipmentCount ?? 0),
      codText: money(row.cod),
      feeText: money(row.fees),
      net: Number(row.net ?? 0),
      netText: money(row.net),
      href: statementHref(url, row.id),
      ...status(row.state, STATEMENT_TONES),
    }))
  const collection = scoped(url, DELIVERY_PATHS.carriers)
  return read.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    baseFeeText: money(row.baseFee),
    extraKgFeeText: money(row.extraKgFee),
    codFeeRateText: `${new Intl.NumberFormat(_.locale === 'en' ? 'en' : 'vi', { maximumFractionDigits: 2 }).format(Number(row.codFeeRate ?? 0))}%`,
    isDefaultText: row.isDefault === true ? _('stock_backend.carrier.default.true') : '',
    href: recordModalHref(collection, { kind: 'stock.carrier', id: String(row.id) }),
    ...status(row.state, CARRIER_TONES),
  }))
}

/** K48's paged reads: each shipping list, searched, filtered, sorted and cut into pages on the server. */
export const deliveryDataRoute =
  (list: DeliveryList) =>
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (req.headers['sec-fetch-site'] === 'cross-site' || !(await ctx.allows(DELIVERY_READS[list], url, req)))
      return text('Forbidden', { status: 403 })
    const path = DELIVERY_PATHS[list]
    const spec = DELIVERY_SPECS[list]
    const input = await readForm(req),
      query = deliveryQuery(path, new URL(input.href || path, url), Number(input.pageSize) || undefined)
    const requested = new URL(query.href, url),
      state = parseListState(spec, requested).state
    const _ = ctx.translate(ctx.localeOf(url, req))
    const read = (await ctx.call(
      DELIVERY_READS[list],
      list === 'carriers' ? { includeArchived: true } : {},
      url,
      req,
    )) as Row[]
    const rows = rowsOf(list, _, url, read, read[0]?.currency)
    const filtered = applyRowListState(spec, state, rows)
    const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      current = Math.min(query.page, pages)
    const href = deliveryHref(path, query.href, { page: current > 1 ? String(current) : null })
    const favorites = await loadListFavorites(ctx, url, req, spec, state)
    const answer: DeliveryAnswer = {
      query: { ...query, href, page: current },
      total: filtered.length,
      page: current,
      pages,
      counts: { all: rows.length },
      isEmpty: !rows.length,
      rows: filtered.slice((current - 1) * query.pageSize, current * query.pageSize),
      search: deliverySearch(_, list, state, href, favorites),
      sorts: Object.fromEntries(
        SORTS[list].map((key) => [
          key,
          {
            href: deliveryHref(
              path,
              encodeListState(
                {
                  ...state,
                  page: 1,
                  sort: [
                    { key, dir: state.sort[0]?.key === key && state.sort[0]?.dir === 'asc' ? 'desc' : 'asc' },
                  ],
                },
                requested,
              ),
              {},
            ),
            ...(state.sort[0]?.key === key ? { direction: state.sort[0].dir } : {}),
          },
        ]),
      ),
      ...(current > 1
        ? { previous: deliveryHref(path, href, { page: current > 2 ? String(current - 1) : null }) }
        : {}),
      ...(current < pages ? { next: deliveryHref(path, href, { page: String(current + 1) }) } : {}),
    }
    return json({ ok: true, value: answer })
  }
