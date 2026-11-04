import { saleRecordResult } from '../record-result.ts'
import { variantMatrixTemplates } from '../variant-matrix.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { ours } from '../scope.ts'
import { lineGridFunctions } from './line-grid.ts'
import { applyQuotationGrid } from '../quotation-grid.ts'
import { deliveryPromiseFunctions } from './delivery-promise.ts'
import { saveOrderDeliveryPromise } from '../delivery-promise-write.ts'
import { invalid, SaleRefused } from './shared.ts'

/** Save the visible parent draft atomically before leaving it for the catalogue. */
export async function saveCatalogueDraft(ctx: Ctx, args: Row, inTransaction = false) {
  try {
    const write = async (tx: Ctx) => {
      let order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (!order || Number(order.revision) !== Number(args.expectedRevision))
        return invalid('expectedRevision', 'sale.error.orderChanged')
      if (
        order.locked ||
        !['draft', 'sent', 'sale'].includes(String(order.state)) ||
        (order.orderAuthority != null && order.orderAuthority !== 'local')
      )
        return invalid('id', 'sale.error.lineNotEditable')
      if (
        args.templateId &&
        !(await variantMatrixTemplates(tx, args.id))?.some((row) => row.id === args.templateId)
      )
        return invalid('templateId', 'sale.error.matrixUnavailable')
      if (args.changes !== undefined) {
        const result = await applyQuotationGrid(tx, args, true)
        if (!result.ok) throw new SaleRefused(result)
        order = (await ours(tx, 'sale.Order', { id: args.id }))[0]!
      }
      const patch: Row = {}
      for (const key of ['shippingPolicy', 'commitmentDate'])
        if (Object.hasOwn(args, key) && (args[key] ?? null) !== (order[key] ?? null)) patch[key] = args[key]
      if (Object.keys(patch).length) {
        const result = await saveOrderDeliveryPromise(
          tx,
          { ...patch, id: args.id, expectedRevision: order.revision },
          true,
        )
        if (!result.ok) throw new SaleRefused(result)
      }
      return {
        ok: true,
        id: args.id,
        ...(args.templateId ? { templateId: args.templateId } : {}),
        revision: (await ours(tx, 'sale.Order', { id: args.id }))[0]?.revision,
      }
    }
    return inTransaction ? await write(ctx) : await ctx.tx(write)
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
}
export const saveCatalogueDraftHandler = async (ctx: Ctx, args: Row) =>
  saleRecordResult(await saveCatalogueDraft(ctx, args))

export const catalogueDraftFunctions = {
  saveCatalogueDraft: defineFn({
    input: {
      id: 'id',
      expectedRevision: 'int',
      templateId: 'id?',
      changes: 'json?',
      shippingPolicy: 'text?',
      commitmentDate: 'datetime?',
    },
    output: { ok: 'bool', id: 'id?', templateId: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      ...lineGridFunctions.applyLineGrid.effects!,
      ...deliveryPromiseFunctions.saveDeliveryPromise!.effects!,
    ],
    agent: true,
    idempotent: true,
    handler: saveCatalogueDraftHandler,
  }),
}
