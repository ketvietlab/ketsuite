import { defineFn, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { holdsFunction } from '../../product/functions/shared.ts'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { editableOrder } from '../line-plan.ts'
import { addLineHandler, linesFunctions, removeLineHandler, updateLineHandler } from './lines.ts'
import { invalid } from './shared.ts'

/** A refused part of the grid's save: it rolls back every other part. */
class LinesRefused extends Error {
  readonly result: Row
  constructor(result: Row) {
    super('purchase lines refused')
    this.result = result
  }
}
const object = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null
const optional = (value: unknown) => (value == null || value === '' ? undefined : String(value))
const LINE_FIELDS = ['productQty', 'priceUnit', 'productUomId', 'discount', 'taxId'] as const

/** Each part of the save takes the function a person would call for it alone. */
async function requireFunction(ctx: Ctx, fn: string) {
  if (!(await holdsFunction(ctx, fn)))
    throw new KetError({ code: 'E_FN_NOT_PERMITTED', message: `this role may not call ${fn}` })
}

/**
 * The order's line grid saves at once, all or nothing: `removed` names lines of this order to drop
 * (as `removeLine`), and each entry of `lines` either adds a new line (`productId`, as `addLine`) or
 * changes one of this order's lines (as `updateLine`). Each part needs the caller to hold that
 * function, and a line of another order is refused.
 */
export async function saveLinesHandler(ctx: Ctx, args: Row) {
  if (!Array.isArray(args.lines) || (args.removed != null && !Array.isArray(args.removed)))
    return invalid('lines', 'the lines to save could not be read')
  try {
    return await ctx.tx(async (tx) => {
      const order = await editableOrder(tx, args.id)
      if (!order) throw new LinesRefused(invalid('id', 'lines can only be changed on an unlocked RFQ'))
      const lines = new Map(
        (await tx.db.select('purchase.OrderLine', { orderId: order.id })).map((line) => [
          String(line.id),
          line,
        ]),
      )
      // New lines follow the order's last line, in the grid's order.
      let sequence = Math.max(0, ...[...lines.values()].map((line) => Number(line.sequence) || 0))
      const removed = ((args.removed as unknown[] | undefined) ?? []).map(String)
      if (removed.length) await requireFunction(tx, 'purchase.removeLine')
      for (const id of removed) {
        if (!lines.delete(id)) {
          // A retried save finds the line it removed gone; a line of another order stays refused.
          if ((await tx.db.select('purchase.OrderLine', { id }))[0])
            throw new LinesRefused(invalid('id', 'the line is not part of this order'))
          continue
        }
        const result = await removeLineHandler(tx, { id })
        if (result.ok !== true) throw new LinesRefused(result)
      }
      for (const value of args.lines as unknown[]) {
        const entry = object(value) ?? {}
        const id = typeof entry.id === 'string' ? entry.id : ''
        if (!id) throw new LinesRefused(invalid('id', 'the line is not part of this order'))
        const changes = Object.fromEntries(
          LINE_FIELDS.filter((key) => Object.hasOwn(entry, key)).map((key) => [key, optional(entry[key])]),
        )
        const line = lines.get(id)
        // A retried save finds the line it added: the add already happened.
        if (line && Object.hasOwn(entry, 'productId') && String(line.productId) === String(entry.productId))
          continue
        if (line) {
          await requireFunction(tx, 'purchase.updateLine')
          const result = await updateLineHandler(tx, {
            ...changes,
            id,
            productQty: changes.productQty ?? String(line.productQty),
            // An emptied tax cell takes the tax off.
            ...(Object.hasOwn(changes, 'taxId') ? { taxId: changes.taxId ?? null } : {}),
          })
          if (result.ok !== true) throw new LinesRefused(result)
          continue
        }
        if ((await tx.db.select('purchase.OrderLine', { id }))[0])
          throw new LinesRefused(invalid('id', 'the line is not part of this order'))
        await requireFunction(tx, 'purchase.addLine')
        const result = await addLineHandler(tx, {
          ...changes,
          id,
          orderId: order.id,
          productId: optional(entry.productId) ?? '',
          productQty: changes.productQty ?? '',
          productUomId: changes.productUomId ?? '',
          sequence: (sequence += 10),
        })
        if (result.ok !== true) throw new LinesRefused(result)
        lines.set(id, { id, productId: entry.productId })
      }
      return { ok: true, id: order.id }
    })
  } catch (error) {
    if (error instanceof LinesRefused) return error.result
    throw error
  }
}

export const lineGridFunctions: Record<string, FnSpec> = {
  saveLines: defineFn({
    // Optional so that a grid draft the modal could not read is refused by name, not by schema.
    input: { id: 'id', lines: 'json?', removed: 'json?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      ...new Set([
        ...(linesFunctions.addLine!.effects ?? []),
        ...(linesFunctions.updateLine!.effects ?? []),
        ...(linesFunctions.removeLine!.effects ?? []),
        ...AUTHORIZATION_READ_EFFECTS,
      ]),
    ],
    idempotent: true,
    handler: saveLinesHandler,
  }),
}
