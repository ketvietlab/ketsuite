import type { Ctx, Row } from '@ketvietlab/ketjs'
import { minorText, moneyMinor, multiplyDecimals, roundedQuotient, scaleOf } from '../account/money.ts'
import { ours } from './scope.ts'
import { companyCurrency, now } from './functions/shared.ts'

export const DELIVERED_COST_EFFECTS = [
  'read:sale.OrderLine',
  'read:sale.OrderLineCost',
  'write:sale.OrderLineCost',
  'read:stock.Move',
  'read:stock.ValuationLayer',
  'read:stock.ProductValuation',
  'read:product.Cost',
  'read:company.Company',
] as const

/** Quantities are exact to six decimals, as the stock ledger keeps them. */
const UNIT = 1_000_000n
/** Drivers hand decimals back as text or numbers; the exact math takes text. */
const decimal = (value: unknown) =>
  typeof value === 'number' ? value.toFixed(6) : String(value ?? '0').trim() || '0'

/**
 * What a sales line's goods cost once some of them left (K25, mock `saleLineCost`): the value its
 * deliveries took out, less what returns brought back, with what is still to deliver at the product's
 * average now, per unit of the line. The order's margin then reads what the goods cost, not what they
 * cost when quoted. A line none of whose goods left, or whose deliveries were never valued, keeps the cost
 * captured when it was written.
 */
export async function refreshDeliveredCosts(ctx: Ctx, orderId: unknown) {
  if (!ctx.manifest.models['stock.ValuationLayer']) return
  const scale = scaleOf(await companyCurrency(ctx))
  const lines = new Map(
    (await ours(ctx, 'sale.OrderLine', { orderId })).map((line) => [String(line.id), line]),
  )
  for (const cost of await ours(ctx, 'sale.OrderLineCost', { orderId })) {
    const line = lines.get(String(cost.lineId))
    if (!line?.productId || line.comboBasePrice != null || line.productId !== cost.productId) continue
    const taken = await deliveredWorth(ctx, line, scale)
    if (!taken || taken.units <= 0n) continue
    const held = (await ours(ctx, 'stock.ProductValuation', { productId: line.productId }))[0]
    const heldUnits = held ? moneyMinor(decimal(held.quantity), 6) : 0n
    const catalogue = (await ours(ctx, 'product.Cost', { productId: line.productId }))[0]?.standardPrice
    const average =
      heldUnits > 0n
        ? roundedQuotient(moneyMinor(decimal(held!.value), scale) * UNIT, heldUnits)
        : moneyMinor(decimal(catalogue ?? cost.baseCost), scale)
    // Ordered in the product's own unit, as the deliveries count it.
    const ordered = moneyMinor(multiplyDecimals(decimal(line.productUomQty), decimal(cost.factor)), 6)
    const rest = ordered > taken.units ? ordered - taken.units : 0n
    const whole = ordered > taken.units ? ordered : taken.units
    const each = roundedQuotient((taken.value + roundedQuotient(average * rest, UNIT)) * UNIT, whole)
    const baseCost = minorText(each, scale)
    const unitCost = minorText(moneyMinor(multiplyDecimals(baseCost, decimal(cost.factor)), scale), scale)
    if (decimal(cost.baseCost) === baseCost && decimal(cost.unitCost) === unitCost) continue
    await ctx.db.update('sale.OrderLineCost', { id: cost.id }, { baseCost, unitCost, capturedAt: now() })
  }
}

/** What a line's done deliveries took out, net of returns, in product units and currency minor units. */
async function deliveredWorth(ctx: Ctx, line: Row, scale: number) {
  let units = 0n
  let value = 0n
  for (const move of await ctx.db.select('stock.Move', { saleLineId: line.id, state: 'done' })) {
    if (moneyMinor(decimal(move.quantity), 6) <= 0n) continue
    const layers = await ours(ctx, 'stock.ValuationLayer', { moveId: move.id })
    // Done before valuation began: what it took out is unknown.
    if (!layers.length) return null
    for (const layer of layers) {
      units -= moneyMinor(decimal(layer.quantity), 6)
      value -= moneyMinor(decimal(layer.value), scale)
    }
  }
  return { units, value }
}
