import { comboRefusal } from '../../product/combo-policy.ts'
import { lotAvailable, LotRefused } from '../lot-policy.ts'
import { invalid, InventoryRefused } from '../inventory-validation.ts'
import {
  lotKey,
  quantId,
  trackingOf,
  mutateQuant,
  mutateTransferQuant,
  reserveMoveInContext,
  reserveEffects,
} from '../stock-ledger.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { compareQty } from '../../uom/convert.ts'
import { ours } from '../scope.ts'
import { boundPicking } from './returns.ts'
import { toProductUnit } from '../units.ts'

/**
 * `stock.addMove` as a caller reaches it. A sale's delivery takes its products from the order and a
 * return from the delivery it returns (K21), so neither takes a product added one by one, as the
 * transfer page's grid already refuses (#1818). The order's own flows add through `insertMoveHandler`.
 */
export async function addMoveHandler(ctx: Ctx, args: Row) {
  if (args.pickingId && (await boundPicking(ctx, args.pickingId)))
    return { ok: false, errors: [{ field: 'pickingId', messageKey: 'stock.error.pickingBound' }] }
  return insertMoveHandler(ctx, args)
}

/** A move added to any transfer, bound or not: for the flows that own the transfer's lines. */
export async function insertMoveHandler(ctx: Ctx, args: Row) {
  const picking = args.pickingId ? (await ours(ctx, 'stock.Picking', { id: args.pickingId }))[0] : null
  if (args.pickingId && !picking) return invalid('pickingId', 'transfer không tồn tại')
  if (picking && ['done', 'cancel'].includes(String(picking.state)))
    return invalid('pickingId', 'không thể thêm move vào transfer đã kết thúc')
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
  if (!product) return invalid('productId', 'biến thể không tồn tại')
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  if (template?.type === 'combo') return comboRefusal('productId', 'noStock')
  if (!(await ctx.db.select('uom.Unit', { id: args.productUomId }))[0])
    return invalid('productUomId', 'đơn vị không tồn tại')
  if (!(Number(args.productUomQty) > 0)) return invalid('productUomQty', 'phải lớn hơn 0')
  // The caller may speak in boxes; the ledger does not. Everything behind
  // this door — quants, reservations, the forecast — compares plain numbers
  // and is only right when they all share the product's unit.
  const based = await toProductUnit(ctx, args.productId, args.productUomId, Number(args.productUomQty))
  if (based === null) return invalid('productUomId', 'đơn vị không cùng hệ đo với đơn vị gốc của sản phẩm')
  const locationId = args.locationId ?? picking?.locationId
  const locationDestId = args.locationDestId ?? picking?.locationDestId
  if (!locationId || !locationDestId) return invalid('locationId', 'cần source và destination location')
  const procureMethod = String(args.procureMethod ?? 'make_to_stock')
  if (!['make_to_stock', 'make_to_order'].includes(procureMethod))
    return invalid('procureMethod', 'move chỉ nhận make_to_stock hoặc make_to_order')
  await ctx.db.insertIfAbsent('stock.Move', {
    id: args.id,
    name: args.name,
    pickingId: args.pickingId ?? null,
    productId: args.productId,
    productUomId: based.uomId,
    productUomQty: String(based.quantity),
    quantity: '0',
    locationId,
    locationDestId,
    state: picking?.state === 'draft' ? 'draft' : 'confirmed',
    picked: false,
    procureMethod,
    ruleId: args.ruleId ?? null,
    origin: args.origin ?? null,
  })
  return { ok: true, id: args.id }
}

export async function reserveMoveHandler(ctx: Ctx, args: Row) {
  const move = (await ours(ctx, 'stock.Move', { id: args.id }))[0]
  if (!move) return invalid('id', 'move không tồn tại')
  try {
    return await ctx.tx((tx) => reserveMoveInContext(tx, move, args.selections))
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    throw error
  }
}

