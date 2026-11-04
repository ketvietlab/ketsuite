import type { Ctx, Row } from '@ketvietlab/ketjs'
import { linePrice } from './line-price.ts'
/** Compatibility API returns one base-unit net price and never matches package-only rules. */
export async function priceFor(
  ctx: Ctx,
  pricelistId: string,
  product: Row,
  template: Row,
  qty: number,
  date: string,
  seen: Set<string>,
  _depth = 0,
): Promise<{ price: number; ruleId: string | null }> {
  const result = await linePrice(ctx, pricelistId, product, template, String(qty), date, undefined, '1', seen)
  return { price: Number(result.price), ruleId: result.ruleId }
}
