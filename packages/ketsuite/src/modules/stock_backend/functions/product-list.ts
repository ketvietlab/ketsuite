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
import {
  VARIANT_LIST_EFFECTS,
  VARIANT_LIST_INPUT,
  VARIANT_LIST_OUTPUT,
  readVariantList,
} from '../../product_backend/variants/read.ts'
import type { VariantListStock } from '../../product_backend/variants/read.ts'

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

/**
 * On hand and available (on hand less reserved), per SKU of the Variants list's page, over
 * the internal and transit locations of the company's active warehouses: the same places
 * the product list counts. A SKU whose product keeps no stock is absent: a dash, not zero.
 */
const variantStock: VariantListStock = {
  figures: async (ctx: Ctx, productIds: string[]) => {
    const figures = new Map<string, { onHand: number; available: number }>()
    const company = ctx.scope.company
    if (!company || !productIds.length) return figures
    const P = ctx.table('product.Product')
    const T = ctx.table('product.Template')
    const products = await ctx.db.all(from(P).select(P.id!, P.templateId!).where(inArray(P.id!, productIds)))
    const storable = new Set(
      (
        await ctx.db.all(
          from(T)
            .select(T.id!)
            .where(
              eq(T.isStorable!, true),
              inArray(
                T.id!,
                products.map((row) => String(row.templateId)),
              ),
            ),
        )
      ).map((row) => String(row.id)),
    )
    for (const row of products)
      if (storable.has(String(row.templateId))) figures.set(String(row.id), { onHand: 0, available: 0 })
    if (!figures.size) return figures
    const [warehouses, locations] = await Promise.all([
      ctx.db.select('stock.Warehouse', { companyId: company, active: true }),
      ctx.db.select('stock.Location', { companyId: company }),
    ])
    const active = new Set(warehouses.map((warehouse) => String(warehouse.id)))
    const counted = locations
      .filter(
        (location) =>
          ['internal', 'transit'].includes(String(location.usage)) &&
          location.warehouseId != null &&
          active.has(String(location.warehouseId)),
      )
      .map((location) => String(location.id))
    if (!counted.length) return figures
    const Q = ctx.table('stock.Quant')
    const sums = await ctx.db.group(
      from(Q)
        .where(
          eq(Q.companyId!, company),
          inArray(Q.locationId!, counted),
          inArray(Q.productId!, [...figures.keys()]),
        )
        .groupBy({ col: Q.productId! })
        .aggregate(
          { fn: 'sum', col: Q.quantity!, as: 'onHand' },
          { fn: 'sum', col: Q.reservedQuantity!, as: 'reserved' },
        ),
    )
    for (const sum of sums) {
      const id = String(sum.key[0])
      if (!figures.has(id)) continue
      const onHand = Number(sum.aggregates.onHand ?? 0)
      figures.set(id, { onHand, available: onHand - Number(sum.aggregates.reserved ?? 0) })
    }
    return figures
  },
}

export const productListFunctions: Record<string, FnSpec> = {
  searchProductVariants: defineFn({
    input: VARIANT_LIST_INPUT,
    output: VARIANT_LIST_OUTPUT,
    effects: [...VARIANT_LIST_EFFECTS, 'read:stock.Warehouse', 'read:stock.Location', 'read:stock.Quant'],
    handler: (ctx, args) => readVariantList(ctx, args, variantStock),
  }),
  searchProductTemplates: defineFn({
    input: { href: 'text?', pageSize: 'int?', timezone: 'text?' },
    output: PRODUCT_LIST_OUTPUT,
    effects: [...PRODUCT_LIST_EFFECTS, 'read:stock.Warehouse', 'read:stock.Location', 'read:stock.Quant'],
    handler: (ctx, args) => readProductList(ctx, args, productStock),
  }),
}
