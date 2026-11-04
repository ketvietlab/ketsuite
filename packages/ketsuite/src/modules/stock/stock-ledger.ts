import { stockQuantityError } from './overdelivery.ts'
import { lotAvailable, lotRefusal, fefoTime } from './lot-policy.ts'
import { claimStockConfiguration } from '../product/stock-policy.ts'
import { KetError } from '@ketvietlab/ketjs'
import { TRACKING } from './types.ts'
import { invalid, n, InventoryRefused } from './inventory-validation.ts'
import { createHash } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareQty } from '../uom/convert.ts'
import { company, ours } from './scope.ts'
import { quantityText } from './quantity-text.ts'

export const lotKey = (lotId: unknown): string => (lotId == null ? '' : String(lotId))

export const quantId = (ctx: Ctx, productId: unknown, locationId: unknown, lotId: unknown): string =>
  `${company(ctx)}:${String(productId)}:${String(locationId)}:${lotKey(lotId) || '_'}`

export async function trackingOf(ctx: Ctx, productId: unknown): Promise<'none' | 'lot' | 'serial'> {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!product) throw new Error(`unknown product ${String(productId)}`)
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  const tracking = String(template?.tracking ?? 'none')
  return TRACKING.includes(tracking as never) ? (tracking as 'none' | 'lot' | 'serial') : 'none'
}

export async function isStorable(ctx: Ctx, productId: unknown): Promise<boolean> {
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  return Boolean(template?.isStorable)
}

export async function mutateQuant(
  ctx: Ctx,
  args: {
    productId: unknown
    locationId: unknown
    lotId?: unknown
    quantity: number
    reserved: number
    expectedVersion?: number
    requireAvailable?: boolean
  },
): Promise<Row> {
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  if (!template) throw new KetError({ code: 'notFound', message: 'Stock product no longer exists.' })
  await claimStockConfiguration(ctx, template)
  if (args.lotId && (args.reserved > 0 || args.requireAvailable)) {
    const lot = (await ours(ctx, 'stock.Lot', { id: args.lotId }))[0]
    if (!lotAvailable(lot)) throw new InventoryRefused(lotRefusal('lotId', 'lotUnavailable'))
  }
  if (!template.isStorable)
    throw new KetError({
      code: 'conflict',
      message: 'Product is no longer storable; reload the stock operation.',
    })
  const tracking = String(template.tracking ?? 'none')
  if ((tracking === 'none') !== (args.lotId == null))
    throw new KetError({ code: 'conflict', message: 'Product tracking changed; reload the stock operation.' })
  const id = quantId(ctx, args.productId, args.locationId, args.lotId)
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = (await ours(ctx, 'stock.Quant', { id }))[0]
    if (args.expectedVersion !== undefined && n(current?.version ?? -1) !== args.expectedVersion)
      throw new InventoryRefused(invalid('stockRevision', 'stock position changed'))
    if (!current) {
      if (args.requireAvailable && args.quantity < -1e-12)
        throw new InventoryRefused(stockQuantityError('stock.error.insufficientStock'))
      // the domain contract keeps the other side of completed moves on supplier, customer and
      // inventory locations as well. Those virtual locations legitimately carry
      // negative quantities; only a positive physical balance can be reserved.
      if (args.reserved < 0 || args.reserved > Math.max(args.quantity, 0))
        throw new Error('quant cannot become over-reserved')
      const inserted = await ctx.db.insertIfAbsent('stock.Quant', {
        id,
        productId: args.productId,
        locationId: args.locationId,
        lotId: args.lotId ?? null,
        lotKey: lotKey(args.lotId),
        quantity: quantityText(args.quantity),
        reservedQuantity: quantityText(args.reserved),
        inDate: new Date().toISOString(),
        version: 0,
      })
      // A dry run writes nothing, so there is no row to re-read and nothing for the
      // retry loop to converge on. Report the quant that would have been created
      // rather than spinning eight times and blaming concurrency.
      if ('dryRun' in inserted)
        return {
          id,
          productId: args.productId,
          locationId: args.locationId,
          lotId: args.lotId ?? null,
          lotKey: lotKey(args.lotId),
          quantity: args.quantity,
          reservedQuantity: args.reserved,
          version: 0,
        }
      if (inserted.inserted) return (await ours(ctx, 'stock.Quant', { id }))[0]!
      continue
    }
    const quantity = Number(current.quantity) + args.quantity
    const reservedQuantity = Number(current.reservedQuantity) + args.reserved
    if (args.requireAvailable && (quantity < -1e-12 || reservedQuantity - quantity > 1e-12))
      throw new InventoryRefused(stockQuantityError('stock.error.insufficientStock'))
    if (reservedQuantity < -1e-12 || reservedQuantity - Math.max(quantity, 0) > 1e-12)
      throw new Error(`quant ${id} cannot become over-reserved`)
    const changed = await ctx.db.compareAndSet(
      'stock.Quant',
      { id },
      {
        quantity: current.quantity,
        reservedQuantity: current.reservedQuantity,
        version: current.version,
      },
      {
        quantity: quantityText(quantity),
        reservedQuantity: quantityText(reservedQuantity),
        version: Number(current.version) + 1,
      },
    )
    if ('dryRun' in changed || changed.matched)
      return { ...current, quantity, reservedQuantity, version: Number(current.version) + 1 }
    if (args.expectedVersion !== undefined)
      throw new InventoryRefused(invalid('stockRevision', 'stock position changed'))
  }
  throw new Error(`concurrent quant update did not settle for ${id}`)
}

