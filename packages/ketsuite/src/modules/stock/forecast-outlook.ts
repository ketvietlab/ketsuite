import { from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { civilDate } from '../company/civil-date.ts'
import { lotAvailable } from './lot-policy.ts'
import { companyToday } from './reservation-policy.ts'
import { ours } from './scope.ts'
import type { MakeReplenishment } from './replenishment-policy.ts'

/**
 * K40: the stock forecast of a product in a warehouse. What the warehouse holds that may leave
 * (`usable`) is its stock less expired or quarantined lots (`blocked`). Each confirmed operation then
 * counts on the day it is due, one overdue from today, in that order, with what is left after it;
 * the first day that falls below zero is when the product runs short. Draft receipts and transfers
 * into the warehouse are on order: they are listed but do not enter the forecast until confirmed.
 */
export const forecastReads = [
  'read:stock.Warehouse',
  'read:stock.Location',
  'read:stock.Quant',
  'read:stock.Lot',
  'read:stock.Move',
  'read:stock.Picking',
  'read:stock.PickingType',
  'read:stock.Orderpoint',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:company.Company',
]

export const FORECAST_STATUSES = ['short', 'belowMin', 'ok'] as const
export type ForecastStatus = (typeof FORECAST_STATUSES)[number]

export type ForecastEvent = {
  moveId: string
  pickingId: string
  pickingName: string
  /** Receipt, delivery, an internal transfer into or out of the warehouse, or a draft order to make it. */
  kind: 'in' | 'out' | 'transferIn' | 'transferOut' | 'make'
  /** A draft that is not a transfer opens its own page (P12). */
  href?: string
  /** The other end of the move: where the goods come from or go to. */
  party: string
  /** The scheduled day; an overdue operation counts from today. */
  date: string
  day: string
  late: boolean
  quantity: number
  balance?: number
}

export type ForecastLine = {
  warehouseId: string
  warehouse: string
  productId: string
  productCode: string
  productName: string
  uom: string
  usable: number
  blocked: number
  incoming: number
  outgoing: number
  forecast: number
  onOrder: number
  shortDate: string
  /** The operation after which the product first runs short. */
  shortPicking: { id: string; name: string } | null
  /** The warehouse's reorder rule for the product, if it keeps one (K39). */
  rule: { id: string; location: string; minQuantity: number; maxQuantity: number } | null
  status: ForecastStatus
  events: ForecastEvent[]
  drafts: ForecastEvent[]
}

const OPEN = (move: Row) => !['done', 'cancel'].includes(String(move.state))
const at = (warehouseId: unknown, productId: unknown) => `${String(warehouseId)}|${String(productId)}`

export async function forecastLines(
  ctx: Ctx,
  filter: { warehouseId?: string; productId?: string } = {},
  make?: MakeReplenishment,
): Promise<{ today: string; lines: ForecastLine[] }> {
  const { today, zone } = await companyToday(ctx)
  const now = Date.now()
  const byProduct = filter.productId ? { productId: filter.productId } : {}
  const [warehouses, locations, quants, lots, moves, pickings, types, points] = await Promise.all([
    ours(ctx, 'stock.Warehouse'),
    ours(ctx, 'stock.Location'),
    ours(ctx, 'stock.Quant', byProduct),
    ours(ctx, 'stock.Lot', byProduct),
    ours(ctx, 'stock.Move', byProduct),
    ours(ctx, 'stock.Picking'),
    ours(ctx, 'stock.PickingType'),
    ours(ctx, 'stock.Orderpoint', byProduct),
  ])
  const active = new Map(
    warehouses
      .filter((row) => row.active !== false && (!filter.warehouseId || row.id === filter.warehouseId))
      .map((row) => [String(row.id), row]),
  )
  // A warehouse's stock is what sits in its internal and transit locations, as the inventory reads it.
  const warehouseOf = new Map(
    locations
      .filter(
        (row) => ['internal', 'transit'].includes(String(row.usage)) && active.has(String(row.warehouseId)),
      )
      .map((row) => [String(row.id), String(row.warehouseId)]),
  )
  const locationName = new Map(locations.map((row) => [String(row.id), String(row.name)]))
  const lotById = new Map(lots.map((row) => [String(row.id), row]))
  const pickingById = new Map(pickings.map((row) => [String(row.id), row]))
  const typeById = new Map(types.map((row) => [String(row.id), row]))

  const usable = new Map<string, number>()
  const blocked = new Map<string, number>()
  for (const quant of quants) {
    const warehouseId = warehouseOf.get(String(quant.locationId))
    if (!warehouseId) continue
    const key = at(warehouseId, quant.productId)
    const target = !quant.lotId || lotAvailable(lotById.get(String(quant.lotId)), now) ? usable : blocked
    target.set(key, (target.get(key) ?? 0) + Number(quant.quantity))
  }

  const events = new Map<string, ForecastEvent[]>()
  const drafts = new Map<string, ForecastEvent[]>()
  for (const move of moves.filter(OPEN)) {
    const source = warehouseOf.get(String(move.locationId))
    const destination = warehouseOf.get(String(move.locationDestId))
    if (source === destination) continue
    const picking = pickingById.get(String(move.pickingId))
    const code = String(typeById.get(String(picking?.pickingTypeId))?.code ?? '')
    // A move outside any transfer has no scheduled day: it is due now.
    const date = picking?.scheduledDate ? civilDate(String(picking.scheduledDate), zone) : today
    const event = (sign: 1 | -1, kind: ForecastEvent['kind'], party: unknown): ForecastEvent => ({
      moveId: String(move.id),
      pickingId: String(picking?.id ?? ''),
      pickingName: String(picking?.name ?? ''),
      kind,
      party: locationName.get(String(party)) ?? '',
      date,
      day: date < today ? today : date,
      late: date < today,
      quantity: sign * Number(move.productUomQty),
    })
    const add = (map: Map<string, ForecastEvent[]>, key: string, value: ForecastEvent) =>
      map.set(key, [...(map.get(key) ?? []), value])
    if (move.state === 'draft') {
      // Only the receiving warehouse has goods on order; a draft leaving one promises nothing yet.
      if (destination && (!picking || picking.state === 'draft'))
        add(
          drafts,
          at(destination, move.productId),
          event(1, code === 'internal' ? 'transferIn' : 'in', move.locationId),
        )
      continue
    }
    if (destination)
      add(
        events,
        at(destination, move.productId),
        event(1, code === 'internal' ? 'transferIn' : 'in', move.locationId),
      )
    if (source)
      add(
        events,
        at(source, move.productId),
        event(-1, code === 'internal' ? 'transferOut' : 'out', move.locationDestId),
      )
  }

  // P12: a draft manufacturing order is on order in the warehouse it will fill.
  for (const draft of make
    ? await make.planned(ctx, filter.productId ? { productId: filter.productId } : {})
    : []) {
    const warehouseId = warehouseOf.get(draft.locationId)
    if (!warehouseId) continue
    const date = draft.date ? civilDate(draft.date, zone) : today
    const key = at(warehouseId, draft.productId)
    drafts.set(key, [
      ...(drafts.get(key) ?? []),
      {
        moveId: draft.id,
        pickingId: '',
        pickingName: draft.name,
        href: draft.href,
        kind: 'make',
        party: '',
        date,
        day: date < today ? today : date,
        late: date < today,
        quantity: draft.quantity,
      },
    ])
  }

  const rules = new Map<string, Row>()
  for (const point of [...points].sort((a, b) => String(a.id).localeCompare(String(b.id))))
    if (point.active !== false && active.has(String(point.warehouseId)))
      if (!rules.has(at(point.warehouseId, point.productId)))
        rules.set(at(point.warehouseId, point.productId), point)

  const keys = new Set([
    ...usable.keys(),
    ...blocked.keys(),
    ...events.keys(),
    ...drafts.keys(),
    ...rules.keys(),
  ])
  const productIds = [...new Set([...keys].map((key) => key.split('|')[1]!))]
  const P = ctx.table('product.Product')
  const products = productIds.length ? await ctx.db.all(from(P).where(inArray(P.id, productIds))) : []
  const templateIds = [...new Set(products.map((row) => String(row.templateId)))]
  const T = ctx.table('product.Template')
  const templates = templateIds.length ? await ctx.db.all(from(T).where(inArray(T.id, templateIds))) : []
  const units = await ctx.db.select('uom.Unit')
  const productById = new Map(products.map((row) => [String(row.id), row]))
  const templateById = new Map(templates.map((row) => [String(row.id), row]))
  const unitName = new Map(units.map((row) => [String(row.id), String(row.name)]))

  const lines: ForecastLine[] = []
  for (const key of keys) {
    const [warehouseId, productId] = key.split('|') as [string, string]
    const product = productById.get(productId)
    const template = product && templateById.get(String(product.templateId))
    // Only goods the warehouse keeps stock of have a forecast: no services, combos or archived goods.
    if (
      !product ||
      !template ||
      template.isStorable !== true ||
      product.active === false ||
      template.active === false
    )
      continue
    const due = [...(events.get(key) ?? [])].sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.date.localeCompare(b.date) ||
        a.pickingName.localeCompare(b.pickingName) ||
        a.moveId.localeCompare(b.moveId),
    )
    const onHand = usable.get(key) ?? 0
    let balance = onHand
    let shortDate = ''
    let shortPicking: ForecastLine['shortPicking'] = null
    for (const event of due) {
      balance += event.quantity
      event.balance = balance
      if (balance < 0 && !shortDate) {
        shortDate = event.day
        shortPicking = { id: event.pickingId, name: event.pickingName }
      }
    }
    const incoming = due.filter((event) => event.quantity > 0).reduce((sum, event) => sum + event.quantity, 0)
    // Summed as positives so a product with nothing going out reads 0, not -0.
    const outgoing = due.filter((event) => event.quantity < 0).reduce((sum, event) => sum - event.quantity, 0)
    const forecast = onHand + incoming - outgoing
    const point = rules.get(key)
    const rule = point
      ? {
          id: String(point.id),
          location: locationName.get(String(point.locationId)) ?? '',
          minQuantity: Number(point.minQuantity),
          maxQuantity: Number(point.maxQuantity),
        }
      : null
    const onOrder = (drafts.get(key) ?? []).reduce((sum, event) => sum + event.quantity, 0)
    lines.push({
      warehouseId,
      warehouse: String(active.get(warehouseId)?.name ?? warehouseId),
      productId,
      productCode: String(product.defaultCode ?? ''),
      productName: String(template.name ?? productId),
      uom: unitName.get(String(template.uomId)) ?? '',
      usable: onHand,
      blocked: blocked.get(key) ?? 0,
      incoming,
      outgoing,
      forecast,
      onOrder,
      shortDate,
      shortPicking,
      rule,
      status: shortDate ? 'short' : rule && forecast < rule.minQuantity ? 'belowMin' : 'ok',
      events: due,
      drafts: drafts.get(key) ?? [],
    })
  }
  // What runs short comes first, by the day it does; then what falls below its minimum; then the rest.
  lines.sort(
    (a, b) =>
      FORECAST_STATUSES.indexOf(a.status) - FORECAST_STATUSES.indexOf(b.status) ||
      (a.shortDate || '9999-12-31').localeCompare(b.shortDate || '9999-12-31') ||
      (a.productCode || a.productName).localeCompare(b.productCode || b.productName) ||
      a.warehouse.localeCompare(b.warehouse),
  )
  return { today, lines }
}
