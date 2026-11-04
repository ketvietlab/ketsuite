import type { Ctx } from '@ketvietlab/ketjs'
import { invalid, now, currency, nextName } from './functions/shared.ts'
import { planLine } from './line-plan.ts'
import { totals } from './order-amounts.ts'

/** Shared writes for standalone commands and atomic multi-line RFQ replacement. */
export async function createPurchaseDraft(ctx: Ctx, args: Record<string, unknown>) {
  const existing = (await ctx.db.select('purchase.Order', { id: args.id }))[0]
  if (existing) return { ok: true, id: args.id, name: existing.name }
  if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
    return invalid('partnerId', 'vendor does not exist')
  if (!(await ctx.db.select('stock.PickingType', { id: args.pickingTypeId }))[0])
    return invalid('pickingTypeId', 'receipt operation type does not exist')
  const dateOrder = String(args.dateOrder ?? now())
  const name = await nextName(ctx)
  await ctx.db.insert('purchase.Order', {
    id: args.id,
    name,
    partnerId: args.partnerId,
    // The vendor's own quotation number arrives with their reply, so it
    // cannot be a condition of asking them for one.
    partnerRef: String(args.partnerRef ?? '').trim(),
    state: 'draft',
    locked: false,
    dateOrder,
    dateApprove: null,
    datePlanned: args.datePlanned ?? dateOrder,
    pickingTypeId: args.pickingTypeId,
    currency: await currency(ctx),
    invoiceStatus: 'no',
    amountUntaxed: '0',
    amountTax: '0',
    amountTotal: '0',
    notes: args.notes ?? null,
    revision: 0,
  })
  return { ok: true, id: args.id, name }
}

export async function insertPurchaseLine(ctx: Ctx, args: Record<string, unknown>) {
  const existing = (await ctx.db.select('purchase.OrderLine', { id: args.id }))[0]
  // A retry must report what the line holds, not what this call would have
  // written. Returning a freshly computed price for a line that was never
  // touched is what made an edit look like it had worked.
  if (existing) return { ok: true, id: args.id, priceUnit: String(existing.priceUnit), existing: true }
  const planned = await planLine(ctx, args)
  if ('error' in planned) return planned.error
  const inserted = await ctx.db.insertIfAbsent('purchase.OrderLine', {
    ...planned.values,
    id: args.id,
    orderId: args.orderId,
    qtyReceived: '0',
    qtyInvoiced: '0',
    sequence: args.sequence ?? 10,
  })
  if (!('dryRun' in inserted) && !inserted.inserted) {
    // A concurrent retry won the insert; report the line it wrote.
    const raced = (await ctx.db.select('purchase.OrderLine', { id: args.id }))[0]
    return { ok: true, id: args.id, priceUnit: String(raced?.priceUnit ?? ''), existing: true }
  }
  await totals(ctx, args.orderId)
  return { ok: true, id: args.id, priceUnit: planned.values.priceUnit, existing: false }
}
