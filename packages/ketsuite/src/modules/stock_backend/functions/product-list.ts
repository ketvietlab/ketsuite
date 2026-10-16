// The product list, with what stock knows about each product.
//
// `product_backend.searchTemplates` is the list's read; this answers through the same
// read (product_backend/list/read.ts) and adds the sellable quantity, the sort by it and
// the out-of-stock preset. They belong here because only an installation with stock has
// them: without stock the list has no stock column at all.

import { defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import {
  PRODUCT_LIST_EFFECTS,
  PRODUCT_LIST_OUTPUT,
  readProductList,
} from '../../product_backend/list/read.ts'
import type { ProductListStock } from '../../product_backend/list/read.ts'

/**
 * Sellable now, per template that keeps stock: on hand less reserved, over the internal
 * and transit locations of the company's active warehouses. The product page's figure
 * (stock/product-workspace.ts), for the whole catalogue in three reads.
 */
const productStock: ProductListStock = {
  availability: async (ctx: Ctx) => {
    const figures = new Map<string, number>()
    const company = ctx.scope.company
    if (!company) return figures
    const T = ctx.table('product.Template')
    for (const row of await ctx.db.all(from(T).select(T.id!).where(eq(T.isStorable!, true))))
      figures.set(String(row.id), 0)
    if (!figures.size) return figures
    const P = ctx.table('product.Product')
    const [products, warehouses, locations] = await Promise.all([
      ctx.db.all(from(P).select(P.id!, P.templateId!)),
      ctx.db.select('stock.Warehouse', { companyId: company, active: true }),
      ctx.db.select('stock.Location', { companyId: company }),
    ])
    const templateOf = new Map(
      products.flatMap((row) =>
        figures.has(String(row.templateId)) ? [[String(row.id), String(row.templateId)] as const] : [],
      ),
    )
    const active = new Set(warehouses.map((warehouse) => String(warehouse.id)))
    const counted = locations
      .filter(
        (location) =>
          ['internal', 'transit'].includes(String(location.usage)) &&
          location.warehouseId != null &&
          active.has(String(location.warehouseId)),
      )
      .map((location) => String(location.id))
    if (!templateOf.size || !counted.length) return figures
    const Q = ctx.table('stock.Quant')
    const sums = await ctx.db.group(
      from(Q)
        .where(eq(Q.companyId!, company), inArray(Q.locationId!, counted))
        .groupBy({ col: Q.productId! })
        .aggregate(
          { fn: 'sum', col: Q.quantity!, as: 'onHand' },
          { fn: 'sum', col: Q.reservedQuantity!, as: 'reserved' },
        ),
    )
    for (const sum of sums) {
      const template = templateOf.get(String(sum.key[0]))
      if (!template) continue
      const sellable = Number(sum.aggregates.onHand ?? 0) - Number(sum.aggregates.reserved ?? 0)
      figures.set(template, figures.get(template)! + sellable)
    }
    return figures
  },
}

export const productListFunctions: Record<string, FnSpec> = {
  searchProductTemplates: defineFn({
    input: { href: 'text?', pageSize: 'int?', timezone: 'text?' },
    output: PRODUCT_LIST_OUTPUT,
    effects: [...PRODUCT_LIST_EFFECTS, 'read:stock.Warehouse', 'read:stock.Location', 'read:stock.Quant'],
    handler: (ctx, args) => readProductList(ctx, args, productStock),
  }),
}
