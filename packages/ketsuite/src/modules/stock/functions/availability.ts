import { availabilityAt } from '../stock-ledger.ts'
import { defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { company, ours } from '../scope.ts'
import { forecastLines, forecastReads } from '../forecast-outlook.ts'
import type { MakeReplenishment } from '../replenishment-policy.ts'

export async function trackedAvailabilityHandler(ctx: Ctx, args: Row) {
  return availabilityAt(ctx, {
    productId: args.productId,
    warehouseId: args.warehouseId,
    at: args.at,
  })
}

export async function forecastHandler(ctx: Ctx, args: Row) {
  const locations = await ours(ctx, 'stock.Location')
  const anchor = args.locationId ? locations.find((location) => location.id === args.locationId) : null
  const inside = new Set(
    locations
      .filter((location) => ['internal', 'transit'].includes(String(location.usage)))
      .filter((location) => {
        if (args.warehouseId) return location.warehouseId === args.warehouseId
        if (anchor) return String(location.parentPath).startsWith(String(anchor.parentPath))
        return true
      })
      .map((location) => String(location.id)),
  )
  const quants = (await ours(ctx, 'stock.Quant', { productId: args.productId })).filter((quant) =>
    inside.has(String(quant.locationId)),
  )
  const onHand = quants.reduce((sum, quant) => sum + Number(quant.quantity), 0)
  const reserved = quants.reduce((sum, quant) => sum + Number(quant.reservedQuantity), 0)
  const moves = (await ours(ctx, 'stock.Move', { productId: args.productId })).filter(
    (move) => !['done', 'cancel', 'draft'].includes(String(move.state)),
  )
  let incoming = 0,
    outgoing = 0
  for (const move of moves) {
    // The whole demand of an open move is still to come. `move.quantity` is
    // what has been reserved, not what has shipped — completePicking is the
    // only writer that turns it into a done quantity, and it sets state to
    // `done` in the same update, which this filter has already excluded. Using
    // it as progress made a fully reserved outgoing move count for nothing, so
    // the screen reported `available 0` beside `forecast 10` for the same
    // product, and replenishment never saw the committed demand.
    const remaining = Number(move.productUomQty)
    const sourceInside = inside.has(String(move.locationId))
    const destinationInside = inside.has(String(move.locationDestId))
    if (!sourceInside && destinationInside) incoming += remaining
    if (sourceInside && !destinationInside) outgoing += remaining
  }
  const forecasted = onHand + incoming - outgoing
  return {
    productId: args.productId,
    onHand: String(onHand),
    reserved: String(reserved),
    available: String(onHand - reserved),
    incoming: String(incoming),
    outgoing: String(outgoing),
    forecasted: String(forecasted),
    forecast: String(forecasted),
  }
}

export async function forecastCollectionOf(ctx: Ctx, args: Row, make?: MakeReplenishment) {
  const { today, lines } = await forecastLines(
    ctx,
    { ...(args.warehouseId ? { warehouseId: String(args.warehouseId) } : {}) },
    make,
  )
  return { today, rows: lines.map(({ events: _events, drafts: _drafts, ...line }) => line) }
}

export async function forecastDetailOf(ctx: Ctx, args: Row, make?: MakeReplenishment) {
  const { today, lines } = await forecastLines(
    ctx,
    { warehouseId: String(args.warehouseId), productId: String(args.productId) },
    make,
  )
  return { today, line: lines[0] ?? null }
}

/** K40's forecast reads; a composition that makes goods counts its draft orders as on order (P12). */
export function createForecastFunctions(make?: MakeReplenishment): Record<string, FnSpec> {
  const effects = [...forecastReads, ...(make?.effects ?? [])]
  const getForecastCollectionHandler = (ctx: Ctx, args: Row) => forecastCollectionOf(ctx, args, make)
  const getForecastDetailHandler = (ctx: Ctx, args: Row) => forecastDetailOf(ctx, args, make)
  return {
    // K40: one row per product in each warehouse that holds, expects, has on order or keeps a rule for it.
    getForecastCollection: defineFn({
      input: { warehouseId: 'id?' },
      effects,
      agent: true,
      handler: getForecastCollectionHandler,
    }),
    // K40: a product's forecast in a warehouse, operation by operation; null when it has none there.
    getForecastDetail: defineFn({
      input: { warehouseId: 'id', productId: 'id' },
      effects,
      agent: true,
      handler: getForecastDetailHandler,
    }),
  }
}

export async function listProductAvailabilityHandler(ctx: Ctx, args: Row) {
  const productIds = [
    ...new Set(Array.isArray(args.productIds) ? args.productIds.map(String).slice(0, 2_000) : []),
  ]
  if (!productIds.length) return []
  const mine = company(ctx)
  const Q = ctx.table('stock.Quant')
  const L = ctx.table('stock.Location')
  const [quants, locations] = await Promise.all([
    ctx.db.all(from(Q).where(eq(Q.companyId, mine), inArray(Q.productId, productIds))),
    ctx.db.all(from(L).where(eq(L.companyId, mine), inArray(L.usage, ['internal', 'transit']))),
  ])
  const inside = new Set(
    locations
      .filter((row) => !args.warehouseId || row.warehouseId === args.warehouseId)
      .map((row) => String(row.id)),
  )
  const available = new Map(productIds.map((id) => [id, 0]))
  for (const quant of quants) {
    if (!inside.has(String(quant.locationId))) continue
    const id = String(quant.productId)
    available.set(id, (available.get(id) ?? 0) + Number(quant.quantity) - Number(quant.reservedQuantity))
  }
  return productIds.map((productId) => ({
    productId,
    available: String(available.get(productId) ?? 0),
  }))
}

export async function getProductStockViewHandler(ctx: Ctx, args: Row) {
  const mine = company(ctx)
  const Q = ctx.table('stock.Quant')
  const L = ctx.table('stock.Location')
  const Lot = ctx.table('stock.Lot')
  const quants = await ctx.db.all(
    from(Q).where(eq(Q.companyId, mine), eq(Q.productId, String(args.productId))),
  )
  const locationIds = [...new Set(quants.map((row) => String(row.locationId)))]
  const lotIds = [
    ...new Set(
      quants
        .map((row) => row.lotId)
        .filter(Boolean)
        .map(String),
    ),
  ]
  const [locations, lots] = await Promise.all([
    locationIds.length ? ctx.db.all(from(L).where(eq(L.companyId, mine), inArray(L.id, locationIds))) : [],
    lotIds.length ? ctx.db.all(from(Lot).where(eq(Lot.companyId, mine), inArray(Lot.id, lotIds))) : [],
  ])
  const locationById = new Map(locations.map((row) => [String(row.id), row]))
  const lotById = new Map(lots.map((row) => [String(row.id), row]))
  const positions = quants
    .flatMap((quant) => {
      const location = locationById.get(String(quant.locationId))
      if (
        !location ||
        !['internal', 'transit'].includes(String(location.usage)) ||
        Number(quant.quantity) <= 0
      )
        return []
      return [
        {
          quant,
          location,
          lot: quant.lotId ? (lotById.get(String(quant.lotId)) ?? null) : null,
        },
      ]
    })
    .sort(
      (left, right) =>
        String(left.location.name).localeCompare(String(right.location.name)) ||
        String(left.lot?.name ?? '').localeCompare(String(right.lot?.name ?? '')) ||
        String(left.quant.id).localeCompare(String(right.quant.id)),
    )
  const available = positions.reduce(
    (sum, entry) => sum + Number(entry.quant.quantity) - Number(entry.quant.reservedQuantity),
    0,
  )
  return { productId: String(args.productId), available: String(available), positions }
}

export const availabilityFunctions: Record<string, FnSpec> = {
  trackedAvailability: defineFn({
    input: { productId: 'id', warehouseId: 'id', at: 'datetime?' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:stock.PickingType',
      'read:stock.Location',
      'read:stock.Quant',
      'read:stock.Lot',
    ],
    agent: true,
    handler: trackedAvailabilityHandler,
  }),

  forecast: defineFn({
    input: { productId: 'id', warehouseId: 'id?', locationId: 'id?' },
    output: {
      productId: 'id',
      onHand: 'decimal',
      reserved: 'decimal',
      available: 'decimal',
      incoming: 'decimal',
      outgoing: 'decimal',
      forecasted: 'decimal',
      forecast: 'decimal',
    },
    effects: ['read:stock.Quant', 'read:stock.Move', 'read:stock.Location'],
    agent: true,
    handler: forecastHandler,
  }),

  ...createForecastFunctions(),

  listProductAvailability: defineFn({
    input: { productIds: 'json', warehouseId: 'id?' },
    output: { productId: 'id', available: 'decimal' },
    effects: ['read:stock.Quant', 'read:stock.Location'],
    agent: true,
    handler: listProductAvailabilityHandler,
  }),

  getProductStockView: defineFn({
    input: { productId: 'id' },
    effects: ['read:stock.Quant', 'read:stock.Location', 'read:stock.Lot'],
    agent: true,
    handler: getProductStockViewHandler,
  }),
}
