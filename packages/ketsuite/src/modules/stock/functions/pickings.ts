import {
  allowsReceiptLot,
  receiptExpiryText,
  receiptLineRevision,
  materializeReceiptLot,
  RECEIPT_LOT_EFFECTS,
} from '../receipt-lots.ts'
import { allowsOverdelivery, stockQuantityError } from '../overdelivery.ts'
import { lotAvailable, LotRefused } from '../lot-policy.ts'
import { invalid, companyKey, PickingConflict, InventoryRefused } from '../inventory-validation.ts'
import {
  trackingOf,
  mutateTransferQuant,
  reservedOn,
  reserveEffects,
  updatePickingState,
} from '../stock-ledger.ts'
import { pickingViewEffects, pickingViews } from '../queries/picking-views.ts'
import { movesFunctions } from './moves.ts'
import { boundMoves, boundPicking, partnerRoleOf, relatedPickings, returnableDelivery } from './returns.ts'
import { nextPickingNameOfType, PICKING_NAME_EFFECTS } from '../picking-names.ts'
import { defineFn, deleteFrom, desc, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { compareQty } from '../../uom/convert.ts'
import { civilDayInstant } from '../../company/civil-date.ts'
import { pushFromCompletedMove } from '../routing.ts'
import { cancelMove } from '../move-demand.ts'
import {
  deliveredValue,
  primeValuation,
  VALUATION_EFFECTS,
  valueOperation,
  withoutCosts,
  type ValuationEntry,
} from '../valuation.ts'
import { company, ours } from '../scope.ts'
import {
  companyToday,
  offerFreedGoods,
  reservationOrder,
  reservationPolicy,
  reservationPolicyEffects,
  reserveFreedEffects,
  reservesNow,
  reservesOnItsOwn,
  reservesStock,
} from '../reservation-policy.ts'
import { quantityText } from '../quantity-text.ts'

export async function listPickingsHandler(ctx: Ctx, args: Row) {
  return args.state ? ours(ctx, 'stock.Picking', { state: args.state }) : ours(ctx, 'stock.Picking')
}

export async function getPickingHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return null
  const moves = await ours(ctx, 'stock.Move', { pickingId: args.id })
  const type = (await ours(ctx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
  return {
    ...picking,
    // Scrap and count transfers use inactive types that the type list leaves out.
    pickingTypeName: type?.name ?? null,
    // What the transfer plans (`incoming`, `outgoing`, `internal`), for a reader who may not list the types.
    pickingTypeCode: type?.code ?? null,
    // K60: whether it holds stock at all (receipts do not), how its warehouse holds goods for it and,
    // by date, from which day.
    reserves: reservesStock(type),
    reservation: await reservationPolicy(ctx, picking),
    partnerName: picking.partnerId
      ? String(
          (await ctx.db.select('partner.Partner', { id: picking.partnerId }))[0]?.name ?? picking.partnerId,
        )
      : null,
    // K19: a completed delivery with goods that may still come back.
    returnable: await returnableDelivery(ctx, picking, moves),
    partnerRole: await partnerRoleOf(ctx, picking),
    related: await relatedPickings(ctx, picking, moves),
    bound: boundMoves(moves),
    moves: await Promise.all(
      moves.map(async (move) => {
        const source = (await ours(ctx, 'stock.Location', { id: move.locationId }))[0]
        const destination = (await ours(ctx, 'stock.Location', { id: move.locationDestId }))[0]
        const lines = await ours(ctx, 'stock.MoveLine', { moveId: move.id })
        return {
          ...withoutCosts(move),
          allowOverdelivery: allowsOverdelivery(type?.code, source?.usage, destination?.usage),
          // Whether a manager may price this move's lines (K24); the price itself is not here.
          valuedReceipt:
            ['supplier', 'production'].includes(String(source?.usage)) &&
            ['internal', 'transit'].includes(String(destination?.usage)),
          receiptLotInput: allowsReceiptLot(
            type?.code,
            source?.usage,
            destination?.usage,
            await trackingOf(ctx, move.productId),
          ),
          lines: await Promise.all(
            lines.map(async (line) => {
              // A draft naming an existing lot will keep that lot's expiry, so show it before completion.
              const lot = line.lotId
                ? (await ours(ctx, 'stock.Lot', { id: line.lotId }))[0]
                : line.receiptLotName
                  ? (
                      await ours(ctx, 'stock.Lot', { productId: move.productId, name: line.receiptLotName })
                    )[0]
                  : undefined
              return {
                ...withoutCosts(line),
                receiptRevision: receiptLineRevision(line),
                receiptLotNumber: lot?.name ?? line.receiptLotName ?? null,
                receiptExpiryDate: await receiptExpiryText(
                  ctx,
                  lot?.expirationDate ?? line.receiptExpirationDate,
                ),
              }
            }),
          ),
        }
      }),
    ),
  }
}

export async function createPickingHandler(ctx: Ctx, args: Row) {
  const type = (await ours(ctx, 'stock.PickingType', { id: args.pickingTypeId }))[0]
  if (!type) return invalid('pickingTypeId', 'operation type không tồn tại')
  const locationId = args.locationId ?? type.defaultLocationSrcId
  const locationDestId = args.locationDestId ?? type.defaultLocationDestId
  if (!locationId || !locationDestId) return invalid('locationId', 'cần source và destination location')
  const moveType = String(args.moveType ?? 'direct')
  if (!['direct', 'one'].includes(moveType)) return invalid('moveType', 'phải là direct hoặc one')
  // A transfer named by no one takes its warehouse's next number of its kind (K17).
  const named =
    args.name ||
    ((await ours(ctx, 'stock.Picking', { id: args.id }))[0]
      ? undefined
      : await nextPickingNameOfType(ctx, args.pickingTypeId))
  const inserted = await ctx.db.insertIfAbsent('stock.Picking', {
    id: args.id,
    name: named ?? args.id,
    pickingTypeId: args.pickingTypeId,
    locationId,
    locationDestId,
    moveType,
    state: 'draft',
    backorderId: args.backorderId ?? null,
    scheduledDate: (await scheduledFrom(ctx, args.scheduledDate, null)) ?? new Date().toISOString(),
    dateDone: null,
    priority: args.priority === true,
  })
  return 'inserted' in inserted && !inserted.inserted ? { ok: true, id: args.id } : { ok: true, id: args.id }
}

export async function confirmPickingHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return invalid('id', 'transfer không tồn tại')
  if (picking.state === 'done' || picking.state === 'cancel') return invalid('state', 'transfer đã kết thúc')
  await ctx.db.update('stock.Picking', { id: args.id }, { state: 'confirmed' })
  for (const move of await ours(ctx, 'stock.Move', { pickingId: args.id }))
    if (move.state === 'draft') await ctx.db.update('stock.Move', { id: move.id }, { state: 'confirmed' })
  // K60: a person confirming follows the warehouse's method. Modules that confirm transfers in their
  // own flows (sale procurement, POS, manufacturing) reserve there, with the lots they need.
  if (args.reserve === true && picking.state === 'draft' && (await reservesNow(ctx, picking))) {
    const assigned = (await assignPickingHandler(ctx, { id: args.id })) as Row
    return { ok: true, id: args.id, state: assigned.state ?? 'confirmed' }
  }
  return { ok: true, id: args.id }
}

export async function completePickingHandler(ctx: Ctx, args: Row) {
  const completedResult = async (): Promise<Row> => {
    const backorder = (await ours(ctx, 'stock.Picking', { backorderId: args.id }))[0]
    return { ok: true, id: args.id, ...(backorder ? { backorderId: backorder.id } : {}) }
  }
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return invalid('id', 'transfer không tồn tại')
  if (picking.state === 'done') return completedResult()
  if (picking.state === 'cancel') return invalid('state', 'transfer đã hủy')
  const requested = new Map<string, number>()
  if (Array.isArray(args.quantities))
    for (const entry of args.quantities as Array<{ moveLineId: string; quantity: number }>)
      requested.set(String(entry.moveLineId), Number(entry.quantity))
  let alreadyDone = false
  let backorderId: string | null = null
  try {
    await ctx.tx(async (tx) => {
      const current = (await ours(tx, 'stock.Picking', { id: args.id }))[0]
      if (!current) throw new Error('transfer disappeared while completing')
      if (current.state === 'done') {
        alreadyDone = true
        return
      }
      if (current.state === 'cancel') throw new Error('transfer đã hủy')
      const lock = await tx.db.compareAndSet(
        'stock.Picking',
        { id: current.id },
        { state: current.state },
        { state: current.state },
      )
      if (!('dryRun' in lock) && !lock.matched) throw new PickingConflict()
      const type = (await ours(tx, 'stock.PickingType', { id: current.pickingTypeId }))[0]
      const moves = await ours(tx, 'stock.Move', { pickingId: args.id })
      // Open each product's running value from the stock held before this transfer moves any of it.
      await primeValuation(
        tx,
        moves.map((move) => move.productId),
      )
      const valuing: ValuationEntry[] = []
      const remaining: Array<{ move: Row; quantity: number; unitCost: unknown }> = []
      const arrived: unknown[] = []
      for (const move of moves) {
        const tracking = await trackingOf(tx, move.productId)
        const destination = (await ours(tx, 'stock.Location', { id: move.locationDestId }))[0]!
        const moveSource = (await ours(tx, 'stock.Location', { id: move.locationId }))[0]
        const overdelivery = allowsOverdelivery(type?.code, moveSource?.usage, destination?.usage)
        const lines = await ours(tx, 'stock.MoveLine', { moveId: move.id })
        const returnOf = move.originReturnedMoveId
          ? await deliveredValue(tx, move.originReturnedMoveId)
          : undefined
        let done = 0
        // The unit cost agreed on a line that was not received travels with what is left.
        let carried: unknown = null
        for (const line of lines) {
          // A line records the location its goods actually sit in, which is the
          // sub-location reserveMove drew them from rather than the parent the
          // move names. Releasing and deducting at the move's location would
          // touch a quant the line never held.
          const source = (await ours(tx, 'stock.Location', { id: line.locationId }))[0]!
          const reserved = Number(line.quantity)
          if (args.pickedOnly && !line.picked) {
            carried ??= line.unitCost ?? null
            if ((source.usage === 'internal' || source.usage === 'transit') && reserved)
              await mutateTransferQuant(tx, {
                productId: move.productId,
                locationId: line.locationId,
                lotId: line.lotId,
                quantity: 0,
                reserved: -reserved,
              })
            await tx.db.update(
              'stock.MoveLine',
              { id: line.id },
              { quantity: '0', quantityProductUom: '0', picked: true },
            )
            continue
          }
          const quantity = requested.has(String(line.id))
            ? requested.get(String(line.id))!
            : requested.size
              ? 0
              : reserved
          if (!Number.isFinite(quantity) || quantity < 0 || (!overdelivery && quantity > reserved))
            throw new InventoryRefused(stockQuantityError('stock.error.doneOverDemand'))
          if (quantity < reserved) carried ??= line.unitCost ?? null
          if (typeof line.receiptLotName === 'string' && !line.lotId) {
            if (quantity === 0) {
              await tx.db.update(
                'stock.MoveLine',
                { id: line.id },
                { quantity: '0', quantityProductUom: '0', picked: true },
              )
              continue
            }
            line.lotId = await materializeReceiptLot(tx, move, current, line)
          }
          if (tracking !== 'none' && !line.lotId)
            throw new Error(`${tracking} tracked product requires a lot/serial`)
          if (tracking === 'serial' && quantity > 0 && compareQty(quantity, 1, 0.000001) !== 0)
            throw new Error('serial picked move line quantity must equal 1')
          if (
            quantity > 0 &&
            line.lotId &&
            ['internal', 'transit'].includes(String(source.usage)) &&
            !['supplier', 'inventory'].includes(String(destination?.usage))
          ) {
            const lot = (await ours(tx, 'stock.Lot', { id: line.lotId }))[0]
            if (!lotAvailable(lot)) throw new LotRefused('lotId', 'lotUnavailable')
          }
          if (source.usage === 'internal' || source.usage === 'transit') {
            // Release what this line holds, capped at what the quant has left to
            // release. Both reserveMove and saveMoveLine reserve as they write a
            // line, so the two agree in normal operation; the cap is a floor
            // against a ledger already off, where releasing the full quantity
            // would drive the mirror negative and throw, leaving the transfer
            // impossible to complete by any later call.
            const held = await reservedOn(tx, move.productId, line.locationId, line.lotId)
            await mutateTransferQuant(tx, {
              productId: move.productId,
              locationId: line.locationId,
              lotId: line.lotId,
              quantity: -quantity,
              requireAvailable:
                quantity > 0 && !['supplier', 'inventory'].includes(String(destination?.usage)),
              reserved: -Math.min(reserved, held),
            })
          } else {
            await mutateTransferQuant(tx, {
              productId: move.productId,
              locationId: line.locationId,
              lotId: line.lotId,
              quantity: -quantity,
              reserved: 0,
            })
          }
          // Keep both sides of every completed move in the quant ledger. The
          // forecast still counts only internal/transit locations.
          if (destination)
            await mutateTransferQuant(tx, {
              productId: move.productId,
              locationId: move.locationDestId,
              lotId: line.lotId,
              quantity,
              reserved: 0,
            })
          await tx.db.update(
            'stock.MoveLine',
            { id: line.id },
            {
              quantity: quantityText(quantity),
              quantityProductUom: quantityText(quantity),
              picked: true,
              lotId: line.lotId ?? null,
            },
          )
          if (quantity > 0)
            valuing.push({
              key: String(line.id),
              productId: move.productId,
              productUomId: move.productUomId,
              moveId: move.id,
              moveLineId: line.id,
              quantity,
              sourceUsage: source.usage,
              destinationUsage: destination?.usage,
              unitCost: line.unitCost ?? move.priceUnit,
              returnOf,
            })
          done += quantity
        }
        if (!overdelivery && done > Number(move.productUomQty) + 0.000001)
          throw new InventoryRefused(stockQuantityError('stock.error.doneOverDemand'))
        await tx.db.update(
          'stock.Move',
          { id: move.id },
          { quantity: quantityText(done), picked: true, state: 'done' },
        )
        await pushFromCompletedMove(tx, move, done)
        if (done > 0) arrived.push(move.productId)
        const left = Math.max(0, Number(move.productUomQty) - done)
        if (left > 0) remaining.push({ move, quantity: left, unitCost: carried })
      }
      const finishedAt = new Date().toISOString()
      const valued = await valueOperation(
        tx,
        {
          id: String(current.id),
          name: String(current.name),
          partnerId: current.partnerId,
          date: finishedAt,
        },
        valuing,
      )
      for (const line of valued)
        await tx.db.update('stock.MoveLine', { id: line.key }, { value: line.value, unitCost: line.unitCost })
      const completed = await tx.db.compareAndSet(
        'stock.Picking',
        { id: args.id },
        { state: current.state },
        { state: 'done', dateDone: finishedAt },
      )
      if (!('dryRun' in completed) && !completed.matched) throw new PickingConflict()
      // K60: what a receipt or transfer brought in goes to the transfers waiting for it.
      if (type?.code === 'incoming' || type?.code === 'internal')
        await offerFreedGoods(tx, current.id, arrived)

      const shouldBackorder =
        remaining.length > 0 && (args.createBackorder ?? type?.createBackorder !== 'never')
      if (shouldBackorder) {
        backorderId = companyKey(ctx, String(args.id), 'backorder')
        await tx.db.insertIfAbsent('stock.Picking', {
          id: backorderId,
          name:
            (await nextPickingNameOfType(tx, current.pickingTypeId)) ?? `${String(current.name)} backorder`,
          pickingTypeId: current.pickingTypeId,
          locationId: current.locationId,
          locationDestId: current.locationDestId,
          moveType: current.moveType,
          state: 'confirmed',
          backorderId: current.id,
          partnerId: current.partnerId ?? null,
          scheduledDate: finishedAt,
          dateDone: null,
        })
        for (const { move, quantity, unitCost } of remaining) {
          const id = companyKey(ctx, String(move.id), 'backorder')
          await tx.db.insertIfAbsent('stock.Move', {
            ...Object.fromEntries(Object.entries(move).filter(([key]) => key !== 'companyId')),
            id,
            pickingId: backorderId,
            productUomQty: quantityText(quantity),
            quantity: '0',
            state: 'confirmed',
            picked: false,
            priceUnit: unitCost ?? move.priceUnit ?? null,
          })
          await tx.db.insertIfAbsent('stock.MoveLink', {
            id: `${String(move.id)}:${id}`,
            originMoveId: move.id,
            destinationMoveId: id,
          })
        }
      }
    })
  } catch (error) {
    if (error instanceof LotRefused || error instanceof InventoryRefused) return error.result
    if (error instanceof PickingConflict) {
      const latest = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
      if (latest?.state === 'done') return completedResult()
      return invalid('state', 'transfer đã thay đổi, hãy tải lại')
    }
    throw error
  }
  if (alreadyDone) return completedResult()
  return { ok: true, id: args.id, backorderId }
}

/**
 * The planned moment a form's bare day (YYYY-MM-DD) names, read where the company keeps its books,
 * at the time of day the transfer already has (C30): not midnight UTC.
 */
const scheduledFrom = async (ctx: Ctx, value: unknown, held: unknown): Promise<unknown> =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? civilDayInstant(value, (await companyToday(ctx)).zone, held == null ? null : String(held))
    : value

export async function savePickingHandler(ctx: Ctx, args: Row) {
  const type = (await ours(ctx, 'stock.PickingType', { id: args.pickingTypeId }))[0]
  if (!type) return invalid('pickingTypeId', 'operation type không tồn tại')
  const existing = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  // K21: a sales delivery or a return keeps its operation type and ends; only when and how urgent change.
  if (
    existing &&
    (await boundPicking(ctx, existing.id)) &&
    (['pickingTypeId', 'locationId', 'locationDestId'] as const).some(
      (key) => args[key] != null && String(args[key]) !== String(existing[key]),
    )
  )
    return { ok: false, errors: [{ field: 'locationId', messageKey: 'stock.error.pickingBound' }] }
  const values = {
    ...args,
    locationId: args.locationId ?? existing?.locationId ?? type.defaultLocationSrcId,
    locationDestId: args.locationDestId ?? existing?.locationDestId ?? type.defaultLocationDestId,
    moveType: args.moveType ?? 'direct',
    state: existing?.state ?? 'draft',
    backorderId: args.backorderId ?? existing?.backorderId ?? null,
    scheduledDate:
      (await scheduledFrom(ctx, args.scheduledDate, existing?.scheduledDate)) ??
      existing?.scheduledDate ??
      new Date().toISOString(),
    dateDone: existing?.dateDone ?? null,
    priority: args.priority == null ? (existing?.priority ?? false) : args.priority === true,
  }
  if (!values.locationId || !values.locationDestId)
    return invalid('locationId', 'cần source và destination location')
  const cs = ctx
    .change('stock.Picking', values, existing ?? null)
    .cast([
      'id',
      'name',
      'pickingTypeId',
      'locationId',
      'locationDestId',
      'moveType',
      'state',
      'backorderId',
      'scheduledDate',
      'dateDone',
      'priority',
    ])
    .required(['name', 'pickingTypeId', 'locationId', 'locationDestId', 'moveType', 'state', 'scheduledDate'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
  return { ok: true, id: args.id }
}

export async function assignPickingHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return invalid('id', 'transfer không tồn tại')
  if (picking.state === 'draft') return invalid('state', 'xác nhận transfer trước khi giữ hàng')
  if (picking.state === 'done' || picking.state === 'cancel') return invalid('state', 'transfer đã kết thúc')
  // K60: reserving by hand lifts what giving back set; runs of their own skip paused transfers.
  if (picking.reservationPaused)
    await ctx.db.update('stock.Picking', { id: args.id }, { reservationPaused: false })
  const allocations: Row[] = []
  const shortages: Row[] = []
  for (const move of await ours(ctx, 'stock.Move', { pickingId: args.id })) {
    const result = (await movesFunctions.reserveMove!.handler(ctx, { id: move.id })) as Row
    const reserved = Number(result.reserved ?? 0)
    allocations.push(...(await ours(ctx, 'stock.MoveLine', { moveId: move.id })))
    const shortage = Math.max(0, Number(move.productUomQty) - reserved)
    if (shortage) shortages.push({ moveId: move.id, quantity: String(shortage) })
  }
  const updated = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]!
  return { ok: true, state: updated.state, allocations, shortages }
}

/**
 * K60: gives back what a transfer holds. Lines not yet picked return their quantity to the
 * location and go; picked lines stay, so recorded work is never lost. The transfer then waits for a
 * person: no run of its own reserves it again until someone presses reserve.
 */
export async function unreservePickingHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return invalid('id', 'transfer không tồn tại')
  if (picking.state === 'done' || picking.state === 'cancel')
    return { ok: false, errors: [{ field: 'state', messageKey: 'stock.error.pickingClosed' }] }
  // A receipt's open lines are drafts of goods arriving, not stock set aside.
  if (!reservesStock((await ours(ctx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]))
    return { ok: false, errors: [{ field: 'id', messageKey: 'stock.error.pickingNotReserving' }] }
  let released = 0
  await ctx.tx(async (tx) => {
    for (const move of await ours(tx, 'stock.Move', { pickingId: args.id })) {
      if (['done', 'cancel'].includes(String(move.state))) continue
      let kept = 0
      for (const line of await ours(tx, 'stock.MoveLine', { moveId: move.id })) {
        if (line.picked) {
          kept += Number(line.quantity)
          continue
        }
        const source = (await ours(tx, 'stock.Location', { id: line.locationId }))[0]
        if (source && ['internal', 'transit'].includes(String(source.usage)))
          await mutateTransferQuant(tx, {
            productId: move.productId,
            locationId: line.locationId,
            lotId: line.lotId,
            quantity: 0,
            reserved: -Number(line.quantity),
          })
        await tx.db.del(
          deleteFrom(tx.table('stock.MoveLine')).where(eq(tx.table('stock.MoveLine').id, line.id)),
        )
        released += Number(line.quantity)
      }
      if (move.state !== 'draft')
        await tx.db.update(
          'stock.Move',
          { id: move.id },
          {
            state:
              compareQty(kept, Number(move.productUomQty), 0.000001) >= 0
                ? 'assigned'
                : kept > 0
                  ? 'partially_available'
                  : 'confirmed',
            quantity: String(kept),
          },
        )
    }
    await tx.db.update('stock.Picking', { id: args.id }, { reservationPaused: true })
    await updatePickingState(tx, args.id)
  })
  const updated = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]!
  return { ok: true, id: args.id, state: updated.state, released: String(released) }
}

