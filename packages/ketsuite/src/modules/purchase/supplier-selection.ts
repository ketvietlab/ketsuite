import type { Ctx, Row } from '@ketvietlab/ketjs'
import { minorText, multiplyToMinor, scaleOf } from '../account/money.ts'
import { currency, inUnit, n, productContext } from './functions/shared.ts'
import { companyCalendar, SUPPLIER_VALIDITY_EFFECTS, supplierValidity } from './supplier-validity.ts'

export const SUPPLIER_SELECTION_EFFECTS = [
  'read:purchase.SupplierInfo',
  'read:partner.Partner',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  ...SUPPLIER_VALIDITY_EFFECTS,
] as const

type Selection = { row: Row; quantityInSupplierUnit: number; unitsPerOrderUnit: number }

/** Shared by purchase pricing and product-driven replenishment; grid order is authoritative. */
export async function selectProductSupplier(
  ctx: Ctx,
  args: { productId: unknown; quantity: number; uomId: unknown; at: string; partnerId?: unknown },
): Promise<Selection | null> {
  if (!ctx.scope.company || !Number.isFinite(args.quantity) || args.quantity < 0) return null
  const product = await productContext(ctx, args.productId)
  if (!product) return null
  const calendar = await companyCalendar(ctx)
  const rows = (await ctx.db.select('purchase.SupplierInfo', { productTemplateId: product.template.id }))
    .filter((row) => String(row.companyId) === ctx.scope.company)
    .filter((row) => !args.partnerId || row.partnerId === args.partnerId)
    .filter((row) => !row.productId || row.productId === args.productId)
    .filter((row) => supplierValidity(row, args.at, calendar) === 'current')
    .sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
  const partners = new Map<unknown, boolean>()
  let first: Selection | null = null
  for (const row of rows) {
    if (!partners.has(row.partnerId)) {
      const partner = (await ctx.db.select('partner.Partner', { id: row.partnerId }))[0]
      partners.set(row.partnerId, Boolean(partner && partner.active !== false))
    }
    if (!partners.get(row.partnerId)) continue
    const quantityInSupplierUnit = await inUnit(ctx, args.quantity, args.uomId, row.productUomId)
    const unitsPerOrderUnit = await inUnit(ctx, 1, args.uomId, row.productUomId)
    if (quantityInSupplierUnit === null || unitsPerOrderUnit === null) continue
    const selection = { row, quantityInSupplierUnit, unitsPerOrderUnit }
    first ??= selection
    if (quantityInSupplierUnit >= n(row.minQty)) return selection
  }
  return first
}

/** Preserve supplier unit conversion and currency precision after choosing the row. */
export async function supplierPrice(
  ctx: Ctx,
  partnerId: unknown,
  productId: unknown,
  quantity: number,
  orderedUomId: unknown,
  at: string,
): Promise<Row | null> {
  const selected = await selectProductSupplier(ctx, {
    partnerId,
    productId,
    quantity,
    uomId: orderedUomId,
    at,
  })
  if (!selected) return null
  const scale = scaleOf(await currency(ctx))
  return {
    ...selected.row,
    price: minorText(multiplyToMinor([selected.row.price, String(selected.unitsPerOrderUnit)], scale), scale),
    minQtyOrdered: selected.quantityInSupplierUnit,
  }
}
