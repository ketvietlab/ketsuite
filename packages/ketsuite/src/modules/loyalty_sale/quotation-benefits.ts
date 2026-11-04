import type { Ctx, Row } from '@ketvietlab/ketjs'
import { evaluate, snapshotOf, normalizeCode, invalid, issue } from '../loyalty/engine.ts'
import { applyOrderReward, removeOrderReward, orderFunctions } from '../loyalty/order-functions.ts'
import { ours } from '../sale/scope.ts'
import { SaleRefused } from '../sale/functions/shared.ts'
import { claimSaleProgramNamespace } from './programs.ts'
import {
  saleSnapshot,
  removeRewardLines,
  materializeReward,
  materializeEffects,
  effectsOf,
} from './functions/shared.ts'

export const quotationBenefitEffects = [
  ...new Set([
    ...materializeEffects,
    ...effectsOf(orderFunctions.applyReward, orderFunctions.removeReward),
    'read:loyalty.ProgramNamespace',
    'write:loyalty.ProgramNamespace',
  ]),
]

const must = (result: Row) => {
  if (result.ok !== true) throw new SaleRefused(result)
  return result
}
const applications = (ctx: Ctx, orderId: string) =>
  ours(ctx, 'loyalty.Application', { orderType: 'sale', orderId })

/** Rebuild only Sales-profile benefits inside the quotation writer's transaction. */
export async function refreshQuotationBenefits(
  ctx: Ctx,
  orderId: string,
  removedPrograms = new Set<string>(),
) {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (
    !order ||
    !['draft', 'sent'].includes(String(order.state)) ||
    order.locked ||
    (order.orderAuthority != null && order.orderAuthority !== 'local')
  )
    return
  await claimSaleProgramNamespace(ctx)
  const programs = (await ours(ctx, 'loyalty.Program')).filter((row) => row.salePolicyVersion === 1)
  if (!programs.length) return
  const native = new Map(programs.map((row) => [String(row.id), row]))
  const beforeFacts = JSON.stringify({
    earned: order.loyaltyPointsEarned ?? '0',
    spent: order.loyaltyPointsSpent ?? '0',
    rewards: await benefitFacts(ctx, orderId),
  })
  const prior = (await applications(ctx, orderId)).filter((row) => native.has(String(row.programId)))
  const selected = new Map(prior.map((row) => [String(row.programId), row]))
  // Release and rebuild within one transaction: other quotations cannot observe
  // the temporary release or spend the same reserved balance between these writes.
  for (const app of prior) {
    if (app.rewardId)
      must(
        await removeOrderReward(
          ctx,
          { orderType: 'sale', orderId, programId: app.programId },
          { inTransaction: true },
        ),
      )
    await removeRewardLines(ctx, orderId, String(app.programId))
    if (removedPrograms.has(String(app.programId))) {
      await ctx.db.update(
        'loyalty.Application',
        { id: app.id },
        { state: 'dismissed', code: null, walletId: null },
      )
      selected.set(String(app.programId), { ...app, state: 'dismissed', code: null, walletId: null })
    } else if (app.state === 'dismissed') {
      await ctx.db.update('loyalty.Application', { id: app.id }, { state: 'dismissed' })
    }
  }
  const codes = [...new Set([...selected.values()].map((row) => normalizeCode(row.code)).filter(Boolean))]
  const snapshot = snapshotOf({ ...(await saleSnapshot(ctx, orderId)), codes })
  if (!snapshot) throw new SaleRefused(invalid(issue('id', 'loyalty.error.order')))
  const eligible = await evaluate(ctx, snapshot)
  for (const candidate of eligible) {
    // Earlier programs may consume the remaining discountable basis. Re-evaluate
    // before selecting this reward; a fully discounted group produces no reward.
    const result = (
      await evaluate(ctx, snapshotOf({ ...(await saleSnapshot(ctx, orderId)), codes })!, {
        onlyProgramId: candidate.programId,
      })
    )[0]
    if (!result) continue
    const program = native.get(result.programId),
      previous = selected.get(result.programId)
    if (!program || previous?.state === 'dismissed') continue
    const automatic = ['promotion', 'buy_x_get_y'].includes(String(program.programType))
    const quote = previous?.rewardId
      ? result.rewards.find((row) => row.rewardId === previous.rewardId)
      : automatic || previous?.code
        ? result.rewards[0]
        : undefined
    if (!quote || (quote.rewardType !== 'product' && Number(quote.discountAmount) <= 0)) continue
    const applied = must(
      await applyOrderReward(
        ctx,
        {
          order: { ...(await saleSnapshot(ctx, orderId)), codes },
          programId: result.programId,
          rewardId: quote.rewardId,
          ...(previous?.pointsSpent ? { points: previous.pointsSpent } : {}),
        },
        { inTransaction: true },
      ),
    )
    must(await materializeReward(ctx, orderId, result.programId, applied.reward as Row))
  }
  const final = snapshotOf({ ...(await saleSnapshot(ctx, orderId)), codes })!
  const current = await evaluate(ctx, final)
  const saved = await applications(ctx, orderId)
  for (const app of saved.filter((row) => native.has(String(row.programId)))) {
    const points = String(current.find((row) => row.programId === app.programId)?.points ?? 0)
    if (app.pointsEarned !== points)
      await ctx.db.update('loyalty.Application', { id: app.id }, { pointsEarned: points })
  }
  const earned = String(current.reduce((sum, row) => sum + row.points, 0))
  const spent = String(saved.reduce((sum, row) => sum + Number(row.pointsSpent ?? 0), 0))
  const changed = beforeFacts !== JSON.stringify({ earned, spent, rewards: await benefitFacts(ctx, orderId) })
  await ctx.db.update(
    'sale.Order',
    { id: orderId },
    {
      ...(changed ? { revision: Number(order.revision ?? 0) + 1 } : {}),
      loyaltyState: 'draft',
      loyaltyPointsEarned: earned,
      loyaltyPointsSpent: spent,
    },
  )
}

/** A deleted tax-group row removes the entire application rather than leaving half a reward. */
export async function removedQuotationBenefits(ctx: Ctx, orderId: string, before: Row[]) {
  const after = new Set((await ours(ctx, 'sale.OrderLine', { orderId })).map((row) => row.id))
  return new Set(
    before
      .filter((row) => row.loyaltyApplicationId && !after.has(row.id))
      .map((row) => String(row.loyaltyApplicationId).slice(`sale:${orderId}:`.length)),
  )
}

async function benefitFacts(ctx: Ctx, orderId: string) {
  return (await applications(ctx, orderId))
    .filter((row) => row.rewardId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((row) => [
      row.id,
      row.rewardId,
      row.walletId,
      row.discountAmount,
      row.pointsSpent,
      row.rewardPayload,
    ])
}