/**
 * K60: reserves several transfers at once, priority first, then soonest scheduled. With `due`, it takes
 * every confirmed transfer still short of goods that may reserve on its own: its warehouse reserves on
 * confirmation, or by date and its day has come, and no person gave its goods back. `productIds`
 * narrows that to transfers short of those products, the goods a receipt or cancellation freed.
 */
export async function reservePickingsHandler(ctx: Ctx, args: Row) {
  const open = (row: Row) => ['confirmed', 'waiting', 'assigned'].includes(String(row.state))
  let pickings: Row[]
  if (args.due === true) {
    const { today, zone } = await companyToday(ctx)
    const products = Array.isArray(args.productIds) ? new Set(args.productIds.map(String)) : null
    const short = (move: Row) =>
      !['done', 'cancel', 'assigned'].includes(String(move.state)) &&
      (!products || products.has(String(move.productId)))
    pickings = []
    for (const row of (await ours(ctx, 'stock.Picking')).filter(open)) {
      if (!(await ours(ctx, 'stock.Move', { pickingId: row.id })).some(short)) continue
      if (await reservesOnItsOwn(ctx, row, today, zone)) pickings.push(row)
    }
  } else {
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : []
    if (!ids.length) return invalid('ids', 'chọn ít nhất một phiếu')
    pickings = (await ours(ctx, 'stock.Picking')).filter((row) => ids.includes(String(row.id)))
    if (pickings.length !== new Set(ids).size) return invalid('ids', 'phiếu không tồn tại')
    pickings = pickings.filter(open)
  }
  const results: Row[] = []
  for (const picking of pickings.sort(reservationOrder)) {
    const assigned = (await assignPickingHandler(ctx, { id: picking.id })) as Row
    results.push({ id: picking.id, name: picking.name, state: assigned.state ?? picking.state })
  }
  return { ok: true, results }
}

