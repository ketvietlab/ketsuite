import { saleUnitRatio } from '../unit-ratio.ts'
import { roundTo } from '../../uom/convert.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { ours } from '../scope.ts'
import { DELIVERED_COST_EFFECTS, refreshDeliveredCosts } from '../delivered-cost.ts'
import {
  invalid,
  n,
  statusOf,
  refreshStatus,
  recordOrderLifecycle,
  confirmEffects,
  confirm,
} from './shared.ts'

export function confirmOrderHandler(ctx: Ctx, args: Row) {
  return confirm(ctx, args.id, args.expectedRevision)
}

export async function syncDeliveriesHandler(ctx: Ctx, args: Row) {
  const held = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!held) return invalid('id', 'sales order does not exist')
  if (held.stockAuthority === 'external')
    return { ok: true, id: args.id, invoiceStatus: await statusOf(ctx, args.id) }
  if (held.stockAuthority != null && held.stockAuthority !== 'local')
    return invalid('stockAuthority', 'unknown stock authority')
  for (const line of await ours(ctx, 'sale.OrderLine', { orderId: args.id })) {
    if (line.comboBasePrice != null || !line.productId) continue
    const moves = await ctx.db.select('stock.Move', { saleLineId: line.id, state: 'done' })
    const unit = (await ctx.db.select('uom.Unit', { id: line.productUomId }))[0]
    if (!unit) return invalid('productUomId', 'line unit does not exist')
    let delivered = 0
    for (const move of moves) {
      const ratio = await saleUnitRatio(ctx, move.productUomId, line.productUomId)
      if (ratio === null) return invalid('productUomId', 'delivery unit cannot be converted')
      // K19: goods a customer returned come off what the line delivered.
      delivered += (move.originReturnedMoveId ? -n(move.quantity) : n(move.quantity)) * ratio
    }
    await ctx.db.update(
      'sale.OrderLine',
      { id: line.id },
      { qtyDelivered: String(roundTo(Math.max(0, delivered), Number(unit.rounding))) },
    )
  }
  await refreshDeliveredCosts(ctx, args.id)
  await refreshStatus(ctx, args.id)
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (order?.state === 'sale') {
    const lines = (await ours(ctx, 'sale.OrderLine', { orderId: args.id })).filter(
      (line) => line.comboBasePrice == null && !!line.productId,
    )
    const required = lines.reduce((sum, line) => sum + n(line.productUomQty), 0)
    const delivered = lines.reduce((sum, line) => sum + n(line.qtyDelivered), 0)
    if (required > 0 && delivered + 0.000001 >= required)
      await recordOrderLifecycle(ctx, args.id, 'delivered')
    else if (delivered > 0) await recordOrderLifecycle(ctx, args.id, 'shipped')
  }
  return { ok: true, id: args.id, invoiceStatus: await statusOf(ctx, args.id) }
}

export const deliveriesFunctions: Record<string, FnSpec> = {
  confirmOrder: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', pickingId: 'id?', errors: 'json?' },
    effects: ['read:company.Company', ...confirmEffects],
    idempotent: true,
    agent: true,
    handler: confirmOrderHandler,
  }),
  syncDeliveries: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', invoiceStatus: 'text?', errors: 'json?' },
    effects: [
      ...new Set([
        'read:sale.Order',
        'read:sale.OrderLine',
        'write:sale.OrderLine',
        'write:sale.Order',
        'read:sale.OrderLifecycleEvent',
        'write:sale.OrderLifecycleEvent',
        'read:stock.Move',
        'read:uom.Unit',
        'read:product.Product',
        'read:product.Template',
        ...DELIVERED_COST_EFFECTS,
      ]),
    ],
    idempotent: true,
    agent: true,
    handler: syncDeliveriesHandler,
  }),
}
