import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { civilDate } from '../../company/civil-date.ts'
import { minorText } from '../../account/money.ts'
import {
  AGING_BUCKETS,
  agingBucket,
  daysBetween,
  layerDay,
  moveKindOf,
  stockLayerEffects,
  stockLayers,
} from '../analysis.ts'
import { companyToday } from '../reservation-policy.ts'
import { ours } from '../scope.ts'
import { moneyMinor, scaleFor, share, units, unitsText } from '../valuation.ts'
import { heldValuationEffects, heldValuations } from './valuation.ts'

const byId = (rows: Row[]) => new Map(rows.map((row) => [String(row.id), row] as const))

/**
 * K63: the moves analysis, a row for every line of every transfer whatever its status. A finished line
 * carries what it moved and its value from the stock ledger, adjustments included; a line that brought goods
 * into an owned location also carries how much of them is still there, read first in, first out, and what
 * that is worth at the price they came in at.
 */
export async function listMoveAnalysisHandler(ctx: Ctx, args: Row) {
  const scale = await scaleFor(ctx)
  const { zone } = await companyToday(ctx)
  const warehouseId = args.warehouseId ? String(args.warehouseId) : null
  const pickings = byId(await ours(ctx, 'stock.Picking'))
  const types = byId(await ours(ctx, 'stock.PickingType'))
  const locations = byId(await ours(ctx, 'stock.Location'))
  const uoms = byId(await ctx.db.select('uom.Unit', {}))
  const values = new Map<string, bigint>()
  for (const layer of await ours(ctx, 'stock.ValuationLayer'))
    if (layer.moveId)
      values.set(
        String(layer.moveId),
        (values.get(String(layer.moveId)) ?? 0n) + moneyMinor(layer.value, scale),
      )
  const left = new Map<string, bigint>()
  for (const layer of await stockLayers(ctx))
    if (layer.moveId) left.set(layer.moveId, (left.get(layer.moveId) ?? 0n) + layer.left)
  const products = new Map<string, { code: string | null; name: string }>()
  const productOf = async (id: string) => {
    if (!products.has(id)) {
      const product = (await ctx.db.select('product.Product', { id }))[0]
      const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
      products.set(id, {
        code: product?.defaultCode == null ? null : String(product.defaultCode),
        name: String(template?.name ?? id),
      })
    }
    return products.get(id)!
  }
  const rows: Row[] = []
  for (const move of await ours(ctx, 'stock.Move')) {
    const picking = pickings.get(String(move.pickingId ?? ''))
    if (!picking) continue
    const type = types.get(String(picking.pickingTypeId))
    const from = locations.get(String(move.locationId))
    const to = locations.get(String(move.locationDestId))
    const warehouseIds = [
      ...new Set([type?.warehouseId, from?.warehouseId, to?.warehouseId].filter(Boolean).map(String)),
    ]
    if (warehouseId && !warehouseIds.includes(warehouseId)) continue
    const done = picking.state === 'done' ? units(move.quantity) : 0n
    const value =
      picking.state === 'done' && values.has(String(move.id)) ? values.get(String(move.id))! : null
    const rest = picking.state === 'done' ? left.get(String(move.id)) : undefined
    const product = await productOf(String(move.productId))
    rows.push({
      id: String(move.id),
      pickingId: String(picking.id),
      pickingName: String(picking.name),
      date: civilDate(String(picking.dateDone ?? picking.scheduledDate), zone),
      productId: String(move.productId),
      code: product.code,
      name: product.name,
      uomName: uoms.get(String(move.productUomId))?.name ?? null,
      kind: moveKindOf(move, type, from, to),
      state: String(picking.state),
      warehouseIds,
      demand: unitsText(units(move.productUomQty)),
      quantity: unitsText(done),
      value: value == null ? null : minorText(value, scale),
      remaining: rest == null ? null : unitsText(rest),
      remainingValue:
        rest == null || value == null || done <= 0n ? null : minorText(share(value, rest, done), scale),
    })
  }
  rows.sort(
    (a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      String(b.pickingName).localeCompare(String(a.pickingName)) ||
      String(a.id).localeCompare(String(b.id)),
  )
  const currency = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency ?? null
  return { currency, rows }
}

/**
 * K52: the moves history, a row for every line a finished transfer moved, counts and scraps included, one a
 * lot. It is read from the transfers each time, nothing stored, so a location's opening stock and its history
 * add up to what it holds. A transfer between two warehouses belongs to both. `period` places the line in the
 * company's current or previous month, for the list's period presets. `lotId` keeps one lot's lines: its trace
 * (K32), with each line's partner and source document.
 */
export async function listMoveHistoryHandler(ctx: Ctx, args: Row) {
  const { today, zone } = await companyToday(ctx)
  const warehouseId = args.warehouseId ? String(args.warehouseId) : null
  const lotId = args.lotId ? String(args.lotId) : null
  const pickings = byId((await ours(ctx, 'stock.Picking')).filter((picking) => picking.state === 'done'))
  const partners = new Map<string, string>()
  const partnerOf = async (id: unknown) => {
    if (!id) return null
    if (!partners.has(String(id)))
      partners.set(String(id), String((await ctx.db.select('partner.Partner', { id }))[0]?.name ?? id))
    return partners.get(String(id))!
  }
  const moves = byId(await ours(ctx, 'stock.Move'))
  const types = byId(await ours(ctx, 'stock.PickingType'))
  const locations = byId(await ours(ctx, 'stock.Location'))
  const lots = byId(await ours(ctx, 'stock.Lot'))
  const uoms = byId(await ctx.db.select('uom.Unit', {}))
  const month = today.slice(0, 7)
  const last = new Date(`${month}-01T00:00:00Z`)
  last.setUTCMonth(last.getUTCMonth() - 1)
  const previous = last.toISOString().slice(0, 7)
  const products = new Map<string, { code: string | null; name: string }>()
  const productOf = async (id: string) => {
    if (!products.has(id)) {
      const product = (await ctx.db.select('product.Product', { id }))[0]
      const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
      products.set(id, {
        code: product?.defaultCode == null ? null : String(product.defaultCode),
        name: String(template?.name ?? id),
      })
    }
    return products.get(id)!
  }
  const rows: Row[] = []
  for (const line of await ours(ctx, 'stock.MoveLine', lotId ? { lotId } : {})) {
    const picking = pickings.get(String(line.pickingId ?? ''))
    const move = moves.get(String(line.moveId))
    // A line a finished transfer left at 0 moved nothing.
    if (!picking || !move || units(line.quantity) <= 0n) continue
    const type = types.get(String(picking.pickingTypeId))
    const from = locations.get(String(line.locationId))
    const to = locations.get(String(line.locationDestId))
    const warehouseIds = [...new Set([from?.warehouseId, to?.warehouseId].filter(Boolean).map(String))]
    if (warehouseId && !warehouseIds.includes(warehouseId)) continue
    const doneAt = String(picking.dateDone ?? picking.scheduledDate)
    const date = civilDate(doneAt, zone)
    const product = await productOf(String(line.productId))
    const lot = line.lotId ? lots.get(String(line.lotId)) : undefined
    rows.push({
      id: String(line.id),
      pickingId: String(picking.id),
      pickingName: String(picking.name),
      doneAt,
      date,
      period: date.slice(0, 7) === month ? 'current' : date.slice(0, 7) === previous ? 'previous' : 'older',
      productId: String(line.productId),
      code: product.code,
      name: product.name,
      lot: lot ? String(lot.name) : line.receiptLotName == null ? null : String(line.receiptLotName),
      locationId: String(line.locationId),
      locationDestId: String(line.locationDestId),
      fromUsage: from?.usage ?? null,
      toUsage: to?.usage ?? null,
      partnerId: picking.partnerId ?? null,
      partner: await partnerOf(picking.partnerId),
      // A direct on-hand adjustment marks its move `inventory`, which names no document.
      origin: move.origin && move.origin !== 'inventory' ? String(move.origin) : null,
      quantity: unitsText(units(line.quantity)),
      uomName: uoms.get(String(line.productUomId))?.name ?? null,
      kind: moveKindOf(move, type, from, to),
      warehouseIds,
    })
  }
  rows.sort(
    (a, b) =>
      String(b.doneAt).localeCompare(String(a.doneAt)) ||
      String(b.pickingName).localeCompare(String(a.pickingName)) ||
      String(a.id).localeCompare(String(b.id)),
  )
  return { rows }
}

/**
 * K63: the stock aging, a row a product a warehouse holds: how much of it came in within 30 days, 31–60,
 * 61–90 and earlier, when its oldest still held came in, and what it is worth at the company's average
 * cost. Without a warehouse the values add up to the stock valuation's total; a warehouse shows its share,
 * as the valuation does.
 */
export async function listStockAgingHandler(ctx: Ctx, args: Row) {
  const scale = await scaleFor(ctx)
  const { today, zone } = await companyToday(ctx)
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(args.asOf ?? '')) ? String(args.asOf) : today
  const warehouseId = args.warehouseId ? String(args.warehouseId) : null
  const locations = byId(await ours(ctx, 'stock.Location'))
  const warehouses = byId(await ours(ctx, 'stock.Warehouse'))
  const held = new Map((await heldValuations(ctx, scale)).map((row) => [row.productId, row] as const))
  type Bucketed = {
    warehouseId: string
    productId: string
    quantity: bigint
    buckets: bigint[]
    oldest: string
  }
  const grouped = new Map<string, Bucketed>()
  for (const layer of await stockLayers(ctx)) {
    if (layer.left <= 0n || !held.has(layer.productId)) continue
    const where = String(locations.get(layer.locationId)?.warehouseId ?? '')
    if (warehouseId && where !== warehouseId) continue
    const key = `${where}\u0000${layer.productId}`
    const row = grouped.get(key) ?? {
      warehouseId: where,
      productId: layer.productId,
      quantity: 0n,
      buckets: AGING_BUCKETS.map(() => 0n),
      oldest: '',
    }
    const day = layerDay(layer, zone)
    // A layer without a date is stock held before any recorded transfer: the oldest there is.
    const bucket = day ? agingBucket(Math.max(0, daysBetween(day, asOf))) : AGING_BUCKETS.length - 1
    row.quantity += layer.left
    row.buckets[bucket]! += layer.left
    if (day && (!row.oldest || day < row.oldest)) row.oldest = day
    grouped.set(key, row)
  }
  const rows = [...grouped.values()].map((row) => {
    const product = held.get(row.productId)!
    return { ...row, value: share(product.value, row.quantity, product.quantity) }
  })
  // Rounding each warehouse's share apart can miss the product's value by a minor unit; the largest holding
  // takes the difference so the unfiltered aging totals what the valuation does.
  if (!warehouseId)
    for (const product of held.values()) {
      const own = rows.filter((row) => row.productId === product.productId)
      if (!own.length) continue
      const counted = own.reduce((sum, row) => sum + row.quantity, 0n)
      if (counted !== product.quantity) continue
      const largest = own.reduce((best, row) => (row.quantity > best.quantity ? row : best))
      largest.value += product.value - own.reduce((sum, row) => sum + row.value, 0n)
    }
  const currency = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency ?? null
  return {
    currency,
    asOf,
    rows: rows
      .map((row) => {
        const product = held.get(row.productId)!
        return {
          id: `${row.warehouseId || '-'}:${row.productId}`,
          warehouseId: row.warehouseId || null,
          warehouseName: warehouses.get(row.warehouseId)?.name ?? null,
          productId: row.productId,
          code: product.code,
          name: product.name,
          uomName: product.uomName,
          quantity: unitsText(row.quantity),
          ...Object.fromEntries(
            AGING_BUCKETS.map(([key], index) => [key, unitsText(row.buckets[index]!)] as const),
          ),
          oldest: row.oldest || null,
          value: minorText(row.value, scale),
        }
      })
      .sort(
        (a, b) =>
          String(a.code ?? a.name).localeCompare(String(b.code ?? b.name), 'vi') ||
          String(a.warehouseName ?? '').localeCompare(String(b.warehouseName ?? ''), 'vi'),
      ),
  }
}

