import type { Ctx, Row } from '@ketvietlab/ketjs'
import { ours } from './scope.ts'
import { deliveryPatch, deliverySchedule } from './delivery-promise.ts'
import { invalid, now, nextName, companyCurrency } from './functions/shared.ts'
import { orderSalesDefaults } from './teams.ts'
import { salesConfiguration } from './configuration.ts'

/**
 * What a new order is priced and paid by when its caller names nothing: the customer's own
 * pricelist and payment term in this company (D11), else the company's first active pricelist,
 * the retail one (D14); sold by the customer's salesperson or the person creating it, in that
 * salesperson's team (D16). An explicit null stays null.
 */
export async function orderDefaults(ctx: Ctx, args: Row) {
  const terms =
    args.pricelistId === undefined || args.paymentTermId === undefined || args.userId === undefined
      ? (await ours(ctx, 'sale.CustomerTerms', { partnerId: args.partnerId }))[0]
      : undefined
  let pricelistId = args.pricelistId
  if (pricelistId === undefined) {
    pricelistId =
      terms?.pricelistId ??
      (await ours(ctx, 'pricing.Pricelist', { active: true })).sort(
        (a, b) =>
          Number(a.sequence ?? 0) - Number(b.sequence ?? 0) || String(a.id).localeCompare(String(b.id)),
      )[0]?.id ??
      null
  }
  const sales = await orderSalesDefaults(ctx, args, terms?.userId)
  if (!('userId' in sales)) return sales
  return {
    ok: true as const,
    pricelistId,
    paymentTermId: args.paymentTermId === undefined ? (terms?.paymentTermId ?? null) : args.paymentTermId,
    userId: sales.userId,
    teamId: sales.teamId,
  }
}

/** Caller owns the transaction when composing quotation creation with other writers. */
export async function createOrder(ctx: Ctx, args: Row, requireNew = false) {
  const existing = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (existing)
    return requireNew
      ? invalid('id', 'sale.error.copyConflict')
      : { ok: true, id: args.id, name: existing.name }
  if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
    return invalid('partnerId', 'customer does not exist')
  if (!(await ours(ctx, 'stock.Warehouse', { id: args.warehouseId }))[0])
    return invalid('warehouseId', 'warehouse does not exist')
  if (args.pricelistId && !(await ctx.db.select('pricing.Pricelist', { id: args.pricelistId }))[0])
    return invalid('pricelistId', 'pricelist does not exist')
  const defaults = await orderDefaults(ctx, args)
  if (!('pricelistId' in defaults)) return defaults
  const refused = await deliveryPatch(ctx, args, { dateOrder: args.dateOrder ?? now() })
  if (refused) return refused
  const name = await nextName(ctx),
    dateOrder = await deliverySchedule(ctx, args.dateOrder ?? now())
  // A quotation nobody gave a validity is valid for the company's default number of days (D20).
  const days = args.validityDate === undefined ? (await salesConfiguration(ctx)).quotationValidityDays : null
  const validityDate =
    args.validityDate ??
    (days ? new Date(Date.parse(String(dateOrder)) + Number(days) * 86400000).toISOString() : null)
  // Two callers deciding on the same order at the same moment — a scheduled
  // import and a webhook delivering the same external order — both pass the
  // existence check above. The primary key settles it; the loser reads the
  // winner's row and answers ok, which is what `idempotent` promises. The
  // loser's sequence number is burned, which is the cheaper casualty.
  const inserted = await ctx.db.insertIfAbsent('sale.Order', {
    id: args.id,
    name,
    partnerId: args.partnerId,
    clientOrderRef: args.clientOrderRef ?? null,
    state: 'draft',
    locked: false,
    dateOrder,
    validityDate,
    commitmentDate: args.commitmentDate ? await deliverySchedule(ctx, args.commitmentDate) : null,
    shippingPolicy: args.shippingPolicy ?? 'direct',
    confirmedAt: null,
    warehouseId: args.warehouseId,
    pricelistId: defaults.pricelistId,
    paymentTermId: defaults.paymentTermId,
    userId: defaults.userId,
    teamId: defaults.teamId,
    currency: await companyCurrency(ctx),
    invoiceStatus: 'no',
    amountUntaxed: '0',
    amountTax: '0',
    amountTotal: '0',
    notes: args.notes ?? null,
    revision: 0,
  })
  if (!('dryRun' in inserted) && !inserted.inserted) {
    if (requireNew) return invalid('id', 'sale.error.copyConflict')
    const winner = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
    return { ok: true, id: args.id, name: winner?.name ?? name }
  }
  return { ok: true, id: args.id, name }
}
