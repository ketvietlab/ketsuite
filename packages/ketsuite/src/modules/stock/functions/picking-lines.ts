import { defineFn, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { holdsFunction } from '../../product/functions/shared.ts'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { InventoryRefused, PickingConflict } from '../inventory-validation.ts'
import { LotRefused } from '../lot-policy.ts'
import { allowsReceiptLot, prepareReceiptLotIn } from '../receipt-lots.ts'
import { ours } from '../scope.ts'
import { trackingOf } from '../stock-ledger.ts'
import { movesFunctions, saveMoveLineIn } from './moves.ts'
import { receiptLotFunctions } from './receipt-lots.ts'
import { setReceiptUnitCostHandler, valuationFunctions } from './valuation.ts'

const refused = (field: string, key: string) =>
  new InventoryRefused({ ok: false, errors: [{ field, messageKey: `stock.error.${key}` }] })
const forbidden = (fn: string) =>
  new KetError({ code: 'E_FN_NOT_PERMITTED', message: `this role may not call ${fn}` })

/**
 * The transfer grid saves every line it changed at once, all or nothing. Each entry names its move
 * line `id` and `moveId`. With `quantity` it saves the line as `saveMoveLine` would, or as
 * `prepareReceiptLot` for a lot-tracked receipt (`name`, `expirationDate`, `expectedRevision`);
 * with `unitCost` it prices the line as `setReceiptUnitCost`. Each part needs the caller to hold
 * that function, and every line must belong to this transfer.
 */
export async function savePickingLinesHandler(ctx: Ctx, args: Row) {
  if (!Array.isArray(args.lines)) return refused('lines', 'pickingLinesInvalid').result
  try {
    return await ctx.tx(async (tx) => {
      const picking = (await ours(tx, 'stock.Picking', { id: args.id }))[0]
      if (!picking || ['done', 'cancel'].includes(String(picking.state))) throw refused('id', 'pickingClosed')
      const type = (await ours(tx, 'stock.PickingType', { id: picking.pickingTypeId }))[0]
      const moves = new Map(
        (await ours(tx, 'stock.Move', { pickingId: picking.id })).map((move) => [String(move.id), move]),
      )
      const usage = async (id: unknown) => (await ours(tx, 'stock.Location', { id }))[0]?.usage
      for (const entry of args.lines as unknown[]) {
        const line = entry && typeof entry === 'object' ? (entry as Row) : {}
        const move = moves.get(String(line.moveId))
        if (!move || typeof line.id !== 'string' || !line.id) throw refused('moveId', 'pickingLineMissing')
        const existing = (await ours(tx, 'stock.MoveLine', { id: line.id }))[0]
        if (existing && existing.moveId !== move.id) throw refused('id', 'pickingLineMissing')
        if (line.quantity !== undefined) {
          const receipt = allowsReceiptLot(
            type?.code,
            await usage(move.locationId),
            await usage(move.locationDestId),
            await trackingOf(tx, move.productId),
          )
          const fn = receipt ? 'stock.prepareReceiptLot' : 'stock.saveMoveLine'
          if (!(await holdsFunction(tx, fn))) throw forbidden(fn)
          const saved = receipt
            ? await prepareReceiptLotIn(tx, {
                id: line.id,
                moveId: move.id,
                quantity: String(line.quantity ?? ''),
                name: String(line.name ?? ''),
                expirationDate: String(line.expirationDate ?? ''),
                picked: line.picked !== false,
                expectedRevision: line.expectedRevision ?? undefined,
              })
            : await saveMoveLineIn(tx, {
                id: line.id,
                moveId: move.id,
                quantity: String(line.quantity ?? ''),
                lotId: line.lotId ? String(line.lotId) : null,
                picked: line.picked === true,
              })
          if (saved.ok !== true) throw new InventoryRefused(saved)
        }
        if (Object.hasOwn(line, 'unitCost')) {
          if (!(await holdsFunction(tx, 'stock.setReceiptUnitCost')))
            throw forbidden('stock.setReceiptUnitCost')
          const priced = await setReceiptUnitCostHandler(tx, {
            id: line.id,
            unitCost: line.unitCost == null ? '' : String(line.unitCost),
          })
          if (priced.ok !== true) throw new InventoryRefused(priced)
        }
      }
      return { ok: true, id: picking.id }
    })
  } catch (error) {
    if (error instanceof LotRefused || error instanceof InventoryRefused) return error.result
    if (error instanceof PickingConflict) return refused('id', 'pickingClosed').result
    throw error
  }
}

export const pickingLineFunctions: Record<string, FnSpec> = {
  savePickingLines: defineFn({
    // Optional so that a grid draft the modal could not read is refused by name, not by schema.
    input: { id: 'id', lines: 'json?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...new Set([
        'read:stock.Picking',
        'read:stock.PickingType',
        ...(movesFunctions.saveMoveLine!.effects ?? []),
        ...(receiptLotFunctions.prepareReceiptLot!.effects ?? []),
        ...(valuationFunctions.setReceiptUnitCost!.effects ?? []),
        ...AUTHORIZATION_READ_EFFECTS,
      ]),
    ],
    idempotent: true,
    handler: savePickingLinesHandler,
  }),
}
