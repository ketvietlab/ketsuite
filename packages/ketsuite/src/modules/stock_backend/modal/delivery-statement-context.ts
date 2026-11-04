import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { shipmentHref } from '../delivery/shared.ts'
import { civilDayText, deliveryMessages, entryLink } from './shipment-context.ts'

/**
 * K47: a carrier statement's page — its shipments with what each collected and cost, its totals, the entries it
 * posted (for a reader of Accounting), the carriers and journals it may take, and what the reader may do.
 */
export const deliveryStatementContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    if (
      !(await ctx.allows(creating ? 'stock.saveDeliveryStatement' : 'stock.getDeliveryStatement', url, req))
    )
      return text('Forbidden', { status: 403 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const _ = ctx.translate(lang)
    const may = (fn: string) => ctx.allows(`stock.${fn}`, url, req)
    const [save, post, settle, cancel] = await Promise.all([
      may('saveDeliveryStatement'),
      may('postDeliveryStatement'),
      may('settleDeliveryStatement'),
      may('cancelDeliveryStatement'),
    ])
    const carriers = ((await optionalRead<Row[]>(ctx, 'stock.listCarriers', {}, url, req, [])) ?? []).map(
      (row) => ({
        id: String(row.id),
        name: String(row.name),
        isDefault: row.isDefault === true,
        currency: row.currency,
      }),
    )
    const record: Row | null = creating
      ? {
          id: '',
          name: '',
          state: 'draft',
          carrierId: (carriers.find((row) => row.isDefault) ?? carriers[0])?.id ?? null,
          date: '',
          note: '',
          cod: '0',
          fees: '0',
          net: '0',
          lines: [],
          pending: 0,
          currency: carriers[0]?.currency ?? null,
        }
      : ((await ctx.call('stock.getDeliveryStatement', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const { manifest, messages } = await deliveryMessages(ctx, req, lang)
    const money = (value: unknown) => formatMoney(_, value ?? '0', record.currency)
    const journals =
      settle && record.state === 'posted'
        ? ((await optionalRead<Row[]>(ctx, 'stock.listSettlementJournals', {}, url, req, [])) ?? [])
        : []
    const carrierName =
      String(record.carrierName ?? '') || carriers.find((row) => row.id === record.carrierId)?.name || ''
    const cod = Number(record.cod ?? 0),
      fees = Number(record.fees ?? 0)
    return json({
      data: {
        record,
        lang,
        draftId: randomUUID(),
        permissions: { save, post, settle, cancel },
        carrierName,
        texts: {
          cod: money(record.cod),
          fees: money(record.fees),
          net: money(String(record.net ?? '0').replace(/^-/, '')),
          signedNet: money(record.net),
          date: civilDayText(lang, record.date),
          paidDate: civilDayText(lang, record.paidDate),
          cancelledDate: civilDayText(lang, record.cancelledDate),
        },
        // Fees above what was collected are paid to the carrier rather than received.
        paying: fees > cod,
        lines: ((record.lines as Row[]) ?? []).map((line) => ({
          id: String(line.id),
          name: String(line.name ?? ''),
          href: shipmentHref(url, line.shipmentId),
          tracking: String(line.trackingCode ?? ''),
          customer: String(line.partnerName ?? ''),
          closed: civilDayText(lang, line.closedDate),
          outcome: line.outcome ? _(`stock_backend.shipment.state.${String(line.outcome)}`) : '',
          cod: money(line.cod),
          fee: money(line.fee),
        })),
        links: {
          feeEntry: await entryLink(ctx, url, req, manifest, record.feeEntry),
          paymentEntry: await entryLink(ctx, url, req, manifest, record.paymentEntry),
        },
        today: String(record.today ?? ''),
        carriers: carriers.map(({ id, name }) => ({ id, name })),
        journals: journals.map((row) => ({
          id: String(row.id),
          name: `${String(row.name)} · ${String(row.code)}`,
        })),
      },
      messages,
    })
  }
