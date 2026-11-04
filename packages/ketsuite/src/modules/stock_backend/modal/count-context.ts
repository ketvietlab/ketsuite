import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { defaultWarehouseId } from '../../stock/default-warehouse.ts'

export type CountSessionOptions = {
  /**
   * A function that tells, per count line, whether its product is counted in pieces and how many
   * pieces its counted quantity makes: `{lines: [{id, productId, counted}]}` to
   * `[{id, enabled, pieces}]`. The grid then shows a Pieces column, editable only where enabled;
   * the deployment's `stock.saveCountLines` turns posted pieces into the counted quantity.
   */
  countPieces?: string
}

/** A physical count's modal (K33–K38): its lines, what the viewer may do and what approval booked. */
export const countSessionContextWith =
  (options: CountSessionOptions = {}) =>
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    if (!(await ctx.allows(creating ? 'stock.startCountSession' : 'stock.getCountSession', url, req)))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? { id: '', name: '', state: 'new', warehouseId: '', blind: true, lines: [] }
      : ((await ctx.call('stock.getCountSession', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const permissions = Object.fromEntries(
      await Promise.all(
        [
          'startCountSession',
          'saveCountLines',
          'saveCountDetails',
          'addCountLine',
          'removeCountLine',
          'submitCountSession',
          'approveCountSession',
          'returnCountSession',
          'cancelCountSession',
          'settleCountDifference',
        ].map(async (name) => [name, await ctx.allows(`stock.${name}`, url, req)]),
      ),
    )
    const lookup = (fn: string) => optionalRead<Row[]>(ctx, fn, {}, url, req, [])
    const [warehouses, templates, lots, people] = await Promise.all([
      lookup('stock.listWarehouses'),
      lookup('stock.listStorableProducts'),
      lookup('stock.listLots'),
      lookup('stock.listCountSettlementPeople'),
    ])
    const products = templates.flatMap((template) =>
      ((template.variants as Row[]) ?? []).map((variant) => ({
        id: variant.id,
        tracking: template.tracking ?? 'none',
        name: `${String(template.name)}${variant.defaultCode ? ` · ${String(variant.defaultCode)}` : ''}`,
      })),
    )
    const query = new URLSearchParams(
      [...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
    )
    const transferHref = (id: unknown) =>
      id ? `/admin/stock/transfers/${encodeURIComponent(String(id))}?${query}` : null
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const _ = ctx.translate(lang)
    // K36 with K25: what approval booked reaches only a viewer who may read stock value.
    const valuation = async (id: unknown) =>
      id ? optionalRead<Row | null>(ctx, 'stock.getPickingValuation', { id }, url, req, null) : null
    const [shortage, excess] = await Promise.all([
      valuation(record.shortagePickingId),
      valuation(record.excessPickingId),
    ])
    const money = (value: unknown, currency: unknown) =>
      value == null ? null : formatMoney(_, value as string, currency as string)
    const lineValues = new Map(
      [shortage, excess].flatMap((side) =>
        ((side?.lines as Row[] | undefined) ?? []).map((line) => [
          String(line.moveLineId),
          money(line.value, side?.currency),
        ]),
      ),
    )
    // Pieces are a way of entering the count, never a stored figure of their own.
    const pieceFacts =
      options.countPieces && !creating && (await ctx.allows(options.countPieces, url, req))
        ? new Map(
            (
              await optionalRead<Row[]>(
                ctx,
                options.countPieces,
                {
                  lines: ((record.lines as Row[] | undefined) ?? []).map((line) => ({
                    id: line.id,
                    productId: line.productId,
                    counted: line.counted ?? null,
                  })),
                },
                url,
                req,
                [],
              )
            ).map((row) => [String(row.id), row]),
          )
        : null
    const lines = ((record.lines as Row[] | undefined) ?? []).map((line) => {
      const pieces = pieceFacts?.get(String(line.id))
      return {
        ...line,
        value: lineValues.get(`${String(line.id)}:line`) ?? null,
        ...(pieceFacts
          ? {
              pieces: pieces?.enabled ? (pieces.pieces ?? null) : null,
              piecesEnabled: pieces?.enabled === true,
            }
          : {}),
      }
    })
    const manifest = await ctx.live(req)
    return json({
      data: {
        // K15 (#1428): a new count starts in the counter's one warehouse, or the company's only one.
        record: {
          ...record,
          ...(creating ? { warehouseId: defaultWarehouseId(warehouses) ?? '' } : {}),
          lines,
        },
        lang,
        permissions,
        draftId: randomUUID(),
        pieces: pieceFacts != null,
        links: {
          print:
            record.state === 'done' && (await ctx.allows('stock.getCountReport', url, req))
              ? `/admin/stock/count-session/${encodeURIComponent(String(record.id))}/print?${query}`
              : null,
          valuedPrint:
            record.state === 'done' && (await ctx.allows('stock.getValuedCountReport', url, req))
              ? `/admin/stock/count-session/${encodeURIComponent(String(record.id))}/print?${query}&values=1`
              : null,
          shortage: transferHref(record.shortagePickingId),
          excess: transferHref(record.excessPickingId),
        },
        value:
          shortage || excess
            ? {
                shortage: shortage ? money(shortage.total, shortage.currency) : null,
                excess: excess ? money(excess.total, excess.currency) : null,
                entries: [shortage?.accountMoveName, excess?.accountMoveName].filter(Boolean),
              }
            : null,
        choices: {
          people,
          warehouses: warehouses.map((row) => ({ id: row.id, name: row.name })),
          products,
          lots: lots.map((row) => ({ id: row.id, name: row.name, productId: row.productId })),
        },
      },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) =>
              key.startsWith('stock_backend.') ||
              key.startsWith('stock.error.') ||
              key.startsWith('stock.countReason.') ||
              key.startsWith('backend.relation.') ||
              key.startsWith('backend.validation.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }

export const countSessionContext = countSessionContextWith()
