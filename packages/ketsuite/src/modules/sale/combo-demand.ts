import { invoicedQuantity } from './invoice-settlement.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../account/money.ts'
import { functions as stockFunctions } from '../stock/functions.ts'
import { insertMoveHandler } from '../stock/functions/moves.ts'
import { quantityText } from '../stock/quantity-text.ts'
import { MOVE_DEMAND_EFFECTS, resizeMoveDemand } from '../stock/move-demand.ts'
import { saleUnitRatio } from './unit-ratio.ts'
import { expectedDeliveryDate, deliverySchedule } from './delivery-promise.ts'
import { companyKey, ours } from './scope.ts'
import { invalid, SaleRefused } from './functions/shared.ts'

export const COMBO_DEMAND_EFFECTS = [
  ...MOVE_DEMAND_EFFECTS,
  'read:company.Company',
  'read:sale.OrderLine',
  'read:account.Move',
  'read:account.MoveLine',
  'read:product.Product',
  'read:product.Template',
  ...stockFunctions.createPicking!.effects!,
  ...stockFunctions.addMove!.effects!,
]

/** Keep confirmed combo demand attached to its child lines, including partial-delivery backorders. */
export async function resizeComboDemand(ctx: Ctx, order: Row, children: Row[], quantity: unknown) {
  let newPickingId: string | undefined
  for (const child of children) {
    const reducing = compareDecimals(quantity, child.productUomQty ?? '0') < 0
    if (reducing && compareDecimals(quantity, await invoicedQuantity(ctx, child)) < 0)
      throw new SaleRefused(invalid('productUomQty', 'sale.error.belowSettled'))
    const product = (await ctx.db.select('product.Product', { id: child.productId }))[0]!
    const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]!
    const moves = await ctx.db.select('stock.Move', { saleLineId: child.id })
    let delivered = 0
    for (const move of moves.filter((row) => row.state === 'done')) {
      const ratio = await saleUnitRatio(ctx, move.productUomId, child.productUomId)
      if (ratio == null) throw new SaleRefused(invalid('productUomId', 'unit cannot be converted'))
      delivered += Number(move.quantity) * ratio
    }
    delivered = Math.max(delivered, Number(child.qtyDelivered ?? 0))
    if (reducing && Number(quantity) + 0.000001 < delivered)
      throw new SaleRefused(invalid('productUomQty', 'sale.error.belowSettled'))
    if (template.type !== 'goods' || order.stockAuthority === 'external') continue
    const pending = moves
      .filter((move) => !['done', 'cancel'].includes(String(move.state)))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    const remaining = Math.max(0, Number(quantity) - delivered)
    if (pending.length) {
      for (const [index, move] of pending.entries()) {
        const ratio = await saleUnitRatio(ctx, child.productUomId, move.productUomId)
        if (ratio == null) throw new SaleRefused(invalid('productUomId', 'unit cannot be converted'))
        await resizeMoveDemand(ctx, move.id, index === 0 ? remaining * ratio : 0)
      }
    } else if (remaining > 0) {
      newPickingId ??= companyKey(ctx, 'combo-demand', String(order.id), String(order.revision))
      const picking = (await stockFunctions.createPicking!.handler(ctx, {
        id: newPickingId,
        pickingTypeId: `${String(order.warehouseId)}:outgoing`,
        scheduledDate: await deliverySchedule(
          ctx,
          order.commitmentDate ||
            (await expectedDeliveryDate(
              ctx,
              order,
              await ours(ctx, 'sale.OrderLine', { orderId: order.id }),
            )) ||
            order.dateOrder,
        ),
        moveType: order.shippingPolicy ?? 'direct',
      })) as Row
      if (picking.ok !== true) throw new SaleRefused(picking)
      await ctx.db.update('stock.Picking', { id: newPickingId }, { partnerId: order.partnerId ?? null })
      const moveId = companyKey(ctx, 'combo-demand-line', String(child.id), String(order.revision))
      const added = (await insertMoveHandler(ctx, {
        id: moveId,
        name: child.name,
        pickingId: newPickingId,
        productId: child.productId,
        productUomId: child.productUomId,
        productUomQty: quantityText(remaining),
        origin: order.name,
      })) as Row
      if (added.ok !== true) throw new SaleRefused(added)
      await ctx.db.update('stock.Move', { id: moveId }, { saleLineId: child.id })
    }
  }
}
