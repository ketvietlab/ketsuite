import { defineFn, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { holdsFunction } from '../../product/functions/shared.ts'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { InventoryRefused } from '../inventory-validation.ts'
import { ours } from '../scope.ts'
import { insertMoveHandler, movesFunctions } from './moves.ts'
import { boundPicking } from './returns.ts'

const refused = (field: string, key: string) =>
  new InventoryRefused({ ok: false, errors: [{ field, messageKey: `stock.error.${key}` }] })

/**
 * The transfer's products grid adds every new product line at once, all or nothing. Each entry is a
 * move as `addMove` takes it (`id`, `name`, `productId`, `productUomId`, `productUomQty`) and joins
 * this transfer, at its locations; the caller must hold `addMove`. A move id already used by another
 * transfer is refused, so that a retried save only ever writes this transfer's moves.
 */
export async function addMovesHandler(ctx: Ctx, args: Row) {
  if (!Array.isArray(args.moves)) return refused('moves', 'pickingLinesInvalid').result
  try {
    return await ctx.tx(async (tx) => {
      const picking = (await ours(tx, 'stock.Picking', { id: args.pickingId }))[0]
      if (!picking || ['done', 'cancel'].includes(String(picking.state)))
        throw refused('pickingId', 'pickingClosed')
      // K21: a sales delivery's products are the order's, a return's the delivery's.
      if (await boundPicking(tx, picking.id)) throw refused('pickingId', 'pickingBound')
      if (!(await holdsFunction(tx, 'stock.addMove')))
        throw new KetError({ code: 'E_FN_NOT_PERMITTED', message: 'this role may not call stock.addMove' })
      for (const entry of args.moves as unknown[]) {
        const move = entry && typeof entry === 'object' ? (entry as Row) : {}
        if (typeof move.id !== 'string' || !move.id) throw refused('id', 'pickingLineMissing')
        const existing = (await tx.db.select('stock.Move', { id: move.id }))[0]
        if (existing && existing.pickingId !== picking.id) throw refused('id', 'pickingLineMissing')
        const added = await insertMoveHandler(tx, {
          id: move.id,
          name: String(move.name ?? ''),
          pickingId: picking.id,
          productId: String(move.productId ?? ''),
          productUomId: String(move.productUomId ?? ''),
          productUomQty: move.productUomQty == null ? '' : String(move.productUomQty),
        })
        if (added.ok !== true) throw new InventoryRefused(added)
      }
      return { ok: true, id: picking.id }
    })
  } catch (error) {
    if (error instanceof InventoryRefused) return error.result
    throw error
  }
}

export const pickingMoveFunctions: Record<string, FnSpec> = {
  addMoves: defineFn({
    // Optional so that a grid draft the modal could not read is refused by name, not by schema.
    input: { pickingId: 'id', moves: 'json?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...new Set([
        'read:stock.Move',
        ...(movesFunctions.addMove.effects ?? []),
        ...AUTHORIZATION_READ_EFFECTS,
      ]),
    ],
    idempotent: true,
    handler: addMovesHandler,
  }),
}
