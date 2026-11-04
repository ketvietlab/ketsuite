import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { deliveriesFunctions, syncDeliveriesHandler } from './functions/deliveries.ts'

/** What syncing an order's deliveries reads and writes, on top of the wrapped function's own effects. */
const SYNC_EFFECTS = [...(deliveriesFunctions.syncDeliveries!.effects ?? []), 'read:stock.Move']

/** The sales orders whose lines a call's writes completed a move of (a delivery, or a return of one). */
async function ordersCompletedBy(ctx: Ctx, writes: Ctx['writes']): Promise<string[]> {
  const moveIds = new Set<string>()
  for (const write of writes)
    if (
      write.op === 'update' &&
      write.model === 'stock.Move' &&
      write.patch?.state === 'done' &&
      write.where?.id
    )
      moveIds.add(String(write.where.id))
  const orders = new Set<string>()
  for (const id of moveIds) {
    const move = (await ctx.db.select('stock.Move', { id }))[0]
    if (!move?.saleLineId) continue
    const line = (await ctx.db.select('sale.OrderLine', { id: move.saleLineId }))[0]
    if (line?.orderId) orders.add(String(line.orderId))
  }
  return [...orders]
}

/**
 * A function that completes stock moves, followed by what its sales orders delivered (K2): the order counts
 * a delivery as soon as it is done, as the mock does, without Đồng bộ giao hàng. The stock work has
 * committed by then; syncing again from the order repeats the same count.
 */
export function withSaleDeliveries(spec: FnSpec): FnSpec {
  return {
    ...spec,
    effects: [...new Set([...(spec.effects ?? []), ...SYNC_EFFECTS])],
    handler: async (ctx, args) => {
      const start = ctx.writes.length
      const result = await spec.handler(ctx, args)
      if ((result as Row | null)?.ok === false) return result
      for (const id of await ordersCompletedBy(ctx, ctx.writes.slice(start)))
        await syncDeliveriesHandler(ctx, { id })
      return result
    },
  }
}

/** The module with the named functions completing moves through withSaleDeliveries. */
export function moduleWithSaleDeliveries<M extends { functions: Record<string, FnSpec> }>(
  module: M,
  names: string[],
): M {
  const functions = { ...module.functions }
  for (const name of names) {
    const spec = functions[name]
    if (!spec) throw new Error(`moduleWithSaleDeliveries: no function ${name}`)
    functions[name] = withSaleDeliveries(spec)
  }
  return { ...module, functions }
}
