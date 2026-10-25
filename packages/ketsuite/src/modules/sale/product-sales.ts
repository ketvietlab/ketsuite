// What the product page shows about one template's sales: confirmed orders in a trailing
// window, read in one call. Quantities are counted in the product's own unit; revenue is
// untaxed. Orders are found through their (state, date) index first, so a long history
// is not scanned line by line.

import { and, defineFn, eq, from, gte, inArray } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'

const CONFIRMED = ['sale', 'done']
const CHUNK = 500

export const productSalesFunctions: Record<string, FnSpec> = {
  productSales: defineFn({
    input: { templateId: 'id', days: 'int?' },
    effects: [
      'read:product.Template',
      'read:product.Product',
      'read:sale.Order',
      'read:sale.OrderLine',
      'read:uom.Unit',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const company = ctx.scope.company
      const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
      if (!template || !company) return null
      const days = Math.min(365, Math.max(1, Number(args.days ?? 30)))
      // Stored as ISO text on SQLite: compare text with text, as the order list does.
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      const productIds = (await ctx.db.select('product.Product', { templateId: args.templateId })).map(
        (row) => String(row.id),
      )
      const Order = ctx.table('sale.Order')
      const orders = productIds.length
        ? await ctx.db.all(
            from(Order).where(
              and(eq(Order.companyId, company), inArray(Order.state, CONFIRMED), gte(Order.dateOrder, since)),
            ),
          )
        : []
      const Line = ctx.table('sale.OrderLine')
      const lines: Row[] = []
      const orderIds = orders.map((row) => String(row.id))
      for (let start = 0; start < orderIds.length; start += CHUNK)
        lines.push(
          ...(await ctx.db.all(
            from(Line).where(
              and(
                eq(Line.companyId, company),
                inArray(Line.orderId, orderIds.slice(start, start + CHUNK)),
                inArray(Line.productId, productIds),
              ),
            ),
          )),
        )
      const units = new Map(
        (await ctx.db.select('uom.Unit')).map((row) => [
          String(row.id),
          Number(row.absoluteFactor ?? 1) || 1,
        ]),
      )
      const own = units.get(String(template.uomId ?? '')) ?? 1
      const dates = new Map(orders.map((row) => [String(row.id), String(row.dateOrder ?? '')]))
      let quantity = 0
      let revenue = 0
      for (const line of lines) {
        quantity += (Number(line.productUomQty ?? 0) * (units.get(String(line.productUomId)) ?? own)) / own
        revenue += Number(line.priceSubtotal ?? 0)
      }
      const sold = new Set(lines.map((line) => String(line.orderId)))
      const lastAt =
        [...sold]
          .map((id) => dates.get(id) ?? '')
          .sort()
          .at(-1) || null
      return {
        days,
        quantity: Math.round(quantity * 1000) / 1000,
        revenue: Math.round(revenue),
        orders: sold.size,
        lastAt,
      }
    },
  }),
}
