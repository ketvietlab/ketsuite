import { replenishmentDataRoute } from './screens/replenishment-data.tsx'
import { forecastDataRoute } from './screens/forecast-data.tsx'
import { forecastDetailRoute } from './screens/forecast-detail.tsx'
import { forecastCollectionScreen } from './screens/forecast-collection.tsx'
import { valuationDataRoute } from './screens/valuation-data.tsx'
import { valuationRoute } from './screens/valuation-page.tsx'
import { agingDataRoute, moveAnalysisDataRoute, moveHistoryDataRoute } from './screens/stock-reports-data.tsx'
import { agingRoute, moveAnalysisRoute, moveHistoryRoute } from './screens/stock-reports-page.tsx'
import { scrapsDataRoute } from './screens/scraps-data.tsx'
import { scrapsRoute } from './screens/scraps-page.tsx'
import { scrapContext } from './modal/scrap-context.ts'
import { landedCostsDataRoute } from './screens/landed-costs-data.tsx'
import { landedCostPageRoute, landedCostsRoute } from './screens/landed-costs-page.tsx'
import { landedCostContext } from './modal/landed-cost-context.ts'
import { deliveryDataRoute } from './delivery/data.ts'
import { deliveryListRoute, deliveryOverviewRoute, deliveryRecordRoute } from './delivery/pages.tsx'
import { shipmentContext } from './modal/shipment-context.ts'
import { deliveryStatementContext } from './modal/delivery-statement-context.ts'
import { countsDataRoute } from './screens/counts-data.tsx'
import { CountPrint } from './screens/count-print.tsx'
import { countsRoute } from './screens/counts-page.tsx'
import { countSessionContext } from './modal/count-context.ts'
import { accountingRoute } from './screens/accounting.tsx'
import { replenishmentCollectionRoute, replenishmentRecordRoute } from './screens/replenishment-page.tsx'
import { lotPageScreen } from './screens/lot-page.tsx'
import { transferPageScreen } from './screens/transfer-page.tsx'
import { localizeGeneratedRecords } from './generated-names.ts'
import { productPageLink } from '../backend/product-page.ts'
import { stockOverviewScreen } from './screens/overview.tsx'
import { transferContext } from './modal/transfer-context.ts'
import { inventoryCountContext } from './modal/inventory-context.ts'
import { stockConfigurationContext } from './modal/configuration-context.ts'
import { recordModalCreateHref, recordModalHref } from '../../ui/record-modal.tsx'
import { optionalRead } from '../backend/optional-read.ts'
import { rowListSearch } from '../backend/row-list.ts'
import {
  inventoryListSearch,
  locationListSearch,
  lotListSearch,
  pickingTypeListSearch,
  stockRouteListSearch,
  TRANSFER_KINDS,
  transferListSearch,
  warehouseListSearch,
} from './search.ts'

/** The sidebar label of each kind's queue, which heads the list opened on it (K21). */
const QUEUE_LABELS = { incoming: 'receipts', outgoing: 'deliveries', internal: 'internalTransfers' } as const

import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import type { Translator } from '@ketvietlab/ketjs'
import { backendPage, formatDateTime, modalWorkspace } from '../../ui/index.ts'
import { errorsOf, readForm, seeOther } from '../backend/forms.ts'
import {
  inventoryScreen,
  lotCondition,
  lotCreateModal,
  lotsListScreen,
  locationCreateModal,
  locationsListScreen,
  pickingTypeCreateModal,
  pickingTypesListScreen,
  stockRouteCreateModal,
  stockRouteDetailScreen,
  stockRoutesListScreen,
  transfersListScreen,
  warehouseCreateModal,
  warehousesListScreen,
} from './screens/index.ts'

const crossSite = (req: Parameters<Route>[1]): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

/**
 * A cross-origin POST carries the signed-in operator's session cookie without
 * their intent, and every write here moves stock or rewrites the configuration
 * that governs it — completing a transfer, cancelling one and releasing its
 * reservations, re-parenting a location. Refused the way user_backend,
 * company_backend, oauth_backend and product_backend already refuse it.
 */
const refusePost = (req: Parameters<Route>[1], accepts = 'POST') =>
  req.method !== 'POST'
    ? text(accepts, { status: 405 })
    : crossSite(req)
      ? text('Forbidden', { status: 403 })
      : null

import { adminPage, frameOf, inLocale, timezoneOf } from '../backend/screen.ts'
import { TransferPrint } from './screens/transfer-print.tsx'
import { PICKING_PRINTS } from '../stock/reports.ts'
import { lotAvailable } from '../stock/lot-policy.ts'
import { reservesStock } from '../stock/reservation-policy.ts'
import { transferStatus } from './transfer-status.ts'
import { formatMoney } from '../../ui/money-format.ts'
import { overviewFigures } from './overview-data.ts'
import { selectionLabel as resolveSelection } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import { searchRoutes } from './search/routes.ts'

/**
 * A group heading in the reader's language: a selection code reads as its
 * label, anything else — a warehouse or location name — reads as itself.
 */
const GROUP_MESSAGES: Record<string, string> = {
  state: 'state',
  usage: 'usage',
  code: 'pickingType',
  createBackorder: 'backorder',
  trigger: 'trigger',
  receptionSteps: 'receptionSteps',
  deliverySteps: 'deliverySteps',
}

const stockGroupLabel = (_: Translator, key: string, value: unknown): string => {
  const raw = value == null ? '' : String(value)
  if (!raw) return _('backend.chrome.groupEmpty')
  const message = `stock_backend.${GROUP_MESSAGES[key] ?? key}.${raw}`
  return _.resolves(message) ? _(message) : raw
}

/** Every stock list shares one set of search-filter functions; see `functions.ts`. */
const stockSearchFunctions = {
  apply: 'stock_backend.applySearchFilter',
  saveFavorite: 'stock_backend.saveSearchFavorite',
  deleteFavorite: 'stock_backend.deleteSearchFavorite',
  setDefaultFavorite: 'stock_backend.setDefaultSearchFavorite',
}

const options = (rows: AnyRow[]) => rows.map((row) => ({ value: String(row.id), label: String(row.name) }))
/** A stable stock code in the reader's language; the code itself survives as data. */
const selectionLabel = (_: Translator, group: string, value: unknown): string =>
  resolveSelection(_, 'stock_backend', group, value)
const localizedGeneratedRouteName = (_: Translator, row: AnyRow): string => {
  const raw = String(row.name)
  const separator = raw.lastIndexOf(': ')
  const suffix = separator >= 0 ? raw.slice(separator + 2) : ''
  const group = String(row.id).endsWith(':receipt-route')
    ? 'receptionSteps'
    : String(row.id).endsWith(':delivery-route')
      ? 'deliverySteps'
      : ''
  const generated =
    (group === 'receptionSteps' && ['one_step', 'two_steps', 'three_steps'].includes(suffix)) ||
    (group === 'deliverySteps' && ['ship_only', 'pick_ship', 'pick_pack_ship'].includes(suffix))
  return generated ? `${raw.slice(0, separator)}: ${selectionLabel(_, group, suffix)}` : raw
}

const localizedGeneratedRuleName = (_: Translator, row: AnyRow): string => {
  const parts = String(row.id).split(':')
  const flow = parts.at(-2)
  const suffix = parts.at(-1) ?? ''
  const group = flow === 'receipt' ? 'record.receiptRule' : flow === 'delivery' ? 'record.deliveryRule' : ''
  const key = group ? `stock_backend.${group}.${suffix}` : ''
  return key && _.resolves(key) ? _(key) : String(row.name)
}

