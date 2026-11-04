import { materializeSaleReward } from '../reward-lines.ts'
import { deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { quoteTaxLine } from '../../account/functions.ts'
import {
  absDecimalText,
  canonicalDecimalText,
  minorText,
  moneyMinor,
  negateDecimalText,
  scaleOf,
} from '../../account/money.ts'
import { invalid, issue, n, snapshotOf } from '../../loyalty/engine.ts'
import { ours } from '../../sale/scope.ts'

export const effectsOf = (...specs: Array<FnSpec | undefined>): string[] => [
  ...new Set(specs.flatMap((spec) => spec?.effects ?? [])),
]

export const decimal = (value: number): string => String(value)

const lineTotal = async (ctx: Ctx, line: Row): Promise<string> => {
  if (line.priceSubtotalIncl != null) return canonicalDecimalText(String(line.priceSubtotalIncl))
  const quote = await quoteTaxLine(ctx, {
    productId: line.productId,
    taxIds: Array.isArray(line.taxIds) ? line.taxIds : line.taxId ? [line.taxId] : [],
    quantity: String(line.productUomQty ?? '1'),
    priceUnit: String(line.priceUnit ?? '0'),
    discount: String(line.discount ?? '0'),
    taxUse: 'sale',
  })
  return quote.ok === true ? quote.amountTotal : canonicalDecimalText(String(line.priceSubtotal ?? '0'))
}

export const saleSnapshot = async (ctx: Ctx, orderId: string) => {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order) return null
  const lines = await ours(ctx, 'sale.OrderLine', { orderId })
  return {
    orderType: 'sale',
    orderId,
    partnerId: order.partnerId,
    currency: order.currency,
    warehouseId: order.warehouseId ?? null,
    pricelistId: order.pricelistId ?? null,
    date: order.dateOrder,
    lines: await Promise.all(
      lines
        .filter((line) => !line.displayType)
        .map(async (line) => ({
          id: String(line.id),
          productId: line.productId ? String(line.productId) : null,
          quantity: n(line.productUomQty),
          comboParent: line.comboBasePrice != null,
          comboChild: Boolean(line.comboParentId),
          untaxed:
            line.comboBasePrice != null ? '0' : canonicalDecimalText(String(line.priceSubtotal ?? '0')),
          total: line.comboBasePrice != null ? '0' : await lineTotal(ctx, line),
          lineKind: String(line.lineKind ?? 'product'),
          ...(String(line.loyaltyApplicationId ?? '').startsWith(`sale:${orderId}:`)
            ? { loyaltyProgramId: String(line.loyaltyApplicationId).slice(`sale:${orderId}:`.length) }
            : {}),
          taxKey: JSON.stringify(
            [
              ...new Set(
                (Array.isArray(line.taxIds) ? line.taxIds : line.taxId ? [line.taxId] : []).map(String),
              ),
            ].sort(),
          ),
        })),
    ),
  }
}

const recompute = async (ctx: Ctx, orderId: string) => {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order) return
  const scale = scaleOf(order.currency)
  const lines = await ours(ctx, 'sale.OrderLine', { orderId })
  let untaxed = 0n
  let total = 0n
  for (const line of lines) {
    untaxed += moneyMinor(String(line.priceSubtotal ?? '0'), scale)
    total += moneyMinor(await lineTotal(ctx, line), scale)
  }
  await ctx.db.update(
    'sale.Order',
    {
      id: orderId,
    },
    {
      amountUntaxed: minorText(untaxed, scale),
      amountTax: minorText(total - untaxed, scale),
      amountTotal: minorText(total, scale),
    },
  )
}

export const removeRewardLines = async (ctx: Ctx, orderId: string, programId?: string) => {
  const L = ctx.table('sale.OrderLine')
  const lines = (await ours(ctx, 'sale.OrderLine', { orderId })).filter(
    (line) =>
      Boolean(line.loyaltyApplicationId) &&
      (!programId || String(line.loyaltyApplicationId) === `sale:${orderId}:${programId}`),
  )
  for (const line of lines) await ctx.db.del(deleteFrom(L).where(eq(L.id, line.id)))
  await recompute(ctx, orderId)
}

export const materializeReward = async (ctx: Ctx, orderId: string, programId: string, payload: Row) => {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order || !['draft', 'sent'].includes(String(order.state)) || order.locked)
    return invalid(issue('orderId', 'loyalty.error.state'))
  await removeRewardLines(ctx, orderId, programId)
  const reward = (await ctx.db.select('loyalty.Reward', { id: payload.rewardId }))[0]
  if (!reward) return invalid(issue('rewardId', 'loyalty.error.rewardMissing'))
  const program = (await ours(ctx, 'loyalty.Program', { id: programId }))[0]
  if (program?.salePolicyVersion === 1) {
    const snapshot = snapshotOf(await saleSnapshot(ctx, orderId))
    if (!snapshot) return invalid(issue('orderId', 'loyalty.error.order'))
    const result = await materializeSaleReward(ctx, order, reward, payload, snapshot)
    if (result.ok === true) await recompute(ctx, orderId)
    return result
  }
  const ordinary = (await ours(ctx, 'sale.OrderLine', { orderId })).filter(
    (line) => line.lineKind !== 'reward',
  )
  const productId = String(payload.productId ?? reward.lineProductId)
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  const uomId = template?.uomId ?? ordinary[0]?.productUomId
  if (!product || !uomId) return invalid(issue('rewardId', 'loyalty.error.rewardProduct'))
  const productReward = payload.rewardType === 'product'
  const quantity = productReward ? n(payload.productQuantity ?? 1) : 1
  const priceUnit = productReward
    ? '0'
    : negateDecimalText(absDecimalText(String(payload.discountAmount ?? '0')))
  const subtotal = productReward ? '0' : priceUnit
  await ctx.db.insert('sale.OrderLine', {
    id: `loyalty:${orderId}:${programId}`,
    orderId,
    productId,
    name: reward.description,
    productUomQty: decimal(quantity),
    productUomId: uomId,
    priceUnit,
    discount: '0',
    taxId: null,
    taxIds: [],
    taxEvidence: null,
    quoteRevision: null,
    qtyDelivered: '0',
    qtyInvoiced: '0',
    priceSubtotal: subtotal,
    priceSubtotalIncl: subtotal,
    sequence: 9000,
    lineKind: 'reward',
    loyaltyApplicationId: `sale:${orderId}:${programId}`,
    loyaltyRewardId: reward.id,
    loyaltyPointsCost: decimal(n(payload.requiredPoints)),
  })
  await recompute(ctx, orderId)
  return { ok: true }
}

export const snapshotEffects = [
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:account.Tax',
  'read:company.Company',
] as const

export const materializeEffects = [
  ...snapshotEffects,
  'write:sale.Order',
  'write:sale.OrderLine',
  'read:loyalty.Reward',
  'read:loyalty.Program',
  'read:loyalty.RewardProduct',
  'read:account.ProductTax',
  'read:product.Product',
  'read:product.Template',
] as const
