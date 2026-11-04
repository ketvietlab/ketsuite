import { deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals, multiplyDecimals } from '../account/money.ts'
import { companyKey, ours } from './scope.ts'
import { companyCurrency, now } from './functions/shared.ts'

export const LINE_COST_EFFECTS = ['read:sale.OrderLineCost', 'write:sale.OrderLineCost'] as const

/** Capture cost per selected selling unit; never convert it to the quotation currency. */
export async function captureLineCost(
  ctx: Ctx,
  line: Row,
  baseUomId: unknown,
  ratio: number,
  retained?: Row,
) {
  const cost = (await ours(ctx, 'product.Cost', { productId: line.productId }))[0]
  const factor = ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 })
  const currency = await companyCurrency(ctx)
  const id = companyKey(ctx, 'sale-line-cost', String(line.id))
  const existing = (await ours(ctx, 'sale.OrderLineCost', { id }))[0]
  const previous = existing ?? retained
  const keep =
    cost?.standardPrice == null &&
    previous?.productId === line.productId &&
    previous?.productUomId === line.productUomId &&
    previous?.baseUomId === baseUomId &&
    compareDecimals(previous.factor, factor) === 0 &&
    previous?.currency === currency
  if (keep && existing) return
  const baseCost = cost?.standardPrice == null ? null : String(cost.standardPrice)
  const values: Row = keep
    ? { ...previous, id: undefined, companyId: undefined }
    : {
        orderId: line.orderId,
        lineId: line.id,
        productId: line.productId,
        productUomId: line.productUomId,
        baseUomId,
        factor,
        baseCost,
        unitCost: baseCost === null ? null : multiplyDecimals(baseCost, factor),
        currency,
        capturedAt: now(),
      }
  delete values.id
  delete values.companyId
  if (existing) await ctx.db.update('sale.OrderLineCost', { id }, values)
  else await ctx.db.insert('sale.OrderLineCost', { id, ...values })
}

/** Caller owns the transaction; remove the satellite before deleting its line. */
export async function deleteLineCosts(ctx: Ctx, field: 'lineId' | 'orderId', id: unknown) {
  const C = ctx.table('sale.OrderLineCost')
  await ctx.db.del(deleteFrom(C).where(eq(C[field], String(id))))
}
