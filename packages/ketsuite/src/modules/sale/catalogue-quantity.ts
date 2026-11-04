import { randomUUID } from 'node:crypto'
import { deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { addDecimals, compareDecimals, multiplyDecimals } from '../account/money.ts'
import { sellableProduct } from '../product/sellable.ts'
import { InventoryRefused } from '../stock/inventory-validation.ts'
import { automaticLinePrice } from './automatic-price.ts'
import { resizeComboDemand } from './combo-demand.ts'
import { deleteLineCosts } from './line-cost.ts'
import { ours } from './scope.ts'
import { saleUnitRatio } from './unit-ratio.ts'
import { writeQuotationLine } from './functions/lines.ts'
import { editSaleLine } from './line-edit.ts'
import { claimRevision, invalid, recompute, refreshStatus, SaleRefused } from './functions/shared.ts'

/** One SKU edits the first ordinary line, retaining later duplicates and historical references. */
export async function changeCatalogueQuantity(ctx: Ctx, args: Row, inTransaction = false) {
  try {
    if (typeof args.quantity !== 'string' || compareDecimals(args.quantity, '0') < 0)
      return invalid('quantity', 'sale.error.quantityPositive')
  } catch {
    return invalid('quantity', 'sale.error.quantityPositive')
  }
  try {
    const write = async (tx: Ctx) => {
      const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (
        !order ||
        !['draft', 'sent', 'sale'].includes(String(order.state)) ||
        order.locked ||
        (order.orderAuthority != null && order.orderAuthority !== 'local')
      )
        return invalid('id', 'sale.error.lineNotEditable')
      if (Number(order.revision) !== Number(args.expectedRevision))
        return invalid('expectedRevision', 'sale.error.orderChanged')
      const product = await sellableProduct(tx, args.productId)
      if (
        !product.ok ||
        (product.value.product.companyId && product.value.product.companyId !== tx.scope.company) ||
        (product.value.template.companyId && product.value.template.companyId !== tx.scope.company)
      )
        return invalid('productId', 'sale.error.comboUnavailable')
      const lines = (await ours(tx, 'sale.OrderLine', { orderId: order.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
      )
      const line = lines.find(
        (row) =>
          row.productId === args.productId &&
          !row.displayType &&
          !row.comboParentId &&
          row.comboBasePrice == null &&
          row.lineKind !== 'reward',
      )
      const zero = compareDecimals(args.quantity, '0') === 0
      if ((!line && zero) || (line && compareDecimals(args.quantity, line.productUomQty) === 0))
        return { ok: true, id: order.id, revision: order.revision }
      if (line) {
        const invoices = await tx.db.select('account.MoveLine', { saleLineId: line.id })
        // Source references protect history even when cached invoice quantities have not synced.
        let invoiced = '0'
        for (const item of invoices.filter((row) => row.productId === line.productId && row.productUomId)) {
          const move = (await tx.db.select('account.Move', { id: item.moveId }))[0]
          if (!move || move.state === 'cancel') continue
          const ratio = await saleUnitRatio(tx, item.productUomId, line.productUomId)
          if (ratio == null) return invalid('quantity', 'sale.error.gridHistory')
          const quantity = multiplyDecimals(
            item.quantity,
            ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }),
          )
          invoiced = addDecimals(
            invoiced,
            move.moveType === 'out_refund' ? multiplyDecimals(quantity, '-1') : quantity,
          )
        }
        if (
          compareDecimals(args.quantity, line.productUomQty) < 0 &&
          (compareDecimals(args.quantity, invoiced) < 0 ||
            compareDecimals(args.quantity, line.qtyInvoiced ?? '0') < 0 ||
            compareDecimals(args.quantity, line.qtyDelivered ?? '0') < 0)
        )
          return invalid('quantity', 'sale.error.gridHistory')
        if (zero) {
          if (invoices.length || (await tx.db.select('stock.Move', { saleLineId: line.id })).length)
            return invalid('quantity', 'sale.error.gridHistory')
          if (!(await claimRevision(tx, order, args.expectedRevision)))
            throw new SaleRefused(invalid('expectedRevision', 'sale.error.orderChanged'))
          await deleteLineCosts(tx, 'lineId', line.id)
          const L = tx.table('sale.OrderLine')
          await tx.db.del(deleteFrom(L).where(eq(L.id, String(line.id))))
          await recompute(tx, order.id)
          if (order.state === 'sale') await refreshStatus(tx, order.id)
        } else {
          const updated = await editSaleLine(
            tx,
            { id: line.id, expectedRevision: args.expectedRevision, productUomQty: args.quantity },
            true,
          )
          if (!updated.ok) throw new SaleRefused(updated)
        }
      } else {
        if (lines.length >= 100) return invalid('quantity', 'sale.error.gridTooMany')
        const draft = {
          id: randomUUID(),
          orderId: order.id,
          productId: args.productId,
          productUomId: product.value.template.uomId,
          productUomQty: args.quantity,
          sequence: Math.max(0, ...lines.map((row) => Number(row.sequence))) + 100,
          priceAutomatic: true,
        }
        const priced = await automaticLinePrice(tx, order, draft, args.quantity)
        if (!priced.ok) return priced
        if (!(await claimRevision(tx, order, args.expectedRevision)))
          throw new SaleRefused(invalid('expectedRevision', 'sale.error.orderChanged'))
        const added = await writeQuotationLine(tx, draft, undefined, [], undefined, true)
        if (!added.ok) throw new SaleRefused(added)
        if (order.state === 'sale') {
          const fresh = (await ours(tx, 'sale.Order', { id: order.id }))[0]!
          const saved = (await ours(tx, 'sale.OrderLine', { id: draft.id }))[0]!
          await resizeComboDemand(tx, fresh, [saved], args.quantity)
          await refreshStatus(tx, order.id)
        }
      }
      return {
        ok: true,
        id: order.id,
        revision: (await ours(tx, 'sale.Order', { id: order.id }))[0]?.revision,
      }
    }
    return inTransaction ? await write(ctx) : await ctx.tx(write)
  } catch (error) {
    if (error instanceof SaleRefused || error instanceof InventoryRefused) return error.result
    throw error
  }
}
