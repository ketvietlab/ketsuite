import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { formatMoney } from '../../../ui/money-format.ts'

/**
 * A landed cost's page (K64): the cost, the receipts it may land on, how it was spread once posted and what
 * the reader may do with it. A new one opened from a receipt (`picking`) starts on that receipt.
 */
export const landedCostContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const envelope = await readLandedCostContext(ctx, url, req, String(params.id))
    if (envelope === 403) return text('Forbidden', { status: 403 })
    if (envelope === 404) return text('Not found', { status: 404 })
    return json(envelope)
  }

/**
 * The page's context, read for the record runtime and, for a new cost opened from a receipt, rendered with
 * the page: the runtime mounts before the browser shows the new address, so it cannot read `picking` itself.
 */
export async function readLandedCostContext(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
): Promise<403 | 404 | { data: Row; messages: Record<string, unknown> }> {
  const creating = id === 'new'
  if (!(await ctx.allows(creating ? 'stock.saveLandedCost' : 'stock.getLandedCost', url, req))) return 403
  const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const _ = ctx.translate(lang)
  const may = async (fn: string) => ctx.allows(`stock.${fn}`, url, req)
  const [save, post, cancel] = await Promise.all([
    may('saveLandedCost'),
    may('postLandedCost'),
    may('cancelLandedCost'),
  ])
  const landable = (await optionalRead<Row[]>(ctx, 'stock.listLandableReceipts', {}, url, req, [])) ?? []
  const picking = url.searchParams.get('picking')
  const record: Row | null = creating
    ? {
        id: '',
        name: '',
        state: 'draft',
        vendorId: null,
        date: '',
        pickingIds: picking && landable.some((row) => row.id === picking) ? [picking] : [],
        receipts: [],
        lines: [],
        allocations: [],
        total: '0',
      }
    : ((await ctx.call('stock.getLandedCost', { id: id }, url, req)) as Row | null)
  if (!record) return 404
  const query = new URLSearchParams(
    [...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
  )
  const transferHref = (id: unknown) => `/admin/stock/transfers/${encodeURIComponent(String(id))}?${query}`
  const day = new Intl.DateTimeFormat(lang, { timeZone: 'UTC' })
  const dayText = (value: unknown) =>
    /^\d{4}-\d{2}-\d{2}/.test(String(value ?? ''))
      ? day.format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`))
      : ''
  const money = (value: unknown) => formatMoney(_, value, record.currency)
  // A vendor and the receipts a draft names stay offered even when nothing else is.
  const vendors = await optionalRead<Row[]>(ctx, 'stock.listLandedCostVendors', {}, url, req, [])
  const chosenVendor =
    record.vendorId && !vendors.some((row) => row.id === record.vendorId)
      ? [{ id: record.vendorId, name: record.vendorName ?? record.vendorId }]
      : []
  const partners = new Map(
    [...vendors, ...chosenVendor].map((row) => [String(row.id), String(row.name)] as const),
  )
  const receipts = landable.map((row) => ({
    id: String(row.id),
    name: [row.name, row.partnerName, dayText(row.dateDone)].filter(Boolean).join(' · '),
  }))
  for (const chosen of (record.receipts as Row[] | undefined) ?? [])
    if (!receipts.some((row) => row.id === chosen.id))
      receipts.push({ id: String(chosen.id), name: String(chosen.name) })
  const templates = await optionalRead<Row[]>(ctx, 'stock.listStorableProducts', {}, url, req, [])
  const products = new Map(
    templates.flatMap((template) =>
      ((template.variants as Row[]) ?? []).map((variant) => [
        String(variant.id),
        `${String(template.name)}${variant.defaultCode ? ` · ${String(variant.defaultCode)}` : ''}`,
      ]),
    ),
  )
  const lines = (record.lines as Row[]) ?? []
  const receiptNames = new Map(
    ((record.receipts as Row[] | undefined) ?? []).map((row) => [String(row.id), String(row.name)]),
  )
  const manifest = await ctx.live(req)
  const readsEntries = Boolean(
    record.accountMoveId &&
      manifest.functions?.['account.getMove'] &&
      (await ctx.allows('account.getMove', url, req)),
  )
  return {
    data: {
      record: { ...record, lines: lines.map((line) => ({ ...line, amountText: money(line.amount) })) },
      lang,
      draftId: randomUUID(),
      permissions: { save, post, cancel },
      fromReceipt: creating && picking ? (receipts.find((row) => row.id === picking)?.name ?? null) : null,
      totalText: money(record.total),
      dateText: dayText(record.date),
      postedText: dayText(record.postedDate),
      entryHref: readsEntries
        ? `/admin/accounting/entries/${encodeURIComponent(String(record.accountMoveId))}?${query}`
        : null,
      receiptLinks: ((record.receipts as Row[] | undefined) ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        href: transferHref(row.id),
      })),
      allocations: ((record.allocations as Row[] | undefined) ?? []).map((row) => ({
        id: String(row.id),
        receipt: receiptNames.get(String(row.pickingId)) ?? String(row.pickingId),
        receiptHref: transferHref(row.pickingId),
        product: products.get(String(row.productId)) ?? String(row.productId),
        line: String(lines.find((line) => line.id === row.lineId)?.name ?? ''),
        amountText: money(row.amount),
        stockText: money(row.stockAmount),
        cogsText: money(row.cogsAmount),
      })),
      choices: {
        vendors: [...partners].map(([id, name]) => ({ id, name })),
        receipts,
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
  }
}