export async function cancelPickingHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return invalid('id', 'transfer không tồn tại')
  if (picking.state === 'done') return invalid('state', 'transfer đã hoàn thành')
  // K18: a person cancelling says why. A transfer cancelled with its order or by a flow (sale,
  // channel, manufacturing) passes no reason at all; a reason given empty is refused.
  const reason = args.reason === undefined || args.reason === null ? null : String(args.reason).trim()
  if (reason === '')
    return { ok: false, errors: [{ field: 'reason', messageKey: 'stock.error.cancelReason' }] }
  await ctx.tx(async (tx) => {
    const freed: unknown[] = []
    for (const move of await ours(tx, 'stock.Move', { pickingId: args.id }))
      if ((await cancelMove(tx, move)) > 0) freed.push(move.productId)
    // K60: what it held goes to the transfers waiting for it.
    await offerFreedGoods(tx, args.id, freed)
    await tx.db.update(
      'stock.Picking',
      { id: args.id },
      { state: 'cancel', ...(reason ? { cancelReason: reason } : {}) },
    )
  })
  return { ok: true, id: args.id }
}

export async function validatePickingHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return invalid('id', 'transfer không tồn tại')
  const type = (await ours(ctx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
  const moves = await ours(ctx, 'stock.Move', { pickingId: args.id })
  const lines = new Map<unknown, Row[]>()
  for (const move of moves) lines.set(move.id, await ours(ctx, 'stock.MoveLine', { moveId: move.id }))
  // Nothing ticked as picked: the transfer is done as held, as the mock does. Nothing held either:
  // there is nothing to complete, rather than a done transfer that moved nothing (K24, mock
  // `stockNothingDone`).
  const pickedOnly = [...lines.values()].some((rows) => rows.some((line) => line.picked))
  const counted = (line: Row) => (!pickedOnly || line.picked ? Number(line.quantity) : 0)
  if (!pickedOnly && ![...lines.values()].some((rows) => rows.some((line) => Number(line.quantity) > 0)))
    return stockQuantityError('stock.error.nothingDone')
  let hasRemaining = false
  for (const move of moves) {
    const done = lines.get(move.id)!.reduce((sum, line) => sum + counted(line), 0)
    if (done + 1e-12 < Number(move.productUomQty)) hasRemaining = true
  }
  let createBackorder = false
  if (hasRemaining && type?.createBackorder === 'always') createBackorder = true
  else if (hasRemaining && type?.createBackorder === 'ask') {
    if (!['create', 'cancel'].includes(String(args.backorder ?? '')))
      return invalid('backorder', 'phải chọn create hoặc cancel')
    createBackorder = args.backorder === 'create'
  }
  return pickingsFunctions.completePicking!.handler(ctx, {
    id: args.id,
    createBackorder,
    pickedOnly,
  })
}

export async function listPickingViewsHandler(ctx: Ctx, args: Row) {
  const P = ctx.table('stock.Picking')
  const limit = Math.max(1, Math.min(Math.trunc(Number(args.limit) || 20), 101))
  const rows = await ctx.db.all(
    from(P)
      .where(eq(P.companyId, company(ctx)), ...(args.state ? [eq(P.state, String(args.state))] : []))
      .orderBy(desc(P.scheduledDate), desc(P.id))
      .limit(limit)
      .offset(Math.max(0, Math.trunc(Number(args.offset) || 0))),
  )
  return pickingViews(ctx, rows)
}

export async function getPickingViewHandler(ctx: Ctx, args: Row) {
  const P = ctx.table('stock.Picking')
  const row = await ctx.db.one(from(P).where(eq(P.companyId, company(ctx)), eq(P.id, String(args.id))))
  return row ? (await pickingViews(ctx, [row]))[0] : null
}

const completePicking = defineFn({
  input: { id: 'id', quantities: 'json?', createBackorder: 'bool?', pickedOnly: 'bool?' },
  output: { ok: 'bool', id: 'id?', backorderId: 'id?', errors: 'json?' },
  // Receipt lots and valuation share reads with the transfer itself; list each effect once.
  effects: [
    ...new Set([
      ...RECEIPT_LOT_EFFECTS,
      ...VALUATION_EFFECTS,
      ...PICKING_NAME_EFFECTS,
      ...reserveFreedEffects,
      'read:stock.Picking',
      'write:stock.Picking',
      'read:stock.PickingType',
      'read:stock.Move',
      'write:stock.Move',
      'read:stock.MoveLine',
      'write:stock.MoveLine',
      'read:stock.Location',
      'read:stock.Lot',
      'read:stock.Quant',
      'write:stock.Quant',
      'read:product.Product',
      'read:product.Template',
      'write:product.Template',
      'read:product.Category',
      'read:stock.Route',
      'read:stock.Rule',
      'read:stock.ProductRoute',
      'read:stock.CategoryRoute',
      'read:stock.WarehouseRoute',
      'read:stock.MoveLink',
      'write:stock.MoveLink',
    ]),
  ],
  idempotent: true,
  agent: true,
  handler: completePickingHandler,
})

/** It reserves every move of a transfer, so it needs what reserveMove needs. */
const ASSIGN_EFFECTS = [
  ...(movesFunctions.reserveMove!.effects ?? []),
  'read:stock.Picking',
  'write:stock.Picking',
]

export const pickingsFunctions: Record<string, FnSpec> = {
  listPickings: defineFn({
    input: { state: 'text?' },
    effects: ['read:stock.Picking'],
    agent: true,
    handler: listPickingsHandler,
  }),

  getPicking: defineFn({
    input: { id: 'id' },
    effects: [
      'read:stock.Lot',
      'read:product.Product',
      'read:product.Template',
      'read:company.Company',
      'read:stock.Picking',
      'read:stock.Move',
      'read:stock.MoveLine',
      'read:partner.Partner',
      'read:stock.PickingType',
      'read:stock.Location',
      'read:stock.Warehouse',
    ],
    agent: true,
    handler: getPickingHandler,
  }),

  createPicking: defineFn({
    input: {
      id: 'id',
      name: 'text?',
      pickingTypeId: 'id',
      locationId: 'id?',
      locationDestId: 'id?',
      moveType: 'text?',
      scheduledDate: 'datetime?',
      backorderId: 'id?',
      priority: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.PickingType',
      'read:stock.Picking',
      'write:stock.Picking',
      'read:company.Company',
      ...PICKING_NAME_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: createPickingHandler,
  }),

  confirmPicking: defineFn({
    // K60: `reserve` follows the warehouse's reservation method, as a person confirming does.
    input: { id: 'id', reserve: 'bool?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: [
      ...new Set([
        'read:stock.Picking',
        'read:stock.Move',
        'write:stock.Picking',
        'write:stock.Move',
        ...ASSIGN_EFFECTS,
        ...reservationPolicyEffects,
      ]),
    ],
    idempotent: true,
    agent: true,
    handler: confirmPickingHandler,
  }),

  completePicking,

  savePicking: defineFn({
    input: {
      id: 'id',
      name: 'text',
      pickingTypeId: 'id',
      locationId: 'id?',
      locationDestId: 'id?',
      moveType: 'text?',
      scheduledDate: 'datetime?',
      backorderId: 'id?',
      priority: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    // It reads the moves to keep a sales delivery or a return on its own ends (K21).
    effects: [
      'read:stock.PickingType',
      'read:stock.Picking',
      'write:stock.Picking',
      'read:stock.Move',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: savePickingHandler,
  }),

  assignPicking: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', state: 'text?', allocations: 'json?', shortages: 'json?', errors: 'json?' },
    // It reserves every move of the transfer, so it needs what reserveMove needs.
    effects: ASSIGN_EFFECTS,
    idempotent: true,
    agent: true,
    handler: assignPickingHandler,
  }),
  unreservePicking: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', state: 'text?', released: 'decimal?', errors: 'json?' },
    // Giving back moves the same quants reserving does.
    effects: reserveEffects,
    idempotent: true,
    agent: true,
    handler: unreservePickingHandler,
  }),
  reservePickings: defineFn({
    input: { ids: 'json?', due: 'bool?' },
    output: { ok: 'bool', results: 'json?', errors: 'json?' },
    effects: [...new Set([...ASSIGN_EFFECTS, ...reservationPolicyEffects])],
    idempotent: true,
    agent: true,
    handler: reservePickingsHandler,
  }),

  cancelPicking: defineFn({
    input: { id: 'id', reason: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...reserveFreedEffects,
      'read:stock.Picking',
      'write:stock.Picking',
      'read:stock.Move',
      'write:stock.Move',
      'read:stock.MoveLine',
      'write:stock.MoveLine',
      'read:stock.Location',
      'read:stock.Quant',
      'write:stock.Quant',
      'read:product.Product',
      'read:product.Template',
      'write:product.Template',
    ],
    idempotent: true,
    agent: true,
    handler: cancelPickingHandler,
  }),

  validatePicking: defineFn({
    input: { id: 'id', backorder: 'text?' },
    output: { ok: 'bool', id: 'id?', backorderId: 'id?', errors: 'json?' },
    effects: completePicking.effects,
    idempotent: true,
    agent: true,
    handler: validatePickingHandler,
  }),

  listPickingViews: defineFn({
    input: { state: 'text?', limit: 'int?', offset: 'int?' },
    effects: pickingViewEffects,
    agent: true,
    handler: listPickingViewsHandler,
  }),

  getPickingView: defineFn({
    input: { id: 'id' },
    effects: pickingViewEffects,
    agent: true,
    handler: getPickingViewHandler,
  }),
}
