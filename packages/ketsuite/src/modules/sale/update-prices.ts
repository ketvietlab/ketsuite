import { from, inArray, type Ctx, type Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../account/money.ts'
import { ours } from './scope.ts'
import { invalid, SaleRefused } from './functions/shared.ts'
import { applyQuotationGrid } from './quotation-grid.ts'
import { automaticLinePrice } from './automatic-price.ts'

/**
 * "Update prices" on a quotation (D14): optionally switch its pricelist, then price every product
 * line nothing has been delivered or invoiced from again by that pricelist, as if just added. Manual
 * prices and discounts on those lines give way; combo items, rewards and discounts keep theirs, and
 * so does any line with history. A confirmed order keeps the pricelist it was sold under.
 */
export async function updatePrices(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx(async (tx) => {
      const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (
        !order ||
        !['draft', 'sent'].includes(String(order.state)) ||
        order.locked ||
        (order.orderAuthority != null && order.orderAuthority !== 'local')
      )
        return invalid('id', 'sale.error.pricesLocked')
      if (Number(order.revision) !== Number(args.expectedRevision))
        return invalid('expectedRevision', 'sale.error.orderChanged')
      if (args.pricelistId !== undefined && (args.pricelistId || null) !== (order.pricelistId ?? null)) {
        if (args.pricelistId) {
          const pricelist = (await ours(tx, 'pricing.Pricelist', { id: args.pricelistId, active: true }))[0]
          if (!pricelist || pricelist.currency !== order.currency)
            return invalid('pricelistId', 'sale.error.pricelistInvalid')
        }
        await tx.db.update('sale.Order', { id: order.id }, { pricelistId: args.pricelistId || null })
      }
      const lines = await ours(tx, 'sale.OrderLine', { orderId: order.id })
      const ids = lines.map((line) => String(line.id))
      const SM = tx.table('stock.Move'),
        AML = tx.table('account.MoveLine')
      const settled = new Set(
        ids.length
          ? [
              ...(await tx.db.all(from(SM).select(SM.saleLineId).where(inArray(SM.saleLineId, ids)))),
              ...(await tx.db.all(from(AML).select(AML.saleLineId).where(inArray(AML.saleLineId, ids)))),
            ].map((row) => String(row.saleLineId))
          : [],
      )
      const repriced = lines.filter(
        (line) =>
          line.productId &&
          !line.displayType &&
          !['reward', 'discount'].includes(String(line.lineKind ?? '')) &&
          !line.comboParentId &&
          line.comboBasePrice == null &&
          !settled.has(String(line.id)) &&
          compareDecimals(line.qtyDelivered ?? '0', '0') === 0 &&
          compareDecimals(line.qtyInvoiced ?? '0', '0') === 0,
      )
      if (!repriced.length) {
        // Only the pricelist changed: the order still moves to a new revision.
        await tx.db.update('sale.Order', { id: order.id }, { revision: Number(order.revision) + 1 })
        return { ok: true, id: order.id, revision: Number(order.revision) + 1 }
      }
      // An empty price asks the grid for the automatic one. A quotation that already has delivery or
      // invoice history edits its lines one by one, as a confirmed order does, and needs the price itself.
      const priced = {
        ...order,
        pricelistId: args.pricelistId === undefined ? order.pricelistId : args.pricelistId || null,
      }
      const updated = []
      for (const line of repriced) {
        if (!settled.size) {
          updated.push({ id: String(line.id), values: { priceUnit: '', discount: '' } })
          continue
        }
        const price = await automaticLinePrice(tx, priced, line, line.productUomQty)
        if (price.ok !== true) throw new SaleRefused(price)
        updated.push({
          id: String(line.id),
          values: {
            priceUnit: String(price.priceUnit),
            discount: String(price.discount ?? '0'),
          },
        })
      }
      const result = await applyQuotationGrid(
        tx,
        {
          id: order.id,
          expectedRevision: order.revision,
          changes: { added: [], updated, removed: [], order: null },
        },
        true,
      )
      // A refused repricing must not leave the new pricelist behind.
      if (result.ok !== true) throw new SaleRefused(result)
      return result
    })
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
}