const completeLocationName = (row: AnyRow, nameById: Map<string, string>) =>
  String(row.parentPath)
    .split('/')
    .filter(Boolean)
    .map((id) => nameById.get(id) ?? id)
    .join(' / ')

const invalid = (url: URL, _: Translator) =>
  url.searchParams.has('invalid') ? [_('stock_backend.error.invalid')] : undefined
const createModalHref = (url: URL, collection: string): string => inLocale(url, `${collection}?create=1`)
const createModalOpen = (url: URL): boolean => url.searchParams.get('create') === '1'
const createModalErrorHref = (url: URL, collection: string): string =>
  inLocale(url, `${collection}?create=1&invalid=1`)
const resultRedirect = (result: unknown, success: string) =>
  (result as { ok?: boolean }).ok
    ? seeOther(success)
    : seeOther(`${success}${success.includes('?') ? '&' : '?'}invalid=1`)
const lotProductOptions = (products: AnyRow[]) =>
  products.flatMap((template) =>
    (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : [])
      .filter((variant) => variant.active !== false)
      .map((variant) => ({
        value: String(variant.id),
        label: variant.defaultCode
          ? `${String(template.name)} · ${String(variant.defaultCode)}`
          : String(template.name),
      })),
  )
/** A moment as the company reads it: its accounting time zone, not the server's. */
const dateTimeLabel = (value: unknown, lang: string, timeZone: string): string => {
  const raw = String(value ?? '')
  if (!raw) return ''
  const date = new Date(raw)
  return Number.isNaN(date.getTime())
    ? raw
    : formatDateTime(lang === 'vi' ? 'vi-VN' : 'en-US', date, {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone,
      })
}

/**
 * Where a transfer sits in the warehouse's work (K18): ready, then waiting for goods, then drafts,
 * each by scheduled date, then the closed ones newest first.
 */
const TRANSFER_QUEUE_RANK: Record<string, number> = {
  assigned: 0,
  waiting: 1,
  confirmed: 1,
  partially_available: 1,
  draft: 2,
}
const transferQueueOrder = (row: AnyRow): number => {
  const time = (value: unknown) => {
    const ms = Date.parse(String(value ?? ''))
    return Number.isNaN(ms) ? 0 : ms
  }
  const rank = TRANSFER_QUEUE_RANK[String(row.state)]
  return rank === undefined
    ? 3e13 + (1e13 - time(row.dateDone ?? row.scheduledDate))
    : rank * 1e13 + time(row.scheduledDate)
}

const common = async (ctx: ServeContext, url: URL, req: Req) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const [warehouses, locations, pickingTypes, lots, routes, units] = (await Promise.all([
    optionalRead<AnyRow[]>(ctx, 'stock.listWarehouses', {}, url, req, []),
    optionalRead<AnyRow[]>(ctx, 'stock.listLocations', {}, url, req, []),
    optionalRead<AnyRow[]>(ctx, 'stock.listPickingTypes', {}, url, req, []),
    optionalRead<AnyRow[]>(ctx, 'stock.listLots', {}, url, req, []),
    optionalRead<AnyRow[]>(ctx, 'stock.listRoutes', {}, url, req, []),
    optionalRead<AnyRow[]>(ctx, 'uom.listUnits', {}, url, req, []),
  ])) as [AnyRow[], AnyRow[], AnyRow[], AnyRow[], AnyRow[], AnyRow[]]
  return {
    warehouses,
    locations: localizeGeneratedRecords(_, locations, 'location'),
    pickingTypes: localizeGeneratedRecords(_, pickingTypes, 'pickingType'),
    lots,
    routes,
    units,
  }
}

/** A stock path in the locale, company and branch of the page linking to it. */
const scoped = (url: URL, path: string): string => {
  const target = new URL(inLocale(url, path), url)
  for (const key of ['company', 'branch'])
    if (url.searchParams.has(key)) target.searchParams.set(key, url.searchParams.get(key)!)
  return `${target.pathname}${target.search}`
}
/** A transfer's page; `null` creates one. */
export const transferHref = (url: URL, id: string | null): string =>
  scoped(url, `/admin/stock/transfers/${id ?? 'new'}`)
/**
 * A transfer is a page (`/admin/stock/transfers/{id}`, `new` to create). The server renders the
 * RecordPage loading; the record runtime reads `/admin/stock/transfer/{id}/context` and renders
 * the transfer (modal/transfer-view.tsx).
 */
const transferPageRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const creating = params.id === 'new'
    const picking = creating
      ? null
      : ((await ctx.call('stock.getPicking', { id: params.id }, url, req)) as AnyRow | null)
    if (!creating && !picking) return text('not found', { status: 404 })
    const title = picking ? String(picking.name) : _('stock_backend.transfer.create.title')
    const island = await ctx.joint(url, req, 'stock_backend:transfer.page', {
      id: params.id,
      title,
      loading: _('backend.relation.loading'),
      back: scoped(url, '/admin/stock/transfers'),
      // Saved transfers are wide for their grids, so loading does not shift the page.
      width: creating ? 'default' : 'wide',
    })
    return backendPage(ctx, req, {
      lang,
      title,
      body: transferPageScreen(_, title, island, await frameOf(ctx, url, req), lang === 'en' ? 'en' : 'vi'),
    })
  }

