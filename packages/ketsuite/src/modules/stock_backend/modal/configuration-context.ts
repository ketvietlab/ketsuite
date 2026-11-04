import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { productPageLink } from '../../backend/product-page.ts'
import { stockConfigurations } from './configuration.ts'
import { localizeGeneratedRecords } from '../generated-names.ts'
import { lotCondition } from '../screens/lots-list.tsx'
import { inLocale } from '../../backend/screen.ts'

export const loadStockConfigurationContext = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  params: Record<string, string>,
) => {
  const config = Object.hasOwn(stockConfigurations, params.kind)
    ? stockConfigurations[params.kind]
    : undefined
  if (!config) return text('Not found', { status: 404 })
  const creating = params.id === 'new'
  if (!(await ctx.allows(creating ? config.save : config.read, url, req)))
    return text('Forbidden', { status: 403 })
  const record = creating
    ? {}
    : ((await ctx.call(config.read, config.readInput ?? {}, url, req)) as Row[]).find(
        (row) => row.id === params.id,
      )
  if (!record) return text('Not found', { status: 404 })
  const save = await ctx.allows(config.save, url, req)
  const lookup = (fn: string) => optionalRead<Row[]>(ctx, fn, {}, url, req, [])
  const [locations, warehouses, templates, units, routes, rules, pickingTypes, people] = await Promise.all([
    params.kind === 'route' ||
    params.kind === 'lot' ||
    config.fields.some((field) => field.lookup === 'locations')
      ? lookup('stock.listLocations')
      : [],
    // A lot's page scraps from the warehouses that hold it (K37).
    params.kind === 'lot' || config.fields.some((field) => field.lookup === 'warehouses')
      ? lookup('stock.listWarehouses')
      : [],
    config.fields.some((field) => field.lookup === 'products') ? lookup('stock.listStorableProducts') : [],
    config.fields.some((field) => field.lookup === 'units') ? lookup('uom.listUnits') : [],
    config.fields.some((field) => field.lookup === 'routes') ? lookup('stock.listRoutes') : [],
    params.kind === 'route' && !creating
      ? optionalRead<Row[]>(ctx, 'stock.listRules', { routeId: params.id }, url, req, [])
      : [],
    params.kind === 'route' ? lookup('stock.listPickingTypes') : [],
    config.fields.some((field) => field.lookup === 'people') ? lookup('stock.listWarehousePeople') : [],
  ])
  const products = templates.flatMap((template) =>
    ((template.variants as Row[]) ?? []).map((variant) => ({
      ...variant,
      name: `${template.name}${variant.defaultCode ? ` · ${variant.defaultCode}` : ''}`,
    })),
  )
  const quants =
    params.kind === 'lot' && !creating
      ? (
          await optionalRead<Row[]>(
            ctx,
            'stock.listQuants',
            { productId: String(record.productId) },
            url,
            req,
            [],
          )
        ).filter(
          (row) =>
            row.lotId === params.id &&
            locations.some(
              (location) =>
                location.id === row.locationId && ['internal', 'transit'].includes(String(location.usage)),
            ),
        )
      : []
  const history =
    params.kind === 'lot' && !creating
      ? await optionalRead<Row[]>(ctx, 'stock.listLotHistory', { lotId: params.id }, url, req, [])
      : []
  // K32: where the lot went, read from its finished transfers, and the figures the page's rail adds up.
  const trace =
    params.kind === 'lot' && !creating
      ? ((
          (await optionalRead<Row | null>(
            ctx,
            'stock.listMoveHistory',
            { lotId: params.id },
            url,
            req,
            null,
          )) as { rows?: Row[] } | null
        )?.rows ?? null)
      : null
  const lotTrace = trace ? await traceOf(ctx, url, req, record, trace, locations, warehouses) : null
  // P11: what production made of the lot, for a reader of production; absent without the module.
  const production =
    params.kind === 'lot' && !creating
      ? await optionalRead<Row | null>(ctx, 'manufacturing.traceLot', { lotId: params.id }, url, req, null)
      : null
  // The lot's product opens its own page (P24), for a reader who may read it.
  const productHref =
    params.kind === 'lot' && !creating
      ? (await productPageLink(ctx, url, req))(
          templates.find((template) =>
            ((template.variants as Row[]) ?? []).some((variant) => variant.id === record.productId),
          )?.id,
        )
      : null
  const rule = params.kind === 'route' && (await ctx.allows('stock.saveRule', url, req))
  const scrapLot = params.kind === 'lot' && !creating && (await ctx.allows('stock.scrapLot', url, req))
  const run = params.kind === 'replenishment' && (await ctx.allows('stock.runOrderpoint', url, req))
  const supply =
    params.kind === 'replenishment'
      ? await optionalRead<Row | null>(
          ctx,
          'stock.getOrderpointSupply',
          creating ? {} : { id: params.id },
          url,
          req,
          null,
        )
      : null
  const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  // K10 (#1426): what a warehouse made (its locations and operation types) reads in the reader's language.
  const _ = ctx.translate(lang)
  const generated = { location: 'location', 'picking-type': 'pickingType' } as const
  const group = Object.hasOwn(generated, params.kind)
    ? generated[params.kind as keyof typeof generated]
    : null
  const shown = group && !creating ? localizeGeneratedRecords(_, [record as Row], group)[0]! : record
  const manifest = await ctx.live(req)
  const messages = Object.fromEntries(
    Object.entries(manifest.messages?.[lang] ?? {}).filter(
      ([key]) =>
        key.startsWith('stock_backend.') ||
        key.startsWith('stock.error.') ||
        key.startsWith('backend.relation.') ||
        key.startsWith('backend.validation.'),
    ),
  )
  return {
    data: {
      record: shown,
      supply,
      lang,
      save,
      rule,
      run,
      scrapLot,
      rules,
      quants,
      history,
      ...(lotTrace ? { trace: lotTrace.rows, figures: lotTrace.figures(quants) } : {}),
      ...(production ? { production: productionTraceOf(url, production) } : {}),
      // K32: quarantined, expired or expiring heads the lot's page.
      ...(params.kind === 'lot' && !creating
        ? {
            condition: lotCondition(
              record,
              quants.reduce((total, row) => total + Number(row.quantity), 0),
              Date.now(),
            ),
          }
        : {}),
      productHref,
      draftId: randomUUID(),
      storedName: shown !== record && shown?.name !== record?.name ? (record?.name ?? null) : null,
      choices: {
        locations: localizeGeneratedRecords(_, locations, 'location'),
        warehouses,
        products,
        units,
        routes,
        pickingTypes: localizeGeneratedRecords(_, pickingTypes, 'pickingType'),
        people,
      },
    },
    messages: { ...messages, ...USER_RECORD_MODAL_LABELS[lang] },
  }
}

