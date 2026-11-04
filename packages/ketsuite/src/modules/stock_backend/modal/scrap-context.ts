import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { formatMoney } from '../../../ui/money-format.ts'
import { defaultWarehouseId } from '../../stock/default-warehouse.ts'

/** A scrap order's modal (K59): the order, what the viewer may do with it and where its goods went. */
export const scrapContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    if (!(await ctx.allows(creating ? 'stock.saveScrap' : 'stock.getScrap', url, req)))
      return text('Forbidden', { status: 403 })
    const readSource = (pickingId: string) =>
      optionalRead<Row | null>(ctx, 'stock.getScrapSource', { pickingId }, url, req, null)
    const pickingId = url.searchParams.get('picking')
    const opened = creating && pickingId ? await readSource(pickingId) : null
    const record = creating
      ? {
          id: '',
          name: '',
          state: 'draft',
          warehouseId: opened?.warehouseId ?? '',
          pickingId: opened?.pickingId ?? '',
          productId:
            ((opened?.products as string[] | undefined) ?? []).length === 1
              ? (opened!.products as string[])[0]
              : '',
          lotId: '',
          quantity: '',
          reason: '',
          replenish: false,
          note: '',
        }
      : ((await ctx.call('stock.getScrap', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    // A saved draft keeps naming the transfer it scraps from and offers only that transfer's products.
    const source =
      opened ??
      (record.state === 'draft' && record.pickingId ? await readSource(String(record.pickingId)) : null)
    const permissions = Object.fromEntries(
      await Promise.all(
        ['saveScrap', 'validateScrap', 'cancelScrap', 'undoScrap'].map(async (name) => [
          name,
          await ctx.allows(`stock.${name}`, url, req),
        ]),
      ),
    )
    const lookup = (fn: string) => optionalRead<Row[]>(ctx, fn, {}, url, req, [])
    const [warehouses, templates, lots] = await Promise.all([
      lookup('stock.listWarehouses'),
      lookup('stock.listStorableProducts'),
      lookup('stock.listLots'),
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
    // K25: what the goods were worth reaches only a viewer who may read stock value.
    const valuation = record.operationId
      ? await optionalRead<Row | null>(
          ctx,
          'stock.getPickingValuation',
          { id: record.operationId },
          url,
          req,
          null,
        )
      : null
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    return json({
      data: {
        // K15 (#1428): a scrap not opened from a transfer starts in the person's one warehouse, or the
        // company's only one.
        record:
          creating && !record.warehouseId
            ? { ...record, warehouseId: defaultWarehouseId(warehouses) ?? '' }
            : record,
        lang,
        permissions,
        draftId: randomUUID(),
        source: source ? { name: source.name, products: source.products } : null,
        links: {
          source: transferHref(record.pickingId),
          operation: transferHref(record.operationId),
          undo: transferHref(record.undoId),
          replenishment: transferHref(record.replenishmentPickingId),
        },
        value:
          valuation?.total != null
            ? formatMoney(ctx.translate(lang), valuation.total, valuation.currency)
            : null,
        choices: {
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
              key.startsWith('backend.relation.') ||
              key.startsWith('backend.validation.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
