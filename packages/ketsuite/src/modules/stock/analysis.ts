import type { Ctx, Row } from '@ketvietlab/ketjs'
import { civilDate } from '../company/civil-date.ts'
import { ours } from './scope.ts'
import { OWNED, units } from './valuation.ts'

/**
 * K63: what is left of each arrival, read first in, first out, location by location. Every done line bringing
 * goods into an owned location is a layer dated the day its transfer finished; every done line taking goods
 * out of one uses that location's oldest layers first. At the same moment, what came in is there before what
 * left. A location that went short consumes the shortfall from its next arrival, so what the layers leave adds
 * up to what each location holds whenever it holds anything. Stock that no done line explains, such as what
 * a location held before its first recorded transfer, is an opening layer older than every arrival.
 */
export type StockLayer = {
  locationId: string
  productId: string
  /** When the goods came into the location, as the transfer's completion instant. */
  date: string
  units: bigint
  left: bigint
  moveId: string
  moveLineId: string
}

export const stockLayerEffects = [
  'read:stock.Location',
  'read:stock.Picking',
  'read:stock.Move',
  'read:stock.MoveLine',
  'read:stock.Quant',
] as const

type Event = { side: 1 | -1; date: string; order: string; line: Row; move: Row; locationId: string }

export async function stockLayers(ctx: Ctx): Promise<StockLayer[]> {
  const owned = new Set(
    (await ours(ctx, 'stock.Location'))
      .filter((row) => OWNED.includes(String(row.usage)))
      .map((row) => String(row.id)),
  )
  const finished = new Map(
    (await ours(ctx, 'stock.Picking', { state: 'done' })).map((row) => [String(row.id), row] as const),
  )
  const moves = new Map(
    (await ours(ctx, 'stock.Move', { state: 'done' })).map((row) => [String(row.id), row] as const),
  )
  const events: Event[] = []
  for (const line of await ours(ctx, 'stock.MoveLine')) {
    const move = moves.get(String(line.moveId))
    if (!move || units(line.quantityProductUom ?? line.quantity) <= 0n) continue
    const picking = finished.get(String(move.pickingId ?? line.pickingId ?? ''))
    const date = String(picking?.dateDone ?? picking?.scheduledDate ?? '')
    const order = `${String(picking?.name ?? '')}\u0000${String(line.id)}`
    // Completion takes goods out of the line's location and puts them in the move's destination.
    if (owned.has(String(move.locationDestId)))
      events.push({ side: 1, date, order, line, move, locationId: String(move.locationDestId) })
    if (owned.has(String(line.locationId)))
      events.push({ side: -1, date, order, line, move, locationId: String(line.locationId) })
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || b.side - a.side || a.order.localeCompare(b.order))
  const layers: StockLayer[] = []
  const open = new Map<string, StockLayer[]>()
  const short = new Map<string, bigint>()
  const net = new Map<string, bigint>()
  for (const { side, line, move, locationId } of events) {
    const key = `${locationId}\u0000${String(move.productId)}`
    net.set(key, (net.get(key) ?? 0n) + BigInt(side) * units(line.quantityProductUom ?? line.quantity))
  }
  const held = new Map<string, { quantity: bigint; date: string; locationId: string; productId: string }>()
  for (const quant of await ours(ctx, 'stock.Quant')) {
    if (!owned.has(String(quant.locationId))) continue
    const key = `${String(quant.locationId)}\u0000${String(quant.productId)}`
    const date = String(quant.inDate ?? '')
    const known = held.get(key)
    held.set(key, {
      quantity: (known?.quantity ?? 0n) + units(quant.quantity),
      date: known?.date && known.date < date ? known.date : date,
      locationId: String(quant.locationId),
      productId: String(quant.productId),
    })
  }
  for (const [key, quant] of held) {
    const opening = quant.quantity - (net.get(key) ?? 0n)
    if (opening <= 0n) continue
    const layer = { ...quant, units: opening, left: opening, moveId: '', moveLineId: '' }
    layers.push(layer)
    open.set(key, [layer])
  }
  for (const { side, date, line, move, locationId } of events) {
    const productId = String(move.productId)
    const key = `${locationId}\u0000${productId}`
    let rest = units(line.quantityProductUom ?? line.quantity)
    if (side > 0) {
      const owed = short.get(key) ?? 0n
      const used = owed < rest ? owed : rest
      if (used) short.set(key, owed - used)
      const layer = {
        locationId,
        productId,
        date,
        units: rest,
        left: rest - used,
        moveId: String(move.id),
        moveLineId: String(line.id),
      }
      layers.push(layer)
      if (layer.left > 0n) open.set(key, [...(open.get(key) ?? []), layer])
      continue
    }
    const queue = open.get(key) ?? []
    while (rest > 0n && queue.length) {
      const layer = queue[0]!
      const used = layer.left < rest ? layer.left : rest
      layer.left -= used
      rest -= used
      if (layer.left === 0n) queue.shift()
    }
    if (rest > 0n) short.set(key, (short.get(key) ?? 0n) + rest)
  }
  return layers
}

/** K63 aging buckets: days since the goods came into their location. */
export const AGING_BUCKETS = [
  ['age30', 0, 30],
  ['age60', 31, 60],
  ['age90', 61, 90],
  ['ageOlder', 91, Number.POSITIVE_INFINITY],
] as const

const DAY = 86_400_000
/** Whole days from the civil day `from` to the civil day `to`. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

export const agingBucket = (age: number): number =>
  AGING_BUCKETS.findIndex(([, from, to]) => age >= from && age <= to)

/** The civil day a layer came in, in the company's zone. */
export const layerDay = (layer: StockLayer, zone: string): string =>
  layer.date ? civilDate(layer.date, zone) : ''

/**
 * What kind of move a line of a transfer is, the way the moves history and analysis name it: scrapping and
 * its undo, returns and count adjustments first, then the operation type's direction.
 */
export const moveKindOf = (
  move: Row,
  type: Row | undefined,
  from: Row | undefined,
  to: Row | undefined,
): string =>
  from?.usage === 'scrap'
    ? 'scrapUndo'
    : to?.usage === 'scrap'
      ? 'scrap'
      : move.originReturnedMoveId
        ? 'return'
        : [from?.usage, to?.usage].includes('inventory')
          ? 'adjustment'
          : type?.code === 'incoming'
            ? 'receipt'
            : type?.code === 'outgoing'
              ? 'delivery'
              : 'internal'