const owned = (usage: unknown) => usage === 'internal' || usage === 'transit'

/**
 * K32: the lot's trace as the page shows it, newest first — locations as `<warehouse code>/<name>`, the
 * customer, and the sale order a line came from, linked only for a reader who may read orders — and the
 * rail's figures: what came in from suppliers and counts, on hand, held, delivered less returned, and how
 * many customers received some.
 */
async function traceOf(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  record: Row,
  rows: Row[],
  locations: Row[],
  warehouses: Row[],
) {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const codes = new Map(warehouses.map((row) => [String(row.id), String(row.code ?? row.name)]))
  const names = new Map(
    localizeGeneratedRecords(_, locations, 'location').map((row) => [
      String(row.id),
      row.warehouseId && codes.has(String(row.warehouseId))
        ? `${codes.get(String(row.warehouseId))}/${String(row.name)}`
        : String(row.name),
    ]),
  )
  // A reader who may not read orders gets none, and their names stay plain text.
  const orders = new Map(
    (
      (await optionalRead<Row[]>(
        ctx,
        'sale.listOrders',
        { productId: String(record.productId), limit: 2000 },
        url,
        req,
        [],
      )) ?? []
    ).map((order) => [
      String(order.name),
      `${['draft', 'sent', 'cancel'].includes(String(order.state)) ? '/admin/sales/quotations' : '/admin/sales/orders'}/${encodeURIComponent(String(order.id))}`,
    ]),
  )
  // In the reader's language, company and branch, as every stock link is.
  const scoped = (path: string) => {
    const target = new URL(inLocale(url, path), url)
    for (const key of ['company', 'branch'])
      if (url.searchParams.has(key)) target.searchParams.set(key, url.searchParams.get(key)!)
    return `${target.pathname}${target.search}`
  }
  const sum = (kept: Row[]) => kept.reduce((total, row) => total + Number(row.quantity), 0)
  const delivered = rows.filter((row) => row.toUsage === 'customer')
  const returned = rows.filter((row) => row.fromUsage === 'customer')
  return {
    rows: rows.map((row) => ({
      id: String(row.id),
      date: String(row.date),
      pickingName: String(row.pickingName),
      pickingHref: scoped(`/admin/stock/transfers/${encodeURIComponent(String(row.pickingId))}`),
      from: names.get(String(row.locationId)) ?? String(row.locationId),
      to: names.get(String(row.locationDestId)) ?? String(row.locationDestId),
      quantity: String(row.quantity),
      uomName: row.uomName ?? null,
      kind: String(row.kind),
      partner: row.partner ?? null,
      origin: row.origin ?? null,
      originHref:
        row.origin && orders.has(String(row.origin)) ? scoped(orders.get(String(row.origin))!) : null,
    })),
    figures: (quants: Row[]) => ({
      received: sum(
        rows.filter((row) => owned(row.toUsage) && ['supplier', 'inventory'].includes(String(row.fromUsage))),
      ),
      onHand: quants.reduce((total, row) => total + Number(row.quantity), 0),
      held: quants.reduce((total, row) => total + Number(row.reservedQuantity ?? 0), 0),
      delivered: sum(delivered) - sum(returned),
      customers: new Set(delivered.map((row) => String(row.partnerId ?? '')).filter(Boolean)).size,
    }),
  }
}

