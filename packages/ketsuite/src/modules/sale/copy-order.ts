import { randomUUID } from 'node:crypto'
import { lockSalesConfiguration } from './configuration.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { salespeople } from './teams.ts'
import { createOrder } from './create-order.ts'
import { ours } from './scope.ts'
import { writeQuotationLine } from './functions/lines.ts'
import { applyDiscount } from './functions/discounts.ts'
import { addDecimals, compareDecimals } from '../account/money.ts'
import { invalid, now, externalOrder, SaleRefused, recompute } from './functions/shared.ts'

/** Copy commercial intent inside the caller's transaction; never copy fulfilment or ledger facts. */
export async function copyOrderInTransaction(ctx: Ctx, args: Row): Promise<Row> {
  if (!(await lockSalesConfiguration(ctx))) return invalid('id', 'sale.error.orderChanged')
  const receipt = (await ours(ctx, 'sale.OrderCopy', { id: args.id }))[0]
  if (receipt)
    return receipt.sourceId === args.sourceId &&
      Number(receipt.sourceRevision) === Number(args.expectedRevision)
      ? { ok: true, id: args.id, replayed: true }
      : invalid('id', 'sale.error.copyConflict')
  if (await ctx.db.select('sale.Order', { id: args.id }).then((rows) => rows.length))
    return invalid('id', 'sale.error.copyConflict')
  const source = (await ours(ctx, 'sale.Order', { id: args.sourceId }))[0]
  if (!source || externalOrder(source)) return invalid('sourceId', 'sale.error.copySource')
  if (Number(source.revision ?? 0) !== Number(args.expectedRevision))
    return invalid('expectedRevision', 'sale.error.orderChanged')
  const held = await ctx.db.compareAndSet(
    'sale.Order',
    { id: source.id },
    { revision: source.revision ?? null },
    { revision: source.revision ?? null },
  )
  if (!('dryRun' in held) && !held.matched) return invalid('expectedRevision', 'sale.error.orderChanged')
  const dateOrder = now()
  const validityDays = source.validityDate
    ? Math.max(
        1,
        Math.ceil(
          (Date.parse(String(source.validityDate)) - Date.parse(String(source.dateOrder))) / 86400000,
        ),
      )
    : null
  const created = await createOrder(
    ctx,
    {
      id: args.id,
      partnerId: source.partnerId,
      warehouseId: source.warehouseId,
      pricelistId: source.pricelistId,
      paymentTermId: source.paymentTermId,
      // The copy keeps its salesperson while they still sell here, in the team they sell in now.
      ...(source.userId && (await salespeople(ctx, [String(source.userId)])).has(String(source.userId))
        ? { userId: source.userId }
        : {}),
      shippingPolicy: source.shippingPolicy,
      notes: source.notes,
      dateOrder,
      validityDate:
        validityDays && Number.isFinite(validityDays)
          ? new Date(Date.parse(dateOrder) + validityDays * 86400000).toISOString()
          : null,
    },
    true,
  )
  if (created.ok !== true) return created
  const target = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!target) throw new SaleRefused(invalid('id', 'sale.error.copyConflict'))
  const lines = (await ours(ctx, 'sale.OrderLine', { orderId: source.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
  )
  const ordinary = lines.filter(
    (row) =>
      !row.comboParentId &&
      !row.loyaltyApplicationId &&
      !['reward', 'discount'].includes(String(row.lineKind)),
  )
  if (lines.length > 100) throw new SaleRefused(invalid('lines', 'sale.error.gridTooMany'))
  for (const [index, line] of ordinary.entries()) {
    const result = await writeQuotationLine(
      ctx,
      {
        id: randomUUID(),
        orderId: args.id,
        productId: line.productId,
        name: line.name,
        displayType: line.displayType,
        optionalSection: line.optionalSection,
        productUomId: line.productUomId,
        productUomQty: line.productUomQty,
        priceUnit: line.comboBasePrice ?? line.priceUnit,
        priceAutomatic: line.priceAutomatic,
        discount: line.discount,
        taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : []),
        // Keep source order even when legacy sequences tie; reserve room for combo children.
        sequence: (index + 1) * 100,
      },
      undefined,
      lines.filter((child) => child.comboParentId === line.id),
    )
    if (result.ok !== true) throw new SaleRefused(result)
  }
  const discount = lines
    .filter((line) => line.lineKind === 'discount' && !line.loyaltyApplicationId)
    .reduce((sum, line) => addDecimals(sum, String(line.priceSubtotal).replace(/^-/, '')), '0')
  if (compareDecimals(discount, '0') > 0) {
    const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]!
    const result = await applyDiscount(
      ctx,
      { id: args.id, expectedRevision: Number(order.revision ?? 0), mode: 'amount', value: discount },
      true,
    )
    if (result.ok !== true) throw new SaleRefused(result)
  }
  await recompute(ctx, args.id)
  await ctx.db.insert('sale.OrderCopy', {
    id: args.id,
    sourceId: source.id,
    sourceRevision: Number(source.revision ?? 0),
    copiedAt: dateOrder,
  })
  return { ok: true, id: args.id, name: target.name }
}

export async function copyOrder(ctx: Ctx, args: Row): Promise<Row> {
  try {
    return await ctx.tx(async (tx) => {
      const result = await copyOrderInTransaction(tx, args)
      if (result.ok !== true) throw new SaleRefused(result)
      return result
    })
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
}