export async function reserveMovesHandler(ctx: Ctx, args: Row) {
  if (!Array.isArray(args.moves) || !args.moves.length)
    return invalid('moves', 'at least one move reservation is required')
  try {
    const results = await ctx.tx(async (tx) => {
      const held: Row[] = []
      for (const entry of args.moves as Row[]) {
        const move = (await ours(tx, 'stock.Move', { id: entry.id }))[0]
        if (!move) throw new InventoryRefused(invalid('moves', `move ${String(entry.id)} does not exist`))
        const result = await reserveMoveInContext(tx, move, entry.selections)
        if (result.ok !== true) throw new InventoryRefused(result)
        if (args.requireFull && result.state !== 'assigned')
          throw new InventoryRefused(invalid('stock', `insufficient stock for move ${String(move.id)}`))
        held.push({ id: String(move.id), reserved: result.reserved, state: result.state })
      }
      return held
    })
    return { ok: true, results }
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    throw error
  }
}

export async function saveMoveLineHandler(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx((tx) => saveMoveLineIn(tx, args))
  } catch (error) {
    if (error instanceof LotRefused || error instanceof InventoryRefused) return error.result
    throw error
  }
}

/**
 * Saves one move line inside the caller's transaction (`saveMoveLine`, and the transfer grid's
 * `savePickingLines`). A refusal before anything is written comes back as a result; one found
 * while writing throws `LotRefused` or `InventoryRefused`.
 */
