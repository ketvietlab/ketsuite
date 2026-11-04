import type { Ctx, Row } from '@ketvietlab/ketjs'
import { minorText, moneyMinor, scaleOf } from '../account/money.ts'
import { quoteTaxLine } from '../account/tax-quote.ts'
import { saleRewardBases } from '../loyalty/sale-policy.ts'
import type { OrderSnapshot } from '../loyalty/types.ts'
import { ours } from '../sale/scope.ts'
import { invalid, issue } from '../loyalty/engine.ts'

/** Materialize the same Sales basis the engine quoted, retaining each source tax group. */
export async function materializeSaleReward(
  ctx: Ctx,
  order: Row,
  reward: Row,
  payload: Row,
  snapshot: OrderSnapshot,
) {
  const all = await ours(ctx, 'sale.OrderLine', { orderId: order.id })
  const common = {
    orderId: order.id,
    name: reward.description,
    qtyDelivered: '0',
    qtyInvoiced: '0',
    quoteRevision: null,
    loyaltyApplicationId: `sale:${order.id}:${reward.programId}`,
    loyaltyRewardId: reward.id,
    loyaltyPointsCost: String(payload.requiredPoints ?? '0'),
  }
  let sequence = Math.max(0, ...all.map((row) => Number(row.sequence)))
  if (payload.rewardType === 'product') {
    const product = (await ctx.db.select('product.Product', { id: payload.productId }))[0]
    const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    if (!product?.active || !template?.active || template.type === 'combo' || !template.uomId)
      return invalid(issue('rewardId', 'loyalty.error.rewardProduct'))
    if (all.length >= 100) return invalid(issue('rewardId', 'sale.error.gridTooMany'))
    const quote = await quoteTaxLine(ctx, {
      productId: product.id,
      quantity: String(payload.productQuantity),
      priceUnit: String(template.listPrice ?? '0'),
      discount: '100',
      taxUse: 'sale',
    })
    if (!quote.ok) return quote
    await ctx.db.insert('sale.OrderLine', {
      ...common,
      id: `loyalty:${order.id}:${reward.programId}`,
      lineKind: 'reward',
      productId: product.id,
      productUomId: template.uomId,
      productUomQty: String(payload.productQuantity),
      priceUnit: quote.priceUnit,
      discount: '100',
      taxId: quote.taxIds[0] ?? null,
      taxIds: quote.taxIds,
      taxEvidence: { taxes: quote.taxes },
      priceSubtotal: quote.amountUntaxed,
      priceSubtotalIncl: quote.amountTotal,
      sequence: sequence + 100,
    })
    return { ok: true }
  }
  const products = new Set(
    (await ours(ctx, 'loyalty.RewardProduct', { rewardId: reward.id })).map((row) => String(row.productId)),
  )
  const saleProgramOrder = (await ours(ctx, 'loyalty.Program', { active: true }))
    .filter((row) => row.salePolicyVersion === 1)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)))
    .map((row) => String(row.id))
  const bases = saleRewardBases({ ...snapshot, saleProgramOrder }, reward, products)
  const groups = new Map<string, { base: bigint; taxIds: string[] }>()
  for (const part of bases) {
    const line = all.find((row) => row.id === part.id)!
    const taxIds = [
      ...new Set((Array.isArray(line.taxIds) ? line.taxIds : line.taxId ? [line.taxId] : []).map(String)),
    ].sort()
    const key = JSON.stringify(taxIds),
      group = groups.get(key) ?? { base: 0n, taxIds }
    group.base += part.base
    groups.set(key, group)
  }
  const scale = scaleOf(order.currency),
    amount = moneyMinor(payload.discountAmount, scale)
  const totalBase = bases.reduce((sum, row) => sum + row.base, 0n)
  if (amount <= 0n || amount > totalBase || all.length + groups.size > 100)
    return invalid(issue('rewardId', 'loyalty.error.invalid'))
  let remaining = amount
  for (const [index, group] of [...groups.values()].entries()) {
    const allocated = index === groups.size - 1 ? remaining : (amount * group.base) / totalBase
    remaining -= allocated
    if (!allocated) continue
    const quote = await quoteTaxLine(ctx, {
      taxIds: group.taxIds,
      quantity: '1',
      priceUnit: minorText(-allocated, scale),
      discount: '0',
      allowNegativePrice: true,
      discountLine: true,
    })
    if (!quote.ok) return quote
    sequence += 100
    await ctx.db.insert('sale.OrderLine', {
      ...common,
      id: `loyalty:${order.id}:${reward.programId}:${index}`,
      lineKind: 'discount',
      productId: null,
      productUomId: null,
      productUomQty: '1',
      priceUnit: quote.priceUnit,
      discount: '0',
      taxId: quote.taxIds[0] ?? null,
      taxIds: quote.taxIds,
      taxEvidence: { taxes: quote.taxes },
      priceSubtotal: quote.amountUntaxed,
      priceSubtotalIncl: quote.amountTotal,
      sequence,
    })
  }
  return { ok: true }
}
