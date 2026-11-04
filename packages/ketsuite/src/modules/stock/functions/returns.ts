import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { PickingConflict } from '../inventory-validation.ts'
import { nextPickingNameOfType, PICKING_NAME_EFFECTS } from '../picking-names.ts'
import { ours } from '../scope.ts'

const refusal = (field: string, key: string) => ({
  ok: false,
  errors: [{ field, messageKey: `stock.error.${key}` }],
})

class ReturnRefused extends Error {
  readonly result: ReturnType<typeof refusal>
  constructor(result: ReturnType<typeof refusal>) {
    super(result.errors[0]!.messageKey)
    this.result = result
  }
}

/**
 * K19: what of a delivered move can still come back. A completed return claims what it received and an
 * open one what it expects, so two open returns cannot claim the same goods; cancelled ones claim nothing.
 */
export async function returnableOf(ctx: Ctx, move: Row): Promise<number> {
  if (move.state !== 'done') return 0
  let claimed = 0
  for (const back of await ours(ctx, 'stock.Move', { originReturnedMoveId: move.id }))
    if (back.state === 'done') claimed += Number(back.quantity)
    else if (back.state !== 'cancel') claimed += Number(back.productUomQty)
  return Math.max(0, Number(move.quantity) - claimed)
}

/** Whether a completed transfer delivered goods to a customer that may still come back. */
export async function returnableDelivery(ctx: Ctx, picking: Row, moves: Row[]): Promise<boolean> {
  if (picking.state !== 'done') return false
  const destination = (await ours(ctx, 'stock.Location', { id: picking.locationDestId }))[0]
  if (destination?.usage !== 'customer') return false
  for (const move of moves) if ((await returnableOf(ctx, move)) > 0.000001) return true
  return false
}

/** Who a transfer's partner is to it: a delivery or a return deals with a customer, a receipt with a supplier. */
export async function partnerRoleOf(ctx: Ctx, picking: Row): Promise<'customer' | 'supplier' | null> {
  const usages: unknown[] = []
  for (const id of [picking.locationId, picking.locationDestId])
    usages.push((await ours(ctx, 'stock.Location', { id }))[0]?.usage)
  if (usages.includes('customer')) return 'customer'
  if (usages.includes('supplier')) return 'supplier'
  return null
}

/**
 * K21: a sales delivery (and its backorders) follows its order and a return its delivery: their operation
 * type, ends and products are not the warehouse's to change, only when and how much (mock `bound`).
 */
export const boundMoves = (moves: Row[]) =>
  moves.some((move) => Boolean(move.saleLineId) || Boolean(move.originReturnedMoveId))

export async function boundPicking(ctx: Ctx, pickingId: unknown) {
  return boundMoves(await ours(ctx, 'stock.Move', { pickingId }))
}

const named = (row: Row | undefined) => (row ? { id: String(row.id), name: String(row.name) } : null)

/**
 * K19: the transfers a transfer came from and those that followed it (its backorders and returns), so each
 * page opens the others.
 */
export async function relatedPickings(ctx: Ctx, picking: Row, moves: Row[]) {
  const pickingOf = async (id: unknown) => (id ? (await ours(ctx, 'stock.Picking', { id }))[0] : undefined)
  const origin = moves.find((move) => move.originReturnedMoveId)?.originReturnedMoveId
  const delivered = origin ? (await ours(ctx, 'stock.Move', { id: origin }))[0] : undefined
  const returnIds = new Set<string>()
  for (const move of moves)
    for (const back of await ours(ctx, 'stock.Move', { originReturnedMoveId: move.id }))
      if (back.pickingId) returnIds.add(String(back.pickingId))
  const returns = []
  for (const id of returnIds) {
    const row = named(await pickingOf(id))
    if (row) returns.push(row)
  }
  return {
    backorderOf: named(await pickingOf(picking.backorderId)),
    returnOf: named(await pickingOf(delivered?.pickingId)),
    backorders: (await ours(ctx, 'stock.Picking', { backorderId: picking.id })).map((row) => named(row)!),
    returns,
  }
}

