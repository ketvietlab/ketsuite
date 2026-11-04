import { supplierPrice, SUPPLIER_SELECTION_EFFECTS } from './supplier-selection.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { quoteTaxLineForPosting } from '../account/functions.ts'
import { compareDecimals } from '../account/money.ts'
import { describeVariantName, VARIANT_NAME_EFFECTS } from '../product/functions/variants.ts'
import { invalid, n, inUnit, productContext } from './functions/shared.ts'

export const lineEffects = [
  ...VARIANT_NAME_EFFECTS,
  ...SUPPLIER_SELECTION_EFFECTS,
  'read:purchase.Order',
  'read:purchase.OrderLine',
  'write:purchase.OrderLine',
  'write:purchase.Order',
  'read:purchase.SupplierInfo',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
  'read:account.Tax',
  'read:company.Company',
] as const

/** An RFQ accepts line changes until it is confirmed or locked. */
export const editableOrder = async (ctx: Ctx, orderId: unknown): Promise<Row | null> => {
  const order = (await ctx.db.select('purchase.Order', { id: orderId }))[0]
  if (!order || order.locked || !['draft', 'sent'].includes(String(order.state))) return null
  return order
}

export type PlannedLine = { values: Record<string, unknown> } | { error: ReturnType<typeof invalid> }

/**
 * Price and validate one line. Shared so adding and correcting a line cannot
 * drift apart — the second was missing entirely, which left a mistyped quantity
 * correctable only by cancelling the whole request.
 */
export async function planLine(ctx: Ctx, args: Record<string, unknown>): Promise<PlannedLine> {
  const order = await editableOrder(ctx, args.orderId)
  if (!order) return { error: invalid('orderId', 'lines can only be added to an unlocked RFQ') }
  if (compareDecimals(args.productQty, '0') <= 0)
    return { error: invalid('productQty', 'ordered quantity must be positive') }
  const context = await productContext(ctx, args.productId)
  if (!context?.template.purchaseOk) return { error: invalid('productId', 'product is not purchasable') }
  if (!(await ctx.db.select('uom.Unit', { id: args.productUomId }))[0])
    return { error: invalid('productUomId', 'unit of measure does not exist') }
  // A unit that measures something else is not a unit for this product. Without
  // this an order could be placed in kilograms for a product counted in pieces.
  if ((await inUnit(ctx, 1, args.productUomId, context.template.uomId)) === null)
    return { error: invalid('productUomId', 'unit does not measure the same thing as the product') }
  const price = await supplierPrice(
    ctx,
    order.partnerId,
    args.productId,
    n(args.productQty),
    args.productUomId,
    String(order.dateOrder),
  )
  const priceUnit = args.priceUnit ?? price?.price ?? '0'
  const discount = args.discount ?? price?.discount ?? '0'
  if (
    compareDecimals(priceUnit, '0') < 0 ||
    compareDecimals(discount, '0') < 0 ||
    compareDecimals(discount, '100') > 0
  )
    return { error: invalid('priceUnit', 'unit price and discount are invalid') }
  const tax = args.taxId ? (await ctx.db.select('account.Tax', { id: args.taxId }))[0] : null
  if (args.taxId && (!tax || !['purchase', 'none'].includes(String(tax.typeTaxUse))))
    return { error: invalid('taxId', 'tax use does not match a purchase order') }
  const datePlanned = String(
    args.datePlanned ??
      new Date(new Date(String(order.dateOrder)).getTime() + n(price?.delay ?? 1) * 86400000).toISOString(),
  )
  const quote = await quoteTaxLineForPosting(ctx, {
    taxIds: tax ? [tax.id] : [],
    quantity: args.productQty,
    priceUnit,
    discount,
    taxUse: 'purchase',
  })
  if (quote.ok !== true)
    return { error: invalid('taxId', String(quote.errors[0]?.message ?? 'invalid purchase tax')) }
  return {
    values: {
      productId: args.productId,
      name:
        args.name ??
        price?.productName ??
        (await describeVariantName(ctx, context.product, context.template)),
      productQty: String(args.productQty),
      productUomId: args.productUomId,
      priceUnit: String(priceUnit),
      discount: String(discount),
      taxId: args.taxId ?? null,
      datePlanned,
      priceSubtotal: quote.amountUntaxed,
    },
  }
}
