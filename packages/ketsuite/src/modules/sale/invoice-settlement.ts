import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addDecimals, compareDecimals, multiplyDecimals } from '../account/money.ts'
import { saleUnitRatio } from './unit-ratio.ts'
import { invalid, refreshStatus, SaleRefused } from './functions/shared.ts'

/**
 * What a line has invoiced on invoices still in force (D10): a cancelled invoice and a reversed one no longer
 * count, a refund takes its quantity back.
 */
export async function liveInvoicedQuantity(ctx: Ctx, line: Row) {
  let quantity = '0'
  for (const item of await ctx.db.select('account.MoveLine', { saleLineId: line.id })) {
    if (item.productId !== line.productId) continue
    const move = (await ctx.db.select('account.Move', { id: item.moveId }))[0]
    if (!move || move.state === 'cancel' || move.reversedById) continue
    const ratio =
      item.productUomId && line.productUomId
        ? await saleUnitRatio(ctx, item.productUomId, line.productUomId)
        : !item.productUomId && !line.productUomId
          ? 1
          : null
    if (ratio == null) throw new SaleRefused(invalid('productUomQty', 'sale.error.gridHistory'))
    quantity = addDecimals(
      quantity,
      multiplyDecimals(item.quantity, String(move.moveType === 'out_refund' ? -ratio : ratio)),
    )
  }
  return quantity
}

/** Source invoice references protect reductions before the cached quantity has synced. */
export async function invoicedQuantity(ctx: Ctx, line: Row) {
  const quantity = await liveInvoicedQuantity(ctx, line)
  return compareDecimals(quantity, line.qtyInvoiced ?? '0') > 0 ? quantity : String(line.qtyInvoiced ?? '0')
}

/** Each line of the orders counts again what it has invoiced, and the orders' invoice status follows. */
export async function syncInvoicedQuantities(ctx: Ctx, orderIds: Iterable<string>) {
  for (const orderId of new Set(orderIds)) {
    for (const line of await ctx.db.select('sale.OrderLine', { orderId })) {
      if (line.displayType || line.comboBasePrice != null) continue
      const quantity = await liveInvoicedQuantity(ctx, line)
      if (compareDecimals(quantity, line.qtyInvoiced ?? '0') !== 0)
        await ctx.db.update('sale.OrderLine', { id: line.id }, { qtyInvoiced: quantity })
    }
    await refreshStatus(ctx, orderId)
  }
}

/** The sales orders whose lines an invoice was made for. */
async function ordersInvoicedBy(ctx: Ctx, moveId: unknown): Promise<string[]> {
  const orders = new Set<string>()
  for (const item of await ctx.db.select('account.MoveLine', { moveId })) {
    if (!item.saleLineId) continue
    const line = (await ctx.db.select('sale.OrderLine', { id: item.saleLineId }))[0]
    if (line?.orderId) orders.add(String(line.orderId))
  }
  return [...orders]
}

const SYNC_EFFECTS = [
  'read:account.Move',
  'read:account.MoveLine',
  'read:sale.Order',
  'write:sale.Order',
  'read:sale.OrderLine',
  'write:sale.OrderLine',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
]

/**
 * An accounting function that cancels or reverses an invoice, followed by what the invoice's sales orders have
 * invoiced (D10): the order offers the quantity again once the cancellation or reversal lands.
 */
export function withSaleInvoices(spec: FnSpec): FnSpec {
  return {
    ...spec,
    effects: [...new Set([...(spec.effects ?? []), ...SYNC_EFFECTS])],
    handler: async (ctx, args) => {
      const result = await spec.handler(ctx, args)
      if ((result as Row | null)?.ok !== true) return result
      await syncInvoicedQuantities(ctx, await ordersInvoicedBy(ctx, (args as Row).id))
      return result
    },
  }
}

/** The module with the named functions cancelling or reversing invoices through withSaleInvoices. */
export function moduleWithSaleInvoices<M extends { functions: Record<string, FnSpec> }>(
  module: M,
  names: string[],
): M {
  const functions = { ...module.functions }
  for (const name of names) {
    const spec = functions[name]
    if (!spec) throw new Error(`moduleWithSaleInvoices: no function ${name}`)
    functions[name] = withSaleInvoices(spec)
  }
  return { ...module, functions }
}