const analysisEffects = [
  ...new Set([
    ...stockLayerEffects,
    'read:stock.PickingType',
    'read:stock.ValuationLayer',
    'read:product.Product',
    'read:product.Template',
    'read:uom.Unit',
    'read:company.Company',
  ]),
]

export const analysisFunctions: Record<string, FnSpec> = {
  listMoveAnalysis: defineFn({
    input: { warehouseId: 'id?' },
    effects: analysisEffects,
    agent: true,
    handler: listMoveAnalysisHandler,
  }),
  // K52: read as the stock on hand is, without values.
  listMoveHistory: defineFn({
    input: { warehouseId: 'id?', lotId: 'id?' },
    effects: [
      'read:stock.Picking',
      'read:stock.PickingType',
      'read:stock.Move',
      'read:stock.MoveLine',
      'read:stock.Location',
      'read:stock.Lot',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
      'read:company.Company',
      'read:partner.Partner',
    ],
    agent: true,
    handler: listMoveHistoryHandler,
  }),
  listStockAging: defineFn({
    input: { warehouseId: 'id?', asOf: 'text?' },
    effects: [...new Set([...stockLayerEffects, ...heldValuationEffects, 'read:stock.Warehouse'])],
    agent: true,
    handler: listStockAgingHandler,
  }),
}