export async function createReturnHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return refusal('id', 'returnMissing')
  const existing = (await ours(ctx, 'stock.Picking', { id: args.returnId }))[0]
  if (existing) {
    // A replay of the same request opens the return it already made.
    const moves = await ours(ctx, 'stock.Move', { pickingId: existing.id })
    const origins = await ours(ctx, 'stock.Move', { pickingId: picking.id })
    const ownIds = new Set(origins.map((move) => String(move.id)))
    return moves.length && moves.every((move) => ownIds.has(String(move.originReturnedMoveId)))
      ? { ok: true, id: existing.id }
      : refusal('returnId', 'returnIdTaken')
  }
  const customer = (await ours(ctx, 'stock.Location', { id: picking.locationDestId }))[0]
  if (customer?.usage !== 'customer') return refusal('id', 'returnOnlyDelivery')
  const type = (await ours(ctx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
  const receipts = type?.warehouseId
    ? (await ours(ctx, 'stock.PickingType', { warehouseId: type.warehouseId, code: 'incoming' })).filter(
        (row) => row.active !== false,
      )
    : []
  if (!receipts.length) return refusal('id', 'returnNoReceiptType')
  try {
    await ctx.tx(async (tx) => {
      // Only a completed delivery matches, and holding it serialises its returns so two cannot both
      // take the last units.
      const lock = await tx.db.compareAndSet(
        'stock.Picking',
        { id: picking.id },
        { state: 'done' },
        { state: 'done' },
      )
      if (!('dryRun' in lock) && !lock.matched) throw new PickingConflict()
      const lines: Array<{ move: Row; quantity: number }> = []
      for (const move of await ours(tx, 'stock.Move', { pickingId: picking.id })) {
        const quantity = await returnableOf(tx, move)
        if (quantity > 0.000001) lines.push({ move, quantity })
      }
      if (!lines.length) throw new ReturnRefused(refusal('id', 'returnNothingLeft'))
      await tx.db.insert('stock.Picking', {
        id: args.returnId,
        name: (await nextPickingNameOfType(tx, receipts[0]!.id)) ?? `${String(picking.name)} return`,
        pickingTypeId: receipts[0]!.id,
        locationId: picking.locationDestId,
        locationDestId: picking.locationId,
        moveType: picking.moveType,
        state: 'confirmed',
        backorderId: null,
        partnerId: picking.partnerId ?? null,
        replenishmentGroup: null,
        scheduledDate: new Date().toISOString(),
        dateDone: null,
      })
      for (const { move, quantity } of lines)
        await tx.db.insert('stock.Move', {
          // Fields other modules keep on the move (the sales line it delivered) follow it back.
          ...Object.fromEntries(Object.entries(move).filter(([key]) => key !== 'companyId')),
          id: `${String(args.returnId)}:${String(move.id)}`,
          pickingId: args.returnId,
          productUomQty: String(quantity),
          replenishmentQuantity: null,
          replenishmentUomId: null,
          quantity: '0',
          locationId: move.locationDestId,
          locationDestId: move.locationId,
          state: 'confirmed',
          picked: false,
          procureMethod: 'make_to_stock',
          ruleId: null,
          origin: picking.name,
          priceUnit: null,
          originReturnedMoveId: move.id,
        })
    })
  } catch (error) {
    if (error instanceof ReturnRefused) return error.result
    if (error instanceof PickingConflict) return refusal('id', 'returnNotDone')
    throw error
  }
  return { ok: true, id: args.returnId }
}

export const returnFunctions: Record<string, FnSpec> = {
  createReturn: defineFn({
    input: { id: 'id', returnId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Picking',
      'write:stock.Picking',
      'read:stock.Move',
      'write:stock.Move',
      'read:stock.PickingType',
      'read:stock.Location',
      ...PICKING_NAME_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: createReturnHandler,
  }),
}