export async function saveMoveLineIn(ctx: Ctx, args: Row): Promise<Row> {
  const move = (await ours(ctx, 'stock.Move', { id: args.moveId }))[0]
  if (!move) return invalid('moveId', 'move không tồn tại')
  if (['done', 'cancel'].includes(String(move.state)))
    return invalid('moveId', 'không thể sửa dòng của move đã kết thúc')
  const tracking = await trackingOf(ctx, move.productId)
  if (tracking !== 'none' && !args.lotId)
    return invalid('lotId', `${tracking} tracked product cần lot/serial`)
  if (!(Number(args.quantity) > 0)) return invalid('quantity', 'phải lớn hơn 0')
  if (tracking === 'serial' && compareQty(Number(args.quantity), 1, 0.000001) > 0)
    return invalid('quantity', 'serial move line không được lớn hơn 1')
  if (tracking === 'serial' && args.picked && compareQty(Number(args.quantity), 1, 0.000001) !== 0)
    return invalid('quantity', 'serial đã pick phải có quantity đúng 1')
  if (args.lotId) {
    const lot = (await ours(ctx, 'stock.Lot', { id: args.lotId }))[0]
    if (!lot || lot.productId !== move.productId) return invalid('lotId', 'lot/serial không thuộc sản phẩm')
  }
  const existing = (await ours(ctx, 'stock.MoveLine', { id: args.id }))[0]
  const values = {
    id: args.id,
    moveId: move.id,
    pickingId: move.pickingId,
    productId: move.productId,
    productUomId: move.productUomId,
    quantity: args.quantity,
    quantityProductUom: args.quantity,
    locationId: move.locationId,
    locationDestId: move.locationDestId,
    lotId: args.lotId ?? null,
    picked: args.picked ?? false,
  }
  const cs = ctx
    .change('stock.MoveLine', values, existing ?? null)
    .cast([
      'id',
      'moveId',
      'pickingId',
      'productId',
      'productUomId',
      'quantity',
      'quantityProductUom',
      'locationId',
      'locationDestId',
      'lotId',
      'picked',
    ])
    .required(['moveId', 'productId', 'productUomId', 'quantity', 'locationId', 'locationDestId'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  const source = (await ours(ctx, 'stock.Location', { id: move.locationId }))[0]
  if (source && ['internal', 'transit'].includes(String(source.usage))) {
    if (args.lotId) {
      const lot = (await ours(ctx, 'stock.Lot', { id: args.lotId }))[0]
      if (!lotAvailable(lot)) throw new LotRefused('lotId', 'lotUnavailable')
    }
    // A picked line still holds its reservation — completePicking and
    // cancelPicking both release it on the way out — so what the row holds
    // today is its quantity whether or not it has been picked. Excluding a
    // picked line here made re-saving one add its quantity to the quant a
    // second time: pressing the pick button twice reserved ten for a line
    // of five, or threw `cannot become over-reserved` when the quant had
    // nothing left to give.
    const oldQuantity = existing ? Number(existing.quantity) : 0
    const newQuantity = Number(args.quantity)
    if (existing && lotKey(existing.lotId) !== lotKey(args.lotId) && oldQuantity)
      await mutateTransferQuant(ctx, {
        productId: move.productId,
        locationId: move.locationId,
        lotId: existing.lotId,
        quantity: 0,
        reserved: -oldQuantity,
      })
    const delta = lotKey(existing?.lotId) === lotKey(args.lotId) ? newQuantity - oldQuantity : newQuantity
    if (delta)
      await mutateTransferQuant(ctx, {
        productId: move.productId,
        locationId: move.locationId,
        lotId: args.lotId,
        quantity: 0,
        reserved: delta,
      })
  }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  return { ok: true, id: args.id }
}

export async function reconcileReservationsHandler(ctx: Ctx, args: Row) {
  return ctx.tx(async (tx) => {
    // Every read here is narrowed to the company being written to, and quantId
    // keys on that same company. Read across the whole readable set instead — as
    // an unnarrowed select does — and another company's lines land under keys no
    // quant of theirs carries: their expectation reads as zero and this function
    // strips reservations it was asked to repair.
    const moves = new Map((await ours(tx, 'stock.Move')).map((move) => [String(move.id), move]))
    const locations = new Map(
      (await ours(tx, 'stock.Location')).map((location) => [String(location.id), location]),
    )
    const wanted = new Map<string, number>()
    for (const line of await ours(tx, 'stock.MoveLine')) {
      const move = moves.get(String(line.moveId))
      const location = locations.get(String(line.locationId))
      if (
        line.picked ||
        !move ||
        ['done', 'cancel'].includes(String(move.state)) ||
        !location ||
        !['internal', 'transit'].includes(String(location.usage)) ||
        (args.productId && line.productId !== args.productId) ||
        (args.locationId && line.locationId !== args.locationId)
      )
        continue
      const id = quantId(tx, line.productId, line.locationId, line.lotId)
      wanted.set(id, (wanted.get(id) ?? 0) + Number(line.quantity))
    }
    let changed = 0
    for (const quant of await ours(tx, 'stock.Quant')) {
      if (args.productId && quant.productId !== args.productId) continue
      if (args.locationId && quant.locationId !== args.locationId) continue
      const expected = wanted.get(String(quant.id)) ?? 0
      const delta = expected - Number(quant.reservedQuantity)
      if (Math.abs(delta) > 1e-12) {
        await mutateQuant(tx, {
          productId: quant.productId,
          locationId: quant.locationId,
          lotId: quant.lotId,
          quantity: 0,
          reserved: delta,
        })
        changed++
      }
    }
    return { ok: true, changed }
  })
}

export const movesFunctions: Record<string, FnSpec> = {
  addMove: defineFn({
    input: {
      id: 'id',
      name: 'text',
      pickingId: 'id?',
      productId: 'id',
      productUomId: 'id',
      productUomQty: 'decimal',
      locationId: 'id?',
      locationDestId: 'id?',
      procureMethod: 'text?',
      ruleId: 'id?',
      origin: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Picking',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
      'read:stock.Move',
      'write:stock.Move',
    ],
    idempotent: true,
    agent: true,
    handler: addMoveHandler,
  }),

  reserveMove: defineFn({
    input: { id: 'id', selections: 'json?' },
    output: { ok: 'bool', reserved: 'decimal?', state: 'text?', errors: 'json?' },
    effects: reserveEffects,
    idempotent: true,
    agent: true,
    handler: reserveMoveHandler,
  }),

  reserveMoves: defineFn({
    input: { moves: 'json', requireFull: 'bool?' },
    output: { ok: 'bool', results: 'json?', errors: 'json?' },
    effects: reserveEffects,
    idempotent: true,
    agent: true,
    handler: reserveMovesHandler,
  }),

  saveMoveLine: defineFn({
    input: { id: 'id', moveId: 'id', quantity: 'decimal', lotId: 'id?', picked: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Move',
      'read:stock.MoveLine',
      'write:stock.MoveLine',
      'read:stock.Lot',
      'read:stock.Location',
      'read:stock.Quant',
      'write:stock.Quant',
      'read:product.Product',
      'read:product.Template',
      'write:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: saveMoveLineHandler,
  }),

  reconcileReservations: defineFn({
    input: { productId: 'id?', locationId: 'id?' },
    output: { ok: 'bool', changed: 'int' },
    effects: [
      'read:stock.Move',
      'read:stock.MoveLine',
      'read:stock.Location',
      'read:stock.Quant',
      'write:stock.Quant',
      'read:product.Product',
      'read:product.Template',
      'write:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: reconcileReservationsHandler,
  }),
}