/** P11: the lot's production trace as rows of the lot page, each order, lot and transfer a link. */
function productionTraceOf(url: URL, trace: Row) {
  const scoped = (path: string) => {
    const target = new URL(inLocale(url, path), url)
    for (const key of ['company', 'branch'])
      if (url.searchParams.has(key)) target.searchParams.set(key, url.searchParams.get(key)!)
    return `${target.pathname}${target.search}`
  }
  const order = (row: Row) => ({
    document: String(row.productionName),
    documentHref: scoped(`/admin/manufacturing/orders/${encodeURIComponent(String(row.productionId))}`),
  })
  const lot = (row: Row) => ({
    lot: String(row.lotName),
    lotHref: scoped(`/admin/stock/lots/${encodeURIComponent(String(row.lotId))}`),
  })
  const rows: Row[] = []
  for (const made of (trace.madeBy as Row[]) ?? []) {
    rows.push({ relation: 'madeBy', ...order(made) })
    for (const used of (made.used as Row[]) ?? [])
      rows.push({ relation: 'usedLot', ...order(made), ...lot(used), quantity: used.quantity })
  }
  for (const used of (trace.usedIn as Row[]) ?? []) {
    rows.push({ relation: 'usedIn', ...order(used), quantity: used.quantity })
    for (const made of (used.made as Row[]) ?? [])
      rows.push({ relation: 'madeLot', ...order(used), ...lot(made), quantity: made.quantity })
  }
  const received = (trace.received as Row[]) ?? []
  for (const row of received)
    rows.push({
      relation: Number(row.level) > 0 ? 'receivedMade' : 'received',
      document: String(row.pickingName ?? row.pickingId ?? '—'),
      documentHref: row.pickingId
        ? scoped(`/admin/stock/transfers/${encodeURIComponent(String(row.pickingId))}`)
        : null,
      ...lot(row),
      quantity: row.quantity,
      partner: row.partnerName ?? null,
    })
  return {
    checks: ((trace.checks as Row[]) ?? []).map((check) => ({
      state: String(check.state),
      ph: check.ph == null ? null : String(check.ph),
      sensory: check.sensory == null ? null : String(check.sensory),
      ...order(check),
    })),
    rows: rows.map((row, index) => ({ id: String(index), ...row })),
    customers: new Set(received.map((row) => String(row.partnerId ?? '')).filter(Boolean)).size,
  }
}

export const stockConfigurationContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const result = await loadStockConfigurationContext(ctx, url, req, params)
    return 'data' in result ? json(result) : result
  }