/** How much of a quant is already spoken for; 0 when the quant does not exist. */
export async function reservedOn(
  ctx: Ctx,
  productId: unknown,
  locationId: unknown,
  lotId: unknown,
): Promise<number> {
  const id = quantId(ctx, productId, locationId, lotId)
  const quant = (await ours(ctx, 'stock.Quant', { id }))[0]
  return quant ? Number(quant.reservedQuantity) : 0
}

/**
 * The locations a move may draw from: the one it names, and everything beneath it.
 *
 * `forecast` already rolls a location up through `parentPath` — the replenishment
 * screen asks it for an orderpoint's location, which is a parent with the real
 * shelves under it. Reserving only from the named location meant that stock was
 * reported as available and then refused, leaving the move `confirmed` with no
 * reason given. The named location comes first so a move still empties the shelf
 * it was written against before reaching into the children.
 */
export async function sourcesUnder(ctx: Ctx, locationId: unknown): Promise<string[]> {
  const locations = await ours(ctx, 'stock.Location')
  const anchor = locations.find((location) => String(location.id) === String(locationId))
  if (!anchor) return [String(locationId)]
  const path = String(anchor.parentPath)
  return [
    String(anchor.id),
    ...locations
      .filter(
        (location) =>
          String(location.id) !== String(anchor.id) && String(location.parentPath).startsWith(path),
      )
      .sort((a, b) => String(a.parentPath).localeCompare(String(b.parentPath)))
      .map((location) => String(location.id)),
  ]
}

export async function updatePickingState(ctx: Ctx, pickingId: unknown): Promise<void> {
  const picking = (await ours(ctx, 'stock.Picking', { id: pickingId }))[0]
  // draft belongs to confirmPicking and cancel is terminal. Deriving a state from the
  // moves and writing it unconditionally let a reservation confirm a draft transfer
  // and resurrect a cancelled one.
  if (!picking || picking.state === 'draft' || picking.state === 'cancel') return
  const moves = await ours(ctx, 'stock.Move', { pickingId })
  const live = moves.filter((move) => move.state !== 'cancel')
  let state = 'confirmed'
  if (moves.length && !live.length) state = 'cancel'
  else if (live.length && live.every((move) => move.state === 'done')) state = 'done'
  // K2, K18: a transfer that ships at once when complete (`one`) is ready only once every move is
  // held in full; one that ships what is there (`direct`) is ready as soon as anything is held.
  else if (
    picking.moveType === 'one'
      ? live.every((move) => move.state === 'assigned' || move.state === 'done')
      : live.some((move) => move.state === 'assigned' || move.state === 'partially_available')
  )
    state = 'assigned'
  else if (live.some((move) => move.state === 'waiting')) state = 'waiting'
  await ctx.db.update('stock.Picking', { id: pickingId }, { state })
}

export type TrackedSelection = { lotId: string; quantity: number; stockRevision: string }

