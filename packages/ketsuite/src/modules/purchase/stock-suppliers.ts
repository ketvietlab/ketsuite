import stock from '../stock/index.ts'
import { createOrderpointFunctions } from '../stock/functions/orderpoints.ts'
import { createScrapFunctions } from '../stock/functions/scraps.ts'
import type { MakeReplenishment, SupplierReplenishment, SupplyOption } from '../stock/replenishment-policy.ts'
import { createForecastFunctions } from '../stock/functions/availability.ts'
import { selectProductSupplier, SUPPLIER_SELECTION_EFFECTS } from './supplier-selection.ts'
import { supplierRows } from './product-supplier-policy.ts'
import { inUnit } from './functions/shared.ts'

const suppliers: SupplierReplenishment = {
  effects: SUPPLIER_SELECTION_EFFECTS,
  async options(ctx, productId, at) {
    const product = (await ctx.db.select('product.Product', { id: productId }))[0]
    if (!product || product.active === false) return []
    const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    if (!template || template.active === false || template.purchaseOk !== true || template.type === 'combo')
      return []
    const options: SupplyOption[] = []
    for (const row of await supplierRows(ctx, template.id)) {
      if (
        (row.productId && row.productId !== product.id) ||
        (row.dateStart && String(row.dateStart) > at) ||
        (row.dateEnd && String(row.dateEnd) < at)
      )
        continue
      if (options.some((option) => option.partnerId === row.partnerId)) continue
      const partner = (await ctx.db.select('partner.Partner', { id: row.partnerId }))[0]
      if (
        !partner ||
        partner.active === false ||
        (await inUnit(ctx, 1, template.uomId, row.productUomId)) === null
      )
        continue
      options.push({
        partnerId: String(partner.id),
        name: String(partner.name),
        delay: Number(row.delay ?? 0),
      })
    }
    return options
  },
  async select(ctx, input) {
    const selected = await selectProductSupplier(ctx, input)
    if (!selected) return null
    const partner = (await ctx.db.select('partner.Partner', { id: selected.row.partnerId }))[0]
    return {
      partnerId: String(selected.row.partnerId),
      name: String(partner!.name),
      delay: Number(selected.row.delay ?? 0),
    }
  },
}

/**
 * Commerce opts in; other Stock compositions keep their route-only behavior and effects. With
 * `make`, a reorder rule may also draft manufacturing orders, and the forecast counts them (P12).
 */
export function stockWithProductSuppliers(options: { make?: MakeReplenishment } = {}) {
  const provider: SupplierReplenishment = options.make ? { ...suppliers, make: options.make } : suppliers
  return {
    ...stock,
    // Making stock reads and drafts manufacturing orders, so the rules name it.
    ...(options.make ? { optional: [...new Set([...(stock.optional ?? []), 'manufacturing'])] } : {}),
    functions: {
      ...stock.functions,
      ...createOrderpointFunctions(provider),
      // K59: a scrap order's replenishment runs the same supplier-aware rule.
      ...createScrapFunctions(provider),
      ...(options.make ? createForecastFunctions(options.make) : {}),
    },
  }
}