export const routes: Record<string, RouteEntry> = {
  ...searchRoutes,
  '/admin/stock':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const may = (fn: string) => ctx.allows(fn, url, req)
      // K51: each figure reads the list behind it, and only when the reader may open that list.
      const readIf = async (fn: string, input: Record<string, unknown> = {}) =>
        (await may(fn)) ? await optionalRead<AnyRow[] | null>(ctx, fn, input, url, req, null) : null
      const [rows, locations, pickingTypes, cycles, warehouses, quants, lots, counts, orderpoints] =
        await Promise.all([
          ctx.call('stock.listPickings', {}, url, req) as Promise<AnyRow[]>,
          optionalRead<AnyRow[]>(ctx, 'stock.listLocations', {}, url, req, []),
          optionalRead<AnyRow[]>(ctx, 'stock.listPickingTypes', {}, url, req, []),
          optionalRead<AnyRow[]>(ctx, 'stock.listCountCycles', {}, url, req, []),
          optionalRead<AnyRow[]>(ctx, 'stock.listWarehouses', {}, url, req, []),
          readIf('stock.listQuants'),
          readIf('stock.listLots'),
          readIf('stock.listCountSessions'),
          readIf('stock.getOrderpointCollection'),
        ])
      const requested = url.searchParams.get('warehouse') ?? ''
      const warehouseId = warehouses.some((row) => String(row.id) === requested) ? requested : ''
      const values = (await may('stock.listValuation'))
        ? Object.fromEntries(
            await Promise.all(
              ['', ...warehouses.map((row) => String(row.id))].map(async (id) => {
                const read = (await optionalRead<AnyRow | null>(
                  ctx,
                  'stock.listValuation',
                  { ...(id ? { warehouseId: id } : {}), pageSize: 1 },
                  url,
                  req,
                  null,
                )) as AnyRow | null
                return [id, read ? JSON.stringify([read.totalValue, read.currency]) : null] as const
              }),
            ),
          )
        : null
      const figures = overviewFigures(
        {
          pickings: rows,
          pickingTypes,
          warehouses,
          locations,
          quants,
          lots,
          counts,
          orderpoints,
          values: values
            ? Object.fromEntries(
                Object.entries(values).filter((entry): entry is [string, string] => !!entry[1]),
              )
            : null,
        },
        warehouseId,
        Date.now(),
      )
      return adminPage(ctx, url, req, {
        title: 'stock_backend.overview.title',
        body: async (_, frame) => {
          const money = (value: string | null) => {
            if (!value) return '—'
            const [amount, currency] = JSON.parse(value) as [unknown, unknown]
            return formatMoney(_, amount, currency)
          }
          const here = (path: string) => scoped(url, path)
          const timeZone = await timezoneOf(ctx, url, req)
          // The warehouse's own places keep their English seed names; the reader sees them in their language.
          const places = localizeGeneratedRecords(_, locations, 'location')
          return stockOverviewScreen(_, frame, {
            rows: figures.todo.map((row) => ({
              ...row,
              operationType:
                localizeGeneratedRecords(_, pickingTypes, 'pickingType').find(
                  (item) => item.id === row.pickingTypeId,
                )?.name ?? '—',
              kind: pickingTypes.find((item) => item.id === row.pickingTypeId)?.code ?? '',
              source: places.find((item) => item.id === row.locationId)?.name ?? '—',
              destination: places.find((item) => item.id === row.locationDestId)?.name ?? '—',
              scheduledDate: dateTimeLabel(row.scheduledDate, _.locale, timeZone),
              status: transferStatus(
                row.state,
                reservesStock(pickingTypes.find((item) => item.id === row.pickingTypeId)),
              ),
            })),
            tiles: figures.tiles.map((tile) => ({
              ...tile,
              value: tile.id === 'value' ? money(String(tile.value)) : String(tile.value),
              href: tile.href ? here(tile.href) : null,
            })),
            warehouses: figures.warehouses.map((row) => ({
              ...row,
              value: row.value === null ? null : money(row.value),
              href: here(`/admin/stock/inventory?warehouse=${encodeURIComponent(row.id)}`),
            })),
            warehouseChoices: [
              { id: '', name: _('stock_backend.overview.allWarehouses'), href: here('/admin/stock') },
              ...warehouses.map((row) => ({
                id: String(row.id),
                name: String(row.name),
                href: here(`/admin/stock?warehouse=${encodeURIComponent(String(row.id))}`),
              })),
            ].map((choice) => ({ ...choice, active: choice.id === warehouseId })),
            showValue: values !== null,
            at: (path) => inLocale(url, path),
            rowHref: (row) => transferHref(url, String(row.id)),
            cycles: cycles.filter((row) => !warehouseId || String(row.warehouseId) === warehouseId),
            cycleHref: (row) =>
              row.countingId
                ? recordModalHref(url, { kind: 'stock.countSession', id: String(row.countingId) })
                : recordModalHref(url, { kind: 'stock.warehouse', id: String(row.warehouseId) }),
            createHref: (await ctx.allows('stock.createPicking', url, req)) ? transferHref(url, null) : null,
          })
        },
      })
    },
  '/admin/stock/transfer/{id}/context': transferContext,
  '/admin/stock/count/{id}/context': inventoryCountContext,
  '/admin/stock/record/{kind}/{id}/context': stockConfigurationContext,
  '/admin/stock/inventory':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.requestInventoryCount',
          {
            id: randomUUID(),
            productId: form.productId ?? '',
            locationId: form.locationId ?? '',
            countedQuantity: form.countedQuantity || '0',
            ...(form.lotId ? { lotId: form.lotId } : {}),
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(
              recordModalHref(new URL('/admin/stock/counts', url), {
                kind: 'stock.countSession',
                id: String((result as AnyRow).id),
              }),
            )
          : seeOther(inLocale(url, '/admin/stock/inventory?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [quants, data, templates] = (await Promise.all([
        ctx.call('stock.listQuants', {}, url, req),
        common(ctx, url, req),
        ctx.call('stock.listStorableProducts', {}, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>, AnyRow[]]
      const products = templates.flatMap((template) =>
        (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : [])
          .filter((variant) => variant.active !== false)
          .map((variant) => ({
            value: String(variant.id),
            name: String(template.name),
            label: variant.defaultCode
              ? `${String(template.name)} · ${String(variant.defaultCode)}`
              : String(template.name),
            reference: String(variant.defaultCode ?? ''),
            templateId: String(template.id),
          })),
      )
      const productById = new Map(products.map((product) => [product.value, product]))
      const productHref = await productPageLink(ctx, url, req)
      const locationById = new Map(data.locations.map((location) => [String(location.id), location]))
      const lotById = new Map(data.lots.map((lot) => [String(lot.id), lot]))
      const now = Date.now()
      // K51: the overview's row of a warehouse opens its stock alone.
      const warehouse = url.searchParams.get('warehouse') ?? ''
      // K58: each row opens what moved it and its replenishment, for whoever may read them.
      const [readsHistory, readsRules] = await Promise.all([
        ctx.allows('stock.listMoveHistory', url, req),
        ctx.allows('stock.listOrderpoints', url, req),
      ])
      const rules = readsRules ? ((await ctx.call('stock.listOrderpoints', {}, url, req)) as AnyRow[]) : []
      const ruleAt = new Map(
        rules
          .filter((rule) => rule.active !== false)
          .map((rule) => [`${String(rule.productId)}|${String(rule.locationId)}`, String(rule.id)] as const),
      )
      // A rule of the row's product and place opens itself; otherwise the rules searched for the product.
      const replenishment = (quant: AnyRow, product: AnyRow | undefined) => {
        const ruleId = ruleAt.get(`${String(quant.productId)}|${String(quant.locationId)}`)
        return ruleId
          ? `/admin/stock/replenishment/${encodeURIComponent(ruleId)}`
          : `/admin/stock/replenishment?q=${encodeURIComponent(String(product?.reference || product?.name || ''))}`
      }
      // The day the goods came in where the company keeps its books, not where the server runs.
      const timeZone = await timezoneOf(ctx, url, req)
      const dateOf = (value: unknown) =>
        value
          ? formatDateTime(lang === 'vi' ? 'vi-VN' : 'en-US', new Date(String(value)), {
              dateStyle: 'short',
              timeZone,
            })
          : ''
      const rows = quants
        .filter((quant) =>
          ['internal', 'transit'].includes(String(locationById.get(String(quant.locationId))?.usage)),
        )
        .filter(
          (quant) =>
            !warehouse || String(locationById.get(String(quant.locationId))?.warehouseId) === warehouse,
        )
        .map((quant) => {
          const product = productById.get(String(quant.productId))
          const quantity = String(quant.quantity)
          const reserved = String(quant.reservedQuantity)
          const lot = quant.lotId ? lotById.get(String(quant.lotId)) : undefined
          // K28: an expired, removed or quarantined lot is still on hand but nothing may take it.
          const blocked = Boolean(quant.lotId) && !lotAvailable(lot, now)
          return {
            id: String(quant.id),
            product: product?.name ?? String(quant.productId),
            productHref: productHref(product?.templateId),
            reference: product?.reference ?? '',
            location: String(locationById.get(String(quant.locationId))?.name ?? quant.locationId),
            lot: String(lot?.name ?? ''),
            expiry: dateOf(lot?.expirationDate),
            blocked,
            inDate: dateOf(quant.inDate),
            historyHref: readsHistory
              ? inLocale(
                  url,
                  `/admin/stock/moves?q=${encodeURIComponent(String(lot?.name || product?.reference || product?.name || ''))}`,
                )
              : null,
            replenishHref: readsRules ? inLocale(url, replenishment(quant, product)) : null,
            quantity,
            reserved,
            available: blocked ? '0' : String(Number(quantity) - Number(reserved)),
          }
        })
      return adminPage(ctx, url, req, {
        title: 'stock_backend.inventory',
        body: async (_, frame) => {
          const search = await rowListSearch(ctx, url, req, {
            spec: inventoryListSearch,
            rows,
            frame,
            name: 'stock-inventory-filter',
            bodyId: 'stock-inventory-list',
            functions: stockSearchFunctions,
          })
          return inventoryScreen(
            _,
            {
              rows: search.rows,
              createHref: (await ctx.allows('stock.requestInventoryCount', url, req))
                ? recordModalCreateHref(url, { kind: 'stock.count' })
                : null,
              table: {
                ...(search.groups ? { groups: search.groups } : {}),
                rowHref: (row) => recordModalHref(url, { kind: 'stock.count', id: row.id }),
                // The row opens its count; the product's name inside it links to the
                // product (P24), so the row cannot also be an anchor around that name.
                rowLink: false,
              },
              lang: ctx.localeOf(url, req) === 'en' ? 'en' : 'vi',
              products: products.map(({ value, label }) => ({ value, label })),
              locations: options(data.locations.filter((row) => row.usage === 'internal')),
              inventoryLocations: options(data.locations.filter((row) => row.usage === 'inventory')),
              units: options(data.units),
              lots: options(data.lots),
              action: inLocale(url, '/admin/stock/inventory'),
              locationsHref: inLocale(url, '/admin/stock/locations'),
              applied: url.searchParams.has('applied'),
              errors: invalid(url, _),
            },
            search.frame,
          )
        },
      })
    },

  '/admin/stock/transfers':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const id = randomUUID()
        const result = await ctx.call(
          'stock.createPicking',
          {
            id,
            name: form.name || id,
            pickingTypeId: form.pickingTypeId ?? '',
            ...(form.scheduledDate ? { scheduledDate: form.scheduledDate } : {}),
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, `/admin/stock/transfers/${id}`))
          : seeOther(inLocale(url, '/admin/stock/transfers?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [pickings, data] = (await Promise.all([
        ctx.call('stock.listPickings', {}, url, req),
        common(ctx, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>]
      const locationsById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const pickingTypesById = new Map(data.pickingTypes.map((row) => [String(row.id), String(row.name)]))
      // Counts, adjustments and scrap post through operation types of their own that the stock
      // module creates as `internal`; they are not transfers anyone works through (K21).
      const pickingTypesByIdRow = new Map(data.pickingTypes.map((row) => [String(row.id), row]))
      const pickingTypeCode = new Map(
        data.pickingTypes.map((row) => [
          String(row.id),
          /:(adjustment|count|scrap)$/.test(String(row.id)) ? 'adjustment' : String(row.code),
        ]),
      )
      // K51: the warehouse a transfer belongs to, by its operation type, so the overview narrows to it.
      const warehouseNameById = new Map(data.warehouses.map((row) => [String(row.id), String(row.name)]))
      const warehouseByType = new Map(
        data.pickingTypes.map((row) => [
          String(row.id),
          warehouseNameById.get(String(row.warehouseId)) ?? '',
        ]),
      )
      return adminPage(ctx, url, req, {
        title: 'stock_backend.transfers',
        body: async (_, frame) => {
          const timeZone = await timezoneOf(ctx, url, req)
          const search = await rowListSearch(ctx, url, req, {
            spec: transferListSearch,
            frame,
            rows: pickings.map((row) => {
              // K18: the list reads and filters by the five statuses of the plan.
              const state = transferStatus(
                row.state,
                reservesStock(pickingTypesByIdRow.get(String(row.pickingTypeId))),
              )
              return {
                id: String(row.id),
                name: String(row.name),
                operationType: pickingTypesById.get(String(row.pickingTypeId)) ?? String(row.pickingTypeId),
                kind: pickingTypeCode.get(String(row.pickingTypeId)) ?? '',
                warehouse: warehouseByType.get(String(row.pickingTypeId)) ?? '',
                source: locationsById.get(String(row.locationId)) ?? String(row.locationId),
                destination: locationsById.get(String(row.locationDestId)) ?? String(row.locationDestId),
                scheduledDate: dateTimeLabel(row.scheduledDate, lang, timeZone),
                queue: transferQueueOrder({ ...row, state }),
                state,
                priority: row.priority === true,
                href: transferHref(url, String(row.id)),
              }
            }),
            name: 'stock-transfer-filter',
            bodyId: 'stock-transfer-list',
            functions: stockSearchFunctions,
            labels: { searchPlaceholder: _('stock_backend.transfers') },
            groupLabel: (key, value) => stockGroupLabel(_, key, value),
          })
          // K60: transfers waiting for goods reserve several at once, priority first.
          const bulk = await ctx.allows('stock.reservePickings', url, req)
          // Opened on one kind's queue, the list is headed by that queue's name (K21).
          const kinds = url.searchParams
            .getAll('preset')
            .flatMap((preset) => Object.entries(TRANSFER_KINDS).filter(([, key]) => key === preset))
          const queueTitle =
            kinds.length === 1
              ? _(`stock_backend.menu.${QUEUE_LABELS[kinds[0]![0] as keyof typeof QUEUE_LABELS]}`)
              : null
          return transfersListScreen(
            _,
            {
              rows: search.rows,
              ...(queueTitle ? { title: queueTitle } : {}),
              table: {
                ...(search.groups ? { groups: search.groups } : {}),
                ...(bulk
                  ? {
                      selection: {
                        formId: 'stock-transfer-bulk',
                        action: inLocale(url, '/admin/stock/transfers/bulk'),
                        hidden: { returnTo: `${url.pathname}${url.search}` },
                        actions: [{ id: 'reserve', label: _('stock_backend.action.assign') }],
                      },
                    }
                  : {}),
              },
              createHref: (await ctx.allows('stock.createPicking', url, req))
                ? transferHref(url, null)
                : null,
            },
            search.frame,
          )
        },
      })
    },

  '/admin/stock/transfers/bulk':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      const ids = Object.keys(form)
        .filter((key) => key.startsWith('selected.'))
        .map((key) => key.slice('selected.'.length))
        .filter(Boolean)
      const fallback = inLocale(url, '/admin/stock/transfers')
      const requested = new URL(form.returnTo || fallback, 'http://ket.local')
      const returnTo =
        requested.pathname === '/admin/stock/transfers'
          ? `${requested.pathname}${requested.search}`
          : fallback
      if (!ids.length) return seeOther(returnTo)
      if (form.action !== 'reserve') return text('Unknown bulk action', { status: 400 })
      const result = (await ctx.call('stock.reservePickings', { ids }, url, req)) as { ok?: boolean }
      if (result.ok === false) return text('Invalid bulk selection', { status: 400 })
      return seeOther(returnTo)
    },

  // K65: an operation's printed copy, a page of its own printed with the browser. `?values=1` asks for
  // the copy with values, which only a done operation has and only a stock value reader may read.
  '/admin/stock/count-session/{id}/print':
    (ctx): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const source =
        url.searchParams.get('values') === '1' ? 'stock.getValuedCountReport' : 'stock.getCountReport'
      if (!(await ctx.allows(source, url, req))) return text('Forbidden', { status: 403 })
      const data = (await ctx.call(source, { id: params.id }, url, req)) as AnyRow | null
      if (!data) return text(_('stock_backend.print.missing'), { status: 404 })
      const query = new URLSearchParams(
        [...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
      )
      const back = recordModalHref(new URL(`/admin/stock/counts?${query}`, url), {
        kind: 'stock.countSession',
        id: params.id,
      })
      return backendPage(ctx, req, {
        lang,
        title: `${_('stock_backend.count.minutesTitle')} ${String(data.name)}`,
        body: CountPrint({ _, data, back }),
      })
    },

  '/admin/stock/transfers/{id}/print':
    (ctx): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const valued = url.searchParams.get('values') === '1'
      const keep = new URLSearchParams(
        [...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)),
      )
      const back = `/admin/stock/transfers/${encodeURIComponent(params.id)}${keep.size ? `?${keep}` : ''}`
      // The picking's kind picks the voucher; a source refuses a picking of another kind, so trying each
      // allowed one finds the copy without reading the picking twice.
      let data: AnyRow | null = null
      for (const prints of Object.values(PICKING_PRINTS)) {
        const source = valued ? prints.valued.source : prints.plain.source
        if (!(await ctx.allows(source, url, req))) continue
        data = (await ctx.call(source, { id: params.id }, url, req)) as AnyRow | null
        if (data) break
      }
      if (!data) return text(_('stock_backend.print.missing'), { status: 404 })
      // The copy names the warehouse's own places in the reader's language, as every stock screen does.
      const [source, destination] = localizeGeneratedRecords(
        _,
        [data.source as AnyRow, data.destination as AnyRow],
        'location',
      )
      data = { ...data, source, destination }
      return backendPage(ctx, req, {
        lang,
        title: `${_(String((data.voucher as AnyRow).title))} ${String(data.name)}`,
        body: TransferPrint({ _, data, back }),
      })
    },

  // The only way a transfer opens: the list, its create button and every link lead here.
  '/admin/stock/transfers/{id}': transferPageRoute,

  '/admin/stock/warehouses':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.saveWarehouse',
          {
            id: randomUUID(),
            name: form.name ?? '',
            code: form.code ?? '',
            receptionSteps: form.receptionSteps || 'one_step',
            deliverySteps: form.deliverySteps || 'ship_only',
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/stock/warehouses'))
          : seeOther(createModalErrorHref(url, '/admin/stock/warehouses'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      if (!(await ctx.allows('stock.listWarehouses', url, req))) return text('Forbidden', { status: 403 })
      const rows = (await ctx.call('stock.listWarehouses', {}, url, req)) as AnyRow[]
      const [locations, pickings, pickingTypes] = await Promise.all([
        optionalRead<AnyRow[] | null>(ctx, 'stock.listLocations', {}, url, req, null),
        optionalRead<AnyRow[] | null>(ctx, 'stock.listPickings', {}, url, req, null),
        optionalRead<AnyRow[] | null>(ctx, 'stock.listPickingTypes', {}, url, req, null),
      ])
      const pickingWarehouse = new Map(
        (pickingTypes ?? []).map((type) => [String(type.id), type.warehouseId]),
      )
      return adminPage(ctx, url, req, {
        title: 'stock_backend.warehouses',
        body: async (_, frame) => {
          const collection = inLocale(url, '/admin/stock/warehouses')
          const search = await rowListSearch(ctx, url, req, {
            spec: warehouseListSearch,
            frame,
            rows: rows.map((row) => ({
              id: String(row.id),
              name: String(row.name),
              code: String(row.code),
              receptionSteps: String(row.receptionSteps),
              deliverySteps: String(row.deliverySteps),
              locationCount: locations?.filter((location) => location.warehouseId === row.id).length ?? null,
              transferCount:
                pickings && pickingTypes
                  ? pickings.filter(
                      (picking) => pickingWarehouse.get(String(picking.pickingTypeId)) === row.id,
                    ).length
                  : null,
            })),
            name: 'stock-warehouse-filter',
            bodyId: 'stock-warehouse-list',
            functions: stockSearchFunctions,
            labels: { searchPlaceholder: _('stock_backend.warehouses') },
            groupLabel: (key, value) => stockGroupLabel(_, key, value),
          })
          const list = warehousesListScreen(
            _,
            {
              rows: search.rows,
              table: {
                ...(search.groups ? { groups: search.groups } : {}),
                rowHref: (row) => recordModalHref(url, { kind: 'stock.warehouse', id: String(row.id) }),
              },
              createHref: (await ctx.allows('stock.saveWarehouse', url, req))
                ? recordModalCreateHref(url, { kind: 'stock.warehouse' })
                : null,
            },
            search.frame,
          )
          return createModalOpen(url)
            ? modalWorkspace(
                list,
                warehouseCreateModal(_, {
                  action: inLocale(url, '/admin/stock/warehouses/new'),
                  cancelHref: collection,
                  errors: invalid(url, _),
                }),
              )
            : list
        },
      })
    },

  '/admin/stock/warehouses/new':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.saveWarehouse',
          {
            id: randomUUID(),
            name: form.name ?? '',
            code: form.code ?? '',
            receptionSteps: form.receptionSteps || 'one_step',
            deliverySteps: form.deliverySteps || 'ship_only',
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/stock/warehouses'))
          : seeOther(createModalErrorHref(url, '/admin/stock/warehouses'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return seeOther(createModalHref(url, '/admin/stock/warehouses'))
    },

  '/admin/stock/locations':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.saveLocation',
          {
            id: randomUUID(),
            name: form.name ?? '',
            usage: form.usage || 'internal',
            ...(form.parentId ? { parentId: form.parentId } : {}),
            ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/stock/locations'))
          : seeOther(createModalErrorHref(url, '/admin/stock/locations'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      if (!(await ctx.allows('stock.listLocations', url, req))) return text('Forbidden', { status: 403 })
      const data = await common(ctx, url, req)
      const quants = await optionalRead<AnyRow[] | null>(ctx, 'stock.listQuants', {}, url, req, null)
      const nameById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const warehouseById = new Map(data.warehouses.map((row) => [String(row.id), String(row.name)]))
      return adminPage(ctx, url, req, {
        title: 'stock_backend.locations',
        body: async (_, frame) => {
          const collection = inLocale(url, '/admin/stock/locations')
          const search = await rowListSearch(ctx, url, req, {
            spec: locationListSearch,
            frame,
            rows: data.locations.map((row) => ({
              id: String(row.id),
              completeName: completeLocationName(row, nameById),
              parentLocation: row.parentId
                ? completeLocationName(
                    data.locations.find((location) => location.id === row.parentId) ?? {
                      parentPath: '',
                      name: '',
                    },
                    nameById,
                  )
                : '',
              productCount: quants
                ? new Set(
                    quants
                      .filter((quant) => quant.locationId === row.id && Number(quant.quantity) > 0)
                      .map((quant) => quant.productId),
                  ).size
                : null,
              usage: String(row.usage),
              warehouse: warehouseById.get(String(row.warehouseId)) ?? '',
            })),
            name: 'stock-location-filter',
            bodyId: 'stock-location-list',
            functions: stockSearchFunctions,
            labels: { searchPlaceholder: _('stock_backend.locations') },
            groupLabel: (key, value) => stockGroupLabel(_, key, value),
          })
          const list = locationsListScreen(
            _,
            {
              rows: search.rows,
              table: {
                ...(search.groups ? { groups: search.groups } : {}),
                rowHref: (row) => recordModalHref(url, { kind: 'stock.location', id: String(row.id) }),
              },
              createHref: (await ctx.allows('stock.saveLocation', url, req))
                ? recordModalCreateHref(url, { kind: 'stock.location' })
                : null,
            },
            search.frame,
          )
          if (!createModalOpen(url)) return list
          return modalWorkspace(
            list,
            locationCreateModal(_, {
              warehouses: options(data.warehouses),
              parents: data.locations.map((row) => ({
                value: String(row.id),
                label: completeLocationName(row, nameById),
              })),
              action: inLocale(url, '/admin/stock/locations/new'),
              cancelHref: collection,
              errors: invalid(url, _),
            }),
          )
        },
      })
    },

  '/admin/stock/locations/new':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.saveLocation',
          {
            id: randomUUID(),
            name: form.name ?? '',
            usage: form.usage || 'internal',
            ...(form.parentId ? { parentId: form.parentId } : {}),
            ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/stock/locations'))
          : seeOther(createModalErrorHref(url, '/admin/stock/locations'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return seeOther(createModalHref(url, '/admin/stock/locations'))
    },

  '/admin/stock/picking-types':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.savePickingType',
          {
            id: randomUUID(),
            name: form.name ?? '',
            code: form.code || 'internal',
            ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
            ...(form.defaultLocationSrcId ? { defaultLocationSrcId: form.defaultLocationSrcId } : {}),
            ...(form.defaultLocationDestId ? { defaultLocationDestId: form.defaultLocationDestId } : {}),
            createBackorder: form.createBackorder || 'ask',
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/stock/picking-types'))
          : seeOther(createModalErrorHref(url, '/admin/stock/picking-types'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      if (!(await ctx.allows('stock.listPickingTypes', url, req))) return text('Forbidden', { status: 403 })
      const data = await common(ctx, url, req)
      const rawLocationNameById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const completeLocationNameById = new Map(
        data.locations.map((row) => [String(row.id), completeLocationName(row, rawLocationNameById)]),
      )
      const warehouseById = new Map(data.warehouses.map((row) => [String(row.id), String(row.name)]))
      return adminPage(ctx, url, req, {
        title: 'stock_backend.pickingTypes',
        body: async (_, frame) => {
          const collection = inLocale(url, '/admin/stock/picking-types')
          const search = await rowListSearch(ctx, url, req, {
            spec: pickingTypeListSearch,
            frame,
            rows: data.pickingTypes.map((row) => ({
              id: String(row.id),
              name: String(row.name),
              code: String(row.code),
              warehouse: warehouseById.get(String(row.warehouseId)) ?? '',
              source: completeLocationNameById.get(String(row.defaultLocationSrcId)) ?? '',
              destination: completeLocationNameById.get(String(row.defaultLocationDestId)) ?? '',
              createBackorder: String(row.createBackorder ?? 'ask'),
            })),
            name: 'stock-picking-type-filter',
            bodyId: 'stock-picking-type-list',
            functions: stockSearchFunctions,
            labels: { searchPlaceholder: _('stock_backend.pickingTypes') },
            groupLabel: (key, value) => stockGroupLabel(_, key, value),
          })
          const list = pickingTypesListScreen(
            _,
            {
              rows: search.rows,
              table: {
                ...(search.groups ? { groups: search.groups } : {}),
                rowHref: (row) => recordModalHref(url, { kind: 'stock.pickingType', id: String(row.id) }),
              },
              createHref: (await ctx.allows('stock.savePickingType', url, req))
                ? recordModalCreateHref(url, { kind: 'stock.pickingType' })
                : null,
            },
            search.frame,
          )
          if (!createModalOpen(url)) return list
          return modalWorkspace(
            list,
            pickingTypeCreateModal(_, {
              warehouses: options(data.warehouses),
              locations: data.locations.map((row) => ({
                value: String(row.id),
                label: completeLocationNameById.get(String(row.id)) ?? String(row.name),
              })),
              action: inLocale(url, '/admin/stock/picking-types/new'),
              cancelHref: collection,
              errors: invalid(url, _),
            }),
          )
        },
      })
    },

  '/admin/stock/picking-types/new':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.savePickingType',
          {
            id: randomUUID(),
            name: form.name ?? '',
            code: form.code || 'internal',
            ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
            ...(form.defaultLocationSrcId ? { defaultLocationSrcId: form.defaultLocationSrcId } : {}),
            ...(form.defaultLocationDestId ? { defaultLocationDestId: form.defaultLocationDestId } : {}),
            createBackorder: form.createBackorder || 'ask',
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/stock/picking-types'))
          : seeOther(createModalErrorHref(url, '/admin/stock/picking-types'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return seeOther(createModalHref(url, '/admin/stock/picking-types'))
    },

  '/admin/stock/lots':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.createLot',
          {
            id: randomUUID(),
            productId: form.productId ?? '',
            name: form.name ?? '',
            ref: form.ref || null,
            note: form.note || null,
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/stock/lots'))
          : seeOther(createModalErrorHref(url, '/admin/stock/lots'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [lots, products, locations, quants] = (await Promise.all([
        ctx.call('stock.listLots', {}, url, req),
        ctx.call('stock.listStorableProducts', {}, url, req),
        ctx.call('stock.listLocations', {}, url, req),
        ctx.call('stock.listQuants', {}, url, req),
      ])) as [AnyRow[], AnyRow[], AnyRow[], AnyRow[]]
      const productOptions = lotProductOptions(products)
      const productById = new Map(productOptions.map((product) => [product.value, product.label]))
      const stockLocationIds = new Set(
        locations
          .filter((location) => ['internal', 'transit'].includes(String(location.usage)))
          .map((location) => String(location.id)),
      )
      const onHandByLot = new Map<string, number>()
      // K51: the warehouses holding some of each lot, by name.
      const warehouseOfLocation = new Map(
        locations.map((row) => [String(row.id), String(row.warehouseId ?? '')]),
      )
      const warehouseNames = new Map(
        ((await optionalRead<AnyRow[]>(ctx, 'stock.listWarehouses', {}, url, req, [])) ?? []).map((row) => [
          String(row.id),
          String(row.name),
        ]),
      )
      const warehousesByLot = new Map<string, Set<string>>()
      for (const quant of quants) {
        const lotId = String(quant.lotId ?? '')
        if (!lotId || !stockLocationIds.has(String(quant.locationId))) continue
        onHandByLot.set(lotId, (onHandByLot.get(lotId) ?? 0) + Number(quant.quantity ?? 0))
        const warehouse = warehouseNames.get(warehouseOfLocation.get(String(quant.locationId)) ?? '')
        if (warehouse && Number(quant.quantity) > 0)
          warehousesByLot.set(lotId, (warehousesByLot.get(lotId) ?? new Set()).add(warehouse))
      }
      const number = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
        maximumFractionDigits: 6,
      })
      const now = Date.now()
      // A lot expires on a day where the company keeps its books, not where the server runs.
      const timeZone = await timezoneOf(ctx, url, req)
      return adminPage(ctx, url, req, {
        title: 'stock_backend.lots',
        body: async (_, frame) => {
          const collection = inLocale(url, '/admin/stock/lots')
          const search = await rowListSearch(ctx, url, req, {
            spec: lotListSearch,
            frame,
            rows: lots.map((row) => ({
              id: String(row.id),
              name: String(row.name),
              product: productById.get(String(row.productId)) ?? String(row.productId),
              reference: String(row.ref ?? ''),
              onHand: number.format(onHandByLot.get(String(row.id)) ?? 0),
              onHandValue: onHandByLot.get(String(row.id)) ?? 0,
              active: row.active !== false,
              condition: lotCondition(row, onHandByLot.get(String(row.id)) ?? 0, now),
              warehouses: [...(warehousesByLot.get(String(row.id)) ?? [])].sort().join(', '),
              expiry: row.expirationDate
                ? formatDateTime(lang === 'vi' ? 'vi-VN' : 'en-US', new Date(String(row.expirationDate)), {
                    dateStyle: 'short',
                    timeZone,
                  })
                : '',
              href: inLocale(url, `/admin/stock/lots/${String(row.id)}`),
            })),
            name: 'stock-lot-filter',
            bodyId: 'stock-lot-list',
            functions: stockSearchFunctions,
            labels: { searchPlaceholder: _('stock_backend.lots') },
            groupLabel: (key, value) => stockGroupLabel(_, key, value),
          })
          const list = lotsListScreen(
            _,
            {
              rows: search.rows,
              table: {
                ...(search.groups ? { groups: search.groups } : {}),
                rowHref: (row) => recordModalHref(url, { kind: 'stock.lot', id: String(row.id) }),
              },
              createHref: (await ctx.allows('stock.saveLot', url, req))
                ? recordModalCreateHref(url, { kind: 'stock.lot' })
                : null,
            },
            search.frame,
          )
          return createModalOpen(url)
            ? modalWorkspace(
                list,
                lotCreateModal(_, {
                  products: productOptions,
                  action: inLocale(url, '/admin/stock/lots/new'),
                  cancelHref: collection,
                  errors: invalid(url, _),
                }),
              )
            : list
        },
      })
    },

  '/admin/stock/lots/new':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.createLot',
          {
            id: randomUUID(),
            productId: form.productId ?? '',
            name: form.name ?? '',
            ref: form.ref || null,
            note: form.note || null,
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/stock/lots'))
          : seeOther(createModalErrorHref(url, '/admin/stock/lots'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return seeOther(recordModalCreateHref(inLocale(url, '/admin/stock/lots'), { kind: 'stock.lot' }))
    },

  '/admin/stock/lots/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const here = inLocale(url, `/admin/stock/lots/${params.id}`)
      const partial = req.headers['x-ket-partial'] === 'stock-lot'
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      const lots = (await ctx.call('stock.listLots', {}, url, req)) as AnyRow[]
      let current = lots.find((row) => String(row.id) === params.id)
      if (!current) return text(_('stock_backend.lot.error.notFound'), { status: 404 })
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const values = {
          productId: form.productId ?? '',
          name: form.name ?? '',
          ref: form.ref || null,
          note: form.note || null,
        }
        const result = await ctx.call(
          'stock.saveLot',
          {
            id: params.id,
            ...values,
          },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('stock_backend.error.invalid'), errors: errorsOf(result) },
              { status: 422 },
            )
          return seeOther(`${here}${here.includes('?') ? '&' : '?'}invalid=1`)
        }
        if (!partial) return seeOther(here)
        current = { ...current, ...values }
      }
      const title = String(current.name)
      const island = await ctx.joint(url, req, 'stock_backend:lot.page', {
        id: params.id,
        title,
        loading: _('backend.relation.loading'),
        back: inLocale(url, '/admin/stock/lots'),
        width: 'wide',
      })
      const collaboration = await ctx.joint(url, req, 'stock_backend:lot.collaboration', {
        resModel: 'stock.Lot',
        resId: params.id,
        lang,
      })
      return backendPage(ctx, req, {
        lang,
        title,
        body: lotPageScreen(
          _,
          title,
          island,
          await frameOf(ctx, url, req),
          lang === 'en' ? 'en' : 'vi',
          collaboration,
        ),
      })
    },

  '/admin/stock/routes':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const id = randomUUID()
        const result = await ctx.call(
          'stock.saveRoute',
          { id, name: form.name ?? '', sequence: Number(form.sequence || 10) },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, `/admin/stock/routes/${id}`))
          : seeOther(createModalErrorHref(url, '/admin/stock/routes'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [rows, rules] = (await Promise.all([
        ctx.call('stock.listRoutes', {}, url, req),
        ctx.call('stock.listRules', {}, url, req),
      ])) as [AnyRow[], AnyRow[]]
      const locations = await optionalRead<AnyRow[]>(ctx, 'stock.listLocations', {}, url, req, [])
      const locationNames = new Map(locations.map((location) => [String(location.id), String(location.name)]))
      const ruleValues = (routeId: string, key: string) =>
        [
          ...new Set(
            rules
              .filter((rule) => String(rule.routeId) === routeId)
              .map((rule) => {
                const value = String(rule[key] ?? '')
                return key === 'action'
                  ? selectionLabel(_, 'ruleAction', value)
                  : (locationNames.get(value) ?? '')
              })
              .filter(Boolean),
          ),
        ].join(' · ')
      const ruleCountByRoute = new Map<string, number>()
      for (const rule of rules) {
        const routeId = String(rule.routeId)
        ruleCountByRoute.set(routeId, (ruleCountByRoute.get(routeId) ?? 0) + 1)
      }
      return adminPage(ctx, url, req, {
        title: 'stock_backend.routes',
        body: async (_, frame) => {
          const collection = inLocale(url, '/admin/stock/routes')
          const search = await rowListSearch(ctx, url, req, {
            spec: stockRouteListSearch,
            frame,
            rows: rows.map((row) => ({
              id: String(row.id),
              name: localizedGeneratedRouteName(_, row),
              sequence: Number(row.sequence),
              sources: ruleValues(String(row.id), 'locationSrcId'),
              destinations: ruleValues(String(row.id), 'locationDestId'),
              ruleActions: ruleValues(String(row.id), 'action'),
              ruleCount: ruleCountByRoute.get(String(row.id)) ?? 0,
              href: inLocale(url, `/admin/stock/routes/${String(row.id)}`),
            })),
            name: 'stock-route-filter',
            bodyId: 'stock-route-list',
            functions: stockSearchFunctions,
            labels: { searchPlaceholder: _('stock_backend.routes') },
            groupLabel: (key, value) => stockGroupLabel(_, key, value),
          })
          const list = stockRoutesListScreen(
            _,
            {
              rows: search.rows,
              table: {
                ...(search.groups ? { groups: search.groups } : {}),
                rowHref: (row) => recordModalHref(url, { kind: 'stock.route', id: String(row.id) }),
              },
              createHref: (await ctx.allows('stock.saveRoute', url, req))
                ? recordModalCreateHref(url, { kind: 'stock.route' })
                : null,
            },
            search.frame,
          )
          return createModalOpen(url)
            ? modalWorkspace(
                list,
                stockRouteCreateModal(_, {
                  action: inLocale(url, '/admin/stock/routes/new'),
                  cancelHref: collection,
                  errors: invalid(url, _),
                }),
              )
            : list
        },
      })
    },

  '/admin/stock/routes/new':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const id = randomUUID()
        const result = await ctx.call(
          'stock.saveRoute',
          { id, name: form.name ?? '', sequence: Number(form.sequence || 10) },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, `/admin/stock/routes/${id}`))
          : seeOther(createModalErrorHref(url, '/admin/stock/routes'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return seeOther(createModalHref(url, '/admin/stock/routes'))
    },

  '/admin/stock/routes/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      const routes = (await ctx.call('stock.listRoutes', {}, url, req)) as AnyRow[]
      const route = routes.find((row) => row.id === params.id)
      if (!route) return text('Route not found', { status: 404 })
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        if (form.intent === 'route') {
          const displayName = localizedGeneratedRouteName(ctx.translate(ctx.localeOf(url, req)), route)
          const submittedName = form.name ?? ''
          const result = await ctx.call(
            'stock.saveRoute',
            {
              id: params.id,
              name: submittedName === displayName ? String(route.name) : submittedName,
              sequence: Number(form.sequence || 10),
            },
            url,
            req,
          )
          const target = inLocale(url, `/admin/stock/routes/${params.id}`)
          return (result as { ok?: boolean }).ok
            ? seeOther(target)
            : seeOther(`${target}${target.includes('?') ? '&' : '?'}invalid=route`)
        }
        const result = await ctx.call(
          'stock.saveRule',
          {
            id: randomUUID(),
            name: form.name ?? '',
            routeId: params.id,
            action: form.action || 'pull',
            sequence: Number(form.sequence || 20),
            ...(form.locationSrcId ? { locationSrcId: form.locationSrcId } : {}),
            locationDestId: form.locationDestId ?? '',
            pickingTypeId: form.pickingTypeId ?? '',
            procureMethod: form.procureMethod || 'make_to_stock',
          },
          url,
          req,
        )
        const target = inLocale(url, `/admin/stock/routes/${params.id}`)
        return (result as { ok?: boolean }).ok
          ? seeOther(target)
          : seeOther(`${target}${target.includes('?') ? '&' : '?'}invalid=rule`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const [rules, data] = (await Promise.all([
        ctx.call('stock.listRules', { routeId: params.id }, url, req),
        common(ctx, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>]
      const locationById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const pickingTypeById = new Map(data.pickingTypes.map((row) => [String(row.id), String(row.name)]))
      return adminPage(ctx, url, req, {
        title: 'stock_backend.routeDetail',
        body: (_, frame) =>
          stockRouteDetailScreen(
            _,
            {
              route: {
                id: String(route.id),
                name: localizedGeneratedRouteName(_, route),
                sequence: Number(route.sequence),
                active: route.active !== false,
              },
              rows: rules.map((row) => ({
                id: String(row.id),
                name: localizedGeneratedRuleName(_, row),
                action: String(row.action),
                actionLabel: selectionLabel(_, 'ruleAction', row.action),
                sequence: Number(row.sequence),
                source: row.locationSrcId
                  ? (locationById.get(String(row.locationSrcId)) ?? String(row.locationSrcId))
                  : '—',
                destination: locationById.get(String(row.locationDestId)) ?? String(row.locationDestId),
                operationType: pickingTypeById.get(String(row.pickingTypeId)) ?? String(row.pickingTypeId),
                procureMethod: selectionLabel(_, 'procureMethod', row.procureMethod),
              })),
              locations: options(data.locations),
              pickingTypes: options(data.pickingTypes),
              action: inLocale(url, `/admin/stock/routes/${params.id}`),
              routeErrors:
                url.searchParams.get('invalid') === 'route' ? [_('stock_backend.error.invalid')] : undefined,
              ruleErrors:
                url.searchParams.get('invalid') === 'rule' ? [_('stock_backend.error.invalid')] : undefined,
            },
            frame,
          ),
      })
    },

  '/admin/stock/valuation': valuationRoute,
  '/admin/stock/accounting': accountingRoute,
  '/admin/stock/valuation/data': valuationDataRoute,
  '/admin/stock/analysis': moveAnalysisRoute,
  '/admin/stock/analysis/data': moveAnalysisDataRoute,
  '/admin/stock/moves': moveHistoryRoute,
  '/admin/stock/moves/data': moveHistoryDataRoute,
  '/admin/stock/aging': agingRoute,
  '/admin/stock/aging/data': agingDataRoute,
  '/admin/stock/scraps': scrapsRoute,
  '/admin/stock/scraps/data': scrapsDataRoute,
  '/admin/stock/scrap/{id}/context': scrapContext,
  '/admin/stock/landed-costs': landedCostsRoute,
  '/admin/stock/landed-costs/data': landedCostsDataRoute,
  '/admin/stock/landed-costs/{id}': landedCostPageRoute,
  '/admin/stock/landed-cost/{id}/context': landedCostContext,
  // K45–K48: shipping on the books.
  '/admin/stock/delivery': deliveryOverviewRoute,
  '/admin/stock/delivery/dispatch': deliveryListRoute('dispatch'),
  '/admin/stock/delivery/dispatch/data': deliveryDataRoute('dispatch'),
  '/admin/stock/shipments': deliveryListRoute('shipments'),
  '/admin/stock/shipments/data': deliveryDataRoute('shipments'),
  '/admin/stock/shipments/{id}': deliveryRecordRoute('shipment'),
  '/admin/stock/shipment/{id}/context': shipmentContext,
  '/admin/stock/delivery-statements': deliveryListRoute('statements'),
  '/admin/stock/delivery-statements/data': deliveryDataRoute('statements'),
  '/admin/stock/delivery-statements/{id}': deliveryRecordRoute('statement'),
  '/admin/stock/delivery-statement/{id}/context': deliveryStatementContext,
  '/admin/stock/carriers': deliveryListRoute('carriers'),
  '/admin/stock/carriers/data': deliveryDataRoute('carriers'),
  '/admin/stock/counts': countsRoute,
  '/admin/stock/counts/data': countsDataRoute,
  '/admin/stock/count-session/{id}/context': countSessionContext,
  '/admin/stock/replenishment': replenishmentCollectionRoute,
  '/admin/stock/replenishment/data': replenishmentDataRoute,
  '/admin/stock/replenishment/new': replenishmentRecordRoute,
  '/admin/stock/replenishment/{id}': replenishmentRecordRoute,

  '/admin/stock/replenishment/{id}/run':
    (ctx): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      const result = await ctx.call(
        'stock.runOrderpoint',
        { id: params.id, moveId: `${params.id}:${randomUUID()}` },
        url,
        req,
      )
      return resultRedirect(result, inLocale(url, '/admin/stock/replenishment'))
    },

  // K40: the forecast list, its paged read and the forecast of one product in one warehouse.
  '/admin/stock/forecast':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      if (!(await ctx.allows('stock.getForecastCollection', url, req)))
        return text('Forbidden', { status: 403 })
      return adminPage(ctx, url, req, {
        title: 'stock_backend.forecast',
        body: (_, frame) => forecastCollectionScreen(_, frame, url),
      })
    },
  '/admin/stock/forecast/data': forecastDataRoute,
  '/admin/stock/forecast/{warehouseId}/{productId}': forecastDetailRoute,
}