export const stockRevision = (rows: Row[]): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        rows
          .map((row) => ({
            id: String(row.id),
            quantity: String(row.quantity),
            reservedQuantity: String(row.reservedQuantity),
            version: n(row.version),
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    )
    .digest('hex')

export const availabilityAt = async (
  ctx: Ctx,
  args: { productId: unknown; warehouseId: unknown; at?: unknown },
): Promise<Row> => {
  const tracking = await trackingOf(ctx, args.productId)
  const pickingType = (
    await ours(ctx, 'stock.PickingType', {
      id: `${String(args.warehouseId)}:outgoing`,
    })
  )[0]
  if (!pickingType?.defaultLocationSrcId) return { tracking, sourceLocationId: null, lots: [] }
  const sources = new Set(await sourcesUnder(ctx, pickingType.defaultLocationSrcId))
  const quants = (await ours(ctx, 'stock.Quant', { productId: args.productId })).filter((quant) =>
    sources.has(String(quant.locationId)),
  )
  const lots = await ours(ctx, 'stock.Lot', { productId: args.productId })
  const at = new Date(String(args.at ?? new Date().toISOString())).getTime()
  return {
    tracking,
    sourceLocationId: String(pickingType.defaultLocationSrcId),
    lots: lots
      .map((lot) => {
        const positions = quants.filter((quant) => String(quant.lotId ?? '') === String(lot.id))
        const available = positions.reduce(
          (sum, quant) => sum + Math.max(0, n(quant.quantity) - n(quant.reservedQuantity)),
          0,
        )
        const expiration = lot.expirationDate == null ? null : String(lot.expirationDate)
        const expired = !lotAvailable(lot, Number.isFinite(at) ? at : Date.now())
        const serialConflict =
          tracking === 'serial' && positions.reduce((sum, quant) => sum + n(quant.quantity), 0) > 1
        return {
          lotId: String(lot.id),
          name: String(lot.name),
          expirationDate: expiration,
          removalDate: lot.removalDate ?? null,
          quarantined: lot.quarantined === true,
          availableQuantity: String(expired || serialConflict || lot.active === false ? 0 : available),
          stockRevision: stockRevision(positions),
          selectable: lot.active !== false && !expired && !serialConflict && available > 0,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name) || left.lotId.localeCompare(right.lotId)),
  }
}

export const parsedSelections = (value: unknown): TrackedSelection[] | null => {
  if (!Array.isArray(value)) return null
  const selections = value.map((entry) => {
    const row = entry as Row
    return {
      lotId: String(row.lotId ?? ''),
      quantity: n(row.quantity),
      stockRevision: String(row.stockRevision ?? ''),
    }
  })
  return selections.every((selection) => selection.lotId && selection.quantity > 0 && selection.stockRevision)
    ? selections
    : null
}

/**
 * K-CONSU: a transfer moves goods not kept in stock (`isStorable` off) without touching any quant:
 * a delivery, receipt or return of them completes, and the stock
 * ledger stays as it was. Counts, scraps and adjustments refuse these goods on their own.
 */
export async function mutateTransferQuant(ctx: Ctx, args: Parameters<typeof mutateQuant>[1]) {
  if (!(await isStorable(ctx, args.productId))) return null
  return mutateQuant(ctx, args)
}

/**
 * K-CONSU: goods not kept in stock are always there to take. One line carries what the move still
 * needs from its own location, and nothing is held in a quant.
 */
async function holdUnstocked(ctx: Ctx, move: Row): Promise<Row> {
  const demand = Number(move.productUomQty)
  const lines = await ours(ctx, 'stock.MoveLine', { moveId: move.id })
  const held = lines.reduce((sum, line) => sum + Number(line.quantity), 0)
  const rest = demand - held
  if (rest > 0.000001) {
    const id = `${String(move.id)}:reserve:unstocked`
    const line = lines.find((row) => String(row.id) === id)
    if (line) {
      const quantity = quantityText(Number(line.quantity) + rest)
      await ctx.db.update('stock.MoveLine', { id }, { quantity, quantityProductUom: quantity })
    } else
      await ctx.db.insert('stock.MoveLine', {
        id,
        moveId: move.id,
        pickingId: move.pickingId,
        productId: move.productId,
        productUomId: move.productUomId,
        quantity: quantityText(rest),
        quantityProductUom: quantityText(rest),
        locationId: move.locationId,
        locationDestId: move.locationDestId,
        lotId: null,
        picked: false,
      })
  }
  const reserved = String(Math.max(held, demand))
  await ctx.db.update('stock.Move', { id: move.id }, { state: 'assigned', quantity: reserved })
  if (move.pickingId) await updatePickingState(ctx, move.pickingId)
  return { ok: true, reserved, state: 'assigned' }
}

export const reserveMoveInContext = async (
  ctx: Ctx,
  move: Row,
  requestedSelections?: unknown,
): Promise<Row> => {
  if (['done', 'cancel'].includes(String(move.state))) return invalid('state', 'move đã kết thúc')
  if (move.state === 'draft') return invalid('state', 'xác nhận transfer trước khi reserve')
  if (!(await isStorable(ctx, move.productId))) {
    if (requestedSelections !== undefined)
      return invalid('selections', 'untracked product must not select a lot')
    return holdUnstocked(ctx, move)
  }
  const demand = Number(move.productUomQty)
  const existingLines = await ours(ctx, 'stock.MoveLine', { moveId: move.id })
  let reserved = existingLines.reduce((sum, line) => sum + Number(line.quantity), 0)
  let state = 'confirmed'
  const tracking = await trackingOf(ctx, move.productId)
  const sources = await sourcesUnder(ctx, move.locationId)
  const sourceOrder = new Map(sources.map((id, index) => [id, index]))
  const lots = new Map(
    (await ours(ctx, 'stock.Lot', { productId: move.productId })).map((lot) => [String(lot.id), lot]),
  )
  const quants = (await ours(ctx, 'stock.Quant', { productId: move.productId }))
    .filter((quant) => sourceOrder.has(String(quant.locationId)))
    .sort(
      (left, right) =>
        fefoTime(lots.get(String(left.lotId))) - fefoTime(lots.get(String(right.lotId))) ||
        sourceOrder.get(String(left.locationId))! - sourceOrder.get(String(right.locationId))! ||
        String(left.lotKey).localeCompare(String(right.lotKey)),
    )
  const selections = requestedSelections === undefined ? undefined : parsedSelections(requestedSelections)
  if (requestedSelections !== undefined && !selections)
    return invalid('selections', 'lot/serial selection is malformed')
  if (selections) {
    if (tracking === 'none') return invalid('selections', 'untracked product must not select a lot')
    if (move.pickingId) {
      const picking = (await ours(ctx, 'stock.Picking', { id: move.pickingId }))[0]
      const pickingType = picking
        ? (await ours(ctx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
        : null
      // trackedAvailability hashes quants below the outgoing type's default source.
      // A selected move must reserve below that exact same root; otherwise every
      // refreshed revision would be computed from a permanently different set.
      if (
        !pickingType?.defaultLocationSrcId ||
        String(pickingType.defaultLocationSrcId) !== String(move.locationId)
      )
        return invalid('locationId', 'tracked selection source does not match its picking type')
    }
    if (new Set(selections.map((selection) => selection.lotId)).size !== selections.length)
      return invalid('selections', 'a lot/serial can only be selected once per line')
    if (
      tracking === 'serial' &&
      selections.some((selection) => compareQty(selection.quantity, 1, 0.000001) !== 0)
    )
      return invalid('selections', 'every selected serial must have quantity 1')
    if (
      compareQty(
        selections.reduce((sum, selection) => sum + selection.quantity, 0),
        demand,
        0.000001,
      ) !== 0
    )
      return invalid('selections', 'selected lot/serial quantity must equal line quantity')
    if (existingLines.length) {
      const held = new Map<string, number>()
      for (const line of existingLines)
        held.set(String(line.lotId ?? ''), (held.get(String(line.lotId ?? '')) ?? 0) + n(line.quantity))
      const same =
        compareQty(reserved, demand, 0.000001) === 0 &&
        selections.every(
          (selection) => compareQty(held.get(selection.lotId) ?? 0, selection.quantity, 0.000001) === 0,
        )
      if (!same) return invalid('selections', 'move already holds a different lot/serial selection')
      // This is a completed idempotent replay, not a new stock claim. The original
      // revisions were consumed when these move lines reserved the quants, so a
      // later retry intentionally compares the immutable selection instead.
      await ctx.db.update(
        'stock.Move',
        { id: move.id },
        { state: 'assigned', quantity: quantityText(reserved) },
      )
      if (move.pickingId) await updatePickingState(ctx, move.pickingId)
      return { ok: true, reserved: quantityText(reserved), state: 'assigned' }
    }
    for (const selection of selections) {
      const positions = quants.filter((quant) => String(quant.lotId ?? '') === selection.lotId)
      if (stockRevision(positions) !== selection.stockRevision)
        return invalid('stockRevision', 'stock position changed; reload lot availability')
      const lot = (await ours(ctx, 'stock.Lot', { id: selection.lotId }))[0]
      if (!lot || lot.productId !== move.productId || lot.active === false)
        return invalid('lotId', 'lot/serial is not available for this product')
      if (!lotAvailable(lot))
        return invalid('lotId', 'lot/serial is quarantined, expired or past its removal date')
      if (tracking === 'serial' && positions.reduce((sum, quant) => sum + n(quant.quantity), 0) > 1)
        return invalid('lotId', 'duplicate serial stock must be reconciled before sale')
      let remaining = selection.quantity
      for (const quant of positions) {
        if (remaining <= 0.000001) break
        const available = n(quant.quantity) - n(quant.reservedQuantity)
        if (available <= 0) continue
        const take = Math.min(available, remaining)
        await mutateQuant(ctx, {
          productId: move.productId,
          locationId: quant.locationId,
          lotId: quant.lotId,
          quantity: 0,
          reserved: take,
          expectedVersion: n(quant.version),
        })
        await ctx.db.insert('stock.MoveLine', {
          id: `${String(move.id)}:reserve:${String(quant.id)}`,
          moveId: move.id,
          pickingId: move.pickingId,
          productId: move.productId,
          productUomId: move.productUomId,
          quantity: quantityText(take),
          quantityProductUom: quantityText(take),
          locationId: quant.locationId,
          locationDestId: move.locationDestId,
          lotId: quant.lotId,
          picked: false,
        })
        remaining -= take
        reserved += take
      }
      if (remaining > 0.000001)
        return invalid('stock', `insufficient stock for lot/serial ${selection.lotId}`)
    }
  } else {
    for (const quant of quants) {
      if (reserved >= demand) break
      if (tracking !== 'none' && (!quant.lotId || !lotAvailable(lots.get(String(quant.lotId))))) continue
      const available = Number(quant.quantity) - Number(quant.reservedQuantity)
      if (available <= 0) continue
      const take = Math.min(
        available,
        demand - reserved,
        tracking === 'serial' ? 1 : Number.POSITIVE_INFINITY,
      )
      await mutateQuant(ctx, {
        productId: move.productId,
        locationId: quant.locationId,
        lotId: quant.lotId,
        quantity: 0,
        reserved: take,
      })
      const lineId = `${String(move.id)}:reserve:${String(quant.id)}`
      const line = (await ours(ctx, 'stock.MoveLine', { id: lineId }))[0]
      if (line)
        await ctx.db.update(
          'stock.MoveLine',
          { id: lineId },
          { quantity: quantityText(Number(line.quantity) + take) },
        )
      else
        await ctx.db.insert('stock.MoveLine', {
          id: lineId,
          moveId: move.id,
          pickingId: move.pickingId,
          productId: move.productId,
          productUomId: move.productUomId,
          quantity: quantityText(take),
          quantityProductUom: quantityText(take),
          locationId: quant.locationId,
          locationDestId: move.locationDestId,
          lotId: quant.lotId,
          picked: false,
        })
      reserved += take
    }
  }
  state =
    compareQty(reserved, demand, 0.000001) >= 0
      ? 'assigned'
      : reserved > 0
        ? 'partially_available'
        : 'confirmed'
  await ctx.db.update('stock.Move', { id: move.id }, { state, quantity: quantityText(reserved) })
  if (move.pickingId) await updatePickingState(ctx, move.pickingId)
  return { ok: true, reserved: quantityText(reserved), state }
}

export const reserveEffects = [
  'read:stock.Move',
  'write:stock.Move',
  'read:stock.Picking',
  'write:stock.Picking',
  'read:stock.PickingType',
  'read:stock.MoveLine',
  'write:stock.MoveLine',
  'read:stock.Quant',
  'write:stock.Quant',
  'read:stock.Location',
  'read:stock.Lot',
  'read:product.Product',
  'read:product.Template',
  'write:product.Template',
]
